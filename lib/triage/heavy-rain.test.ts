// 受け入れのテスト: docs/SPEC.md「利用者と場面」「架空の 10 人」の大雨の筋を、種の 10 人に流す。
// 警戒レベル 3（発災。災害モードに切り替える）→ レベル 4 → 浸水と停電。停電の始まりから 0・1・3・6・30・72 時間で、
// 人ごとの色・理由の 1 行・並びを全部確かめる。ルールの表は docs/DECISIONS.md の案 1〜6 を入れた物（確認待ち）。
//
// 筋の時刻（停電の始まりを 0 とする）:
//   -2 時間 レベル 3 高齢者等避難。ここを発災とする（透析・薬・栄養剤の時計はここから走る）
//   -1 時間 レベル 4 避難指示
//    0      浸水と停電（酸素・呼吸器の電池とインスリンの冷蔵の時計はここから走る）
// 信号:
//   1 山田   0.5 時間 本人が赤。4 問の途中で操作が止まり、録音にうめき声（分類は「不明」）
//   3 田中  -1 時間   妻が緑。透析先が受け入れられるかは未確認のまま（台帳の時計の確認）
//   4 佐藤   0.5 時間 本人が緑（本人の報告を当てにしない印がある）→ 4 時間 民生委員が見に行って緑
//   6 高橋  -1 時間   娘が緑
//   8 井上   0.5 時間 本人が緑
//  10 中村  -1.5 時間 妻が緑
//   2 小林・5 伊藤・7 加藤・9 渡辺 は信号なし（未知のまま）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toTriagePerson } from "./from-ledger.ts";
import { rank, type Color, type Situation, type TriageResult, type TriageSignal } from "./index.ts";

/** 浸水と停電の時刻（2026-11-05 18:00 JST）。h 時間あとの時刻は at(h) */
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();

const LEVEL3 = at(-2);

function situation(h: number): Situation {
  return { now: at(h), disasterAt: LEVEL3, outageAt: at(0) };
}

const SIGNALS: Record<string, TriageSignal[]> = {
  "p-01": [{ color: "red", source: "self", at: at(0.5), injured: null, canMove: null, classes: ["unknown"] }],
  "p-03": [{ color: "green", source: "family", at: at(-1) }],
  "p-04": [
    { color: "green", source: "self", at: at(0.5) },
    { color: "green", source: "supporter", at: at(4) },
  ],
  "p-06": [{ color: "green", source: "family", at: at(-1) }],
  "p-08": [{ color: "green", source: "self", at: at(0.5) }],
  "p-10": [{ color: "green", source: "family", at: at(-1.5) }],
};

const ENTRIES = SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: SIGNALS[p.person.id] ?? [] }));
const NAME = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.person.name.split(" ")[0]]));
const CHAR: Record<Color, string> = { red: "赤", yellow: "黄", gray: "灰", green: "緑" };

function board(h: number): TriageResult[] {
  return rank(ENTRIES, situation(h));
}

/** 一覧の 1 行: 姓・色・理由 */
const line = (r: TriageResult) => `${NAME[r.personId]} ${CHAR[r.color]} ${r.reason}`;
const find = (h: number, id: string) => board(h).find((r) => r.personId === id)!;

/** 停電の始まりから h 時間の一覧（上から連絡する順） */
const EXPECTED: Record<number, string[]> = {
  0: [
    "田中 黄 無事だが透析先 未確認",
    "山田 灰 未確認 2 時間",
    "小林 灰 未確認 2 時間",
    "井上 灰 未確認 2 時間",
    "伊藤 灰 未確認 2 時間、支援者なし",
    "加藤 灰 未確認 2 時間",
    "渡辺 灰 未確認 2 時間",
    "佐藤 灰 未確認 2 時間",
    "高橋 緑 家族が「無事」",
    "中村 緑 家族が「無事」",
  ],
  1: [
    "山田 赤 本人が「無事じゃない」",
    "田中 黄 無事だが透析先 未確認",
    "小林 灰 未確認 3 時間",
    "伊藤 灰 未確認 3 時間、支援者なし",
    "加藤 灰 未確認 3 時間",
    "渡辺 灰 未確認 3 時間",
    "佐藤 灰 未確認 3 時間、本人の緑は参考",
    "高橋 緑 家族が「無事」",
    "井上 緑 本人が「無事」",
    "中村 緑 家族が「無事」",
  ],
  3: [
    "山田 赤 本人が「無事じゃない」",
    "小林 黄 人工呼吸器 内蔵電池 残り 0 分、未確認 5 時間",
    "田中 黄 無事だが透析先 未確認",
    "伊藤 灰 未確認 5 時間、支援者なし",
    "加藤 灰 未確認 5 時間",
    "渡辺 灰 未確認 5 時間",
    "佐藤 灰 未確認 5 時間、本人の緑は参考",
    "高橋 緑 家族が「無事」",
    "井上 緑 本人が「無事」",
    "中村 緑 家族が「無事」",
  ],
  6: [
    "山田 赤 本人が「無事じゃない」",
    "小林 赤 人工呼吸器 内蔵電池 3 時間を超過",
    "田中 黄 無事だが透析先 未確認",
    "伊藤 灰 未確認 8 時間、支援者なし",
    "加藤 灰 未確認 8 時間",
    "渡辺 灰 未確認 8 時間",
    "高橋 緑 家族が「無事」",
    "井上 緑 本人が「無事」",
    "佐藤 緑 支援者が「無事」",
    "中村 緑 家族が「無事」",
  ],
  30: [
    "山田 赤 本人が「無事じゃない」",
    "小林 赤 人工呼吸器 内蔵電池 3 時間を超過",
    "田中 黄 無事だが透析 次の回まで 残り 16 時間、透析先 未確認",
    "伊藤 灰 未確認 32 時間、支援者なし",
    "加藤 灰 未確認 32 時間",
    "渡辺 灰 未確認 32 時間",
    "高橋 緑 家族が「無事」",
    "井上 緑 本人が「無事」",
    "佐藤 緑 支援者が「無事」",
    "中村 緑 家族が「無事」",
  ],
  72: [
    "山田 赤 本人が「無事じゃない」",
    "小林 赤 人工呼吸器 内蔵電池 3 時間を超過",
    "田中 黄 無事だが透析 次の回まで 2 日を超過、透析先 未確認",
    "高橋 黄 無事だが栄養剤 3 日を超過",
    "井上 黄 無事だがインスリン 残り 24 時間",
    "伊藤 黄 ステロイド 残り 46 時間、未確認 3.1 日、支援者なし",
    "加藤 灰 未確認 3.1 日",
    "渡辺 灰 未確認 3.1 日",
    "佐藤 緑 支援者が「無事」",
    "中村 緑 家族が「無事」",
  ],
};

