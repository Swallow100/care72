// 採点の機械で数える所（docs/tasks/T22.md）のテスト。D1 も Claude も使わない。
// 順番の一致（10 人の筋で既知の順）、赤の着信の拒否、報告の遅れ、様式 9 の空欄（種の 10 人）、条件に達した人（時計の走り方と手）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { DrillAction } from "../db/types.ts";
import { buildForm9 } from "../forms/form9.ts";
import type { ActionRecord, ActionStatus } from "./engine.ts";
import { outageTownsOf } from "./engine.ts";
import type { CallRecord } from "./responses.ts";
import { reachedText, reportText } from "./score-labels.ts";
import { clockRuns, scoreCalls, scoreDrill, scoreForm9, scoreNumbers, scoreOrder, scoreReached, scoreReport, type ClockForRun } from "./score.ts";

const IDS = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

/** 手 1 つ（atMinute に打って 5 分で返事） */
function rec(
  id: string,
  kind: DrillAction,
  person: string | null,
  atMinute: number,
  opts: { ranking?: string[]; ok?: boolean; status?: ActionStatus; end?: number } = {},
): ActionRecord {
  const ok = opts.ok ?? true;
  const end = opts.end ?? atMinute + 5;
  return {
    id,
    kind,
    person,
    target: null,
    callee: null,
    calleeLabel: null,
    at: atMinute / 60,
    atMinute,
    endMinute: end,
    minutes: end - atMinute,
    step: 0,
    before: {
      person: null,
      marks: {},
      staff: 3,
      phone: "ok",
      roadClosed: false,
      ...(opts.ranking ? { ranking: opts.ranking } : {}),
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
    },
  };
}

const call = (person: string, color: CallRecord["color"], response: CallRecord["response"], minute = 60): CallRecord => ({
  signal: `s-${person}-${minute}`,
  person,
  color,
  source: "family",
  minute,
  step: 1,
  response,
  respondedAt: response ? minute : null,
});

/** 左の表の並び（既知の順）。手の前の状態に毎回同じ並び */
const RANKING = ["p-02", "p-01", "p-03", "p-05", "p-06", "p-08", "p-07", "p-09", "p-10", "p-04"];

/** 10 人の筋: p-03 と p-09 を先にして、p-04 には手なし。行政報告と退避は順番に数えない */
function tenPeopleRun(): ActionRecord[] {
  const order: Array<[DrillAction, string | null]> = [
    ["call_person", "p-02"], // 一致
    ["call_person", "p-03"], // 後回し（一番上は p-01）
    ["visit", "p-01"], // 一致（残りの一番上）
    ["call_contact", "p-05"], // 一致
    ["dispatch", "p-06"], // 一致
    ["report_city", null], // 順番に数えない
    ["call_person", "p-08"], // 一致
    ["call_person", "p-09"], // 後回し（一番上は p-07）
    ["request_welfare_shelter", "p-07"], // 一致
    ["call_person", "p-01"], // 2 回目の手は数えない
    ["evacuate_self", null], // 順番に数えない
    ["call_person", "p-10"], // 一致
  ];
  return order.map(([k, p], i) => rec(`a${i + 1}`, k, p, i * 10, { ranking: RANKING }));
}

