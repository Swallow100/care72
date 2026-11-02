// ケアマネの 7 つの手と世界の返事（docs/tasks/T20.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 7 つの手の所要時間、相手が台帳の連絡先に限られる、手の記録の形（採点 T22 が読む）、時計と割り込み（着信）、
// 職員の空きの増減、印が消える、電話の返事（番号なし・不通・応答なし・無言・通話）、監督の言い換え、保存と再生、API の壁。
// 色は lib/triage の色の名前（red・yellow・gray・green）で比べ、画面の言葉を書かない（言葉は別の作業で変わる）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { DRILL_ACTIONS, type DrillAction, type DrillScenario } from "../db/types.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import {
  ACTION_MINUTES,
  act,
  decideAction,
  DISPATCH_ARRIVE_MINUTES,
  DISPATCH_BACK_MINUTES,
  type ActTarget,
  type CallHook,
} from "./actions.ts";
import { actDrill, advanceDrill, drillScope, loadDrillRow, loadTicks, participantsOf, replayState, startDrill, stateOfRow } from "./db.ts";
import { DIRECTOR_SYSTEM } from "./director.ts";
import { DrillEnded, initialState, simAt, step, type DirectorHook, type DrillState } from "./engine.ts";
import { drillHooks } from "./hooks.ts";
import { actionPost } from "./http.ts";
import { ACTION_LABELS, CALL_FIXED_SPEECH, clockLabel } from "./labels.ts";
import { CALL_SYSTEM, PERSONA_SYSTEM, type PersonaAnswer } from "./persona.ts";
import { applyEvent, EMPTY_WORLD, injectChange, SCENARIOS } from "./scenarios.ts";
import { VISIT_CONFIRMED } from "../triage/index.ts";
import { loadDrillScreen } from "./view.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown, model: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => Message) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return answer(params);
        },
      },
    },
  };
  return { client, calls };
}

const systemOf = (p: Params) => (p.system as Array<{ text: string }>).map((b) => b.text).join("\n");
const inputOf = (p: Params) => JSON.parse(p.messages[0].content as string) as Record<string, { text: string }>;

const QUIET: PersonaAnswer = {
  condition: "",
  location: "home",
  action: "",
  contactsCaremanager: false,
  from: "",
  pressesRed: false,
  redAnswers: null,
  speech: "",
};

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);

function expectNoPersonalData(text: string) {
  expect(findLeaks(text, ALL_KEY)).toEqual([]);
  expect(text).not.toMatch(/090-?0000/);
}

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };
const careManager = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t20";

/** 決まった順の値を返す（足りなければ最後の値） */
const seq =
  (...xs: number[]) =>
  () =>
    xs.length > 1 ? xs.shift()! : xs[0];

async function start(scenario: DrillScenario = "heavy_rain", hooks = {}) {
  const r = await startDrill(db, SCOPE, scenario, START, hooks, () => ID);
  expect(r).toEqual({ ok: true, id: ID });
  return ID;
}

async function advanceTo(id: string, stepIndex: number, hooks = {}) {
  for (;;) {
    const row = (await loadDrillRow(db, DEMO.id, id))!;
    if (row.step >= stepIndex) return;
    const r = await advanceDrill(db, SCOPE, id, row.step, START, hooks);
    expect(r.ok).toBe(true);
  }
}

async function doAct(
  kind: DrillAction,
  person: string | null,
  target: string | null = null,
  opts: Parameters<typeof actDrill>[6] = {},
) {
  const row = (await loadDrillRow(db, DEMO.id, ID))!;
  const n = stateOfRow(row).actions.length;
  return actDrill(db, SCOPE, ID, { step: row.step, actions: n }, { kind, person, target }, START, { roll: () => 0, ...opts });
}

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

async function colors(): Promise<Record<string, string | undefined>> {
  const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
  return Object.fromEntries(s.rows.map((r) => [r.id, r.triage?.color]));
}

const events = (kind: string) =>
  sqlite
    .prepare(`SELECT step, sim_hour, person_id, actor, payload FROM drill_events WHERE drill_id = ? AND kind = ? ORDER BY seq`)
    .all(ID, kind) as Array<{ step: number; sim_hour: number; person_id: string | null; actor: string; payload: string }>;

// ---------- 表 ----------

