// T94 採点と講評 v2（docs/tasks/T94.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 手の表の旗（towardPerson・reach）で順番と「届いた」を数える、空振り・重複・頼み事の未対応・通話の往復（T93 の欄は入る形だけ）、
// 連続の時計（T90）と 18 の手（T91）で 72 時間を手元で回した筋、講評の入力の「その時に分かっていた事実」、禁じる語の検査、画面と紙面。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { ScorePanel } from "../../components/drill/ScorePanel.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction } from "../db/types.ts";
import { ACTION_CATALOG } from "./action-catalog.ts";
import { act, type ActInput, type ActTarget, type ActionHooks } from "./actions.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { advance, initialState, type ActionRecord, type ActionStatus, type DrillState, type Tick } from "./engine.ts";
import type { FreeHook } from "./free-action.ts";
import { actionPost } from "./http.ts";
import { ACTION_LABELS } from "./labels.ts";
import { outageForRuns } from "./outcome.ts";
import { extrasSourceOf, loadDrillRecord, parseStoredScore, withExtras } from "./record.ts";
import { reviewPost } from "./record-http.ts";
import { RESULT_WORDS, REVIEW_ACTION_LABELS, REVIEW_KINDS, REVIEW_SYSTEM, reviewBanned, reviewText, WASTE_WORDS, type ReviewContext } from "./review.ts";
import { ASK_KINDS, EMPTY_WORLD } from "./scenarios.ts";
import { ASK_WORDS, factWords, personWords, REVIEW_KIND_LABELS, SCORE_LABELS, WASTE_LABELS } from "./score-labels.ts";
import { extraText, scoreView } from "./score-view.ts";
import {
  clockRuns,
  extrasCount,
  isPersonAction,
  knownOf,
  PERSON_ACTIONS,
  reachedAt,
  scoreAsks,
  scoreDrill,
  scoreNumbers,
  scoreOrder,
  scoreReached,
  scoreRepeat,
  scoreReport,
  scoreTalks,
  scoreWasted,
  talkTurns,
  visitOf,
  wasteOf,
  type ClockForRun,
  type DrillScore,
  type TickWorld,
} from "./score.ts";
import { drillClocks } from "./world-clocks.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 手 1 つ（数える所の単体） ----------

function rec(
  id: string,
  kind: DrillAction,
  person: string | null,
  atMinute: number,
  opts: {
    ok?: boolean;
    status?: ActionStatus;
    end?: number;
    callee?: ActionRecord["callee"];
    as?: DrillAction;
    arriveAt?: number;
    ranking?: string[];
    before?: Partial<ActionRecord["before"]>;
    step?: number;
    extra?: Record<string, unknown>;
  } = {},
): ActionRecord {
  const ok = opts.ok ?? true;
  const end = opts.end ?? atMinute + 5;
  return {
    id,
    kind,
    person,
    target: null,
    callee: opts.callee ?? null,
    calleeLabel: null,
    at: atMinute / 60,
    atMinute,
    endMinute: end,
    minutes: end - atMinute,
    step: opts.step ?? 0,
    before: {
      person: null,
      marks: {},
      staff: 3,
      phone: "ok",
      roadClosed: false,
      ...(opts.ranking ? { ranking: opts.ranking } : {}),
      ...opts.before,
    },
    result: {
      ok,
      status: opts.status ?? (ok ? "connected" : "noAnswer"),
      because: null,
      text: "",
      ai: false,
      speech: null,
      speechAi: false,
      pickup: null,
      cleared: [],
      staff: 0,
      crossed: [],
      atMinute: end,
      ...(opts.arriveAt !== undefined ? { arriveAt: opts.arriveAt } : {}),
      ...(opts.extra ?? {}),
    },
    ...(opts.as ? { as: opts.as } : {}),
  };
}

const R = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

// ---------- 1. 手の表の旗 ----------

