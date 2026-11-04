// T110 時間を使う手・時間と状況で変わる手・打った文をそのままの手に・細かなログ（docs/tasks/T110.md）のテスト。
// 本物の API は呼ばない（偽の client が決まった JSON を返す）。手元の D1 は node:sqlite と種の 10 人。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionPanel, FreePlanLine } from "../../components/drill/ActionPanel.tsx";
import { BusyLine } from "../../components/drill/BusyLine.tsx";
import { DrillControls } from "../../components/drill/DrillControls.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { ContactKind, DrillAction, DrillScenario } from "../db/types.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { ACT_LOG_LABELS, actLogCsv, buildActLog } from "./act-log.ts";
import { ACTION_CATALOG, actionWords, FREE_MINUTES, FREE_TEXT_MAX, isOwnFree } from "./action-catalog.ts";
import {
  ACTION_WAYS,
  actionTerm,
  blockOf,
  DARK_PICKUP,
  dayHourOf,
  TERM_LABELS,
  TERM_RULES,
  termFactsOf,
  termsFor,
  type TermCallee,
  type TermFacts,
} from "./action-terms.ts";
import { act, ActionBlocked, decideAction, type ActTarget, type ActionHooks } from "./actions.ts";
import { busyOf, spanLabel, staffOf } from "./busy.ts";
import { actDrill, drillScope, loadDrillRow, loadJudgeLog, loadTicks, participantsOf, replayState, startDrill, stateOfRow } from "./db.ts";
import { advance, aiAtOf, initialState, withoutMemo, type ActionRecord, type DrillState } from "./engine.ts";
import { NO_CALL } from "./event-catalog.ts";
import { drillFreeHook, FREE_SYSTEM, planFree, type FreeHook } from "./free-action.ts";
import { abandonPost, actionPost, freePost, logGet, stepPost } from "./http.ts";
import { minuteText } from "./time-text.ts";
import { reviewText, type ReviewContext } from "./review.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { isPersonAction, scoreDrill, scoreOrder } from "./score.ts";
import { decideWorldReply } from "./world-reply.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown, model: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(answer(params), OPUS);
        },
      },
    },
  };
  return { client, calls };
}

const systemOf = (p: Params) => (p.system as Array<{ text: string }>).map((b) => b.text).join("\n");

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const seedOf = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
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
/** 日本の 10 時に発災（夜は 9 時間あと、19 時から） */
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t110";
const TERMS = { clock: true as const, terms: true as const };

async function start(scenario: DrillScenario = "heavy_rain", options: Record<string, unknown> = TERMS) {
  expect(await startDrill(db, SCOPE, scenario, START, {}, () => ID, options)).toEqual({ ok: true, id: ID });
}

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

/** 訓練の drills.world の世界を書き換える（手元の D1 だけ。通行止などの事実を置く） */
function patchWorld(f: (w: WorldState) => WorldState) {
  const row = sqlite.prepare("SELECT world FROM drills WHERE id = ?").get(ID) as { world: string };
  const raw = JSON.parse(row.world) as { world: WorldState };
  raw.world = f({ ...EMPTY_WORLD, ...raw.world });
  sqlite.prepare("UPDATE drills SET world = ? WHERE id = ?").run(JSON.stringify(raw), ID);
}

const target = (id: string, kind: ActTarget["kind"], label: string, hasPhone = true): ActTarget => ({ id, kind, label, hasPhone });
const SELF_01 = target("c-01-0", "self", "本人");
const DAUGHTER_01 = target("c-01-1", "family", "家族 娘");

/** 連続の時計と決まりの表の訓練を 0 分まで（エンジンだけ。D1 なし） */
async function clockAt0(opts: { terms?: boolean } = { terms: true }): Promise<DrillState> {
  const init = initialState("heavy_rain", PARTICIPANTS, START, { clock: true, ...(opts.terms ? { terms: true } : {}) });
  return (await advance(init, 0, {}, { policy: "clock" }))!.state;
}

const closedRoad = (person: string) => ({ id: "rd-t", label: "川沿いの市道", open: false, person });

/** 昼・平時の事実 */
const BASE_FACTS: TermFacts = {
  dark: false,
  phone: "ok",
  lineDown: false,
  roadClosed: false,
  flood: false,
  staff: 2,
  nurseAway: false,
  closed: [],
  battery: false,
  late: false,
};

// ---------- 1. 決まりの表 ----------