describe("7 つの手の表", () => {
  it("手は 7 つで、所要時間は表で固定（出向く 40 分）。ボタンの言葉は 2〜5 字", () => {
    expect(Object.keys(ACTION_MINUTES).sort()).toEqual([...DRILL_ACTIONS].sort());
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...DRILL_ACTIONS].sort());
    expect(ACTION_MINUTES.visit).toBe(40);
    expect(ACTION_MINUTES).toEqual({
      call_person: 5,
      call_contact: 5,
      visit: 40,
      dispatch: 10,
      request_welfare_shelter: 15,
      report_city: 10,
      evacuate_self: 30,
    });
    // 刻みの間はいちばん短くて 60 分。手 1 つで刻みを 2 つ越えない
    for (const m of Object.values(ACTION_MINUTES)) expect(m).toBeGreaterThan(0), expect(m).toBeLessThanOrEqual(60);
    for (const l of Object.values(ACTION_LABELS)) expect(Array.from(l).length).toBeGreaterThanOrEqual(2), expect(Array.from(l).length).toBeLessThanOrEqual(5);
    expect(clockLabel(85)).toBe("1 時間 25 分");
    expect(clockLabel(180)).toBe("3 時間");
  });
});

// ---------- 相手 ----------

describe("相手は台帳の連絡先だけ", () => {
  it("本人電話は本人の連絡先を自動で選ぶ。連絡先電話はその人のほかの連絡先、訪問依頼は訪問看護・介護事業所か事業所の職員", async () => {
    await start();
    const ok = await doAct("call_person", "p-01", "c-02-1");
    expect(ok).toMatchObject({ ok: true, record: { id: "a1", target: "c-01-0", callee: "self", calleeLabel: "本人" } });
    expect(await doAct("call_contact", "p-01", "c-01-1")).toMatchObject({
      ok: true,
      record: { target: "c-01-1", callee: "family", calleeLabel: "家族 娘" },
    });
    // ほかの人の連絡先・本人の連絡先・相手なしの連絡先電話は断る
    expect(await doAct("call_contact", "p-01", "c-02-1")).toEqual({ ok: false, error: "invalid" });
    expect(await doAct("call_contact", "p-01", "c-01-0")).toEqual({ ok: false, error: "invalid" });
    expect(await doAct("call_contact", "p-01", null)).toEqual({ ok: false, error: "invalid" });
    expect(await doAct("call_contact", "p-01", "c-99-9")).toEqual({ ok: false, error: "invalid" });
    // 訪問依頼: 家族は相手にならない。小林の訪問看護はよい、相手なしは事業所の職員
    expect(await doAct("dispatch", "p-01", "c-01-1")).toEqual({ ok: false, error: "invalid" });
    expect(await doAct("dispatch", "p-02", "c-02-2")).toMatchObject({ ok: true, record: { callee: "visiting_nurse" } });
    expect(await doAct("dispatch", "p-04", null)).toMatchObject({ ok: true, record: { callee: null, target: null } });
    // 訪問・受入依頼は相手を受けない。本人が要る手で本人なし・参加者でない人は断る
    expect(await doAct("visit", "p-05", "c-05-1")).toEqual({ ok: false, error: "invalid" });
    expect(await doAct("visit", null)).toEqual({ ok: false, error: "invalid" });
    expect(await doAct("visit", "p-99")).toEqual({ ok: false, error: "invalid" });
    // 行政報告は本人なし（全体）でよい。退避は本人を持たない
    expect(await doAct("report_city", null)).toMatchObject({ ok: true, record: { person: null } });
    expect(await doAct("evacuate_self", "p-01")).toMatchObject({ ok: true, record: { person: null, target: null } });
    // 断った物は残らない
    expect((await stored()).actions.map((a) => a.kind)).toEqual(["call_person", "call_contact", "dispatch", "dispatch", "report_city", "evacuate_self"]);
  });

  it("ほかの事業所の本人の連絡先は選べない（協力事業所の担当一覧の訓練から）", async () => {
    await start();
    const partner = careManager({ office: PARTNER, accountId: "acct-partner-cm", caseloadOf: "acct-partner-cm" });
    const r = await actionPost(db, partner, ID, { step: 0, actions: 0, kind: "call_contact", person: "p-01", target: "c-01-1" }, START);
    expect(r.status).toBe(404);
  });
});

// ---------- 手の記録 ----------