describe("その人への手と「届いた」は手の表の旗から", () => {
  it("その人への手は towardPerson の 13。前の 5 つを含み、記録・退避・行政報告・応援依頼・自由対応（読み替えなし）は入らない", () => {
    expect([...PERSON_ACTIONS].sort()).toEqual(ACTION_CATALOG.filter((r) => r.towardPerson).map((r) => r.id).sort());
    // T125 でメッセージ（伝言）を足して 14
    expect(PERSON_ACTIONS).toHaveLength(14);
    for (const k of ["call_person", "call_contact", "visit", "dispatch", "request_welfare_shelter"] as const) expect(PERSON_ACTIONS).toContain(k);
    for (const k of ["note", "evacuate_self", "report_city", "request_backup", "free"] as const) expect(PERSON_ACTIONS).not.toContain(k);
    expect(isPersonAction(rec("a1", "free", "p-01", 0, { as: "arrange_medicine" }))).toBe(true);
    expect(isPersonAction(rec("a1", "free", "p-01", 0, { as: "note" }))).toBe(false);
    expect(isPersonAction(rec("a1", "free", "p-01", 0))).toBe(false);
  });

  it("届いた時刻: 手の終わり（透析調整・本人電話）か、向かった人の着く時刻（返事の arriveAt → 世界の arrivals → 表の分）", () => {
    expect(reachedAt(rec("a1", "arrange_dialysis", "p-03", 25, { status: "accepted", end: 40 }))).toBe(40);
    expect(reachedAt(rec("a1", "ask_check", "p-01", 0, { status: "connected", arriveAt: 35 }))).toBe(35);
    // 訪問依頼の前の記録（arriveAt なし）は表の 40 分（前の決め打ちと同じ）
    expect(reachedAt(rec("a1", "dispatch", "p-02", 180, { status: "dispatched", end: 190 }))).toBe(230);
    // 世界の arrivals の時刻があればそれ
    expect(reachedAt(rec("a1", "arrange_medicine", "p-02", 5, { status: "dispatched", end: 15 }), new Map([["a1", 150]]))).toBe(150);
    // 表の数える結果でなければ届かない（ok でも）。届かなかった手も null
    expect(reachedAt(rec("a1", "visit", "p-05", 0, { status: "connected" }))).toBeNull();
    expect(reachedAt(rec("a1", "visit", "p-05", 0, { ok: false, status: "blocked" }))).toBeNull();
    // 自由対応は読み替えた手の表で
    expect(reachedAt(rec("a1", "free", "p-02", 5, { as: "arrange_medicine", status: "dispatched", end: 15, arriveAt: 135 }))).toBe(135);
  });

  it("順番: 見守依頼・自由対応（読み替え 薬手配）・透析調整もその人への最初の手に数える。行政報告は数えない", () => {
    const actions = [
      rec("a1", "ask_check", "p-01", 0, { ranking: R }),
      rec("a2", "free", "p-02", 5, { as: "arrange_medicine", status: "dispatched", ranking: R }),
      rec("a3", "report_city", null, 10, { status: "reported", ranking: R }),
      rec("a4", "arrange_dialysis", "p-03", 20, { status: "accepted", ranking: R }),
      rec("a5", "free", "p-05", 30, { as: "note", status: "noted", ranking: R }),
    ];
    const o = scoreOrder(R, actions, []);
    expect(o.turns.map((t) => [t.action, t.kind, t.person, t.match])).toEqual([
      ["a1", "ask_check", "p-01", true],
      ["a2", "arrange_medicine", "p-02", true],
      ["a4", "arrange_dialysis", "p-03", true],
    ]);
    expect(o.matched).toBe(3);
  });

  it("報告の遅れは分のまま（自由対応の読み替えの行政報告も数える）", () => {
    expect(scoreReport([rec("a1", "report_city", null, 125, { status: "reported", end: 135 })])).toEqual({ minute: 135, tries: 1 });
    expect(scoreReport([rec("a1", "free", null, 7, { as: "report_city", status: "reported", end: 17 })])).toEqual({ minute: 17, tries: 1 });
  });
});

// ---------- 2. 空振り・重複・頼み事・往復 ----------

