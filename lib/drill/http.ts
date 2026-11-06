// 訓練の API（app/api/drill/）の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
// 断り方: ログインしていなければ 401、ケアマネの役でなければ 403（行政・医療班・本人・家族・役を選ぶ前の審査員）、
// 形が違う 400（開始の 10 分版も。T124）、事業所の外・無い訓練 404、同じケアマネの進行中があるのに開始 409（T70。24 時間たった進行中は先に中断）、読んだ刻みと違う 409、終わった訓練を進める 409。
// 1 要求で進めるのは 1 刻みだけ（早送りもブラウザから 1 刻みずつ呼ぶ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { DRILL_ACTIONS, type DrillAction } from "../db/types.ts";
import { COLOR_LABELS } from "../labels.ts";
import { PseudonymLeakError } from "../pseudonym/index.ts";
import { FREE_TEXT_MAX } from "./action-catalog.ts";
import type { ActionHooks } from "./actions.ts";
import { FREE_LABELS } from "./free-action.ts";
import {
  abandonDrill,
  actDrill,
  advanceDrill,
  loadJudgeLog,
  readFreeDraft,
  drillScope,
  isDrillScenario,
  listDrills,
  MEMO_MAX,
  startDrill,
  type StartDeps,
  undoDrill,
  type DrillScope,
  type StartOptions,
} from "./db.ts";
import { isStaffCount } from "./engine.ts";
import type { StepHooks } from "./engine.ts";
import { ACTION_LABELS, DRILL_API_LABELS, SCENARIO_LABELS, type DrillApiError } from "./labels.ts";
import { ACT_LOG_CSV_NAMES, actLogCsv, buildActLog } from "./act-log.ts";
import { csvResponse } from "../forms/csv-response.ts";
import { csvFileNames } from "../forms/form9-csv.ts";
import { FREE_WAY_LABELS } from "./action-terms.ts";
import type { FreePlan } from "./action-types.ts";
import { isStartScenario, lastHour, scenarioOf } from "./scenarios.ts";
import { isClockStep, type ClockTo } from "./clock.ts";
import { cleanScale, type DrillScale } from "./scale.ts";
import { HOME_TOWN_MAX } from "./self.ts";
import { loadDrillScreen } from "./view.ts";

const STATUS: Record<DrillApiError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  running: 409,
  conflict: 409,
  ended: 409,
  locked: 409,
};

const NO_STORE = { "Cache-Control": "no-store" };