describe("手の記録（drill_events の action と result、drills.world）", () => {
  it("誰に・何を・何時・手の前の状態（左の表の色と並び）と、世界の返事。名前と番号は残さない", async () => {
    await start();
    await advanceTo(ID, 2); // 3 時間: 山田が赤
    const r = await actionPost(db, careManager(), ID, { step: 2, actions: 0, kind: "call_contact", person: "p-01", target: "c-01-1" }, START, {
      roll: () => 0,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, id: "a1", step: 2, hour: 3, minute: 185, status: "running" });

    const [action] = events("action");
    expect(action).toMatchObject({ step: 2, sim_hour: 3, person_id: "p-01", actor: "care_manager" });
    const a = JSON.parse(action.payload);
    expect(a).toMatchObject({
      id: "a1",
      kind: "call_contact",
      person: "p-01",
      target: "c-01-1",
      callee: "family",
      calleeLabel: "家族 娘",
      at: 3,
      atMinute: 180,
      endMinute: 185,
      minutes: 5,
      step: 2,
      before: {
        person: { color: "red", source: "agent", saying: "いたい、うごけない" },
        marks: {},
        staff: 3,
        phone: "busy",
        roadClosed: false,
        triage: { color: "red", rank: 1 },
      },
    });
    expect(a.before.ranking[0]).toBe("p-01");
    expect(a.before.ranking).toHaveLength(10);
    expect(a).not.toHaveProperty("result");

    const [result] = events("result");
    expect(result).toMatchObject({ step: 2, person_id: "p-01", actor: "persona" });
    expect(result.sim_hour).toBeCloseTo(185 / 60);
    expect(JSON.parse(result.payload)).toEqual({
      id: "a1",
      ok: true,
      status: "connected",
      because: null,
      text: "つながった",
      ai: false,
      speech: CALL_FIXED_SPEECH,
      speechAi: false,
      pickup: "answers",
      cleared: [],
      staff: 0,
      crossed: [],
      atMinute: 185,
      // 娘が出て答えた → 聞いた安否（T21）。色と 4 問は本人役の今の様子（3 時間の赤・けが）から
      heard: { via: "call", color: "red", whereNow: null, injured: true, atHome: null, canMove: null, hasMedicine: null, at: 185 / 60 },
    });

    // drills.world にも同じ手と返事
    const s = await stored();
    expect(s.minute).toBe(185);
    expect(s.actions).toHaveLength(1);
    expect(s.actions[0]).toMatchObject({ ...a, result: { status: "connected" } });

    // 名前と番号は残さない（連絡先の続柄と区分だけ）
    const text = sqlite.prepare("SELECT group_concat(payload, ' ') AS t FROM drill_events WHERE drill_id = ? AND kind IN ('action', 'result')").get(ID) as { t: string };
    const names = SEED_PEOPLE.flatMap((p) => [p.person.name, ...p.contacts.map((c) => c.name).filter((x): x is string => !!x)]);
    for (const n of names) expect(text.t).not.toContain(n);
    expect(text.t).not.toMatch(/090-?0000/);
    // 本人の経過（本番）には書かない
    expect((sqlite.prepare("SELECT count(*) AS n FROM timeline_entries WHERE kind = 'called'").get() as { n: number }).n).toBe(0);
  });
});

// ---------- 時計と割り込み ----------

describe("時計と割り込み（着信）", () => {
  it("手は所要時間だけ時計を進め、次の刻みの時刻を越えたらその刻みを進める。その間の安否は着信", async () => {
    await start();
    expect((await doAct("call_person", "p-01")) as { ok: boolean }).toMatchObject({ ok: true });
    expect((await stored()).minute).toBe(5);
    await doAct("visit", "p-03"); // 0:05 → 0:45
    const third = await doAct("visit", "p-05"); // 0:45 → 1:25 で 1 時間を越える
    expect(third).toMatchObject({ ok: true, step: 1, hour: 1, minute: 85, record: { id: "a3", result: { status: "arrived", crossed: [1] } } });
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    expect(row).toMatchObject({ step: 1, sim_hour: 1 });
    // 1 時間の刻み（表の出来事と安否）が保存される。安否のうち電話の形の物（小林の夫）は着信（手 a3 の途中の割り込み）。
    // 本人（加藤・井上）の緑はボタンなので着信にしない。0 時間の家族の電話（田中・高橋）は進めるで来た着信（手の途中でない）
    expect(events("incident").filter((e) => e.step === 1)).toHaveLength(2);
    expect(events("call_in").map((e) => [e.step, e.person_id, JSON.parse(e.payload).during ?? null])).toEqual([
      [0, "p-06", null],
      [0, "p-03", null],
      [1, "p-02", "a3"],
    ]);
    expect(JSON.parse(events("call_in")[2].payload)).toMatchObject({
      order: 0,
      source: "family",
      color: "green",
      saying: "停電した。呼吸器が電池に切り替わった。3 時間しかもたない",
      ai: false,
    });
    // 返事は越えた刻みの世界（警戒レベル 4）で決まる。訪問の返事の時刻は手の終わり
    expect(JSON.parse(events("result")[2].payload)).toMatchObject({ id: "a3", atMinute: 85, crossed: [1] });
    // 左の表の「今」はケアマネの時計
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.situation.now).toBe(simAt(START, 85 / 60));
    // 進めると次の刻み（3 時間）。時計は刻みの時刻
    expect(await advanceDrill(db, SCOPE, ID, 1, START)).toMatchObject({ ok: true, step: 2, hour: 3 });
    expect((await stored()).minute).toBe(180);
  });

  it("終わった訓練には打てない（engine でも保存でも）", async () => {
    await start("short");
    await advanceTo(ID, 3);
    expect(await doAct("visit", "p-01")).toEqual({ ok: false, error: "ended" });
    const s = await stored();
    await expect(act(s, { kind: "visit", person: "p-01", target: null })).rejects.toBeInstanceOf(DrillEnded);
  });
});