describe("空振り（打った時に分かっていた事実で結果の決まっていた手）", () => {
  const down = { phone: "down" as const };
  it("家の電話が不通なのに本人電話・通行止なのに訪問・職員 0 なのに職員の訪問依頼・休止と分かっている透析施設へ透析調整", () => {
    const tick = (closed: boolean): TickWorld[] => [
      { step: 0, world: { phone: "ok", facilities: closed ? [{ person: "p-03", open: false, depends: "dialysis_center" }] : [] } },
    ];
    const w = (a: ActionRecord, t?: TickWorld[]) => wasteOf(a, knownOf(a, t));
    // 世界の電話の規制（T125）は全部を止めないので、外れても空振りにしない。家の電話の印だけが事実で決まる
    expect(w(rec("a1", "call_person", "p-01", 0, { ok: false, status: "noLine", before: down }))).toBeNull();
    expect(w(rec("a1", "call_person", "p-01", 0, { ok: false, status: "noLine", before: { ...down, marks: { lineDown: 1 } } }))).toBe("phone");
    expect(w(rec("a1", "visit", "p-05", 0, { ok: false, status: "blocked", before: { roadClosed: true } }))).toBe("road");
    expect(w(rec("a1", "dispatch", "p-02", 0, { ok: false, status: "noDispatch", before: { staff: 0 } }))).toBe("staff");
    expect(w(rec("a1", "arrange_dialysis", "p-03", 0, { ok: false, status: "closed", callee: "dialysis_center" }), tick(true))).toBe("closed");
    // 休止の前（刻みの世界で開いている）に打った透析調整は空振りにしない（手の途中で休止になっても）
    expect(w(rec("a1", "arrange_dialysis", "p-03", 0, { ok: false, status: "closed", callee: "dialysis_center" }), tick(false))).toBeNull();
    // 訪問看護の印があるのに訪問看護へ訪問依頼
    expect(w(rec("a1", "dispatch", "p-02", 0, { ok: false, status: "noDispatch", callee: "visiting_nurse", before: { marks: { nurseAway: 1 } } }))).toBe("nurse");
  });

  it("家の電話だけが不通なら、家族への電話は空振りにしない。結果が届いた手・確率で外れた手は空振りにしない", () => {
    const home = { phone: "down" as const, marks: { lineDown: 1 } };
    const w = (a: ActionRecord, t?: TickWorld[]) => wasteOf(a, knownOf(a, t));
    expect(w(rec("a1", "call_person", "p-01", 0, { ok: false, status: "noLine", before: home }))).toBe("phone");
    expect(w(rec("a1", "call_contact", "p-01", 0, { ok: false, status: "noAnswer", callee: "family", before: home }))).toBeNull();
    // 刻みの世界の電話が規制でも、家族への電話は空振りにしない（T125。かけ直せば時々つながる）
    expect(w(rec("a1", "call_contact", "p-01", 0, { ok: false, status: "noLine", callee: "family", before: home }), [{ step: 0, world: { phone: "down", facilities: [] } }])).toBeNull();
    // 手の途中で事実が変わって届いた手（ok）は空振りにしない
    expect(w(rec("a1", "visit", "p-05", 0, { ok: true, status: "arrived", before: { roadClosed: true } }))).toBeNull();
    // 事実の無い外れ（応答なし・到着不可）は空振りにしない
    expect(w(rec("a1", "call_person", "p-01", 0, { ok: false, status: "noAnswer" }))).toBeNull();
    expect(w(rec("a1", "visit", "p-05", 0, { ok: false, status: "turnedBack" }))).toBeNull();
    // 記録・退避は空振りにならない
    expect(w(rec("a1", "note", null, 0, { ok: false, status: "noted", before: down }))).toBeNull();
  });

  it("人ごとの手の番号と理由で残す（全体への手は人なし）", () => {
    const s = scoreWasted([
      rec("a1", "visit", "p-05", 0, { ok: false, status: "blocked", before: { roadClosed: true } }),
      rec("a2", "report_city", null, 10, { ok: false, status: "noLine", before: down }),
      rec("a3", "call_person", "p-01", 20),
      rec("a4", "call_person", "p-02", 30, { ok: false, status: "noLine", before: { ...down, marks: { lineDown: 1 } } }),
    ]);
    // 市役所への報告は規制の間も時々つながるので空振りにしない（T125）
    expect(s).toEqual({
      total: 2,
      rows: [
        { action: "a1", kind: "visit", person: "p-05", atMinute: 0, why: "road" },
        { action: "a4", kind: "call_person", person: "p-02", atMinute: 30, why: "phone" },
      ],
    });
  });
});

describe("重複（同じ人に同じ手を、新しい事が無いまま 30 分以内に 2 回）", () => {
  const two = [rec("a1", "call_person", "p-04", 15), rec("a2", "call_person", "p-04", 20)];
  it("新しい事が無ければ 2 回目を数える。31 分あける・別の手・別の人は数えない。3 回続けば 2 つ", () => {
    expect(scoreRepeat(two, { calls: [] })).toEqual({ total: 1, rows: [{ action: "a2", first: "a1", kind: "call_person", person: "p-04", atMinute: 20, gap: 5 }] });
    expect(scoreRepeat([rec("a1", "call_person", "p-04", 0), rec("a2", "call_person", "p-04", 31)], { calls: [] }).total).toBe(0);
    expect(scoreRepeat([rec("a1", "call_person", "p-04", 0), rec("a2", "call_contact", "p-04", 10)], { calls: [] }).total).toBe(0);
    expect(scoreRepeat([rec("a1", "call_person", "p-04", 0), rec("a2", "call_person", "p-05", 10)], { calls: [] }).total).toBe(0);
    expect(scoreRepeat([...two, rec("a3", "call_person", "p-04", 25)], { calls: [] }).total).toBe(2);
    // 自由対応は読み替えた手で同じ手に数える
    expect(scoreRepeat([rec("a1", "visit", "p-04", 0), rec("a2", "free", "p-04", 10, { as: "visit" })], { calls: [] }).total).toBe(1);
  });

  it("間にその人の連絡（着信）・状況・到着があれば数えない（ほかの人の物は数える）", () => {
    expect(scoreRepeat(two, { calls: [{ person: "p-04", minute: 18 }] }).total).toBe(0);
    expect(scoreRepeat(two, { calls: [{ person: "p-05", minute: 18 }] }).total).toBe(1);
    expect(scoreRepeat(two, { calls: [], incidents: [{ at: 18 / 60, person: "p-04" }] }).total).toBe(0);
    expect(scoreRepeat(two, { calls: [], arrivals: [{ person: "p-04", arrive: 19 }] }).total).toBe(0);
    expect(scoreRepeat(two, { calls: [], dispatched: [{ person: "p-04", arrive: 20 }] }).total).toBe(0);
    // 前の手と同じ時刻の物は前から分かっていた
    expect(scoreRepeat(two, { calls: [{ person: "p-04", minute: 15 }] }).total).toBe(1);
  });
});

