// T139 の評価の台のテスト（禁じた中身の誤検知・赤 → 緑の検査のふだん歩けない人・文の途中の切れ）。作った入力（架空の記録）だけ。
// Claude は呼ばない。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { bannedHits, contradictionHits, cutHits, CUT_MIN } from "./checks.ts";
import type { LooseTick, LooseTurn, RunOutcome } from "./drive.ts";
import { DRILL_START, runStart } from "./drive.ts";
import { planRun } from "./plan.ts";
import type { AiRecord, LogRecord } from "./record.ts";
import { checkContext } from "./run.ts";

const CTX = checkContext();
const CASELOAD = SEED_PEOPLE.map((p) => p.person.id);

function outcome(ticks: LooseTick[]): RunOutcome {
  return {
    plan: planRun("test", 1, CASELOAD, ["earthquake"]),
    drillId: "d1",
    status: "finished",
    advances: ticks.length,
    replay: {
      drill: { id: "d1", scenario: "earthquake", status: "finished", step: ticks.length - 1 },
      hour: 72,
      minute: 4320,
      actions: [],
      world: { alertLevel: null, quake: null, tsunami: "none", flood: false, outage: null, phone: "ok", water: "none", roads: [], shelters: [], facilities: [], staff: 1, marks: {}, dispatched: [] },
      ticks,
      rows: [],
    },
    ops: [],
    errors: [],
    aiCalls: [],
    callsLeft: 100,
    names: {},
    worldAgent: null,
  };
}
const turn = (person: string, at: number, color: string, more: Partial<LooseTurn> = {}): LooseTurn => ({ person, at, color, source: "family", ai: true, saying: null, ...more });
const tick = (step: number, hour: number, turns: LooseTurn[]): LooseTick => ({ step, hour, incidents: [], turns });

/** 本人役の生の返事 1 つの記録（言う事だけ） */
const personaRecord = (seq: number, speech: string): LogRecord =>
  ({ type: "ai", seq, ms: 0, role: "persona", sent: { system: [], user: "" }, returned: { text: JSON.stringify({ speech, condition: "", action: "" }), stopReason: "end_turn" }, attempts: [], retries: 0 }) as unknown as AiRecord;

describe("禁じた中身の誤検知（台。lib/pseudonym の門は変えない）", () => {
  it("行頭の言葉・続柄の「の」のあとの言葉・業者の呼び名の「さん」・「様子」は名前に数えない", () => {
    const texts = [
      "家内を連れてきました。ひとまず、ここで待ちます。",
      "けがはしていません。ここから、どうしたらいいですか。",
      "まだ母のところまで手が届いていません。",
      "酸素の機械屋さんが来て、ボンベを替えてくれました。",
      "母の様子を見ています。",
      "ガス会社さんにも連絡しました。",
    ];
    const hits = bannedHits(texts.map((t, i) => personaRecord(i + 1, t)), outcome([]), CTX);
    expect(hits.filter((h) => h.rule.startsWith("personal:"))).toEqual([]);
  });

  it("本当の名前の形（台帳の名前・敬称つきの名前）はそのまま拾う", () => {
    const name = SEED_PEOPLE[0].person.name;
    const hits = bannedHits([personaRecord(1, `${name}さんが来ました。`), personaRecord(2, "隣の佐藤さんが見に来てくれた。")], outcome([]), CTX);
    expect(hits.some((h) => h.seq === 1 && h.rule.startsWith("personal:"))).toBe(true);
    expect(hits.some((h) => h.seq === 2 && h.rule === "personal:敬称つきの名前")).toBe(true);
  });
});

describe("赤（動けない）→ 緑の検査（ふだん歩けない人）", () => {
  it("台帳でふだん歩けない人の「動けない」の赤のあとの緑は数えない。けがの赤のあとの緑と、歩ける人の「動けない」は数える", () => {
    const o = outcome([
      tick(0, 4, [turn("p-02", 4, "red", { canMove: false, atHome: true }), turn("p-01", 4, "red", { canMove: false, atHome: true }), turn("p-06", 4, "red", { injured: true, atHome: true })]),
      tick(1, 6, [turn("p-02", 6, "green", { whereNow: "home" }), turn("p-01", 6, "green", { whereNow: "home" }), turn("p-06", 6, "green", { whereNow: "home" })]),
    ]);
    const people = contradictionHits(o, CTX.facts).filter((h) => h.rule === "hurt_to_safe").map((h) => h.person);
    expect(people.sort()).toEqual(["p-01", "p-06"]);
  });
});

describe("文の途中の切れ（cutHits）", () => {
  it("長い言葉で文の終わりの無い物を数える。句点・「…」で終わる物と短い物は数えない", () => {
    const cut = "あ".repeat(CUT_MIN + 2);
    const o = outcome([
      tick(0, 1, [
        turn("p-01", 1, "green", { saying: cut }),
        turn("p-02", 1, "green", { saying: `${cut}。` }),
        turn("p-03", 1, "green", { saying: `${cut}…` }),
        turn("p-04", 1, "green", { saying: "家にいます" }),
        turn("p-05", 1, "green", { saying: cut, ai: false }),
      ]),
    ]);
    const r = cutHits(o);
    expect(r.checked).toBe(4);
    expect(r.hits.map((h) => h.person)).toEqual(["p-01"]);
  });
});

describe("回ごとの開始の時刻（台）", () => {
  it("回の番号の日数だけ後の同じ時刻（昼夜は同じ、訓練の種は回ごとに違う）", () => {
    expect(runStart(1)).toBe(DRILL_START);
    expect(runStart(3) - DRILL_START).toBe(2 * 86_400_000);
    expect(new Date(runStart(3)).getUTCHours()).toBe(new Date(DRILL_START).getUTCHours());
  });
});
