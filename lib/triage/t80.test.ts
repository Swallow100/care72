// T80（2 回目の点検）: 医療班・行政の受け入れ（搬送）の知らせが緑の行（黄・赤になる行も）に当たったとき、
// 理由の言葉が「無事の報告」「無事・」と言っていた（山田を受け入れても酸素の時計が超過で要確認のまま、理由「電池が切れたあとに無事の報告…」）。
// 線: 色・行・組・残り・並びは表のまま。受入・搬送から来た知らせは理由の言葉で「受入」「搬送」と言うだけ。

import { describe, expect, it } from "vitest";
import { stateLabel } from "../labels.ts";
import {
  compareResults,
  RULES,
  triage,
  type RuleId,
  type Situation,
  type TriageArrival,
  type TriageClock,
  type TriagePerson,
  type TriageResult,
  type TriageSignal,
} from "./index.ts";

const T0 = Date.parse("2026-11-04T00:00:00.000Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
/** 発災と停電は 0 時間 */
const at = (h: number): Situation => ({ now: iso(h), disasterAt: iso(0), outageAt: iso(0) });

const OXYGEN: TriageClock = { kind: "device", category: "oxygen", label: "酸素 内蔵電池", value: 2, unit: "hour", starts_on: "outage" };
const INSULIN: TriageClock = { kind: "medication", category: "insulin", label: "インスリン", value: 8, unit: "hour", starts_on: "disaster" };
const DIALYSIS: TriageClock = {
  kind: "supply",
  category: "dialysis",
  label: "透析 次の回まで",
  value: 2,
  unit: "day",
  starts_on: "disaster",
  depends_on: "dialysis_center",
  depends_check: "unconfirmed",
};

const person = (clocks: TriageClock[]): TriagePerson => ({
  id: "p1",
  clocks,
  livesAlone: false,
  bedridden: false,
  hasSupporter: true,
  dementia: false,
  selfReportUnreliable: false,
});

/** 本人のけが・動けないの赤（受け入れの前） */
const RED_BEFORE: TriageSignal = { color: "red", source: "self", at: iso(0.1), injured: true, canMove: false };

/** 同じ時刻の 3 つの緑: 本人の緑・受け入れ・搬送で閉じた受け入れ（搬送の時刻が h） */
function three(clocks: TriageClock[], h: number, s: Situation) {
  const p = person(clocks);
  const self = triage({ person: p, signals: [{ color: "green", source: "self", at: iso(h) }] }, s);
  const arrival: TriageArrival = { at: iso(h), shelter: "みどり小学校" };
  const received = triage({ person: p, signals: [RED_BEFORE], arrivals: [arrival] }, s);
  const transported = triage(
    { person: p, signals: [RED_BEFORE], arrivals: [{ at: iso(Math.max(0.2, h - 0.1)), shelter: "みどり小学校", transported: { at: iso(h), to: "市民病院" } }] },
    s,
  );
  return { self, received, transported };
}

/** 受け入れの前の赤を添える言葉（案 11、T184）。受入・搬送の例はどれも前に本人の赤がある */
const BEFORE = "、受入前 本人が「けが」「動けない」";

/** 言葉のほか（色・行・組・残り・足す言葉・骨格）が同じか。受け入れの前の赤の言葉（案 11）は受入・搬送だけに付くので外して比べる */
const facts = (r: TriageResult) => [r.color, r.baseColor, r.rule, r.group, r.remainingHours, r.tier, r.hasSupporter, r.qualifiers.filter((q) => q !== "before_arrival")];

const CASES: Array<{ rule: RuleId; clocks: TriageClock[]; h: number; now: number; self: string; received: string; transported: string }> = [
  {
    rule: "green_out_after_report",
    clocks: [OXYGEN],
    h: 1,
    now: 2.5,
    self: "無事の報告のあとに電池が切れた、酸素 内蔵電池 2 時間を超過",
    received: "受入のあとに電池が切れた、酸素 内蔵電池 2 時間を超過",
    transported: "搬送のあとに電池が切れた、酸素 内蔵電池 2 時間を超過",
  },
  {
    rule: "green_out_before_report",
    clocks: [OXYGEN],
    h: 2.5,
    now: 3,
    self: "電池が切れたあとに無事の報告、酸素 内蔵電池 2 時間を超過",
    received: "受入のあとも 酸素 内蔵電池 2 時間を超過",
    transported: "搬送のあとも 酸素 内蔵電池 2 時間を超過",
  },
  {
    rule: "green_device_low",
    clocks: [OXYGEN],
    h: 1,
    now: 1.5,
    self: "無事・酸素 内蔵電池 残り 30 分",
    received: "受入・酸素 内蔵電池 残り 30 分",
    transported: "搬送・酸素 内蔵電池 残り 30 分",
  },
  {
    rule: "green_clock_half",
    clocks: [INSULIN],
    h: 1,
    now: 6,
    self: "無事・インスリン 残り 2 時間",
    received: "受入・インスリン 残り 2 時間",
    transported: "搬送・インスリン 残り 2 時間",
  },
  {
    rule: "green_unchecked",
    clocks: [DIALYSIS],
    h: 1,
    now: 3,
    self: "無事・透析先 未確認",
    received: "受入・透析先 未確認",
    transported: "搬送・透析先 未確認",
  },
];

describe("受入・搬送から来た緑の理由の言葉（T80）", () => {
  for (const c of CASES) {
    it(`${c.rule}: 本人の緑は「${c.self}」、受入は「${c.received}」、搬送は「${c.transported}」。色・行・組・残り・並びは同じ`, () => {
      const { self, received, transported } = three(c.clocks, c.h, at(c.now));
      expect([self.rule, received.rule, transported.rule]).toEqual([c.rule, c.rule, c.rule]);
      expect([self.reason, received.reason, transported.reason]).toEqual([c.self, c.received + BEFORE, c.transported + BEFORE]);
      expect(facts(received)).toEqual(facts(self));
      expect(facts(transported)).toEqual(facts(self));
      expect(compareResults(received, self)).toBe(0);
      expect(compareResults(transported, self)).toBe(0);
      // 状態の言葉は行の色のまま（受入・搬送の印は行 green だけ。T78）
      expect([received.greenVia, transported.greenVia]).toEqual([undefined, undefined]);
      expect(stateLabel(received)).toBe(stateLabel(self));
    });
  }

  it("表の「理由の例」は本人の緑の言い方のまま（docs/TRIAGE.md の例の列）", () => {
    for (const c of CASES) {
      const example = RULES.find((r) => r.id === c.rule)!.example;
      expect(example, c.rule).toContain("無事");
      expect(example, c.rule).not.toMatch(/受入|搬送/);
    }
  });

  it("山田（酸素 内蔵電池 2 時間）: 停電 3 時間で受け入れても要確認のまま、理由は「受入のあとも 酸素 内蔵電池 2 時間を超過」", () => {
    const r = triage({ person: person([OXYGEN]), signals: [RED_BEFORE], arrivals: [{ at: iso(3), shelter: "かわなぎ小学校" }] }, at(4));
    expect([r.color, r.rule, r.reason, stateLabel(r)]).toEqual(["yellow", "green_out_before_report", `受入のあとも 酸素 内蔵電池 2 時間を超過${BEFORE}`, "要確認"]);
    expect(r.reason).not.toContain("無事");
  });

  it("受入のあとの本人・家族の緑は「無事」の言い方に戻る（いちばん新しい知らせの出どころで決まる）", () => {
    const r = triage(
      {
        person: person([OXYGEN]),
        signals: [RED_BEFORE, { color: "green", source: "family", at: iso(3.5) }],
        arrivals: [{ at: iso(3), shelter: "かわなぎ小学校" }],
      },
      at(4),
    );
    expect([r.rule, r.reason]).toEqual(["green_out_before_report", "電池が切れたあとに無事の報告、酸素 内蔵電池 2 時間を超過"]);
  });

  it("支援者なしなど足す言葉は受入の言葉のあとに続く", () => {
    const p = { ...person([OXYGEN]), hasSupporter: false };
    const r = triage({ person: p, signals: [], arrivals: [{ at: iso(3), shelter: "かわなぎ小学校" }] }, at(4));
    expect(r.reason).toBe("受入のあとも 酸素 内蔵電池 2 時間を超過、支援者なし");
  });
});