describe("頼み事の未対応と通話の往復（T93 の欄）", () => {
  it("終わりまでに頼まれて済まなかった頼み事。終わりのあとに済んだ物も未対応、参加者の外と表に無い種類は数えない", () => {
    const asks = {
      "p-01": [
        { kind: "medicine" as const, at: 30, done: null },
        { kind: "power" as const, at: 40, done: 200 },
        { kind: "water" as const, at: 50, done: 5000 },
      ],
      "p-02": [{ kind: "medicine" as const, at: 4400, done: null }],
      "p-99": [{ kind: "food" as const, at: 10, done: null }],
    };
    expect(scoreAsks(asks, R, 4320)).toEqual({ open: 2, total: 3, rows: [{ person: "p-01", kinds: ["medicine", "water"] }] });
    expect(scoreAsks(undefined, R, 4320)).toEqual({ open: 0, total: 0, rows: [] });
  });

  it("通話の往復は result.talk のケアマネの行の数（T93 が入る前の記録は 0）。訪問の様子と頼み事は result.visit から", () => {
    const talk = [
      { who: "them", text: "はい", ai: true, minute: 5 },
      { who: "cm", text: "", ai: false, minute: 6, ask: "where" },
      { who: "them", text: "家にいます", ai: true, minute: 6 },
      { who: "cm", text: "", ai: false, minute: 8, ask: "device_medicine" },
      { who: "them", text: "薬がもうない", ai: true, minute: 8 },
    ];
    const a = rec("a1", "call_person", "p-01", 0, { extra: { talk } });
    expect(talkTurns(a)).toBe(2);
    expect(talkTurns(rec("a2", "call_person", "p-01", 0))).toBe(0);
    expect(scoreTalks([a, rec("a2", "call_person", "p-01", 30), rec("a3", "call_person", "p-02", 40, { extra: { talk: talk.slice(0, 2) } })])).toEqual({ turns: 3, calls: 2 });
    const v = rec("a4", "visit", "p-01", 0, { status: "arrived", extra: { visit: { condition: "玄関で座っている", asks: ["water", "medicine", "x"], speech: "水がほしい", ai: true } } });
    expect(visitOf(v)).toEqual({ condition: "玄関で座っている", asks: ["water", "medicine"], ai: true });
    expect(visitOf(rec("a5", "visit", "p-01", 0))).toBeNull();
  });
});

// ---------- 3. 72 時間を手元で回す（T90 の advance と T91 の手、偽の自由対応） ----------

const target = (id: string, kind: ActTarget["kind"], label: string): ActTarget => ({ id, kind, label, hasPhone: true });
const SUPPORTER_01 = target("c-01-2", "supporter", "支援者");
const PHARMACY_02 = target("x-02-9", "pharmacy", "薬局");
const SELF_04 = target("c-04-0", "self", "本人");
const DIALYSIS_03 = target("c-03-4", "dialysis_center", "透析施設");
const START = "2026-11-05T01:00:00.000Z";

/** 自由対応の偽の読み替え（Claude を呼ばない）。文は薬局に薬を頼む物 → 薬手配 */
const freeHook: FreeHook = async (ask) => ({ stored: ask.text, reading: { kind: "arrange_medicine", callee: "pharmacy", text: null, reason: null } });

const CLOCKS: ClockForRun[] = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const TOWNS = new Map(SEED_PEOPLE.map((p) => [p.person.id, p.ledger.basic.address?.town ?? null]));

type Run = { state: DrillState; ticks: Tick[] };

/** 大雨の連続の時計で 72 時間。手は roll 0（届く物は届く） */
async function run72(): Promise<Run> {
  const hooks: ActionHooks = { free: freeHook };
  const first = await advance(initialState("heavy_rain", R, START, { clock: true }), 0);
  let s = first!.state;
  const ticks: Tick[] = [first!.tick];
  const doAct = async (input: ActInput) => {
    const r = await act(s, input, hooks, () => 0, { ranking: R });
    s = r.state;
    ticks.push(...r.ticks);
    return r.record;
  };
  const goTo = async (m: number) => {
    const r = await advance(s, m, {}, { policy: "clock" });
    s = r!.state;
    ticks.push(r!.tick);
  };
  await doAct({ kind: "ask_check", person: "p-01", target: SUPPORTER_01 }); // a1 0 分: 見守依頼（30 分後に着く）
  await doAct({ kind: "free", person: "p-02", target: null, text: "薬局に薬を届けてもらうよう頼む", contacts: [PHARMACY_02] }); // a2 5 分
  await doAct({ kind: "call_person", person: "p-04", target: SELF_04 }); // a3 15 分
  await doAct({ kind: "call_person", person: "p-04", target: SELF_04 }); // a4 20 分: 重複
  await doAct({ kind: "arrange_dialysis", person: "p-03", target: DIALYSIS_03 }); // a5 25 分: 受け入れ
  await goTo(180); // 3 時間: 川沿いの市道 通行止（伊藤）・電話 不安定
  await doAct({ kind: "visit", person: "p-05", target: null }); // a6 180 分: 空振り（通行止）
  await doAct({ kind: "report_city", person: null, target: null }); // a7 220 分 → 230 分に報告
  await goTo(780); // 12 時間に田中の透析施設が休止
  await doAct({ kind: "arrange_dialysis", person: "p-03", target: DIALYSIS_03 }); // a8 780 分: 空振り（休止）
  for (let m = 960; s.status === "running"; m = Math.min(4320, m + 360)) await goTo(m);
  return { state: s, ticks };
}

