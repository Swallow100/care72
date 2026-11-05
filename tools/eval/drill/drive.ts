// 評価の台（docs/tasks/T108.md）: 1 回の訓練を、画面を通さずに最初から最後まで回す。
//
// - 使うのは訓練の公開の入口だけ: 開始・進める・手・往復・講評・読み戻し（lib/drill/http.ts・talk.ts・record-http.ts。route と同じ物）と、
//   hooks の作り口（drillStepHooks・drillFreeHook・drillTalkHook）。engine の中の型には頼らず、読み戻しの JSON をそのまま記録する
//   （同時に engine を直す作業があるため）
// - D1 は回ごとに新しい手元の DB（migrations と種の 10 人）。本番に触らない
// - 乱数は全部種から（手の選び方・手の結果の roll・偽の client）。開始の時刻も決まった時刻から

import type { DatabaseSync } from "node:sqlite";
import type { Principal } from "../../../lib/auth/principal.ts";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { d1FromSqlite, migratedSqlite } from "../../../lib/db/test-d1.ts";
import { ACTION_CATALOG } from "../../../lib/drill/action-catalog.ts";
import { TALK_ASKS } from "../../../lib/drill/dialogue.ts";
import { drillFreeHook } from "../../../lib/drill/free-action.ts";
import { drillStepHooks, drillTalkHook } from "../../../lib/drill/hooks.ts";
import { actionPost, replayGet, startPost, stepPost } from "../../../lib/drill/http.ts";
import { reviewPost } from "../../../lib/drill/record-http.ts";
import { warekiText } from "../../../lib/forms/wareki.ts";
import { talkPost } from "../../../lib/drill/talk.ts";
import { loadDrillScreen } from "../../../lib/drill/view.ts";
import type { RoomClient, WorldMode } from "../../../lib/drill/world-room.ts";
import { seedStatements } from "../../../seed/sql.ts";
import type { RunPlan } from "./plan.ts";
import type { RunLog } from "./record.ts";
import { rngOf, type Rng } from "./rng.ts";

// ---------- 読み戻しの形（http.ts の replayGet の JSON。欄は緩く読む） ----------