describe("時間と状況で変わる手（lib/drill/action-terms.ts）", () => {
  it("訓練の中の時刻: 夜間発災は深夜 2 時から、ほかは開始の時刻（日本）から。夜は 19 時から 5 時台", () => {
    expect(dayHourOf(START, 0, false)).toBe(10);
    expect(dayHourOf(START, 9 * 60, false)).toBe(19);
    expect(dayHourOf(START, 20 * 60, false)).toBe(6);
    expect(dayHourOf(START, 0, true)).toBe(2);
    expect(dayHourOf(START, 4 * 60, true)).toBe(6);
    const s = { startedAt: START, minute: 0, world: EMPTY_WORLD, options: { terms: true } };
    expect(termFactsOf(s, null).dark).toBe(false);
    expect(termFactsOf({ ...s, minute: 9 * 60 }, null).dark).toBe(true);
    expect(termFactsOf({ ...s, options: { terms: true, night: true } }, null).dark).toBe(true);
  });

  it("事実を読む: 通行止・浸水・家の電話・訪問看護・休止の施設・電池（事業所の停電 6 時間）・出勤遅れ（6 時間まで）", () => {
    const world: WorldState = {
      ...EMPTY_WORLD,
      roads: [closedRoad("p-05")],
      alertLevel: 4,
      marks: { "p-01": { lineDown: 1, nurseAway: 1 } },
      facilities: [{ id: "f1", label: "透析施設", open: false, person: "p-03", depends: "dialysis_center" }],
      outage: { area: { scope: "office" }, since: 1, restoredAt: null },
      notes: { self_late: 0.5 },
    };
    const s = { startedAt: START, minute: 6 * 60 + 30, world, options: { terms: true } };
    expect(termFactsOf(s, "p-05")).toMatchObject({ roadClosed: true, flood: true, battery: false, late: false });
    expect(termFactsOf(s, "p-01")).toMatchObject({ lineDown: true, nurseAway: true, roadClosed: false });
    expect(termFactsOf(s, "p-03").closed).toEqual(["dialysis_center"]);
    expect(termFactsOf({ ...s, minute: 7 * 60 }, null).battery).toBe(true);
    expect(termFactsOf({ ...s, minute: 60 }, null).late).toBe(true);
  });

  it("決まりを選ばない訓練は表の分のまま・押せない物なし", () => {
    const f: TermFacts = { ...BASE_FACTS, dark: true, roadClosed: true, phone: "down", staff: 0 };
    for (const r of ACTION_CATALOG) {
      const t = actionTerm(r.id, f, { on: false });
      expect(t).toEqual({ minutes: r.minutes, block: null, targets: {}, adds: [], pickup: 1 });
    }
  });

  it("押せない手と所要の足し分（夜・浸水・混雑・電池・出勤遅れ）、夜の電話は出にくい", () => {
    const on = { on: true } as const;
    // 通行止: 訪問と家へ向かう手配は押せない。電話・見守依頼・病院受入は押せる
    const road = { ...BASE_FACTS, roadClosed: true };
    for (const k of ["visit", "dispatch", "arrange_medicine", "arrange_transport", "arrange_power", "call_vendor"] as DrillAction[]) {
      expect(actionTerm(k, road, on).block).toBe(TERM_LABELS.road);
    }
    for (const k of ["call_person", "ask_check", "request_hospital", "note"] as DrillAction[]) expect(actionTerm(k, road, on).block).toBeNull();
    // 電話が通話不可: 電話で済む手と家へ向かう手配は押せない。訪問・記録・退避は押せる
    const down = { ...BASE_FACTS, phone: "down" as const };
    expect(TERM_LABELS.noCall).toBe(NO_CALL);
    for (const r of ACTION_CATALOG) {
      const way = ACTION_WAYS[r.id];
      expect(actionTerm(r.id, down, on).block).toBe(way === "phone" || way === "home" ? NO_CALL : null);
    }
    // 家の電話: 本人電話は押せない。119勧奨は相手が本人のときだけ
    const line = { ...BASE_FACTS, lineDown: true };
    expect(actionTerm("call_person", line, on).block).toBe(NO_CALL);
    expect(actionTerm("advise_119", line, on)).toMatchObject({ block: null, targets: { self: NO_CALL } });
    // 職員なし・訪問看護が来られない・休止の透析施設は相手ごと
    expect(actionTerm("dispatch", { ...BASE_FACTS, staff: 0 }, on).targets).toEqual({ fixed: TERM_LABELS.noStaff, care_service: TERM_LABELS.noStaff });
    expect(actionTerm("dispatch", { ...BASE_FACTS, nurseAway: true }, on).targets).toEqual({ visiting_nurse: TERM_LABELS.nurse });
    expect(actionTerm("arrange_dialysis", { ...BASE_FACTS, closed: ["dialysis_center"] }, on).targets).toEqual({ dialysis_center: TERM_LABELS.closed });
    // 所要: 夜の訪問 60 分、浸水の夜 80 分、出勤遅れも足す。電話の混雑 +5・電池 +10
    expect(actionTerm("visit", { ...BASE_FACTS, dark: true }, on)).toMatchObject({ minutes: 60, adds: [TERM_LABELS.dark] });
    expect(actionTerm("visit", { ...BASE_FACTS, dark: true, flood: true }, on)).toMatchObject({ minutes: 80, adds: [TERM_LABELS.dark, TERM_LABELS.flood] });
    expect(actionTerm("visit", { ...BASE_FACTS, late: true }, on).minutes).toBe(60);
    expect(actionTerm("call_person", { ...BASE_FACTS, phone: "busy", battery: true }, on)).toMatchObject({
      minutes: 20,
      adds: [TERM_LABELS.busy, TERM_LABELS.battery],
    });
    expect(actionTerm("dispatch", { ...BASE_FACTS, battery: true }, on).minutes).toBe(20);
    expect(actionTerm("note", { ...BASE_FACTS, dark: true, battery: true, phone: "busy" }, on).minutes).toBe(2);
    // 夜の電話は出にくい（所要は同じ）
    expect(actionTerm("call_person", { ...BASE_FACTS, dark: true }, on)).toMatchObject({ minutes: 5, pickup: DARK_PICKUP });
    expect(actionTerm("call_vendor", { ...BASE_FACTS, dark: true }, on).pickup).toBe(1);
    // 言葉は 2〜4 字、使わない語なし
    for (const l of Object.values(TERM_LABELS)) {
      expect(Array.from(l).length).toBeGreaterThanOrEqual(2);
      expect(Array.from(l).length).toBeLessThanOrEqual(4);
      expect(l).not.toMatch(/診断|判定|重症|緊急度|札/);
    }
    expect(new Set(TERM_RULES.map((r) => r.id)).size).toBe(TERM_RULES.length);
  });

  it("押せなくする手は、世界の返事が事実で外れと決める手と同じ（どの roll でも届かない）", () => {
    const facts: Array<{ name: string; world: WorldState; f: TermFacts }> = [
      { name: "電話", world: { ...EMPTY_WORLD, phone: "down" }, f: { ...BASE_FACTS, phone: "down" } },
      { name: "家の電話", world: { ...EMPTY_WORLD, marks: { "p-03": { lineDown: 1 } } }, f: { ...BASE_FACTS, lineDown: true } },
      { name: "道", world: { ...EMPTY_WORLD, roads: [closedRoad("p-03")] }, f: { ...BASE_FACTS, roadClosed: true } },
      { name: "職員", world: { ...EMPTY_WORLD, staff: 0 }, f: { ...BASE_FACTS, staff: 0 } },
      { name: "看護", world: { ...EMPTY_WORLD, staff: 2, marks: { "p-03": { nurseAway: 1 } } }, f: { ...BASE_FACTS, nurseAway: true } },
      {
        name: "休止",
        world: { ...EMPTY_WORLD, staff: 2, facilities: [{ id: "f", label: "透析施設", open: false, person: "p-03", depends: "dialysis_center" }] },
        f: { ...BASE_FACTS, closed: ["dialysis_center"] },
      },
    ];
    let checked = 0;
    for (const { name, world, f } of facts) {
      for (const r of ACTION_CATALOG) {
        if (r.decide.type === "record") continue;
        const term = actionTerm(r.id, f, { on: true });
        const callees: Array<TermCallee | null> = [...(r.fixed ? ["fixed" as const] : [null]), ...r.targetKinds];
        for (const c of callees) {
          const callee: TermCallee | null = r.id === "call_person" ? "self" : c;
          if (!blockOf(term, callee)) continue;
          for (const roll of [0, 0.5, 0.99]) {
            const w = decideWorldReply(
              { action: r.id, person: r.needsPerson ? "p-03" : null, callee: callee === "fixed" ? null : (callee as ContactKind | null), world, hour: 12 },
              roll,
            );
            expect(w.ok, `${name} ${r.id} ${callee} ${roll}`).toBe(false);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

// ---------- 2. 時間を使う手 ----------

describe("時間を使う手（重ねる・所要・職員）", () => {
  it("5 分の電話を 3 本、そのあと 40 分の訪問: 時計は 55 分進み、手ごとに打った時刻と終わる時刻。使用 55 分", async () => {
    let s = await clockAt0();
    expect(s.aiAt).toBe(0);
    for (const p of ["p-01", "p-02", "p-04"]) s = (await act(s, { kind: "call_person", person: p, target: SELF_01 }, {}, () => 0.99)).state;
    s = (await act(s, { kind: "visit", person: "p-06", target: null }, {}, () => 0)).state;
    expect(s.actions.map((a) => [a.atMinute, a.endMinute, a.minutes])).toEqual([
      [0, 5, 5],
      [5, 10, 5],
      [10, 15, 5],
      [15, 55, 40],
    ]);
    expect(s.minute).toBe(55);
    const busy = busyOf(s, { on: true, aiAt: aiAtOf(s) });
    expect(busy).toMatchObject({ minute: 55, aiAt: 0, used: 55, acts: 4 });
    // 手の行の時刻の言い方
    expect(spanLabel(65, 70, minuteText)).toBe("1 時間 5 分〜10 分");
    expect(spanLabel(50, 90, minuteText)).toBe("0 時間 50 分〜1 時間 30 分");
    expect(spanLabel(60, 120, minuteText)).toBe("1 時間〜2 時間");
    // 刻みの道（10 分版）は使用を出さない
    expect(busyOf(s, { on: false, aiAt: 0 }).used).toBeNull();
  });

  it("夜の訪問は 60 分、浸水（警戒 4）の夜は 80 分。所要を伸ばした決まりが手の記録に残る", async () => {
    let s = await clockAt0();
    s = { ...s, minute: 9 * 60 };
    const night = (await act(s, { kind: "visit", person: "p-06", target: null }, {}, () => 0)).record;
    expect(night).toMatchObject({ minutes: 60, adds: [TERM_LABELS.dark], atMinute: 540, endMinute: 600 });
    const flooded = { ...s, world: { ...s.world, alertLevel: 4 as const } };
    const both = (await act(flooded, { kind: "visit", person: "p-06", target: null }, {}, () => 0)).record;
    expect(both).toMatchObject({ minutes: 80, adds: [TERM_LABELS.dark, TERM_LABELS.flood] });
    // 決まりの無い訓練（前からある訓練・10 分版）は表の 40 分のまま
    const plain = { ...(await clockAt0({ terms: false })), minute: 9 * 60 };
    expect((await act(plain, { kind: "visit", person: "p-06", target: null }, {}, () => 0)).record).toMatchObject({ minutes: 40 });
    expect((await act(plain, { kind: "visit", person: "p-06", target: null }, {}, () => 0)).record.adds).toBeUndefined();
  });

  it("通行止の家への訪問は押せない（ActionBlocked、何も足さない）。決まりの無い訓練は今までどおり打てて「通行止」", async () => {
    const s = await clockAt0();
    const blocked = { ...s, world: { ...s.world, roads: [closedRoad("p-05")] } };
    await expect(act(blocked, { kind: "visit", person: "p-05", target: null }, {}, () => 0)).rejects.toBeInstanceOf(ActionBlocked);
    await expect(act(blocked, { kind: "visit", person: "p-05", target: null }, {}, () => 0)).rejects.toMatchObject({ label: TERM_LABELS.road });
    // 同じ人への電話は押せる
    expect((await act(blocked, { kind: "call_person", person: "p-05", target: target("c-05-0", "self", "本人") }, {}, () => 0.99)).record.kind).toBe(
      "call_person",
    );
    const plain = await clockAt0({ terms: false });
    const old = await act({ ...plain, world: { ...plain.world, roads: [closedRoad("p-05")] } }, { kind: "visit", person: "p-05", target: null }, {}, () => 0);
    expect(old.record.result).toMatchObject({ ok: false, status: "blocked" });
  });

  it("夜は電話に出にくい: 同じ roll（0.6）で昼は出て、夜（夜間発災の 2 時）は応答なし", async () => {
    const s = await clockAt0();
    const day = await act(s, { kind: "call_person", person: "p-01", target: SELF_01 }, {}, () => 0.6);
    expect(day.record.result).toMatchObject({ status: "connected" });
    const dark = (await advance(initialState("heavy_rain", PARTICIPANTS, START, { clock: true, terms: true, night: true }), 0, {}, { policy: "clock" }))!.state;
    const night = await act(dark, { kind: "call_person", person: "p-01", target: SELF_01 }, {}, () => 0.6);
    expect(night.record.result).toMatchObject({ status: "noAnswer", ok: false });
    // 0.5 は夜でも出る（0.85 × 0.6 = 0.51 の内）
    expect((await act(dark, { kind: "call_person", person: "p-01", target: SELF_01 }, {}, () => 0.5)).record.result?.status).toBe("connected");
    // 返事の決め方そのもの（世界の電話は通常）
    const input = { kind: "call_person" as const, person: "p-01", target: SELF_01 };
    expect(decideAction(input, EMPTY_WORLD, 1, () => 0.6, 1).status).toBe("connected");
    expect(decideAction(input, EMPTY_WORLD, 1, () => 0.6, DARK_PICKUP).status).toBe("noAnswer");
  });

  it("職員の空き・外出・次に空く時刻: 訪問依頼で事業所の職員が 1 人出て、120 分で戻る。応援は着く時刻", async () => {
    const s = await clockAt0();
    expect(staffOf(s.world)).toEqual({ staffFree: 3, staffOut: 0, nextFree: null });
    const d = (await act(s, { kind: "dispatch", person: "p-06", target: null }, {}, () => 0)).state;
    expect(staffOf(d.world)).toEqual({ staffFree: 2, staffOut: 1, nextFree: 10 + 120 });
    const b = (await act(d, { kind: "request_backup", person: null, target: null }, {}, () => 0)).state;
    expect(staffOf(b.world)).toMatchObject({ staffOut: 1, nextFree: 20 + 90 });
  });
});

// ---------- 3. 手の分 ----------

describe("手の分（時計は進めず、手に使った時間を AI も動かして閉じる）", () => {
  it("電話 3 本のあと手の分: 時計は 15 分のまま、電話した人の本人役を呼び、aiAt が 15 に。使った時間が無ければ断る", async () => {
    const asked: string[] = [];
    const hooks: ActionHooks = {
      persona: async (input) => {
        asked.push(input.person);
        return [];
      },
    };
    let s = await clockAt0();
    // T121: 電話に出た（本人に届いた）手の人を呼ぶ。出なかった電話は本人役を呼ぶ理由にしない
    for (const p of ["p-01", "p-02", "p-04"]) s = (await act(s, { kind: "call_person", person: p, target: SELF_01 }, {}, () => 0)).state;
    expect(busyOf(s, { on: true, aiAt: aiAtOf(s) }).used).toBe(15);
    const r = (await advance(s, s.minute, hooks, { policy: "clock", acts: true }))!;
    expect(r.state.minute).toBe(15);
    expect(r.state.aiAt).toBe(15);
    expect(r.tick.hour).toBe(0.25);
    expect(asked.sort()).toEqual(["p-01", "p-02", "p-04"]);
    expect(busyOf(r.state, { on: true, aiAt: aiAtOf(r.state) }).used).toBe(0);
    await expect(advance(r.state, r.state.minute, hooks, { policy: "clock", acts: true })).rejects.toBeInstanceOf(RangeError);
    // 手の分でない進めは今までどおり今の時計より後だけ
    await expect(advance(s, s.minute, hooks, { policy: "clock" })).rejects.toBeInstanceOf(RangeError);
  });

  it("手の途中で表の出来事をまたいだ（同じ分に手の途中の区切りがある）あとの手の分も、作り直した世界が保存と同じ", async () => {
    await start();
    // 0〜40 分の訪問、40〜80 分の訪問（1 時間の表の出来事をまたぎ、80 分に手の途中の区切り）
    await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "visit", person: "p-06", target: null }, START, { roll: () => 0 });
    let st = (await stored()).step;
    await actionPost(db, careManager(), ID, { step: st, actions: 1, kind: "visit", person: "p-04", target: null }, START, { roll: () => 0 });
    const mid = await stored();
    expect(mid.cuts?.at(-1)).toBe(80);
    expect(mid.minute).toBe(80);
    expect(aiAtOf(mid)).toBe(0);
    st = mid.step;
    expect((await stepPost(db, careManager(), ID, { step: st, acts: true }, START)).status).toBe(200);
    const after = await stored();
    expect(after.cuts?.slice(-2)).toEqual([80, 80]);
    expect(after.aiAt).toBe(80);
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    const ticks = await loadTicks(db, ID, (after.cuts ?? []).map((m) => m / 60), row.step, 72);
    const replay = replayState(row, participantsOf(row), ticks, row.step);
    const plain = (w: WorldState) => {
      const { lastCalled: _a, touched: _b, counts: _c, scheduled: _d, ...rest } = w;
      return rest;
    };
    expect(replay.state.step).toBe(after.step);
    expect(replay.state.minute).toBe(80);
    expect(plain(replay.state.world)).toEqual(plain(after.world));
    expect(replay.state.actions).toEqual(after.actions);
  });

  it("中断した訓練に打つ前の確かめを残さない", async () => {
    await start();
    const { free } = freeHooksOf(() => OWN());
    await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-01", text: "近所に頼む" }, planOf(free));
    expect((await stored()).draft).toBeDefined();
    expect((await abandonPost(db, careManager(), ID, START)).status).toBe(200);
    const raw = (sqlite.prepare("SELECT world FROM drills WHERE id = ?").get(ID) as { world: string }).world;
    expect(JSON.parse(raw).draft).toBeUndefined();
  });

  it("API: 進める POST の acts。使った時間が無い・ほかの進め方と一緒・刻みの道の訓練は 400。保存した aiAt", async () => {
    await start();
    const cm = careManager();
    expect((await stepPost(db, cm, ID, { step: 0, acts: true }, START)).status).toBe(400);
    const a = await actionPost(db, cm, ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null }, START, { roll: () => 0.99 });
    expect(a.status).toBe(200);
    const st = (await stored()).step;
    expect((await stepPost(db, cm, ID, { step: st, acts: true, minutes: 30 }, START)).status).toBe(400);
    const ok = await stepPost(db, cm, ID, { step: st, acts: true }, START);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, minute: 5 });
    expect((await stored()).aiAt).toBe(5);
    expect((await stepPost(db, cm, ID, { step: st + 1, acts: true }, START)).status).toBe(400);
  });
});

// ---------- 4. 自由対応のそのままの手 ----------

/** そのままの手の偽の答え */
const OWN = (over: Record<string, unknown> = {}) => ({
  kind: "free",
  callee: "family",
  way: "phone",
  minutes: 15,
  can: true,
  whyNot: "",
  text: "近所の人に発電機の貸出を頼む",
  outcome: "隣の人が発電機を貸すと言った",
  reason: "近所への依頼の手が表に無いので",
  ...over,
});

function freeHooksOf(answer: (p: Params) => unknown): { free: FreeHook; calls: Params[] } {
  const { client, calls } = fake(answer);
  return { free: drillFreeHook({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!, calls };
}

const planOf = (free: FreeHook | undefined) => (s: DrillState, input: Parameters<typeof planFree>[1]) => planFree({ ...s, participants: s.participants }, input, free);

describe("自由対応のそのままの手（読み替え → 確かめ → 打つ）", () => {
  it("読み替えで相手と所要を見せ、確かめを置く（Claude 1 回・counts.free 1）。同じ文で打つと Claude を呼ばずにそのままの手", async () => {
    await start();
    const name = seedOf("p-01").person.name;
    // 理由に仮名（A さん）を書く偽の答え。記録の理由は氏名に戻し、AI の判断の記録は仮名のまま
    const { free, calls } = freeHooksOf((p) => {
      const alias = /[A-Z]{1,3} さん/.exec(JSON.stringify(p.messages))?.[0] ?? "本人";
      return OWN({ reason: `${alias}の近所への依頼の手が表に無いので` });
    });
    const text = `${name}さんの家に近所の人から発電機を借りられないか頼む`;
    const read = await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-01", text }, planOf(free));
    expect(read.status).toBe(200);
    const body = (await read.json()) as { plan: Record<string, unknown> };
    expect(body.plan).toMatchObject({ as: null, label: "自由", way: "電話", callee: "家族 娘", minutes: 15, block: null, ai: true });
    // 起きたこと・伏せた文・AI の判断の記録は打つ前に返さない
    expect(JSON.stringify(body)).not.toContain("隣の人");
    expect(Object.keys(body.plan).sort()).toEqual(["adds", "ai", "as", "block", "blockAi", "callee", "label", "minutes", "reason", "way", "words"]);
    expect(calls).toHaveLength(1);
    expect(systemOf(calls[0])).toContain(FREE_SYSTEM);
    // Claude に渡ったのは伏せた文だけ
    const sent = JSON.stringify(calls[0].messages);
    expect(findLeaks(sent, ALL_KEY)).toEqual([]);
    expect(sent).not.toContain(name);
    expect((await stored()).world.counts?.free).toBe(1);
    expect((await stored()).draft?.text).toBe(text);

    const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "free", person: "p-01", target: null, text }, START, {
      hooks: { free },
      roll: () => 0,
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const s = await stored();
    expect(s.draft).toBeUndefined();
    expect(s.world.counts?.free).toBe(1);
    const rec = s.actions[0];
    expect(rec).toMatchObject({ kind: "free", way: "phone", minutes: 15, callee: "family", calleeLabel: "家族 娘", words: "近所の人に発電機の貸出を頼む" });
    expect(rec.as).toBeUndefined();
    expect(isOwnFree(rec)).toBe(true);
    expect(rec.text).toContain(name); // サーバーの中だけ（氏名に戻した文）
    expect(rec.result).toMatchObject({ ok: true, status: "done", text: "隣の人が発電機を貸すと言った", ai: true, heard: null });
    // 世界は変えない（向かう人・確認・届いた物なし）
    expect(s.world.arrivals ?? []).toEqual([]);
    expect(s.world.checks).toBeUndefined();
    // AI の判断の記録: 伏せた文と事実、答えの要約、コードが決めた物。氏名は入らない
    expect(rec.judge).toMatchObject({ v: 1, called: true, decided: { as: null, way: "phone", minutes: 15, block: null } });
    expect(rec.judge?.output).toMatchObject({ kind: "free", way: "phone", minutes: 15, can: true });
    expect(rec.judge?.input).not.toContain(name);
    expect(findLeaks(JSON.stringify(rec.judge), ALL_KEY)).toEqual([]);
    expect(rec.judge?.output?.reason).toMatch(/^[A-Z]{1,3} さんの近所への依頼の手が表に無いので$/);
    expect(rec.reason).toContain(name);
    // 監督・世界・本人役・講評に渡る手には文・理由・判断の記録が無く、1 文（名前なし）だけ
    const forClaude = withoutMemo(s.actions)[0];
    expect(forClaude.text).toBeUndefined();
    expect(forClaude.reason).toBeUndefined();
    expect(forClaude.judge).toBeUndefined();
    expect(actionWords(forClaude)).toBe("近所の人に発電機の貸出を頼む");
    // 評価の台の読み口
    const judges = await loadJudgeLog(db, DEMO.id, ID);
    expect(judges).toHaveLength(1);
    expect(judges[0]).toMatchObject({ drillId: ID, action: rec.id, atMinute: 0, endMinute: 15, as: null });
    const api = await logGet(db, careManager(), ID, new URL(`http://x/api/drill/${ID}/log?judge=1`), START);
    expect(await api.json()).toMatchObject({ ok: true, judges: [{ action: rec.id }] });
  });

  it("文か本人が変われば確かめは使わず、もう 1 回読み替える", async () => {
    await start();
    const { free, calls } = freeHooksOf(() => OWN());
    await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-01", text: "近所に発電機を頼む" }, planOf(free));
    const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "free", person: "p-01", target: null, text: "近所に発電機を頼んでみる" }, START, {
      hooks: { free },
      roll: () => 0,
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect((await stored()).world.counts?.free).toBe(2);
  });

  it("AI ができないと答えた手・決まりの表で押せない手は打てない（理由を見せ、打つと 409）", async () => {
    await start();
    const { free } = freeHooksOf(() => OWN({ can: false, whyNot: "相手不在" }));
    const read = await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-01", text: "近所の人に頼む" }, planOf(free));
    expect(((await read.json()) as { plan: unknown }).plan).toMatchObject({ block: "相手不在", blockAi: true });
    const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "free", person: "p-01", target: null, text: "近所の人に頼む" }, START, {
      hooks: { free },
      roll: () => 0,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "blocked", label: "相手不在" });
    expect((await stored()).actions).toEqual([]);

    // 自分が出向くそのままの手は、家の前の道が通行止なら決まりの表で押せない
    patchWorld((w) => ({ ...w, roads: [closedRoad("p-01")] }));
    const visit = freeHooksOf(() => OWN({ way: "visit", callee: "", minutes: 30 }));
    const r2 = await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-01", text: "家に行って様子を見る" }, planOf(visit.free));
    expect(((await r2.json()) as { plan: unknown }).plan).toMatchObject({ block: TERM_LABELS.road, blockAi: false, way: "訪問" });
  });

  it("所要は下限と上限の中（500 → 120、0 → 2）。夜は電話のやり方でも出にくさ以外は同じ、訪問は伸びる", async () => {
    const s = await clockAt0();
    const hook = (answer: Record<string, unknown>): FreeHook => async (a) => ({ stored: a.text, reading: { kind: "free", callee: "", text: null, reason: null, ...answer } });
    const long = await planFree({ ...s, participants: s.participants }, { text: "避難所を回る", person: "p-01", contacts: [] }, hook({ way: "visit", minutes: 500 }));
    expect(long.minutes).toBe(FREE_MINUTES.max);
    const short = await planFree({ ...s, participants: s.participants }, { text: "記録する", person: null, contacts: [] }, hook({ way: "desk", minutes: 0 }));
    expect(short.minutes).toBe(FREE_MINUTES.min);
    const night = await planFree(
      { ...s, minute: 10 * 60, participants: s.participants },
      { text: "家に行く", person: "p-01", contacts: [] },
      hook({ way: "visit", minutes: 30 }),
    );
    expect(night).toMatchObject({ minutes: 50, adds: [TERM_LABELS.dark], way: "visit" });
  });

  it("表の手に当たれば表の手（読み替え 透析調整、所要 15 分・相手 病院）。119 に当たる文は 119勧奨", async () => {
    await start();
    const { free } = freeHooksOf(() => ({ kind: "arrange_dialysis", callee: "hospital", text: "病院へ透析の振替を頼む", reason: "透析先が休止" }));
    const read = await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-03", text: "病院に透析を頼む" }, planOf(free));
    expect(((await read.json()) as { plan: unknown }).plan).toMatchObject({ as: "arrange_dialysis", label: "透析調整", minutes: 15, callee: "病院" });
    await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "free", person: "p-03", target: null, text: "病院に透析を頼む" }, START, {
      hooks: { free },
      roll: () => 0,
    });
    expect((await stored()).actions[0]).toMatchObject({ kind: "free", as: "arrange_dialysis", result: { status: "accepted" } });

    const s = await clockAt0();
    const any: FreeHook = async (a) => ({ stored: a.text, reading: { kind: "free", callee: "", text: null, reason: null, way: "phone", minutes: 5 } });
    const p119 = await planFree({ ...s, participants: s.participants }, { text: "家族に 119 を呼ぶよう伝える", person: "p-01", contacts: [DAUGHTER_01] }, any);
    expect(p119).toMatchObject({ as: "advise_119", callee: "family" });
  });

  it("伏せきれない文は 400「伏字不可」で、Claude に送らず確かめも置かない。文の長さは 200 字まで", async () => {
    await start();
    const { free, calls } = freeHooksOf(() => OWN());
    // 生年月日はどの書き方でも伏せる（T118）。伏せきれない物の例は電話の数字を含む長い数字の並び
    const digits = seedOf("p-03").contacts.find((c) => c.kind === "self")!.phone!.replace(/-/g, "");
    const res = await freePost(db, careManager(), ID, { step: 0, actions: 0, person: "p-03", text: `番号 ${digits}2345 の人に電話` }, planOf(free));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ label: "伏字不可" });
    expect(calls).toHaveLength(0);
    expect((await stored()).draft).toBeUndefined();
    expect(FREE_TEXT_MAX).toBe(200);
    expect((await freePost(db, careManager(), ID, { step: 0, actions: 0, person: null, text: "あ".repeat(201) }, planOf(free))).status).toBe(400);
    expect((await freePost(db, careManager(), ID, { step: 1, actions: 0, person: null, text: "記録" }, planOf(free))).status).toBe(409);
  });
});

