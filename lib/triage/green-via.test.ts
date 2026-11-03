// T78（qa-20261104 の中 4）: 本人が赤（けが・動けない）を送ったあとに医療班・行政が受け入れると、表は受け入れを緑に数える
// （行 green、理由「到着 避難所」。lib/triage のまま）。そのとき人ごとの状態の言葉を「無事」でなく「受入」（搬送なら「搬送」）に。
// 線: 色・並び・理由の 1 行は表のまま変えない。変わるのは言葉だけ（lib/labels.ts の stateLabel が表の印 greenVia を読む）。

import { describe, expect, it } from "vitest";
import { COLOR_LABELS, stateLabel } from "../labels.ts";
import {
  compareResults,
  rank,
  triage,
  type Situation,
  type TriageArrival,
  type TriageEntry,
  type TriagePerson,
  type TriageResult,
  type TriageSignal,
} from "./index.ts";

const T0 = Date.parse("2026-11-04T00:00:00.000Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const S: Situation = { now: iso(6), disasterAt: iso(0), outageAt: null };

const person = (id: string): TriagePerson => ({
  id,
  clocks: [],
  livesAlone: false,
  bedridden: false,
  hasSupporter: true,
  dementia: false,
  selfReportUnreliable: false,
});

/** 本人の赤（けが・動けない）を 1 時間後に */
const RED_INJURY: TriageSignal = { color: "red", source: "self", at: iso(1), injured: true, canMove: false };
const ARRIVAL: TriageArrival = { at: iso(2), shelter: "みどり小学校" };

const entry = (id: string, signals: TriageSignal[], arrivals: TriageArrival[] = []): TriageEntry => ({
  person: person(id),
  signals,
  arrivals,
});

/** 言葉の印を外した結果（色・並び・理由が前と同じかを比べる） */
const withoutVia = ({ greenVia: _greenVia, ...rest }: TriageResult) => rest;

describe("受入から来た緑（T78）: 色・並び・理由は表のまま、状態の言葉だけ「受入」", () => {
  it("赤（けが・動けない）のあとの受け入れ: 色は緑・行 green・組 4・理由「到着 みどり小学校」のまま、印は arrival、言葉は「受入」", () => {
    const r = triage(entry("p1", [RED_INJURY], [ARRIVAL]), S);
    expect([r.color, r.rule, r.group, r.reason]).toEqual(["green", "green", 4, "到着 みどり小学校"]);
    expect(r.greenVia).toBe("arrival");
    expect(stateLabel(r)).toBe("受入");
  });

  it("搬送で閉じた受け入れ: 理由「搬送 市民病院」のまま、印は transport、言葉は「搬送」", () => {
    const r = triage(entry("p1", [RED_INJURY], [{ ...ARRIVAL, transported: { at: iso(3), to: "市民病院" } }]), S);
    expect([r.color, r.rule, r.reason]).toEqual(["green", "green", "搬送 市民病院"]);
    expect(r.greenVia).toBe("transport");
    expect(stateLabel(r)).toBe("搬送");
  });

  it("本人・家族・ケアマネの緑と訪問の緑には印を付けない（言葉は「無事」）", () => {
    for (const sig of [
      { color: "green", source: "self", at: iso(1) },
      { color: "green", source: "family", at: iso(1) },
      { color: "green", source: "care_manager", at: iso(1) },
      { color: "green", source: "care_manager", at: iso(1), visit: true },
    ] satisfies TriageSignal[]) {
      const r = triage(entry("p1", [sig]), S);
      expect(r.color).toBe("green");
      expect(r.greenVia).toBeUndefined();
      expect(stateLabel(r)).toBe(COLOR_LABELS.green);
    }
  });

  it("受け入れのあとの本人の緑・受け入れより後の赤は、受け入れの印を持ち越さない", () => {
    const later = triage(entry("p1", [RED_INJURY, { color: "green", source: "self", at: iso(3) }], [ARRIVAL]), S);
    expect([later.reason, later.greenVia, stateLabel(later)]).toEqual(["本人が「無事」", undefined, "無事"]);
    const redAfter = triage(entry("p1", [{ ...RED_INJURY, at: iso(3) }], [ARRIVAL]), S);
    expect([redAfter.color, redAfter.rule, redAfter.greenVia, stateLabel(redAfter)]).toEqual(["red", "red_injury", undefined, "至急"]);
  });

  it("受け入れの緑でも、時計の半分を過ぎていれば表の黄（要確認）のまま。印は行 green だけ", () => {
    const p: TriagePerson = {
      ...person("p1"),
      clocks: [{ kind: "medication", category: "insulin", label: "インスリン", value: 8, unit: "hour", starts_on: "disaster" }],
    };
    const r = triage({ person: p, signals: [RED_INJURY], arrivals: [ARRIVAL] }, S);
    expect([r.color, r.rule, r.greenVia, stateLabel(r)]).toEqual(["yellow", "green_clock_half", undefined, "要確認"]);
  });

  it("ケアマネの上書きで色が変われば、上書きの色の言葉（緑の印は表の色が緑のときだけ効く）", () => {
    const up = triage(
      {
        ...entry("p1", [RED_INJURY], [ARRIVAL]),
        override: { to: "yellow", baseAtOverride: "green", reason: "けがの様子を確かめる", by: "山本", at: iso(4) },
      },
      S,
    );
    expect([up.color, up.baseColor, stateLabel(up)]).toEqual(["yellow", "green", "要確認"]);
  });

  it("並びは印で変わらない: 印だけ違う 2 つの結果の比べは 0、10 人の順は印を外しても同じ", () => {
    const a = triage(entry("p1", [RED_INJURY], [ARRIVAL]), S);
    expect(compareResults(a, withoutVia(a) as TriageResult)).toBe(0);
    const entries = [
      entry("p1", [RED_INJURY], [ARRIVAL]),
      entry("p2", [{ color: "green", source: "self", at: iso(1) }]),
      entry("p3", [RED_INJURY]),
      entry("p4", []),
      entry("p5", [RED_INJURY], [{ ...ARRIVAL, transported: { at: iso(3), to: null } }]),
    ];
    const ranked = rank(entries, S);
    expect(ranked.map((r) => r.personId)).toEqual([...ranked].map(withoutVia).sort((x, y) => compareResults(x as TriageResult, y as TriageResult)).map((r) => r.personId));
    expect(ranked.map((r) => [r.personId, r.color, r.group])).toEqual([
      ["p3", "red", 0],
      ["p4", "gray", 3],
      ["p1", "green", 4],
      ["p2", "green", 4],
      ["p5", "green", 4],
    ]);
  });
});