export function drillError(error: DrillApiError): Response {
  return Response.json({ ok: false, error, label: DRILL_API_LABELS[error] }, { status: STATUS[error], headers: NO_STORE });
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isDrillId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isStep = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;

function gate(p: Principal | null): DrillScope | Response {
  if (!p) return drillError("login_required");
  const scope = drillScope(p);
  return scope ?? drillError("forbidden");
}

/** 参加者の id の数の上限（担当一覧の人数より十分多く） */
const PARTICIPANTS_MAX = 200;

/**
 * 開始の前に選んだ物（T59）の形を見る。無ければ {}（今と同じ）。形が違えば null。
 * { participants?: 本人の id の配列（1 人以上）, staff?: 0〜9, night?: 真偽, clock?: 真偽（T90）, scale?: 規模（T104）, home?: 町名（T104）}。
 * 担当一覧の中か・地区の中かは startDrill が見る
 */
export function parseStartOptions(v: unknown): StartOptions | null {
  if (v === undefined || v === null) return {};
  const o = obj(v);
  if (!o) return null;
  const out: { participants?: string[]; staff?: number; night?: boolean; clock?: true; terms?: true; scale?: DrillScale; home?: string } = {};
  if (o.participants !== undefined) {
    const ps = o.participants;
    if (!Array.isArray(ps) || ps.length === 0 || ps.length > PARTICIPANTS_MAX || !ps.every(isDrillId)) return null;
    out.participants = ps;
  }
  if (o.staff !== undefined) {
    if (!isStaffCount(o.staff)) return null;
    out.staff = o.staff;
  }
  if (o.night !== undefined) {
    if (typeof o.night !== "boolean") return null;
    if (o.night) out.night = true;
  }
  // 連続の時計（T90。開始の画面が大雨・地震・仮想に付ける）。刻みの道の訓練（前からある 10 分版）では startDrill が捨てる
  if (o.clock !== undefined) {
    if (typeof o.clock !== "boolean") return null;
    if (o.clock) out.clock = true;
  }
  // 時間と状況で変わる手（T110。開始の画面が連続の時計の訓練に付ける）。連続の時計でない訓練に来たら startDrill が捨てる
  if (o.terms !== undefined) {
    if (typeof o.terms !== "boolean") return null;
    if (o.terms) out.terms = true;
  }
  // 仮想の規模（T104）。選ばなければおまかせ（startDrill が引く）。仮想でない想定に来たら startDrill が捨てる
  if (o.scale !== undefined) {
    const scale = cleanScale(o.scale);
    if (!scale) return null;
    out.scale = scale;
  }
  // 訓練する人の住む所（T104）。町名。担当一覧の人の地区の中かは startDrill が見る
  if (o.home !== undefined) {
    if (typeof o.home !== "string" || !o.home.trim() || Array.from(o.home.trim()).length > HOME_TOWN_MAX) return null;
    out.home = o.home.trim();
  }
  return out;
}

/**
 * 開始の POST（JSON）。{ scenario: heavy_rain・earthquake・virtual, options?: { participants?, staff?, night?, clock?, terms?, scale?, home? } }
 * （options は T59 から。無ければ担当一覧の全員・想定の表の職員・昼の発災）。
 * 10 分版（short）は T124 で外したので 400（入力不正）。前からある 10 分版の記録は一覧・再生・紙で今までどおり読める
 */
export async function startPost(db: D1Database, p: Principal | null, json: unknown, now: string, hooks?: StepHooks, deps?: StartDeps): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!b || !isDrillScenario(b.scenario) || !isStartScenario(b.scenario)) return drillError("invalid");
  const options = parseStartOptions(b.options);
  if (!options) return drillError("invalid");
  const r = await startDrill(db, scope, b.scenario, now, hooks, undefined, options, undefined, deps);
  if (!r.ok) return drillError(r.error === "running" ? "running" : r.error === "invalid" ? "invalid" : "not_found");
  return Response.json({ ok: true, id: r.id }, { headers: NO_STORE });
}

/**
 * 進め方（T90）の形を見る。{ minutes: 30・60・180 } か { next: true } か { acts: true }（T110 の手の分）。どれも無ければ undefined、形が違えば null（400）。
 * 両方あれば次の出来事まで（手の分は単独）
 */
export function parseClockTo(b: Record<string, unknown>): ClockTo | undefined | null {
  if (b.next !== undefined && b.next !== true) return null;
  if (b.minutes !== undefined && !isClockStep(b.minutes)) return null;
  if (b.acts !== undefined && (b.acts !== true || b.next !== undefined || b.minutes !== undefined)) return null;
  if (b.acts === true) return { acts: true };
  if (b.next === true) return { next: true };
  return isClockStep(b.minutes) ? { minutes: b.minutes } : undefined;
}

/**
 * 1 刻み進める POST（JSON）。{ step: 画面で読んだ今の刻み, minutes?: 30・60・180, next?: true }。
 * 連続の時計の訓練（T90）は minutes か next のどちらかが要る（無ければ 400）。clock の無い訓練は見ない（今までどおり 1 刻み）
 */