// ---------- 5. 採点と講評 ----------

const ownFree = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: "a1",
  kind: "free",
  person: "p-01",
  target: "c-01-1",
  callee: "family",
  calleeLabel: "家族 娘",
  at: 0,
  atMinute: 0,
  endMinute: 15,
  minutes: 15,
  step: 0,
  before: { person: null, marks: {}, staff: 3, phone: "ok", roadClosed: false, ranking: ["p-01", "p-02"] },
  result: {
    ok: true,
    status: "done",
    because: null,
    text: "隣の人が発電機を貸すと言った",
    ai: true,
    speech: null,
    speechAi: false,
    pickup: null,
    cleared: [],
    staff: 0,
    crossed: [],
    atMinute: 15,
    heard: null,
  },
  way: "phone",
  words: "近所の人に発電機の貸出を頼む",
  text: "山田さんの近所の人に発電機を頼む",
  reason: "近所への依頼の手が表に無いので",
  ...over,
});

describe("採点と講評に自由の手を数える", () => {
  it("本人への電話・訪問のそのままの手は順番に数える（机上は数えない）。届いたには数えない", () => {
    expect(isPersonAction(ownFree())).toBe(true);
    expect(isPersonAction(ownFree({ way: "desk" }))).toBe(false);
    expect(isPersonAction(ownFree({ person: null }))).toBe(false);
    const order = scoreOrder(["p-01", "p-02"], [ownFree()], []);
    expect(order.turns).toEqual([expect.objectContaining({ action: "a1", kind: "free", person: "p-01", match: true })]);
    expect(order.matched).toBe(1);
  });

  it("講評の入力: そのままの手は「自由対応（電話 15 分: 1 文）」。ケアマネの文と理由は渡さない", () => {
    const a = ownFree();
    const score = scoreDrill({ participants: ["p-01"], actions: [a], calls: [], runs: [], form9: [], endMinute: 4320 });
    const ctx: ReviewContext = { scenario: "heavy_rain", status: "finished", score, actions: [a], calls: [], incidents: [], previous: null };
    const text = reviewText(ctx, new Map([["p-01", "A さん"]]));
    expect(text).toContain("自由対応（電話 15 分: 近所の人に発電機の貸出を頼む）");
    expect(text).toContain("実施");
    expect(text).not.toContain("山田");
    expect(text).not.toContain("近所への依頼の手が表に無いので");
  });
});

