// 受け入れのテスト: docs/SPEC.md「利用者と場面」「架空の 10 人」の大雨の筋を、種の 10 人に流す。
// 警戒レベル 3（発災。災害モードに切り替える）→ レベル 4 → 浸水と停電。停電の始まりから 0・1・3・6・30・72 時間で、
// 人ごとの色・理由の 1 行・並びを全部確かめる。ルールの表は docs/DECISIONS.md「色と連絡順」の案 1〜6 を入れた物（確認待ち）。
// 筋の時刻・信号・期待の一覧は heavy-rain.fixture.ts（担当一覧の並びのテスト lib/list/board.test.ts も同じ物を読む）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toTriagePerson } from "./from-ledger.ts";
import { EXPECTED, HOURS, SIGNALS, situation } from "./heavy-rain.fixture.ts";
import { rank, type Color, type TriageResult } from "./index.ts";

const ENTRIES = SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: SIGNALS[p.person.id] ?? [] }));
const NAME = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.person.name.split(" ")[0]]));
const CHAR: Record<Color, string> = { red: "赤", yellow: "黄", gray: "灰", green: "緑" };

function board(h: number): TriageResult[] {
  return rank(ENTRIES, situation(h));
}

/** 一覧の 1 行: 姓・色・理由 */
const line = (r: TriageResult) => `${NAME[r.personId]} ${CHAR[r.color]} ${r.reason}`;
const find = (h: number, id: string) => board(h).find((r) => r.personId === id)!;

describe("大雨の筋（レベル 3 → 4 → 浸水と停電）を 10 人に流す", () => {
  for (const h of HOURS) {
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

  it("4 佐藤: 本人の緑は未知（灰「本人の申告は参考」）、民生委員の緑で緑", () => {
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