export async function stepPost(
  db: D1Database,
  p: Principal | null,
  id: string,
  json: unknown,
  now: string,
  hooks?: StepHooks,
): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step)) return drillError("invalid");
  const to = parseClockTo(b);
  if (to === null) return drillError("invalid");
  const r = await advanceDrill(db, scope, id, b.step, now, hooks, to);
  if (!r.ok) return drillError(r.error);
  return Response.json(
    { ok: true, step: r.step, hour: r.hour, status: r.status, ...(r.minute !== undefined ? { minute: r.minute } : {}) },
    { headers: NO_STORE },
  );
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000;
const isRef = (v: unknown): v is string | null => v === null || v === undefined || (typeof v === "string" && ID.test(v));

/**
 * ケアマネの手の POST（JSON、T20・T91）。{ step: 読んだ今の刻み, actions: 読んだ手の数, kind: 手の表の id, person: 本人の id か null, target: 連絡先の id か null,
 * text: 自由対応の文（自由対応だけ、120 字まで） }。自由対応の文を伏せきれなければ 400（label「伏字不可」）。
 * 相手は台帳の連絡先から決める（lib/drill/db.ts）。手の前の左の表は画面と同じ道（loadDrillScreen）で作って手の記録に残す
 */
export async function actionPost(
  db: D1Database,
  p: Principal | null,
  id: string,
  json: unknown,
  now: string,
  opts: { hooks?: ActionHooks; roll?: () => number } = {},
): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions)) return drillError("invalid");
  if (typeof b.kind !== "string" || !(DRILL_ACTIONS as readonly string[]).includes(b.kind)) return drillError("invalid");
  if (!isRef(b.person) || !isRef(b.target)) return drillError("invalid");
  // 手のメモ（T59、任意、100 字まで）。記録に残すだけで Claude には渡さない
  if (b.memo !== undefined && b.memo !== null && (typeof b.memo !== "string" || [...b.memo.trim()].length > MEMO_MAX)) return drillError("invalid");
  const memo = typeof b.memo === "string" ? b.memo.trim() : "";
  // 自由対応の文（T91、自由対応だけ、120 字まで）。伏せきれない文は 400「伏字不可」（Claude には送らない）
  if (b.text !== undefined && b.text !== null && (typeof b.text !== "string" || [...b.text.trim()].length > FREE_TEXT_MAX)) return drillError("invalid");
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (b.kind === "free" && text === "") return drillError("invalid");
  const screen = await loadDrillScreen(db, scope, id, null);
  if (!screen) return drillError("not_found");
  const ranked = screen.rows.filter((r) => r.rank !== null).sort((x, y) => x.rank! - y.rank!);
  const triage = {
    rows: new Map(
      screen.rows.map((r) => [r.id, { color: r.triage?.color ?? "gray", rank: r.rank, reason: r.triage?.reason ?? "" }] as const),
    ),
    ranking: ranked.map((r) => r.id),
  };
  let r: Awaited<ReturnType<typeof actDrill>>;
  try {
    r = await actDrill(
      db,
      scope,
      id,
      { step: b.step, actions: b.actions },
      {
        kind: b.kind as DrillAction,
        person: (b.person as string | null | undefined) ?? null,
        target: (b.target as string | null | undefined) ?? null,
        ...(memo ? { memo } : {}),
        ...(b.kind === "free" ? { text } : {}),
      },
      now,
      { ...(opts.hooks ? { hooks: opts.hooks } : {}), ...(opts.roll ? { roll: opts.roll } : {}), triage },
    );
  } catch (e) {
    if (e instanceof PseudonymLeakError) {
      return Response.json({ ok: false, error: "invalid", label: FREE_LABELS.refused }, { status: STATUS.invalid, headers: NO_STORE });
    }
    throw e;
  }
  if (!r.ok) return r.error === "blocked" ? blockedError(r.label) : drillError(r.error);
  return Response.json({ ok: true, id: r.record.id, step: r.step, hour: r.hour, minute: r.minute, status: r.status }, { headers: NO_STORE });
}