// ---------- 世界の返事 ----------

async function stateAt(n: number, scenario: DrillScenario = "heavy_rain"): Promise<DrillState> {
  let s = initialState(scenario, PARTICIPANTS, START);
  for (let i = 0; i < n; i++) s = (await step(s)).state;
  return s;
}

const SELF_01: ActTarget = { id: "c-01-0", kind: "self", label: "本人", hasPhone: true };
const DAUGHTER_01: ActTarget = { id: "c-01-1", kind: "family", label: "家族 娘", hasPhone: true };

describe("世界の返事", () => {
  it("電話: 番号なし・不通・応答なし・無言・通話。鍵なしの通話は、相手の安否の言う事か固定の言葉", async () => {
    const s = await stateAt(3); // 3 時間: 山田が「いたい、うごけない」、電話 不安定
    const call = (target: ActTarget, roll: () => number, state = s) =>
      act(state, { kind: target.kind === "self" ? "call_person" : "call_contact", person: "p-01", target }, {}, roll).then((r) => r.record.result!);
    expect(await call(SELF_01, () => 0)).toMatchObject({ status: "connected", ok: true, speech: "いたい、うごけない", speechAi: false, pickup: "answers" });
    // 家族に出てもらったときは本人の言う事を使わない
    expect(await call(DAUGHTER_01, () => 0)).toMatchObject({ status: "connected", speech: CALL_FIXED_SPEECH });
    // 不安定: 出る 50%・背景の音だけ 20%
    expect(await call(SELF_01, seq(0, 0.6))).toMatchObject({ status: "silent", ok: false, speech: null, pickup: "background_only" });
    expect(await call(SELF_01, seq(0, 0.95))).toMatchObject({ status: "noAnswer", ok: false, speech: null, pickup: "no_answer" });
    expect(await call({ ...SELF_01, hasPhone: false }, () => 0)).toMatchObject({ status: "noNumber", ok: false });
    const lineDown = { ...s, world: applyEvent(s.world, { change: injectChange("line_down", "p-01"), text: "", person: "p-01" }, 3) };
    expect(await call(SELF_01, () => 0, lineDown)).toMatchObject({ status: "noLine", because: "家の電話 不通", ok: false });
    // 施設: 田中の透析施設が休止なら受けられない
    const flooded = { ...s, world: applyEvent(s.world, { change: injectChange("dialysis_flooded", "p-03"), text: "", person: "p-03" }, 3) };
    const dialysis: ActTarget = { id: "c-03-4", kind: "dialysis_center", label: "透析施設", hasPhone: true };
    const r = await act(flooded, { kind: "call_contact", person: "p-03", target: dialysis }, {}, () => 0);
    expect(r.record.result).toMatchObject({ status: "closed", because: "透析施設 休止", speech: null, pickup: null });
  });

  it("訪問: 家の前の道が通行止なら着けない（伊藤、3 時間）。受入依頼は時間で受け入れが変わる。退避はいつも避難済", async () => {
    const s = await stateAt(3);
    expect(decideAction({ kind: "visit", person: "p-05", target: null }, s.world, 3, () => 0)).toMatchObject({
      status: "blocked",
      because: "川沿いの市道 通行止",
      ok: false,
    });
    expect(decideAction({ kind: "visit", person: "p-01", target: null }, s.world, 3, () => 0.69)).toMatchObject({ status: "arrived" });
    expect(decideAction({ kind: "visit", person: "p-01", target: null }, s.world, 3, () => 0.7)).toMatchObject({ status: "turnedBack" });
    expect(decideAction({ kind: "request_welfare_shelter", person: "p-05", target: null }, s.world, 3, () => 0.29).status).toBe("accepted");
    expect(decideAction({ kind: "request_welfare_shelter", person: "p-05", target: null }, s.world, 3, () => 0.3).status).toBe("refused");
    expect(decideAction({ kind: "request_welfare_shelter", person: "p-05", target: null }, s.world, 48, () => 0.79).status).toBe("accepted");
    expect(decideAction({ kind: "evacuate_self", person: null, target: null }, s.world, 3, () => 0.99).status).toBe("evacuated");
    expect(decideAction({ kind: "report_city", person: null, target: null }, { ...s.world, phone: "down" }, 3, () => 0)).toMatchObject({
      status: "noLine",
      because: "電話 不通",
    });
  });
});

// ---------- 職員の空きと印 ----------