export type LooseIncident = {
  at?: number;
  text?: string;
  actor?: string;
  ai?: boolean;
  inject?: string;
  person?: string;
  reason?: string;
  change?: { kind?: string; [k: string]: unknown };
  [k: string]: unknown;
};
export type LooseTurn = {
  person?: string;
  color?: string;
  source?: string;
  whereNow?: string | null;
  injured?: boolean | null;
  atHome?: boolean | null;
  canMove?: boolean | null;
  hasMedicine?: boolean | null;
  saying?: string | null;
  doing?: string | null;
  ai?: boolean;
  at?: number;
  [k: string]: unknown;
};
export type LooseTick = { step: number; hour: number; incidents: LooseIncident[]; turns: LooseTurn[] };
export type LooseAction = {
  id?: string;
  kind?: string;
  as?: string;
  person?: string | null;
  atMinute?: number;
  endMinute?: number;
  minutes?: number;
  result?: {
    ok?: boolean;
    status?: string;
    speech?: string | null;
    speechAi?: boolean;
    pickup?: string | null;
    atMinute?: number;
    arriveAt?: number;
    talk?: Array<{ who?: string; text?: string; ai?: boolean }>;
    visit?: { condition?: string | null; speech?: string | null; asks?: string[]; ai?: boolean };
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
};
export type Replay = {
  drill: { id: string; scenario: string; status: string; step: number };
  hour: number;
  minute: number;
  actions: LooseAction[];
  world: Record<string, unknown> & { staff?: number; counts?: Record<string, number>; ended?: Record<string, { at?: number }>; arrivals?: Array<{ person?: string; arrive?: number }> };
  ticks: LooseTick[];
  rows: Array<{ person: string; rank: number | null; color: string | null; reason: string | null }>;
};

/** 1 つの要求（開始・進める・手・往復・講評）の結果 */
export type OpStat = { op: string; status: number; ok: boolean; took: number; error: string | null };

export type AiCallRow = { purpose: string; model: string; status: string; error: string | null; input_tokens: number | null; output_tokens: number | null };

export type RunOutcome = {
  plan: RunPlan;
  drillId: string | null;
  status: string;
  /** 進めた回数（開始を除く） */
  advances: number;
  replay: Replay | null;
  ops: OpStat[];
  errors: string[];
  aiCalls: AiCallRow[];
  /** 1 訓練の AI の残り（連続の時計の訓練の画面の「AI 残」。上限 150 から引いた数）。10 分版は null */
  callsLeft: number | null;
  /** 参加者の氏名（仮名化の門の試しの文に使った物。記録の外には出さない） */
  names: Record<string, string>;
  /** 世界の部屋の Agent と Environment（ai_agents の行）。次の回に渡して作り直さない */
  worldAgent: WorldAgentRow | null;
  /** 開始に手の決まり（T110 の terms）を送ったか（T121） */
  terms?: boolean;
  /** 人ごとの事実の帳面の門で落とした・直した数（T130。drills.world の写しの world.gated。再生の世界には入らない） */
  gated?: Record<string, number>;
  /** 想定の表の配役（T70。drills.world の写しの cast）。帳面の検査が表の行の安否を見分けるのに使う（T130） */
  cast?: Record<string, string>;
};

/** ai_agents の行（世界の部屋の Agent と Environment） */
export type WorldAgentRow = { version: number; agent_id: string; agent_version: number; environment_id: string; updated_at: string };

export type DriveDeps = {
  client: ClaudeClient;
  room: RoomClient;
  log: RunLog;
  /** 鍵（本物）か、偽の client のときの飾りの値 */
  key: string;
  world: WorldMode;
  /** 本物の部屋は待ち・時計を差し替えない */
  real: boolean;
  /** 進める回数の上限（72 時間に着く前に打ち切る） */
  maxAdvances: number;
  /** 終わったら講評（Opus 1 回）も作る */
  review: boolean;
  /**
   * 時間と状況で変わる手の決まり（T110 の DrillOptions.terms）を連続の時計の訓練の開始に送る（T121。開始の画面と同じ）。
   * 無ければ送る（false で送らない。決まりの無い前の回と比べるとき）
   */
  terms?: boolean;
  /**
   * 前の回で作った世界の部屋の Agent と Environment。回ごとに新しい DB なので、渡さないと本物の部屋は回ごとに Agent と Environment を作る
   * （消さずに残る）。渡せば DB の ai_agents に入れてから始める
   */
  worldAgent?: WorldAgentRow | null;
};

/** 訓練の発災の時刻（決まった時刻から。本物の時計の経過を足す） */
export const DRILL_START = Date.parse("2026-11-05T01:00:00.000Z");

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

export const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});

/** 種の 10 人を入れた手元の DB */
export function seededSqlite(): DatabaseSync {
  const sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  return sqlite;
}

/** 担当一覧の人（山本の担当、よみの順） */
export function caseloadOf(sqlite: DatabaseSync): string[] {
  return (sqlite.prepare("SELECT id FROM people WHERE care_manager_id = 'acct-yamamoto' AND office_id = 'office-demo' AND unlisted_at IS NULL ORDER BY kana, id").all() as Array<{ id: string }>).map((r) => r.id);
}

// ---------- 手の選び方 ----------

const FREE_TEXTS = [
  "家族に電話して様子を聞く",
  "訪問看護に連絡して様子を見てもらう",
  "薬局に薬を届けてもらえるか聞く",
  "市役所に安否の状況を報告する",
  "家族に連絡して避難できるか確かめる",
  "119 に電話するよう勧める",
  "近所の人に見に行ってもらう",
  "電源を貸してもらえる所を探す",
  "透析の病院に連絡して受け入れを確かめる",
  "避難所の空きを確かめる",
  "酸素の業者に配達を頼む",
  "事業所の職員に訪問を頼む",
  "移送の車を手配する",
  "今の様子を記録に残す",
];
const TALK_TEXTS = ["今どこにいますか", "けがはありませんか", "薬は足りていますか", "近くに誰かいますか", "停電は続いていますか", "あとでまた電話します"];

/** 手の表の重み（表に無い手・増えた手は 1） */
const KIND_WEIGHTS: Readonly<Record<string, number>> = { call_person: 5, call_contact: 3, visit: 2, dispatch: 2, report_city: 1, note: 0.5, evacuate_self: 0.2 };

type Contact = { id: string; person_id: string; kind: string };