function scoreOf(r: Run, actions: ReadonlyArray<ActionRecord> = r.state.actions): DrillScore {
  const outage = outageForRuns(r.state.world, SEED_PEOPLE.map((p) => p.ledger));
  const runs = clockRuns(drillClocks(CLOCKS, r.state.world), TOWNS, outage);
  return scoreDrill({ participants: R, actions, calls: [], runs, form9: [], endMinute: 72 * 60, ...extrasSourceOf(r) });
}

describe("72 時間の筋（連続の時計と 18 の手）", () => {
  let r: Run;
  beforeEach(async () => {
    r = await run72();
  });

  it("手は分の時刻、終わりは 72 時間。自由対応は薬手配に読み替え", () => {
    expect(r.state.status).toBe("finished");
    const a = r.state.actions;
    expect(a.map((x) => [x.id, x.kind, x.as ?? null, x.atMinute, x.result?.status])).toEqual([
      ["a1", "ask_check", null, 0, "connected"],
      ["a2", "free", "arrange_medicine", 5, "dispatched"],
      ["a3", "call_person", null, 15, "connected"],
      ["a4", "call_person", null, 20, "connected"],
      ["a5", "arrange_dialysis", null, 25, "accepted"],
      ["a6", "visit", null, 180, "blocked"],
      ["a7", "report_city", null, 220, "reported"],
      ["a8", "arrange_dialysis", null, 780, "closed"],
    ]);
    expect(a[0].result?.arriveAt).toBe(35);
    expect(a[1].result?.arriveAt).toBe(135);
  });

  it("順番: 見守依頼・自由対応（薬手配）・透析調整・訪問が一致、先に佐藤へ電話したので佐藤は後手", () => {
    const s = scoreOf(r);
    expect(s.order.turns.map((t) => [t.person, t.kind, t.match])).toEqual([
      ["p-01", "ask_check", true],
      ["p-02", "arrange_medicine", true],
      ["p-04", "call_person", false],
      ["p-03", "arrange_dialysis", true],
      ["p-05", "visit", true],
    ]);
    expect(s.order.matched).toBe(4);
    expect(s.order.misses.find((m) => m.person === "p-04")).toEqual({ person: "p-04", why: ["late"], expected: "p-03" });
  });

  it("条件到達: 見守依頼の到着（山田）・薬手配の到着（小林）・透析調整の受入（田中）で届いた人は数えない。手を外すと数える", () => {
    const s = scoreOf(r);
    expect(s.reached).toEqual([]);
    const without = (id: string) => scoreOf(r, r.state.actions.filter((a) => a.id !== id)).reached.map((x) => x.person);
    expect(without("a1")).toContain("p-01");
    expect(without("a2")).toContain("p-02");
    expect(without("a5")).toContain("p-03");
    // 見守依頼が着く前に時計が切れていたら届いていない（着く時刻で数える）
    const late = r.state.actions.map((a) => (a.id === "a1" ? { ...a, result: { ...a.result!, arriveAt: 200 } } : a));
    expect(scoreOf(r, late).reached.map((x) => x.person)).toContain("p-01");
  });

  it("報告の遅れは分（230 分）。空振り 2（通行止の訪問・休止の透析施設）、重複 1（佐藤への電話）、頼み事 0、往復 0", () => {
    const s = scoreOf(r);
    expect(scoreNumbers(s)).toEqual({ order: { matched: 4, total: 10 }, report: 230, form9: 0, reached: 0 });
    expect(s.wasted?.rows.map((w) => [w.action, w.person, w.why])).toEqual([
      ["a6", "p-05", "road"],
      ["a8", "p-03", "closed"],
    ]);
    expect(s.repeat?.rows.map((x) => [x.action, x.first, x.gap])).toEqual([["a4", "a3", 5]]);
    expect(extrasCount(s)).toEqual({ wasted: 2, repeat: 1, asksOpen: 0, talks: 0 });
  });

  it("講評の入力: 手の行にその時に分かっていた事実と結果、自由対応の読み替え、機械の内訳。ケアマネの文は渡さない", () => {
    const s = scoreOf(r);
    const aliasOf = new Map(R.map((p, i) => [p, `${"ABCDEFGHIJ"[i]} さん`]));
    const ctx: ReviewContext = {
      scenario: "heavy_rain",
      status: "finished",
      score: s,
      actions: r.state.actions,
      calls: [],
      incidents: r.ticks.flatMap((t) => t.incidents.map((e) => ({ at: e.at, text: e.text, person: e.person ?? null }))),
      previous: null,
      ticks: r.ticks,
    };
    const text = reviewText(ctx, aliasOf);
    const line = (m: string, label: string) => text.split("\n").find((l) => l.startsWith(`- ${m} ${label}`)) ?? "";
    expect(line("3 時間", "訪問")).toMatch(/E さん（.*）［事実: 電話 不安定・道 通行止・.*］ → 通行止（川沿いの市道 通行止）・空振り$/);
    expect(line("13 時間", "透析調整")).toContain("透析先 休止");
    expect(line("13 時間", "透析調整")).toContain("→ 休止（透析施設 休止）・空振り");
    expect(line("0 時間 5 分", "自由対応（扱い: 薬手配）")).toContain("→ 手配済（着く 2 時間 15 分）");
    expect(line("0 時間", "見守依頼")).toContain("（着く 0 時間 35 分）");
    expect(line("0 時間 20 分", "本人電話")).toContain("前の手から 5 分");
    expect(line("0 時間 20 分", "本人電話")).toMatch(/・重複$/);
    expect(text).toContain("- 空振り（打った時に分かっていた事実で、結果の決まっていた手）: 2");
    expect(text).toContain("  - 3 時間 訪問 → E さん（道 通行止）");
    expect(text).toContain("- 重複（同じ人に同じ手を、その人の新しい連絡・状況・到着が無いまま 30 分以内にもう一度）: 1");
    expect(text).toContain("- 頼み事の未対応（訓練の終わりまでに済まなかった頼み事）: 0");
    expect(text).toContain("- 通話の往復: 0");
    expect(text).not.toContain("薬局に薬を届けて");
  });
});