// ---------- 6. ログ ----------

describe("手と出来事のログ（画面・紙・CSV）", () => {
  const ticks = [
    {
      step: 0,
      incidents: [
        { actor: "world" as const, at: 0, change: { kind: "alert" as const, level: 3 as const }, text: "警戒レベル 3", ai: false },
        // 本人に起きたこと（非公表）。訓練の途中は出さない
        { actor: "director" as const, at: 0.25, change: { kind: "supply_left" as const }, text: "栄養剤を置いてきた", person: "p-06", ai: true, reason: "持ち出しの確認が無い" },
      ],
    },
  ];

  it("時刻の順に手と出来事を 1 本（同じ時刻は出来事が先）。打った時刻・終わり・所要・相手・結果・AI の理由。途中は知り得ない出来事を出さない", () => {
    const a = ownFree({ atMinute: 0, endMinute: 15 });
    const done = buildActLog({ actions: [a], ticks }, { finished: true });
    expect(done.map((r) => [r.kind, r.at])).toEqual([
      ["event", 0],
      ["action", 0],
      ["event", 15],
    ]);
    expect(done[1]).toMatchObject({
      at: 0,
      end: 15,
      minutes: 15,
      what: "自由対応 電話",
      detail: "山田さんの近所の人に発電機を頼む",
      person: "p-01",
      callee: "家族 娘",
      result: "実施 隣の人が発電機を貸すと言った",
      reason: "近所への依頼の手が表に無いので",
      ai: true,
    });
    expect(done[2]).toMatchObject({ what: expect.any(String), reason: "持ち出しの確認が無い", ai: true, person: "p-06" });
    const running = buildActLog({ actions: [a], ticks }, { finished: false });
    expect(running.map((r) => r.kind)).toEqual(["event", "action"]);
  });

  it("CSV: BOM と見出し（開始・終了・所要・種類・内容・本人・相手・結果・AI理由）、時刻は経過の言い方", () => {
    const rows = buildActLog({ actions: [ownFree({ adds: [TERM_LABELS.busy] })], ticks }, { finished: true });
    const csv = actLogCsv(rows, { names: { "p-01": "山田 花子" }, officeName: "デモ事業所", scenario: "大雨想定", madeAt: START });
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain(ACT_LOG_LABELS.title);
    expect(lines[3]).toBe(["開始", "終了", "所要", "種類", "内容", "本人", "相手", "結果", "AI理由", "AI", "加算"].join(","));
    expect(lines[5]).toContain("0 時間,0 時間 15 分,15,手,自由対応 電話 山田さんの近所の人に発電機を頼む,山田 花子,家族 娘");
    expect(lines[5]).toContain(TERM_LABELS.busy);
  });

  it("CSV の GET: 訓練記録と同じ行。ログインなしは 401", async () => {
    await start();
    await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "visit", person: "p-06", target: null }, START, { roll: () => 0 });
    const res = await logGet(db, careManager(), ID, new URL(`http://x/api/drill/${ID}/log`), START);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("訪問");
    expect(text).toContain(seedOf("p-06").person.name);
    expect((await logGet(db, null, ID, new URL(`http://x/api/drill/${ID}/log`), START)).status).toBe(401);
  });
});