describe("対応の順番の一致", () => {
  it("10 人の筋で既知の順: 7/10。後手 2 人（その時の一番上の人つき）と手なし 1 人", () => {
    const o = scoreOrder(IDS, tenPeopleRun(), []);
    expect({ matched: o.matched, total: o.total }).toEqual({ matched: 7, total: 10 });
    expect(o.misses).toEqual([
      { person: "p-03", why: ["late"], expected: "p-01" },
      { person: "p-04", why: ["missing"] },
      { person: "p-09", why: ["late"], expected: "p-07" },
    ]);
    // 本人ごとの最初の手だけ。行政報告・退避・2 回目は入らない
    expect(o.turns.map((t) => t.person)).toEqual(["p-02", "p-03", "p-01", "p-05", "p-06", "p-08", "p-09", "p-07", "p-10"]);
    expect(o.turns[1]).toMatchObject({ person: "p-03", expected: "p-01", rank: 3, expectedRank: 2, match: false });
  });

  it("手は届かなくても（応答なし）順番には数える。並びは手ごとの手の前の状態の物を使う", () => {
    const actions = [
      rec("a1", "call_person", "p-01", 0, { ranking: ["p-01", "p-02"], ok: false }),
      // 手の前の並びが変わった（p-02 が上がった）あとは、その並びの一番上
      rec("a2", "call_person", "p-02", 10, { ranking: ["p-02", "p-01"] }),
    ];
    expect(scoreOrder(["p-01", "p-02"], actions, []).matched).toBe(2);
  });

  it("赤の着信を拒否した人は一致にしない。緑の拒否・赤の応答・未応答は数えない", () => {
    const calls = [call("p-05", "red", "decline", 180), call("p-06", "green", "decline"), call("p-08", "red", "answer"), call("p-10", "red", null)];
    const o = scoreOrder(IDS, tenPeopleRun(), calls);
    expect(o.matched).toBe(6);
    expect(o.misses.find((m) => m.person === "p-05")).toEqual({ person: "p-05", why: ["declined"], declinedAt: [180] });
    // 手の無い人の拒否は理由を 2 つ
    const none = scoreOrder(["p-01"], [], [call("p-01", "red", "decline")]);
    expect(none.misses).toEqual([{ person: "p-01", why: ["missing", "declined"], declinedAt: [60] }]);
  });

  it("手の前の並びが残っていない手は判定できない（一致に数えない）。参加者でない人への手は数えない", () => {
    const o = scoreOrder(["p-01", "p-02"], [rec("a1", "call_person", "p-01", 0), rec("a2", "call_person", "p-99", 5, { ranking: ["p-99"] })], []);
    expect(o.matched).toBe(0);
    expect(o.misses).toEqual([
      { person: "p-01", why: ["unknown"] },
      { person: "p-02", why: ["missing"] },
    ]);
  });
});

describe("市役所への報告の遅れ", () => {
  it("届いた最初の報告の時刻（発災からの分）。届かなかった報告は数えない。無ければ未報告", () => {
    const actions = [
      rec("a1", "report_city", null, 30, { ok: false, status: "noLine" }),
      rec("a2", "report_city", null, 120, { end: 130, status: "reported" }),
      rec("a3", "report_city", null, 300, { end: 310, status: "reported" }),
    ];
    expect(scoreReport(actions)).toEqual({ minute: 130, tries: 3 });
    expect(scoreReport([rec("a1", "visit", "p-01", 0)])).toEqual({ minute: null, tries: 0 });
    expect(reportText(130)).toBe("2 時間 10 分");
    expect(reportText(null)).toBe("未報告");
  });
});

describe("様式 9 の空欄", () => {
  const rows = buildForm9(
    SEED_PEOPLE.map((p) => ({
      person: { ...p.person, ledger: JSON.stringify(p.ledger) },
      careManager: "山本",
      contacts: p.contacts,
      clocks: p.clocks,
    })),
    { today: "2026-11-03" },
  ).rows;

  it("種の 10 人: 避難場所（避難所も介護・医療機関も無い）が 伊藤・佐藤・渡辺 の 3。発災時に埋まる欄・特記・連絡先 2 は数えない", () => {
    const f = scoreForm9(rows, IDS);
    expect(f.blanks).toBe(3);
    expect(f.rows.map((r) => [r.person, r.columns])).toEqual(
      expect.arrayContaining([
        ["p-04", ["place"]],
        ["p-05", ["place"]],
        ["p-09", ["place"]],
      ]),
    );
    expect(f.rows).toHaveLength(3);
  });

  it("参加者の行だけ。担当・住所が空なら数える", () => {
    expect(scoreForm9(rows, ["p-01", "p-02"]).blanks).toBe(0);
    const blankRow = { id: "p-01", cells: { ...rows.find((r) => r.id === "p-01")!.cells, careManager: "", address: " " } };
    expect(scoreForm9([blankRow], ["p-01"]).rows).toEqual([{ person: "p-01", columns: ["address", "careManager"] }]);
  });
});