// ---------- 4. 講評の指示と禁じる語 ----------

describe("講評の指示と禁じる語", () => {
  it("指示に表の手の名前が全部（自由対応のほか 17）、指摘の種類に choice、手の選び方と頼み事の決まり", () => {
    expect(REVIEW_ACTION_LABELS).toHaveLength(18);
    for (const r of ACTION_CATALOG) {
      if (r.id === "free") expect(REVIEW_SYSTEM).not.toContain(`・${r.label}・`);
      else expect(REVIEW_SYSTEM).toContain(r.label);
    }
    expect(REVIEW_KINDS).toContain("choice");
    expect(REVIEW_KIND_LABELS.choice).toBe("選択");
    expect(REVIEW_SYSTEM).toContain("choice（手の選び方");
    expect(REVIEW_SYSTEM).toContain("その時に分かっていた事実");
    expect(REVIEW_SYSTEM).toContain("頼み事に応えなかった事は");
    expect(REVIEW_SYSTEM).toContain("無かった手を作らない");
    // 事実で決まる手の一覧は世界の返事と同じ: 通行止で届かない手に見守依頼・連絡先電話は入らない
    const road = REVIEW_SYSTEM.split("\n").find((l) => l.startsWith("- 道 通行止"))!;
    expect(road).toContain("訪問依頼");
    expect(road).not.toContain("見守依頼");
    expect(road).not.toContain("連絡先電話");
  });

  it("禁じる語に表の手の名前・頼み事・結果・空振りの理由・事実の言葉が掛からない（掛かると名指しできない）", () => {
    const words = [
      ...ACTION_CATALOG.map((r) => r.label),
      ...Object.values(ACTION_LABELS),
      ...Object.values(ASK_WORDS),
      ...Object.values(RESULT_WORDS),
      ...Object.values(WASTE_WORDS),
      ...Object.values(WASTE_LABELS),
      ...Object.values(SCORE_LABELS),
      ...Object.values(REVIEW_KIND_LABELS),
      "電話 通話不可",
      "家の電話 通話不可",
      "電話 不安定",
      "道 通行止",
      "職員 0",
      "訪問看護 来られない",
      "透析先 休止",
      "本人 赤 けが 動けない 家の外 薬なし",
      "家族 緑",
      "連絡なし",
    ];
    for (const w of words) expect(reviewBanned(w), w).toBe(false);
    expect(Object.keys(ASK_WORDS).sort()).toEqual([...ASK_KINDS].sort());
    // 「購入」「服用」「mg」を含む手の名前を作らない
    for (const r of ACTION_CATALOG) expect(r.label).not.toMatch(/購入|服用|mg/i);
  });

  it("事実の言葉: 職員の空きと訪問看護の印は訪問依頼・応援依頼だけ、本人の最後の連絡は色と 4 問", () => {
    const k = knownOf(rec("a1", "dispatch", "p-02", 0, { before: { staff: 0, marks: { nurseAway: 1 }, phone: "busy", roadClosed: true } }));
    expect(factWords(k, "dispatch")).toEqual(["電話 不安定", "道 通行止", "職員 0", "訪問看護 来られない"]);
    expect(factWords(k, "visit")).toEqual(["電話 不安定", "道 通行止"]);
    const red = knownOf(
      rec("a1", "call_person", "p-01", 0, {
        before: { person: { color: "red", source: "agent", whereNow: null, at: 3, saying: null, doing: null, injured: true, canMove: false } },
      }),
    );
    expect(personWords(red)).toBe("本人 赤 けが 動けない");
    expect(personWords(knownOf(rec("a1", "call_person", "p-01", 0)))).toBe("連絡なし");
  });
});