// ---------- 7. 10 分版と前からある訓練 ----------

describe("10 分版は短く終わる形のまま", () => {
  it("10 分版に連続の時計と決まりを送っても捨てる（刻みの道・表の分）。通行止の訪問は今までどおり打てて「通行止」", async () => {
    await start("short", TERMS);
    const s = await stored();
    expect(s.options?.clock).toBeUndefined();
    expect(s.options?.terms).toBeUndefined();
    patchWorld((w) => ({ ...w, roads: [closedRoad("p-05")] }));
    const r = await actDrill(db, SCOPE, ID, { step: 0, actions: 0 }, { kind: "visit", person: "p-05", target: null }, START, { roll: () => 0 });
    expect(r).toMatchObject({ ok: true, record: { minutes: 40, result: { status: "blocked" } } });
    // 手の分は刻みの道の訓練では断る
    expect((await stepPost(db, careManager(), ID, { step: 0, acts: true }, START)).status).toBe(400);
  });

  it("連続の時計の大雨想定は開始で決まりを持つ。画面の可否と所要は本人ごと", async () => {
    await start();
    const s = await stored();
    expect(s.options).toMatchObject({ clock: true, terms: true });
    const terms = termsFor({ ...s, world: { ...s.world, roads: [closedRoad("p-05")] } }, "p-05");
    expect(terms.visit.block).toBe(TERM_LABELS.road);
    expect(terms.call_person.block).toBeNull();
  });
});