type Request = { kind: string; person: string | null; target: string | null; text?: string; probe?: boolean };

function chooseAct(rng: Rng, plan: RunPlan, replay: Replay, contacts: ReadonlyArray<Contact>, names: Record<string, string>, births: Record<string, string> = {}): Request | null {
  const ended = new Set(Object.keys(replay.world.ended ?? {}));
  const live = plan.participants.filter((p) => !ended.has(p));
  if (live.length === 0) return null;
  const ranked = replay.rows.filter((r) => r.rank !== null && live.includes(r.person)).sort((a, b) => a.rank! - b.rank!);
  const person = ranked.length > 0 && rng.chance(plan.followRank) ? rng.pick(ranked.slice(0, 3)).person : rng.pick(live);
  if (rng.chance(plan.freeRate)) {
    const probe = rng.chance(plan.probeRate) && names[person];
    // 門の試し: 氏名と和暦の生年月日（T107 の書類の台の入力と同じ形「昭和17年4月18日生」。T118）を混ぜる
    const text = probe ? `${names[person]}さん（${births[person] ? `${births[person]}生` : ""}）の家に行って様子を見る`.replace("（）", "") : rng.pick(FREE_TEXTS);
    return { kind: "free", person, target: null, text, ...(probe ? { probe: true } : {}) };
  }
  const rows = ACTION_CATALOG.filter((r) => r.id !== "free");
  for (let i = 0; i < 6; i++) {
    const row = rng.weighted(rows.map((r) => [r, KIND_WEIGHTS[r.id] ?? 1] as const));
    const kinds = (row.targetKinds ?? []) as ReadonlyArray<string>;
    const who = row.id === "evacuate_self" ? null : row.needsPerson || kinds.length > 0 || rng.chance(0.5) ? person : null;
    if (row.id === "call_person") return { kind: row.id, person: who, target: null };
    if (kinds.length === 0) return { kind: row.id, person: who, target: null };
    const options = who ? contacts.filter((c) => c.person_id === who && kinds.includes(c.kind)) : [];
    if (options.length === 0) {
      if (row.needsTarget) continue;
      return { kind: row.id, person: who, target: null };
    }
    return { kind: row.id, person: who, target: row.needsTarget || rng.chance(0.7) ? rng.pick(options).id : null };
  }
  return { kind: "call_person", person, target: null };
}

// ---------- 1 回 ----------