// ---------- 5. 保存・前の記録・講評・画面と紙面（D1） ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(value: unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(value);
        },
      },
    },
  };
  return { client, calls };
}

const systemOf = (p: Params) => (p.system as Array<{ text: string }>).map((b) => b.text).join("\n");

describe("保存と講評と紙面（D1）", () => {
  let sqlite: DatabaseSync;
  let db: ReturnType<typeof d1FromSqlite>;
  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });
  afterEach(() => sqlite.close());

  const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
  const careManager = (): Principal => ({
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
  const SCOPE = drillScope(careManager())!;
  const LATER = "2026-11-05T02:00:00.000Z";
  const ID = "d94";

  async function hand(kind: DrillAction, person: string | null, targetId: string | null = null) {
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    const n = stateOfRow(row).actions.length;
    const res = await actionPost(db, careManager(), ID, { step: row.step, actions: n, kind, person, target: targetId }, START, { roll: () => 0 });
    expect(res.status).toBe(200);
  }
  async function to(minutes: 30 | 60 | 180) {
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    expect((await advanceDrill(db, SCOPE, ID, row.step, START, {}, { minutes })).ok).toBe(true);
  }
  async function finished() {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID, { clock: true })).toEqual({ ok: true, id: ID });
    await hand("call_person", "p-04", "c-04-0");
    await hand("call_person", "p-04", "c-04-0");
    await to(180);
    await hand("visit", "p-05");
    for (;;) {
      const row = (await loadDrillRow(db, DEMO.id, ID))!;
      if (row.status !== "running") break;
      await to(180);
    }
  }
  const stored = () => (sqlite.prepare("SELECT score FROM drills WHERE id = ?").get(ID) as { score: string | null }).score;

  it("残す採点に内訳の数。刻みの世界から通行止の訪問を空振り、佐藤への 2 回目の電話を重複に", async () => {
    await finished();
    const rec = await loadDrillRecord(db, SCOPE, ID, LATER);
    if (!rec || rec === "running") throw new Error("記録なし");
    expect(rec.score.wasted?.rows.map((w) => [w.kind, w.person, w.why])).toEqual([["visit", "p-05", "road"]]);
    expect(rec.score.repeat?.rows.map((w) => [w.kind, w.person, w.gap])).toEqual([["call_person", "p-04", 5]]);
    const kept = parseStoredScore(stored())!;
    expect(kept.score.wasted?.total).toBe(1);
    expect(kept.score.talks).toEqual({ turns: 0, calls: 0 });
  });

  it("前の記録（内訳の欄なし）も読める。内訳は訓練の記録から数えて足し、4 つの数字は残した物のまま（書き戻さない）", async () => {
    await finished();
    await loadDrillRecord(db, SCOPE, ID, LATER);
    const kept = parseStoredScore(stored())!;
    const { wasted: _w, repeat: _r, asks: _a, talks: _t, ...old } = kept.score;
    const oldText = JSON.stringify({ ...kept, score: { ...old, form9: { blanks: 99, rows: [] } } });
    sqlite.prepare("UPDATE drills SET score = ? WHERE id = ?").run(oldText, ID);
    const parsed = parseStoredScore(oldText)!;
    expect(parsed.score.wasted).toBeUndefined();
    expect(extrasCount(parsed.score)).toEqual({ wasted: 0, repeat: 0, asksOpen: 0, talks: 0 });
    const rec = await loadDrillRecord(db, SCOPE, ID, LATER);
    if (!rec || rec === "running") throw new Error("記録なし");
    expect(scoreNumbers(rec.score)).toEqual({ ...scoreNumbers(kept.score), form9: 99 });
    expect(extrasCount(rec.score)).toEqual({ wasted: 1, repeat: 1, asksOpen: 0, talks: 0 });
    expect(stored()).toBe(oldText);
    // withExtras は内訳のそろった採点をそのまま返す
    expect(withExtras(kept.score, rec.screen, rec.calls)).toBe(kept.score);
  });

  it("講評（偽の client）: 指示に表の手の名前、入力に事実と結果。kind choice を受けて残す", async () => {
    await finished();
    const answer = {
      summary: "道が通行止と分かっていた所へは見守依頼を試す。",
      findings: [
        { person: "E さん", kind: "choice", text: "3 時間に道が通行止と分かっていたので、訪問でなく見守依頼を試す。", basis: "根拠なし" },
        { person: "全体", kind: "nonsense", text: "記録を残す。", basis: "根拠なし" },
      ],
    };
    const f = fake(answer);
    const res = await reviewPost({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), ID, {}, { claude: f.client, now: () => new Date(LATER) });
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    const sys = systemOf(f.calls[0]);
    for (const l of REVIEW_ACTION_LABELS) expect(sys).toContain(l);
    const sent = JSON.stringify(f.calls[0].messages);
    expect(sent).toContain("［事実: ");
    expect(sent).toContain("道 通行止");
    expect(sent).toContain("空振り");
    // 氏名は渡さない
    for (const p of SEED_PEOPLE) expect(sent).not.toContain(p.person.name);
    const kept = parseStoredScore(stored())!;
    if (kept.review?.state !== "done") throw new Error("講評なし");
    // 仮名は参加者の並びの順（E さんは 5 人目）。一覧の外の kind は other。重い種類で指摘の目安（T141 の REVIEW_LIMIT）まで埋まれば other は残らない
    const kept2 = kept.review.ai.findings.map((x) => [x.person, x.kind]);
    expect(kept2[0]).toEqual([kept.score.participants[4], "choice"]);
    expect(kept2.slice(1).every(([, k]) => k === "other")).toBe(true);
  });

  it("画面の採点の欄と紙面: 内訳の数（空振り・重複・頼み事 未対応・通話 往復）と、対応履歴の事実の列", async () => {
    await finished();
    const rec = await loadDrillRecord(db, SCOPE, ID, LATER);
    if (!rec || rec === "running") throw new Error("記録なし");
    const view = scoreView(rec.score, rec.screen.names, rec.previous);
    expect(extraText(view.extra.counts)).toBe("空振り 1・重複 1・頼み事 未対応 0・通話 0 往復");
    const panel = renderToStaticMarkup(
      createElement(ScorePanel, { drillId: ID, view, review: null, canReview: false, names: rec.screen.names }),
    );
    expect(panel).toContain('data-extra="wasted"');
    expect(panel).toContain('data-score-detail="wasted"');
    expect(panel).toContain("通行止");
    expect(panel).not.toContain('data-score-detail="asks"');
    const paper = renderToStaticMarkup(createElement(DrillPaper, { record: rec, office: "デモ事業所", today: "2026-11-05" }));
    expect(paper).toContain(`<th>${SCORE_LABELS.facts}</th>`);
    expect(paper).toMatch(/data-facts="a3">[^<]*道 通行止/);
    expect(paper).toContain('data-detail="choice"');
    expect(paper).toContain('data-mark="空振り"');
    expect(paper).toContain('data-mark="重複"');
    // 連続の時計の区切りの見出しは分の時刻（小数の時間を書かない）
    const words = paper.replace(/<style>[^<]*<\/style>/g, "").replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/\d\.\d{2,}/);
    expect(words).toMatch(/経過 \d+ ?時間〜\d+ ?時間 ?\d+ ?分/);
    for (const w of ["診断", "判定", "重症", "緊急度", "死亡"]) {
      expect(panel).not.toContain(w);
      expect(paper).not.toContain(w);
    }
  });
});