describe("職員の空きと印", () => {
  it("訪問依頼（事業所の職員）は空きを 1 減らし、戻る時刻に戻す。訪問看護は減らさない。空きが 0 なら手配不可", async () => {
    await start();
    expect((await stored()).world.staff).toBe(3);
    expect(await doAct("dispatch", "p-04", null)).toMatchObject({ record: { result: { status: "dispatched", staff: -1 } } });
    let s = await stored();
    expect(s.world.staff).toBe(2);
    expect(s.world.dispatched).toEqual([{ person: "p-04", arrive: 10 + DISPATCH_ARRIVE_MINUTES, back: 10 + DISPATCH_BACK_MINUTES, arrived: false }]);
    expect(await doAct("dispatch", "p-02", "c-02-2")).toMatchObject({ record: { result: { status: "dispatched", staff: 0 } } });
    expect((await stored()).world.staff).toBe(2);
    await doAct("dispatch", "p-01", null);
    await doAct("dispatch", "p-03", null);
    expect((await stored()).world.staff).toBe(0);
    expect(await doAct("dispatch", "p-05", null)).toMatchObject({
      record: { result: { status: "noDispatch", because: "職員の空き なし", ok: false, staff: 0 } },
    });
    // 1 時間（60 分）ではまだ戻らない（着いたのは 50 分の佐藤と 60 分の訪問看護）。3 時間（180 分）で 3 人とも戻る
    await advanceTo(ID, 1);
    s = await stored();
    expect(s.world.staff).toBe(0);
    expect(s.world.dispatched.map((d) => [d.person, d.arrived])).toEqual([
      ["p-04", true],
      ["p-01", false],
      ["p-03", false],
    ]);
    await advanceTo(ID, 2);
    s = await stored();
    expect(s.world.staff).toBe(3);
    expect(s.world.dispatched).toEqual([]);
  });

  it("訪問で着いたら栄養剤の持ち出し忘れの印が消え、左の表の黄が外れる。手の前の印は記録に残る", async () => {
    await start();
    await advanceTo(ID, 3); // 6 時間: 高橋の家族が栄養剤を持ち出し忘れ
    expect((await colors())["p-06"]).toBe("yellow");
    const r = await doAct("visit", "p-06");
    expect(r).toMatchObject({ ok: true, record: { before: { marks: { supplyLeft: 6 } }, result: { status: "arrived", cleared: ["supplyLeft"] } } });
    expect((await stored()).world.marks["p-06"]).toBeUndefined();
    expect((await colors())["p-06"]).toBe("green");
  });

  it("訪問依頼は着く時刻に印を消す。受入依頼が受けられたら消す。電話の不通の印は消えない", async () => {
    await start();
    await advanceTo(ID, 3);
    await doAct("dispatch", "p-06", null); // 6:00 → 6:10、着くのは 6:50
    expect((await stored()).world.marks["p-06"]).toEqual({ supplyLeft: 6 });
    expect((await colors())["p-06"]).toBe("yellow");
    await advanceTo(ID, 4); // 9 時間
    expect((await stored()).world.marks["p-06"]).toBeUndefined();
    expect((await colors())["p-06"]).toBe("green");
  });

  it("受入依頼が受けられたら印を消す（電話の不通は残る）", async () => {
    let s = await stateAt(4);
    s = { ...s, world: applyEvent(s.world, { change: injectChange("line_down", "p-06"), text: "", person: "p-06" }, 6) };
    expect(s.world.marks["p-06"]).toEqual({ supplyLeft: 6, lineDown: 6 });
    const r = await act(s, { kind: "request_welfare_shelter", person: "p-06", target: null }, {}, () => 0);
    expect(r.record.result).toMatchObject({ status: "accepted", cleared: ["supplyLeft"] });
    expect(r.state.world.marks["p-06"]).toEqual({ lineDown: 6 });
  });
});

// ---------- 鍵あり（偽の Claude）: 受け入れ ----------

/** 偽の Claude: 電話に出た人は山田の言葉、1 時間の刻みで小林の夫が連絡、監督は差し込みなしで a3 の返事を言い換える */
function rain(p: Params): Message {
  const system = systemOf(p);
  const input = inputOf(p);
  if (system.includes(CALL_SYSTEM)) return reply({ speech: "いたい、うごけん。足が動かんのよ" }, HAIKU);
  if (system.includes(PERSONA_SYSTEM)) {
    const profile = input["本人役"]?.text ?? "";
    const tick = input["この刻み"]?.text ?? "";
    if (profile.includes("人工呼吸器") && tick.includes("発災から 1 時間")) {
      return reply({ ...QUIET, contactsCaremanager: true, from: "夫", location: "home", speech: "停電した。呼吸器の電池が心配です" }, HAIKU);
    }
    return reply(QUIET, HAIKU);
  }
  expect(system).toContain(DIRECTOR_SYSTEM);
  const asked = input["返事"]?.text ?? "";
  return reply({ events: [], ...(asked.includes("a3") ? { replies: [{ id: "a3", text: "雨の中、家の前まで着いた" }] } : {}) }, OPUS);
}