describe("大雨の筋（レベル 3 → 4 → 浸水と停電）を 10 人に流す", () => {
  for (const h of [0, 1, 3, 6, 30, 72]) {
    it(`停電から ${h} 時間: 10 人の並び・色・理由`, () => {
      expect(board(h).map(line)).toEqual(EXPECTED[h]);
    });
  }

  it("1 山田: 赤 ＋ 録音（うめき声は不明）で、赤が出た 1 時間から一番上。けが・動けないの組ではなく赤だけの組", () => {
    for (const h of [1, 3, 6, 30, 72]) {
      const top = board(h)[0];
      expect(top, `${h} 時間`).toMatchObject({ personId: "p-01", color: "red", rule: "red", group: 1 });
    }
    // 同じ赤の組の小林より上なのは、時計（酸素の電池 2 時間）の残りが短いから
    expect(find(6, "p-01").remainingHours).toBeLessThan(find(6, "p-02").remainingHours);
  });

  it("2 小林: 未知のまま、呼吸器の電池（3 時間）の半分を過ぎて黄、超えたら赤。3 時間ちょうどはまだ黄", () => {
    expect(find(1, "p-02").color).toBe("gray");
    expect(find(3, "p-02")).toMatchObject({ color: "yellow", rule: "unknown_half" });
    expect(rank(ENTRIES, situation(3.1)).find((r) => r.personId === "p-02")).toMatchObject({
      color: "red",
      rule: "unknown_device_over",
    });
    expect(find(6, "p-02")).toMatchObject({ color: "red", rule: "unknown_device_over" });
  });

  it("3 田中: 妻の緑があっても、透析先が未確認のあいだはずっと黄「透析先 未確認」", () => {
    for (const h of [0, 1, 3, 6, 30, 72]) {
      const r = find(h, "p-03");
      expect(r.color, `${h} 時間`).toBe("yellow");
      expect(r.reason, `${h} 時間`).toContain("透析先 未確認");
    }
  });

  it("4 佐藤: 本人の緑は未知（灰「本人の緑は参考」）、民生委員の緑で緑", () => {
    expect(find(0, "p-04")).toMatchObject({ color: "gray", qualifiers: [] });
    expect(find(1, "p-04")).toMatchObject({ color: "gray", rule: "unknown", qualifiers: ["self_green_set_aside"] });
    expect(find(6, "p-04")).toMatchObject({ color: "green", reason: "支援者が「無事」", qualifiers: [] });
  });

  it("5 伊藤: 灰のあいだも理由に「支援者なし」。灰の中では一番上（加藤・渡辺より残りが短い）", () => {
    for (const h of [0, 1, 3, 6, 30]) {
      const grays = board(h).filter((r) => r.color === "gray").map((r) => r.personId);
      expect(find(h, "p-05")).toMatchObject({ color: "gray", hasSupporter: false });
      expect(find(h, "p-05").reason).toContain("支援者なし");
      expect(grays.indexOf("p-05"), `${h} 時間`).toBeLessThan(grays.indexOf("p-07"));
      expect(grays.indexOf("p-05"), `${h} 時間`).toBeLessThan(grays.indexOf("p-09"));
    }
    expect(find(72, "p-05")).toMatchObject({ color: "yellow", rule: "unknown_half" });
  });

  it("6 高橋・8 井上: 家族・本人の緑でも、栄養剤・インスリンの半分を過ぎた 72 時間は黄（案 6）", () => {
    expect(find(30, "p-06").color).toBe("green");
    expect(find(30, "p-08").color).toBe("green");
    expect(find(72, "p-06")).toMatchObject({ color: "yellow", rule: "green_clock_half" });
    expect(find(72, "p-08")).toMatchObject({ color: "yellow", rule: "green_clock_half" });
  });

  it("7 加藤・9 渡辺: 灰のまま。10 中村: 緑で一番下", () => {
    for (const h of [0, 1, 3, 6, 30, 72]) {
      expect(find(h, "p-07").color).toBe("gray");
      expect(find(h, "p-09").color).toBe("gray");
      expect(board(h).at(-1)).toMatchObject({ personId: "p-10", color: "green" });
    }
  });

  it("赤が出る前の山田・緑が出る前の井上は未知（今より後の信号は使わない）", () => {
    expect(find(0, "p-01")).toMatchObject({ color: "gray", rule: "unknown" });
    expect(find(0, "p-08")).toMatchObject({ color: "gray", rule: "unknown" });
  });
});