// ---------- 8. 画面 ----------

describe("画面（対応の欄・使用の 1 行・手の分・読み替えの 1 行）", () => {
  const term = (minutes: number, over: Record<string, unknown> = {}) => ({ minutes, block: null, targets: {}, adds: [], pickup: 1, ...over });

  it("押せない手は灰で理由の言葉、伸びた所要は太字", () => {
    const base = Object.fromEntries(ACTION_CATALOG.map((r) => [r.id, term(r.minutes)]));
    const terms = { "": { ...base, report_city: term(10, { block: NO_CALL }), note: term(2, { adds: [] }), evacuate_self: term(50, { adds: ["夜間"] }) } };
    const html = renderToStaticMarkup(
      createElement(ActionPanel, {
        drillId: "d1",
        step: 0,
        actions: 0,
        people: [{ id: "p-01", name: "山田", tag: null }],
        contacts: {},
        terms: terms as never,
        status: createElement("p", { "data-status": "" }, "使用"),
      }),
    );
    expect(html).toMatch(/data-act-kind="report_city"[^>]*disabled=""|disabled=""[^>]*data-act-kind="report_city"/);
    expect(html).toContain(`data-act-block="${NO_CALL}"`);
    expect(html).toContain('data-act-minutes="50"');
    expect(html).toContain("data-status");
    expect(html).not.toMatch(/rounded-full|bg-black|tracking-/);
  });

  it("使用・職員の空き・外出・次空の 1 行。手の分のボタンは使った時間があるときだけ押せる", () => {
    const html = renderToStaticMarkup(
      createElement(BusyLine, { busy: { minute: 55, aiAt: 0, used: 55, acts: 4, staffFree: 2, staffOut: 1, nextFree: 130 } }),
    );
    expect(html).toContain('data-busy-used="55"');
    expect(html).toContain("使用");
    expect(html).toContain("外出");
    expect(html).toContain("次空");
    expect(html).toContain("2 時間 10 分");
    const on = renderToStaticMarkup(createElement(DrillControls, { id: "d1", step: 1, done: false, clock: true, left: 100, used: 55 }));
    expect(on).toMatch(/data-acts="55"/);
    expect(on).not.toMatch(/disabled=""[^>]*data-acts="55"/);
    const off = renderToStaticMarkup(createElement(DrillControls, { id: "d1", step: 1, done: false, clock: true, left: 100, used: 0 }));
    expect(off).toMatch(/disabled=""[^>]*data-acts="0"|data-acts="0"[^>]*disabled=""/);
    // 10 分版には手の分が無い
    expect(renderToStaticMarkup(createElement(DrillControls, { id: "d1", step: 1, done: false }))).not.toContain("data-acts");
  });

  it("読み替えの 1 行: 自由とやり方・相手・所要と伸びた理由・AI の印・押せない理由", () => {
    const html = renderToStaticMarkup(
      createElement(FreePlanLine, {
        view: { as: null, label: "自由", way: "電話", callee: "家族 娘", minutes: 25, adds: ["電池"], block: "相手不在", blockAi: true, words: "近所に頼む", reason: "表に無い", ai: true },
      }),
    );
    expect(html).toContain('data-free-as="own"');
    expect(html).toContain('data-free-minutes="25"');
    expect(html).toContain("電池");
    expect(html).toContain('data-free-block="相手不在"');
    expect(html).toContain('data-ai="item"');
  });
});