// ---------- 6. 前からの数字が変わらない ----------

describe("7 つの手だけの訓練の数字", () => {
  it("前の 5 つの手の届いた時刻は前と同じ（本人電話は終わり、訪問依頼は 40 分後）", () => {
    const runs = [{ person: "p-02", label: "人工呼吸器 内蔵電池", hours: 3, startMinute: 60, outMinute: 240, unchecked: [] }];
    expect(scoreReached(runs, [rec("a1", "dispatch", "p-02", 190, { status: "dispatched", end: 205 })], 4320).map((x) => x.person)).toEqual(["p-02"]);
    expect(scoreReached(runs, [rec("a1", "dispatch", "p-02", 180, { status: "dispatched", end: 190 })], 4320)).toEqual([]);
    expect(scoreReached(runs, [rec("a1", "request_welfare_shelter", "p-02", 200, { status: "accepted", end: 215 })], 4320)).toEqual([]);
    expect(scoreReached(runs, [rec("a1", "visit", "p-02", 200, { status: "arrived", end: 240 })], 4320)).toEqual([]);
  });

  it("世界の無い入力（前の呼び方）でも内訳の数が出る", () => {
    const s = scoreDrill({ participants: R, actions: [], calls: [], runs: [], form9: [], endMinute: 4320 });
    expect(extrasCount(s)).toEqual({ wasted: 0, repeat: 0, asksOpen: 0, talks: 0 });
    expect({ ...EMPTY_WORLD }.asks).toBeUndefined();
  });
});