/**
 * 手の取消の POST（JSON、T59）。{ step: 読んだ今の刻み, actions: 読んだ手の数 }。最後の手 1 つだけ、刻みを越えなかった手だけ。
 * 断り方は stepPost と同じ（読んだ刻み・手の数と違えば 409、終わった訓練は 409）。刻みを越えた手は 409（取消不可）、手が無ければ 400
 */
export async function undoPost(db: D1Database, p: Principal | null, id: string, json: unknown): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions)) return drillError("invalid");
  const r = await undoDrill(db, scope, id, { step: b.step, actions: b.actions });
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true, id: r.id, step: r.step, hour: r.hour, minute: r.minute }, { headers: NO_STORE });
}

/** 決まりの表（T110）で押せない手の断り（409。label は理由の 2〜4 字） */
export function blockedError(label: string): Response {
  return Response.json({ ok: false, error: "blocked", label }, { status: 409, headers: NO_STORE });
}

/**
 * 自由対応の読み替えの POST（JSON、T110）。{ step: 読んだ今の刻み, actions: 読んだ手の数, person: 本人の id か null, text: 自由対応の文（200 字まで） }。
 * 打つ前に、読み替えた手（表の手かそのままの手）・相手・所要・押せない理由を返す（起きたことは打ってから）。確かめは訓練に置き、
 * 同じ文と本人で手の POST（kind free）を送ると Claude を呼ばずに打つ。伏せきれない文は 400「伏字不可」（Claude に送らない）。
 * plan は読み替えの口（lib/drill/free-action.ts の planFree に hooks.free を渡した物）
 */
export async function freePost(
  db: D1Database,
  p: Principal | null,
  id: string,
  json: unknown,
  plan: Parameters<typeof readFreeDraft>[5],
): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions) || !isRef(b.person)) return drillError("invalid");
  if (typeof b.text !== "string" || b.text.trim() === "" || [...b.text.trim()].length > FREE_TEXT_MAX) return drillError("invalid");
  let r: Awaited<ReturnType<typeof readFreeDraft>>;
  try {
    r = await readFreeDraft(db, scope, id, { step: b.step, actions: b.actions }, { person: (b.person as string | null | undefined) ?? null, text: b.text.trim() }, plan);
  } catch (e) {
    if (e instanceof PseudonymLeakError) {
      return Response.json({ ok: false, error: "invalid", label: FREE_LABELS.refused }, { status: STATUS.invalid, headers: NO_STORE });
    }
    throw e;
  }
  if (!r.ok) return r.error === "blocked" ? blockedError(r.label) : drillError(r.error);
  return Response.json({ ok: true, plan: planView(r.plan) }, { headers: NO_STORE });
}

/**
 * 画面に返す読み替え（T110）。打つ前に見せる物だけ（起きたこと・伏せた文・AI の判断の記録は返さない）。
 * label は扱い（表の手の名前、そのままの手はやり方の言葉、何も起きない文は「変化なし」。T129）、way はそのままの手のやり方の言葉。
 * person は本人を選ばずに名前を書いた文で決めた対象（T129）、alt は今できないときの今できる別の道（AI か決まりの言葉）
 */
export type FreePlanView = {
  as: DrillAction | null;
  label: string;
  way: string | null;
  callee: string | null;
  minutes: number;
  adds: string[];
  block: string | null;
  blockAi: boolean;
  words: string | null;
  reason: string | null;
  ai: boolean;
  person: string | null;
  alt: string | null;
  altAi: boolean;
  idle: boolean;
};

export function planView(plan: FreePlan): FreePlanView {
  return {
    as: plan.as,
    label: plan.as ? ACTION_LABELS[plan.as] : plan.idle ? FREE_LABELS.idle : plan.way ? FREE_WAY_LABELS[plan.way] : FREE_LABELS.idle,
    way: plan.way ? FREE_WAY_LABELS[plan.way] : null,
    callee: plan.calleeLabel,
    minutes: plan.minutes,
    adds: plan.adds,
    block: plan.block,
    blockAi: plan.blockAi,
    words: plan.words,
    reason: plan.reason,
    ai: plan.called,
    person: plan.person ?? null,
    alt: plan.alt ?? null,
    altAi: plan.altAi === true,
    idle: plan.idle === true,
  };
}