describe("鍵あり（偽の Claude）", () => {
  it("大雨: 本人電話 → 山田 で本人役の返事が吹き出しに。訪問 → 伊藤 で 40 分進み、その間に小林の家族から着信。越えた刻みの監督が返事を言い換える", async () => {
    const { client, calls } = fake(rain);
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!;
    expect(hooks.call).toBeDefined();
    await start("heavy_rain", hooks);

    // 本人電話 → 山田（0:00 → 0:05）
    const a1 = await doAct("call_person", "p-01", null, { hooks });
    expect(a1).toMatchObject({
      ok: true,
      record: { result: { status: "connected", speech: "いたい、うごけん。足が動かんのよ", speechAi: true, ai: false } },
    });
    const call = calls.find((c) => systemOf(c).includes(CALL_SYSTEM))!;
    expect(inputOf(call)["電話"].text).toContain("電話に出た人: 本人");
    expectNoPersonalData(JSON.stringify(call));

    // 訪問 → 田中（0:05 → 0:45）、訪問 → 伊藤（0:45 → 1:25。1 時間の刻みを越える）
    await doAct("visit", "p-03", null, { hooks });
    const a3 = await doAct("visit", "p-05", null, { hooks });
    expect(a3).toMatchObject({ ok: true, step: 1, minute: 85, record: { result: { status: "arrived", crossed: [1] } } });
    // 越えた刻みの監督（Opus 1 回）が返事を言い換えた。越えていない訪問は固定の文
    const s = await stored();
    expect(s.actions[2].result).toMatchObject({ text: "雨の中、家の前まで着いた", ai: true, status: "arrived", ok: true });
    expect(s.actions[1].result).toMatchObject({ text: "家に着いた", ai: false });
    const director = calls.filter((c) => systemOf(c).includes(DIRECTOR_SYSTEM));
    expect(director).toHaveLength(2); // 0 時間と 1 時間（言い換えのための呼び出しは増えない）
    const asked = inputOf(director[1])["返事"].text;
    expect(asked).toContain("a3");
    expect(asked).toContain("到着");
    expectNoPersonalData(JSON.stringify(director[1]));

    // 小林の夫の連絡が 1 時間の刻みの安否で、着信（手 a3 の途中）
    const callIns = events("call_in").map((e) => ({ person: e.person_id, ...JSON.parse(e.payload) }));
    expect(callIns.find((c) => c.person === "p-02")).toMatchObject({
      during: "a3",
      source: "family",
      color: "green",
      saying: "停電した。呼吸器の電池が心配です",
      ai: true,
    });
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.ticks[1].turns.find((t) => t.person === "p-02")).toMatchObject({ source: "family", ai: true });
    expect(screen.state.actions.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);

    // 呼び出しの数: 本人役 10 人 × 2 刻み + 電話 1、監督 2
    const ai = sqlite.prepare("SELECT purpose, count(*) AS n FROM ai_calls GROUP BY purpose ORDER BY purpose").all();
    expect(ai).toEqual([
      { purpose: "director", n: 2 },
      { purpose: "persona", n: 21 },
    ]);
  });

  it("言い換えは結果を変えない。使えない言葉・頼んでいない手の言い換えは捨て、固定の文", async () => {
    const director: DirectorHook = async (input) => ({
      events: [],
      words: (input.replies ?? []).map((r) => ({ id: r.id, text: "" })).concat([{ id: "a9", text: "頼んでいない" }]),
    });
    const s = await stateAt(1); // 0 時間の刻みのあと
    const r = await act({ ...s, minute: 50 }, { kind: "visit", person: "p-05", target: null }, { director }, () => 0);
    expect(r.record.result).toMatchObject({ status: "arrived", text: "家に着いた", ai: false, crossed: [1] });
    // 監督が投げても返事は固定の文で進む
    const boom: DirectorHook = async () => {
      throw new Error("監督が落ちた");
    };
    const r2 = await act({ ...s, minute: 50 }, { kind: "visit", person: "p-05", target: null }, { director: boom }, () => 0);
    expect(r2.record.result).toMatchObject({ status: "arrived", ai: false });
    expect(r2.state.step).toBe(1);
  });
});

// ---------- 聞いた安否（T21、11/3 07:0x の確定 2） ----------

const heardRows = () =>
  sqlite
    .prepare(
      `SELECT id, person_id, color, source, where_now, injured, can_move, transcript, occurred_at FROM signals
        WHERE drill_id = ? AND source = 'care_manager' ORDER BY occurred_at, id`,
    )
    .all(ID) as Array<Record<string, unknown>>;