export async function runDrill(plan: RunPlan, deps: DriveDeps): Promise<RunOutcome> {
  const { log } = deps;
  const rng = rngOf(`${plan.seed}/drive`);
  const roll = rngOf(`${plan.seed}/roll`);
  const t0 = Date.now();
  const nowMs = () => DRILL_START + (Date.now() - t0);
  const now = () => new Date(nowMs()).toISOString();
  const sqlite = seededSqlite();
  if (deps.worldAgent) {
    const a = deps.worldAgent;
    sqlite
      .prepare("INSERT INTO ai_agents (purpose, version, agent_id, agent_version, environment_id, updated_at) VALUES ('drill_world', ?, ?, ?, ?, ?)")
      .run(a.version, a.agent_id, a.agent_version, a.environment_id, a.updated_at);
  }
  const db = d1FromSqlite(sqlite);
  const p = careManager();
  const env = { DB: db, ANTHROPIC_API_KEY: deps.key, DRILL_WORLD: deps.world };
  const nowDate = () => new Date(nowMs());
  const stepHooks = drillStepHooks(env, p, {
    claude: deps.client,
    now: nowDate,
    room: deps.room,
    ...(deps.real ? {} : { roomTime: { sleep: async () => {}, clock: Date.now } }),
  });
  const free = drillFreeHook(env, p, { claude: deps.client, now: nowDate });
  const talk = drillTalkHook(env, p, { claude: deps.client, now: nowDate });
  const actHooks = { ...(stepHooks ?? {}), ...(free ? { free } : {}) };

  const contacts = sqlite.prepare("SELECT id, person_id, kind FROM contacts ORDER BY person_id, sort, id").all() as Contact[];
  const names = Object.fromEntries(
    (sqlite.prepare("SELECT id, name FROM people").all() as Array<{ id: string; name: string }>).filter((r) => plan.participants.includes(r.id)).map((r) => [r.id, r.name]),
  );
  // 門の試しの文に混ぜる和暦の生年月日（空きを抜いた warekiText。T107 の入力と同じ形。T118）
  const births = Object.fromEntries(
    (sqlite.prepare("SELECT id, birth_date FROM people").all() as Array<{ id: string; birth_date: string | null }>)
      .filter((r) => plan.participants.includes(r.id) && r.birth_date)
      .map((r) => [r.id, warekiText(r.birth_date!).replace(/ /g, "")]),
  );

  const ops: OpStat[] = [];
  const errors: string[] = [];
  let failsInRow = 0;

  /** 要求 1 つ。始めと終わりを記録し、間に AI の呼び出しが入る */
  const call = async (op: string, req: unknown, run: () => Promise<Response>): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    log.push({ type: "op", phase: "start", op, req });
    const a = Date.now();
    let status = 0;
    let body: Record<string, unknown> | null = null;
    let error: string | null = null;
    try {
      const res = await run();
      status = res.status;
      body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch (e) {
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      errors.push(`${op}: ${error}`);
    }
    const took = Date.now() - a;
    const ok = error === null && status === 200 && body?.ok === true;
    failsInRow = ok ? 0 : failsInRow + 1;
    // 断られた要求の理由（body の error。決まりどおりの断り blocked を失敗と分ける、T121）
    const refused = !ok && error === null && typeof body?.error === "string" ? body.error : null;
    ops.push({ op, status, ok, took, error: error ?? refused });
    log.push({ type: "op", phase: "end", op, status, ok, took, body, error });
    return { status, body };
  };

  let lastStep = -1;
  let lastActions = new Map<string, string>();
  const read = async (drillId: string): Promise<Replay> => {
    const res = await replayGet(db, p, drillId, null);
    const r = (await res.json()) as Replay;
    // 新しい刻みと、新しい・結果の変わった手だけを記録する（世界と左の表は毎回全部）
    const ticks = r.ticks.filter((t) => t.step > lastStep);
    lastStep = Math.max(lastStep, ...r.ticks.map((t) => t.step));
    const acts = r.actions.filter((a) => lastActions.get(String(a.id)) !== JSON.stringify(a));
    lastActions = new Map(r.actions.map((a) => [String(a.id), JSON.stringify(a)]));
    log.push({
      type: "state",
      step: r.drill.step,
      status: r.drill.status,
      hour: r.hour,
      minute: r.minute,
      staff: r.world.staff ?? null,
      counts: r.world.counts ?? null,
      rows: r.rows,
      ticks,
      actions: acts,
      world: r.world,
    });
    return r;
  };

  try {
    log.push({ type: "run", plan, participants: plan.participants, startedAt: new Date(DRILL_START).toISOString() });
    const options = {
      participants: plan.participants,
      ...(plan.night ? { night: true } : {}),
      ...(plan.staff !== null ? { staff: plan.staff } : {}),
      // 台の想定は全部連続の時計（10 分版は T124 で外した）。開始の画面と同じく clock と terms を送る
      clock: true,
      ...(deps.terms !== false ? { terms: true } : {}),
      ...(plan.scale ? { scale: plan.scale } : {}),
    };
    const startReq = { scenario: plan.scenario, options };
    // 開始の時刻は記録の startedAt と同じ DRILL_START にそろえる（訓練の種〔lib/drill/time-odds.ts の drillSeed〕が開始の時刻から作られ、
    // 壁の時計の数 ms のずれで同じ種の回の出来事が変わらないように。T124 で台の既定の組が全部連続の時計になった）
    const started = await call("start", startReq, () => startPost(db, p, startReq, new Date(DRILL_START).toISOString(), stepHooks));
    const drillId = typeof started.body?.id === "string" ? started.body.id : null;
    if (!drillId) return { plan, drillId: null, status: "not_started", advances: 0, replay: null, ops, errors, aiCalls: aiCallsOf(sqlite), callsLeft: null, names, worldAgent: worldAgentOf(sqlite) };
    let replay = await read(drillId);
    let advances = 0;

    while (replay.drill.status === "running" && advances < deps.maxAdvances && failsInRow < 6) {
      // ケアマネの手（0 か 1〜actMax）
      if (rng.chance(plan.actRate)) {
        const n = rng.int(1, plan.actMax);
        for (let i = 0; i < n && replay.drill.status === "running"; i++) {
          const req = chooseAct(rng, plan, replay, contacts, names, births);
          if (!req) break;
          const body = {
            step: replay.drill.step,
            actions: replay.actions.length,
            kind: req.kind,
            person: req.person,
            target: req.target,
            ...(req.text ? { text: req.text } : {}),
          };
          const r = await call(req.probe ? "act_probe" : "act", body, () => actionPost(db, p, drillId, body, now(), { hooks: actHooks, roll: roll.next }));
          replay = await read(drillId);
          const id = typeof r.body?.id === "string" ? r.body.id : null;
          const done = id ? replay.actions.find((a) => a.id === id) : undefined;
          // 通話に出たら往復（決まった問いか自由の 1 文）。終わりに切る
          if (done?.result?.pickup === "answers" && talk && rng.chance(plan.talkRate) && replay.drill.status === "running") {
            const rounds = rng.int(1, 2);
            for (let k = 0; k < rounds; k++) {
              const ask = rng.chance(0.6) ? { ask: rng.pick(TALK_ASKS) } : { text: rng.pick(TALK_TEXTS) };
              const tb = { step: replay.drill.step, actions: replay.actions.length, action: id, ...ask };
              await call("talk", tb, () => talkPost(db, p, drillId, tb, { hook: talk }));
              replay = await read(drillId);
            }
            const eb = { step: replay.drill.step, actions: replay.actions.length, action: id, end: true };
            await call("talk_end", eb, () => talkPost(db, p, drillId, eb, { hook: talk }));
            replay = await read(drillId);
          }
        }
        if (replay.drill.status !== "running") break;
      }
      // 進める（連続の時計は 30 分・1 時間・3 時間・次まで、10 分版は 1 刻み）
      const pace = rng.weighted<{ minutes: number } | { next: true }>([
        [{ minutes: 30 }, plan.pace.m30],
        [{ minutes: 60 }, plan.pace.h1],
        [{ minutes: 180 }, plan.pace.h3],
        [{ next: true }, plan.pace.next],
      ]);
      const sb = { step: replay.drill.step, ...pace };
      await call("advance", sb, () => stepPost(db, p, drillId, sb, now(), stepHooks));
      advances += 1;
      replay = await read(drillId);
    }

    if (deps.review && replay.drill.status === "finished") {
      await call("review", {}, () => reviewPost(env, p, drillId, {}, { claude: deps.client, now: nowDate }));
    }
    const callsLeft = (await loadDrillScreen(db, { officeId: DEMO.id }, drillId, null))?.left ?? null;
    log.push({ type: "end", status: replay.drill.status, step: replay.drill.step, minute: replay.minute, advances, callsLeft });
    return { plan, drillId, status: replay.drill.status, advances, replay, ops, errors, aiCalls: aiCallsOf(sqlite), callsLeft, names, worldAgent: worldAgentOf(sqlite), terms: options.terms === true, ...storedOf(sqlite, drillId) };
  } finally {
    sqlite.close();
  }
}

function worldAgentOf(sqlite: DatabaseSync): WorldAgentRow | null {
  return (sqlite.prepare("SELECT version, agent_id, agent_version, environment_id, updated_at FROM ai_agents WHERE purpose = 'drill_world'").get() as WorldAgentRow | undefined) ?? null;
}

/** 帳面の門の数と表の配役（T130。保存した drills.world の写しから。再生の世界には入らない） */
function storedOf(sqlite: DatabaseSync, drillId: string): { gated: Record<string, number>; cast: Record<string, string> } {
  const row = sqlite.prepare("SELECT json_extract(world, '$.world.gated') AS g, json_extract(world, '$.cast') AS c FROM drills WHERE id = ?").get(drillId) as
    | { g: string | null; c: string | null }
    | undefined;
  const parse = (t: string | null | undefined): Record<string, never> => {
    try {
      return t ? JSON.parse(t) : {};
    } catch {
      return {};
    }
  };
  return { gated: parse(row?.g), cast: parse(row?.c) };
}

function aiCallsOf(sqlite: DatabaseSync): AiCallRow[] {
  return sqlite.prepare("SELECT purpose, model, status, error, input_tokens, output_tokens FROM ai_calls ORDER BY started_at, id").all() as AiCallRow[];
}