describe("条件に達した人", () => {
  const clocks: ClockForRun[] = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
  const towns = new Map(SEED_PEOPLE.map((p) => [p.person.id, p.ledger.basic.address?.town ?? null]));
  // 大雨: 1 時間に浸水 3 m の地区で停電（山田・小林の町）
  const outage = { since: 1, towns: outageTownsOf({ scope: "hazard", hazard: "flood", minDepthM: 3 }, SEED_PEOPLE.map((p) => p.ledger)) };
  const runs = clockRuns(clocks, towns, outage);
  const END = 72 * 60;

  it("時計の走り方: 停電の時計は停電の地区の人だけ停電の始まりから、発災の時計は 0 分から。本人の状態・値の無い時計は走らない", () => {
    const of = (person: string) => runs.filter((r) => r.person === person).map((r) => [r.label, r.startMinute, r.outMinute]);
    expect(of("p-01")).toEqual([
      ["酸素 内蔵電池", 60, 180],
      ["酸素 予備ボンベ", 60, 540],
    ]);
    expect(of("p-02")).toEqual([["人工呼吸器 内蔵電池", 60, 240]]);
    expect(of("p-03")).toEqual([["透析 次の回まで", 0, 2880]]);
    // 井上のインスリンは残りの日数の時計で発災から走る（4 日。T37 の医療の確定 1、保管は確認の欄）。佐藤（本人の状態）は走らない
    expect(of("p-08")).toEqual([["インスリン", 0, 5760]]);
    expect(of("p-04")).toEqual([]);
    expect(runs.find((r) => r.person === "p-03")!.unchecked).toEqual(["dialysis_center"]);
  });

  it("手が無ければ、訓練の終わり（72 時間）までに切れる 3 人（山田・小林・田中）。72 時間ちょうどに切れる栄養剤は入らない", () => {
    const r = scoreReached(runs, [], END);
    expect(r.map((x) => [x.person, x.label, x.outMinute])).toEqual([
      ["p-01", "酸素 内蔵電池", 180],
      ["p-02", "人工呼吸器 内蔵電池", 240],
      ["p-03", "透析 次の回まで", 2880],
    ]);
    expect(reachedText(r[2])).toBe("透析 次の回まで 2 日を超過、透析先 未確認");
    // 中断した訓練は、中断の時刻までに切れた時計だけ
    expect(scoreReached(runs, [], 200).map((x) => x.person)).toEqual(["p-01"]);
  });

  it("切れる前に届いた手（通話・到着・手配済・受入）があれば入らない。停電の前の手も数える。届かない手は数だけ残す", () => {
    const actions = [
      rec("a1", "call_person", "p-01", 0), // 停電の前の通話（早めの連絡）
      rec("a2", "call_person", "p-02", 100, { ok: false }), // 応答なし
      rec("a3", "visit", "p-02", 200, { ok: false, status: "blocked", end: 240 }),
      rec("a4", "report_city", null, 10, { status: "reported" }),
    ];
    const r = scoreReached(runs, actions, END);
    expect(r.map((x) => [x.person, x.tries])).toEqual([
      ["p-02", 2],
      ["p-03", 0],
    ]);
    // 切れたあとの手は間に合わない
    expect(scoreReached(runs, [rec("a1", "call_person", "p-03", 2900)], END).map((x) => x.person)).toContain("p-03");
  });

  it("訪問依頼は着く時刻（手配から 40 分）で数える", () => {
    // 小林の電池は 240 分で切れる。190 分に手配（205 分に決まる）→ 245 分に着く → 間に合わない
    const late = scoreReached(runs, [rec("a1", "dispatch", "p-02", 190, { status: "dispatched", end: 205 })], END);
    expect(late.map((x) => x.person)).toContain("p-02");
    const early = scoreReached(runs, [rec("a1", "dispatch", "p-02", 180, { status: "dispatched", end: 190 })], END);
    expect(early.map((x) => x.person)).not.toContain("p-02");
  });
});

describe("まとめ", () => {
  it("数字 4 つと着信の数。未設定でも機械の数字だけで出る（Claude を呼ばない）", () => {
    const calls = [call("p-05", "red", "decline"), call("p-06", "green", "answer"), call("p-07", "green", null)];
    const s = scoreDrill({ participants: IDS, actions: tenPeopleRun(), calls, runs: [], form9: [], endMinute: 4320 });
    expect(scoreNumbers(s)).toEqual({ order: { matched: 6, total: 10 }, report: 55, form9: 0, reached: 0 });
    expect(scoreCalls(calls)).toEqual({ total: 3, answered: 1, declined: 1, open: 1, redDeclined: 1 });
  });
});