describe("聞いた安否（通話で答えた・訪問で会えた）", () => {
  it("通話で家族が出て答えたら、安否（出どころ ケアマネ、文字起こしなし、AI の印なし）を足し、左の表の灰が緑に動く", async () => {
    await start();
    expect((await colors())["p-02"]).toBe("gray");
    const r = await doAct("call_contact", "p-02", "c-02-1"); // 0:00 → 0:05、出る
    expect(r).toMatchObject({ ok: true, record: { result: { status: "connected", heard: { via: "call", color: "green", at: 5 / 60 } } } });
    expect(heardRows()).toEqual([
      {
        id: `${ID}-a1-h`,
        person_id: "p-02",
        color: "green",
        source: "care_manager",
        where_now: null,
        injured: null,
        can_move: null,
        transcript: null,
        occurred_at: simAt(START, 5 / 60),
      },
    ]);
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    const row = screen.rows.find((x) => x.id === "p-02")!;
    expect(row.triage).toMatchObject({ color: "green", rule: "green" });
    expect(row.triage?.reason).toContain("ケアマネ");
    expect(screen.heard).toEqual({ [`${ID}-a1-h`]: "call" });
    expect(screen.aiSignals).not.toContain(`${ID}-a1-h`);
  });

  it("出ない・無言・番号なし・言葉の無い相手（訪問看護）は聞いた安否にならない", async () => {
    await start();
    expect(await doAct("call_contact", "p-02", "c-02-1", { roll: seq(0, 0.99) })).toMatchObject({ record: { result: { status: "noAnswer", heard: null } } });
    expect(await doAct("call_contact", "p-02", "c-02-1", { roll: seq(0, 0.87) })).toMatchObject({ record: { result: { status: "silent", heard: null } } });
    expect(await doAct("call_contact", "p-02", "c-02-2")).toMatchObject({ record: { result: { heard: null } } });
    expect(heardRows()).toEqual([]);
  });

  it("赤の本人に電話: 本人役の赤と 4 問の答えを写す。山田は最上位の赤（けが）のまま", async () => {
    await start();
    await advanceTo(ID, 2); // 3 時間: 山田が赤（けが）
    await doAct("call_person", "p-01", null);
    expect(heardRows()).toMatchObject([{ person_id: "p-01", color: "red", injured: 1, can_move: null, where_now: null }]);
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    const yamada = screen.rows.find((x) => x.id === "p-01")!;
    expect(yamada.triage).toMatchObject({ color: "red", rule: "red_injury" });
    expect(yamada.rank).toBe(1);
  });

  it("訪問で着いたら「確認済」（緑の理由）。着けなかった訪問は安否にならない", async () => {
    await start();
    expect((await colors())["p-04"]).toBe("gray");
    expect(await doAct("visit", "p-04")).toMatchObject({ record: { result: { status: "arrived", heard: { via: "visit", color: "green" } } } });
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.rows.find((x) => x.id === "p-04")!.triage).toMatchObject({ color: "green", reason: VISIT_CONFIRMED });
    expect(screen.heard).toEqual({ [`${ID}-a1-h`]: "visit" });
    // 3 時間: 伊藤の家の前の市道が通行止め → 着けない
    await advanceTo(ID, 2);
    expect(await doAct("visit", "p-05", null, { roll: () => 0.99 })).toMatchObject({ record: { result: { heard: null } } });
    expect(heardRows()).toHaveLength(1);
  });

  it("競合した手の聞いた安否は残らない（手を打った要求と同じ門）", async () => {
    await start();
    // 電話に出た人の言葉を待つ間に、ほかの画面が訪問を打った
    const call: CallHook = async () => {
      expect(await doAct("visit", "p-04")).toMatchObject({ ok: true });
      return { pickup: "answers", speech: "はい", ai: false };
    };
    expect(await doAct("call_contact", "p-02", "c-02-1", { hooks: { call } })).toEqual({ ok: false, error: "conflict" });
    expect(heardRows()).toMatchObject([{ id: `${ID}-a1-h`, person_id: "p-04" }]);
  });

  it("再生でも同じ（保存した手の返事から聞いた安否の印を作り直す）", async () => {
    await start();
    await doAct("visit", "p-04");
    await advanceTo(ID, 1);
    const replay = (await loadDrillScreen(db, SCOPE, ID, 0))!;
    expect(replay.heard).toEqual({ [`${ID}-a1-h`]: "visit" });
    expect(replay.rows.find((x) => x.id === "p-04")!.triage?.reason).toBe(VISIT_CONFIRMED);
  });

  it("鍵あり: 本人役の通話に「伝える様子」（聞いた安否の色）を渡す。言う事は吹き出しだけで、聞いた安否の文字起こしにしない", async () => {
    const { client, calls } = fake(rain);
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!;
    await start("heavy_rain", hooks);
    await doAct("call_contact", "p-02", "c-02-1", { hooks });
    const call = calls.find((c) => systemOf(c).includes(CALL_SYSTEM))!;
    expect(inputOf(call)["電話"].text).toContain("伝える様子: 緑（無事）");
    expect((await stored()).actions[0].result).toMatchObject({ speechAi: true, heard: { via: "call", color: "green" } });
    expect(heardRows()).toMatchObject([{ transcript: null }]);
  });
});

// ---------- 保存と再生 ----------