/**
 * 手と出来事のログ（T110）の GET。既定は CSV（lib/drill/act-log.ts。訓練記録の紙と同じ行）、?judge=1 は自由対応の AI の判断の記録の JSON
 * （lib/drill/db.ts の loadJudgeLog。評価の台が読む。伏せた入力と出力の要約だけ）。断り方は再生の GET と同じ（401・403・400・404）
 */
export async function logGet(db: D1Database, p: Principal | null, id: string, url: URL, now: string): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  if (!isDrillId(id)) return drillError("invalid");
  const s = await loadDrillScreen(db, scope, id, null);
  if (!s) return drillError("not_found");
  if (url.searchParams.get("judge") === "1") {
    return Response.json({ ok: true, drill: id, judges: await loadJudgeLog(db, scope.officeId, id) }, { headers: NO_STORE });
  }
  const office = (await db.prepare("SELECT name FROM offices WHERE id = ?1").bind(scope.officeId).first<{ name: string }>())?.name ?? "";
  const rows = buildActLog({ actions: s.state.actions, ticks: s.ticks }, { finished: s.drill.status !== "running" });
  const body = actLogCsv(rows, { names: s.names, officeName: office, scenario: SCENARIO_LABELS[s.drill.scenario], madeAt: now });
  return csvResponse(body, csvFileNames(now, ACT_LOG_CSV_NAMES));
}

/** 中断の POST */
export async function abandonPost(db: D1Database, p: Principal | null, id: string, now: string): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  if (!isDrillId(id)) return drillError("invalid");
  const r = await abandonDrill(db, scope, id, now);
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

/** 訓練記録の一覧の GET（事業所ごと）。now を渡すと先に 24 時間たった進行中を中断にする（T70） */
export async function listGet(db: D1Database, p: Principal | null, now?: string): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const items = await listDrills(db, scope.officeId, 50, now);
  return Response.json(
    {
      ok: true,
      drills: items.map((d) => ({
        id: d.id,
        scenario: d.scenario,
        status: d.status,
        step: d.step,
        hour: d.sim_hour,
        last: lastHour(scenarioOf(d.scenario)),
        startedAt: d.started_at,
        finishedAt: d.finished_at,
        startedBy: d.started_by_name,
        ...(d.abandon_reason ? { abandonReason: d.abandon_reason } : {}),
      })),
    },
    { headers: NO_STORE },
  );
}

/** 再生の読みの GET。step は見る刻み（無ければ今の刻み）。保存した物を読むだけで Claude を呼ばない */
export async function replayGet(db: D1Database, p: Principal | null, id: string, stepParam: string | null): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  if (!isDrillId(id)) return drillError("invalid");
  let want: number | null = null;
  if (stepParam !== null) {
    if (!/^\d{1,3}$/.test(stepParam)) return drillError("invalid");
    want = Number(stepParam);
  }
  const s = await loadDrillScreen(db, scope, id, want);
  if (!s) return drillError("not_found");
  return Response.json(
    {
      ok: true,
      drill: { id: s.drill.id, scenario: s.drill.scenario, status: s.drill.status, step: s.drill.step },
      shown: s.shown,
      hour: s.state.hour,
      minute: s.state.minute,
      actions: s.state.actions,
      hours: s.hours,
      world: s.state.world,
      ticks: s.ticks.map((t) => ({ step: t.step, hour: t.hour, incidents: t.incidents, turns: t.turns })),
      rows: s.rows.map((r) => ({
        person: r.id,
        rank: r.rank,
        color: r.triage?.color ?? null,
        state: r.triage ? COLOR_LABELS[r.triage.color] : null,
        reason: r.triage?.reason ?? null,
      })),
    },
    { headers: NO_STORE },
  );
}