describe("保存と再生", () => {
  it("手を打ちながら最後まで進め、保存した今の状態と、刻みと手から作り直した状態が同じ（時計・職員・印・返事）", async () => {
    await start();
    await doAct("call_person", "p-01");
    await doAct("dispatch", "p-04", null);
    await doAct("visit", "p-03");
    await doAct("visit", "p-05"); // 1 時間を越える
    await advanceTo(ID, 2);
    await doAct("visit", "p-05"); // 3 時間: 通行止
    await advanceTo(ID, 3);
    await doAct("visit", "p-06"); // 6 時間: 栄養剤の印を消す
    await doAct("request_welfare_shelter", "p-05");
    await doAct("report_city", null);
    await advanceTo(ID, 11);
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    expect(row.status).toBe("finished");
    const live = stateOfRow(row);
    expect(live.actions.map((a) => [a.kind, a.result?.status])).toEqual([
      ["call_person", "connected"],
      ["dispatch", "dispatched"],
      ["visit", "arrived"],
      ["visit", "arrived"],
      ["visit", "blocked"],
      ["visit", "arrived"],
      ["request_welfare_shelter", "accepted"],
      ["report_city", "reported"],
    ]);
    const replayed = replayState(row, participantsOf(row), await loadTicks(db, ID, SCENARIOS.heavy_rain.hours, row.step), row.step).state;
    expect(replayed).toEqual(live);
    expect(replayed.world.staff).toBe(3);

    // 途中の刻み（1 時間）を見ると、その刻みまでの手と返事（越えた手の返事も）
    const at1 = (await loadDrillScreen(db, SCOPE, ID, 1))!;
    expect(at1.state.actions.map((a) => [a.id, a.result?.status])).toEqual([
      ["a1", "connected"],
      ["a2", "dispatched"],
      ["a3", "arrived"],
      ["a4", "arrived"],
    ]);
    expect(at1.state.minute).toBe(95);
  });

  it("読んだ刻み・手の数が古ければ競合。進めている間に手が入れば、進める方が競合（手の履歴を消さない）", async () => {
    await start();
    expect(await actDrill(db, SCOPE, ID, { step: 0, actions: 1 }, { kind: "visit", person: "p-01", target: null }, START)).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(await actDrill(db, SCOPE, ID, { step: 1, actions: 0 }, { kind: "visit", person: "p-01", target: null }, START)).toEqual({
      ok: false,
      error: "conflict",
    });
    // 進める要求の監督の間に、ほかの画面が手を打った
    const racing: DirectorHook = async () => {
      const r = await actDrill(db, SCOPE, ID, { step: 0, actions: 0 }, { kind: "call_person", person: "p-01", target: null }, START, {
        roll: () => 0,
      });
      expect(r.ok).toBe(true);
      return [];
    };
    expect(await advanceDrill(db, SCOPE, ID, 0, START, { director: racing })).toEqual({ ok: false, error: "conflict" });
    const s = await stored();
    expect(s.step).toBe(0);
    expect(s.actions.map((a) => a.id)).toEqual(["a1"]);
    expect(events("incident").filter((e) => e.step === 1)).toHaveLength(0);
    // 読み直せば進める
    expect(await advanceDrill(db, SCOPE, ID, 0, START)).toMatchObject({ ok: true, step: 1 });
    expect((await stored()).actions).toHaveLength(1);
  });
});

// ---------- API ----------

describe("API（役と事業所の壁）", () => {
  const body = (over: Record<string, unknown> = {}) => ({ step: 0, actions: 0, kind: "visit", person: "p-01", target: null, ...over });

  it("ケアマネの役だけ。ログインなし 401、ほかの役 403、形が違う 400、ほかの事業所 404、古い読み 409", async () => {
    await start();
    expect((await actionPost(db, null, ID, body(), START)).status).toBe(401);
    expect((await actionPost(db, careManager({ role: "medical", caseloadOf: null }), ID, body(), START)).status).toBe(403);
    for (const bad of [
      body({ kind: "fly" }),
      body({ step: "0" }),
      body({ actions: undefined }),
      body({ person: 3 }),
      body({ target: "x y" }),
    ]) {
      expect((await actionPost(db, careManager(), ID, bad, START)).status).toBe(400);
    }
    expect((await actionPost(db, careManager(), ID, null, START)).status).toBe(400);
    expect((await actionPost(db, careManager(), "nope", body(), START)).status).toBe(404);
    const partner = careManager({ office: PARTNER, accountId: "acct-partner-cm", caseloadOf: "acct-partner-cm" });
    expect((await actionPost(db, partner, ID, body(), START)).status).toBe(404);
    const ok = await actionPost(db, careManager(), ID, body(), START, { roll: () => 0 });
    expect(ok.status).toBe(200);
    expect((await actionPost(db, careManager(), ID, body(), START)).status).toBe(409);
    expect((await actionPost(db, careManager(), ID, body({ actions: 1, person: "p-99" }), START)).status).toBe(400);
  });
});
