// ルールの表のテスト。docs/SPEC.md「医療の芯」の表と docs/DECISIONS.md の案 1〜6・9、
// 架空の 10 人 × 信号（緑・赤・未知）× 停電の経過時間の組。
// 入力は時刻で持つ（今・発災・停電の始まり・信号の時刻）。ここでは発災の時刻を基準に「何時間あと」で書く。
// 大雨の筋を 10 人に流す受け入れのテストは heavy-rain.test.ts。

import { describe, expect, it } from "vitest";
import { RECORDING_CLASSES, type SignalSource } from "../db/types.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toTriagePerson } from "./from-ledger.ts";
import {
  clockHours,
  rank,
  RULES,
  tierOf,
  triage,
  type Color,
  type RuleId,
  type Situation,
  type TriagePerson,
  type TriageSignal,
} from "./index.ts";

const PEOPLE: TriagePerson[] = SEED_PEOPLE.map(toTriagePerson);
const person = (id: string) => PEOPLE.find((p) => p.id === id)!;

/** 頼り先の確認を全部「確認済」にした人（ケアマネが透析先を確かめたあと） */
const checked = (p: TriagePerson): TriagePerson => ({
  ...p,
  clocks: p.clocks.map((k) => (k.depends_on ? { ...k, depends_check: "confirmed" as const } : k)),
});

/** 発災の時刻。h 時間あとの時刻は iso(h) */
const T0 = Date.parse("2026-11-02T06:00:00.000Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();

/** 発災から h 時間。停電は outageFrom 時間に始まる（既定は発災と同時、null は停電なし） */
function sit(h: number, outageFrom: number | null = 0): Situation {
  return { now: iso(h), disasterAt: iso(0), outageAt: outageFrom === null ? null : iso(outageFrom) };
}

const green = (h = 0, source: SignalSource = "self"): TriageSignal => ({ color: "green", source, at: iso(h) });
const red = (extra: Partial<TriageSignal> = {}, h = 0): TriageSignal => ({ color: "red", source: "self", at: iso(h), ...extra });

/** 信号の組。どれも発災の時刻に本人から */
const GREEN: TriageSignal[] = [green()];
const RED: TriageSignal[] = [red()];
const UNKNOWN: TriageSignal[] = [];

/** 停電の経過時間の組。停電は発災と同時に始まるとする（calm・dry は停電なし） */
const S = {
  calm: sit(0, null),
  out1: sit(1),
  out2_5: sit(2.5),
  out6: sit(6),
  out30: sit(30),
  out72: sit(72),
  dry30: sit(30, null),
} satisfies Record<string, Situation>;

const COLOR_OF: Record<string, Color> = { 赤: "red", 黄: "yellow", 灰: "gray", 緑: "green" };
/** "赤黄灰…" を 1 字ずつ色にする（並びは 1〜10 の人の順） */
const colors = (row: string): Color[] => [...row].map((c) => COLOR_OF[c]);

function colorsFor(signals: TriageSignal[], situation: Situation): Color[] {
  return PEOPLE.map((p) => triage({ person: p, signals }, situation).color);
}

const one = (p: TriagePerson, signals: TriageSignal[], s: Situation) => triage({ person: p, signals }, s);

describe("時計の長さ", () => {
  it("単位を時間にそろえる。値が無い時計は未確認で null", () => {
    const base = { kind: "device", category: "oxygen", label: "x", starts_on: "outage" } as const;
    expect(clockHours({ ...base, value: 2, unit: "hour" })).toBe(2);
    expect(clockHours({ ...base, value: 30, unit: "minute" })).toBe(0.5);
    expect(clockHours({ ...base, value: 2, unit: "day" })).toBe(48);
    expect(clockHours({ ...base, value: 1, unit: "week" })).toBe(168);
    expect(clockHours({ ...base, value: null, unit: null })).toBeNull();
  });
});

describe("優先の骨格", () => {
  it("10 人の段: 呼吸器 1・酸素 2・透析 3・インスリンと経管栄養 4・抗凝固とステロイド 5・認知症で独居 6・それ以外 8", () => {
    expect(PEOPLE.map(tierOf)).toEqual([2, 1, 3, 6, 5, 4, 5, 4, 8, 8]);
  });

  it("寝たきり・歩行不可で支援者なしは 7。支援者がいれば 8。認知症でも独居でなければ 8", () => {
    const base: TriagePerson = {
      id: "x",
      clocks: [],
      livesAlone: false,
      bedridden: true,
      hasSupporter: false,
      dementia: false,
      selfReportUnreliable: false,
    };
    expect(tierOf(base)).toBe(7);
    expect(tierOf({ ...base, hasSupporter: true })).toBe(8);
    expect(tierOf({ ...base, bedridden: false, dementia: true })).toBe(8);
    expect(tierOf({ ...base, bedridden: false, dementia: true, livesAlone: true })).toBe(6);
  });

  it("台帳から: 5 は寝たきりで支援者なし、4 は認知症で独居で本人の報告を当てにしない印、3 の透析は透析先 未確認", () => {
    expect(person("p-05")).toMatchObject({ bedridden: true, hasSupporter: false, selfReportUnreliable: false });
    expect(person("p-04")).toMatchObject({ dementia: true, livesAlone: true, hasSupporter: true, selfReportUnreliable: true });
    expect(person("p-03").clocks[0]).toMatchObject({ depends_on: "dialysis_center", depends_check: "unconfirmed" });
  });
});

describe("信号の読み方", () => {
  const p = person("p-09");

  it("信号が無ければ未知", () => {
    expect(one(p, [], S.out6)).toMatchObject({ color: "gray", rule: "unknown" });
  });

  it("いちばん新しい信号を使う（入れた順ではなく時刻の順）", () => {
    const signals = [green(3), red({}, 1)];
    expect(one(p, signals, S.out6).color).toBe("green");
    expect(one(p, [...signals].reverse(), S.out6).color).toBe("green");
    expect(one(p, [green(1), red({}, 3)], S.out6).color).toBe("red");
  });

  it("今より後の時刻の信号は使わない（訓練の早送りで先の信号が入っていても）", () => {
    expect(one(p, [green(10)], S.out6)).toMatchObject({ color: "gray", rule: "unknown" });
    expect(one(p, [green(6)], S.out6).color).toBe("green");
  });

  it("同じ時刻の信号は、あとに入れた方を使う", () => {
    expect(one(p, [green(2), red({}, 2)], S.out6).color).toBe("red");
    expect(one(p, [red({}, 2), green(2)], S.out6).color).toBe("green");
  });

  it("未知の信号（ケアマネが「つながらない」と入れた等）は未知", () => {
    const unknown: TriageSignal = { color: "unknown", source: "care_manager", at: iso(3) };
    expect(one(p, [green(1), unknown], S.out6).color).toBe("gray");
  });

  it("理由の言い方は誰からの信号か（本人・家族・支援者。訓練の本人役は本人）", () => {
    expect(one(p, [green(0, "family")], S.calm).reason).toBe("家族が「無事」");
    expect(one(p, [green(0, "supporter")], S.calm).reason).toBe("支援者が「無事」");
    expect(one(p, [green(0, "agent")], S.calm).reason).toBe("本人が「無事」");
    expect(one(p, [{ ...red(), source: "family" }], S.calm).reason).toBe("家族が「無事じゃない」");
  });

  it("時刻の形が違えば止める", () => {
    expect(() => one(p, [{ color: "green", source: "self", at: "きのう" }], S.out6)).toThrow();
  });
});

describe("10 人 × 未知 × 停電の経過時間", () => {
  //                                    1 2 3 4 5 6 7 8 9 10
  it("発災直後・停電なし: 3 だけ透析先 未確認で黄、ほかは灰", () =>
    expect(colorsFor(UNKNOWN, S.calm)).toEqual(colors("灰灰黄灰灰灰灰灰灰灰")));
  it("停電 1 時間: 酸素の電池（2 時間）はちょうど半分で、まだ灰", () =>
    expect(colorsFor(UNKNOWN, S.out1)).toEqual(colors("灰灰黄灰灰灰灰灰灰灰")));
  it("停電 2.5 時間: 1 は酸素の電池を超えて赤、2 は呼吸器の電池（3 時間）の半分を過ぎて黄", () =>
    expect(colorsFor(UNKNOWN, S.out2_5)).toEqual(colors("赤黄黄灰灰灰灰灰灰灰")));
  it("停電 6 時間: 2 も電池を超えて赤", () => expect(colorsFor(UNKNOWN, S.out6)).toEqual(colors("赤赤黄灰灰灰灰灰灰灰")));
  it("停電 30 時間: 3 は透析（2 日）の半分も過ぎた", () =>
    expect(colorsFor(UNKNOWN, S.out30)).toEqual(colors("赤赤黄灰灰灰灰灰灰灰")));
  it("停電 72 時間: 3 は透析の 2 日を超えて赤（案 2）。5・6・8 は半分を過ぎて黄。6 の栄養剤はちょうど 3 日でまだ黄。7 と 9 は灰", () =>
    expect(colorsFor(UNKNOWN, S.out72)).toEqual(colors("赤赤赤灰黄黄灰黄灰灰")));
  it("停電なしで 30 時間: 電池とインスリン（停電で走る）は走らない", () =>
    expect(colorsFor(UNKNOWN, S.dry30)).toEqual(colors("灰灰黄灰灰灰灰灰灰灰")));
  it("停電が発災より遅れて始まれば、停電で走る時計は停電から数える", () => {
    // 発災から 6 時間、停電は 4 時間めから（停電 2 時間）: 1 の電池はちょうど 2 時間でまだ黄、2 は半分を過ぎて黄
    expect(colorsFor(UNKNOWN, sit(6, 4))).toEqual(colors("黄黄黄灰灰灰灰灰灰灰"));
  });
});

describe("10 人 × 緑（本人から、発災の時刻）× 停電の経過時間", () => {
  //                                                     1 2 3 4 5 6 7 8 9 10
  it("発災直後・停電 1 時間・停電なし 30 時間: 3 は透析先 未確認で黄、4 は本人の緑を参考にして灰", () => {
    for (const s of [S.calm, S.out1, S.dry30]) expect(colorsFor(GREEN, s)).toEqual(colors("緑緑黄灰緑緑緑緑緑緑"));
  });
  it("停電 2.5 時間: 1 は緑の報告のあとに電池が切れて赤（案 3）、2 は電池の半分を過ぎて黄", () =>
    expect(colorsFor(GREEN, S.out2_5)).toEqual(colors("赤黄黄灰緑緑緑緑緑緑")));
  it("停電 6 時間・30 時間: 2 も緑の報告のあとに電池が切れて赤", () => {
    for (const s of [S.out6, S.out30]) expect(colorsFor(GREEN, s)).toEqual(colors("赤赤黄灰緑緑緑緑緑緑"));
  });
  it("停電 72 時間: 5・6・8 は機器以外の時計の半分を過ぎて、無事でも黄（案 6）", () =>
    expect(colorsFor(GREEN, S.out72)).toEqual(colors("赤赤黄灰黄黄緑黄緑緑")));
});

describe("10 人 × 赤 × 停電の経過時間", () => {
  it("どの時間でも全員赤（本人の報告を当てにしない 4 も、赤は赤）", () => {
    for (const s of Object.values(S)) expect(colorsFor(RED, s)).toEqual(colors("赤赤赤赤赤赤赤赤赤赤"));
  });
  it("赤だけは組 1、けが・動けないは組 0（最上位）", () => {
    const p = person("p-09");
    const r = (sig: TriageSignal) => one(p, [sig], S.calm);
    expect(r(red())).toMatchObject({ rule: "red", group: 1 });
    expect(r(red({ injured: true }))).toMatchObject({ rule: "red_injury", group: 0 });
    expect(r(red({ canMove: false })).group).toBe(0);
    expect(r(red({ classes: ["immobile"] })).group).toBe(0);
    expect(r(red({ classes: ["injury"] })).group).toBe(0);
    // 水が来た・機器が止まった・不明は「赤だけ」
    expect(r(red({ classes: ["water", "unknown"] })).group).toBe(1);
  });
});

describe("案 1: 外の物に頼る時計の確認", () => {
  const tanaka = person("p-03");

  it("透析先が未確認なら、緑でも黄「透析先 未確認」。確認済なら緑", () => {
    expect(one(tanaka, [green(0, "family")], S.calm)).toMatchObject({
      color: "yellow",
      rule: "green_unchecked",
      reason: "無事だが透析先 未確認",
    });
    expect(one(checked(tanaka), [green(0, "family")], S.calm)).toMatchObject({ color: "green", reason: "家族が「無事」" });
  });

  it("未知でも、時計の半分までは黄「透析先 未確認」（緑より下にしない）。確認済なら灰", () => {
    expect(one(tanaka, UNKNOWN, S.out6)).toMatchObject({
      color: "yellow",
      rule: "unknown_unchecked",
      reason: "透析先 未確認、未確認 6 時間",
    });
    expect(one(checked(tanaka), UNKNOWN, S.out6)).toMatchObject({ color: "gray", reason: "未確認 6 時間" });
  });

  it("ほかの行で色が決まったときも、理由に「透析先 未確認」を足す", () => {
    expect(one(tanaka, UNKNOWN, S.dry30).reason).toBe("透析 次の回まで 残り 18 時間、未確認 30 時間、透析先 未確認");
    expect(one(tanaka, [green(0, "family")], S.out30).reason).toBe("無事だが透析 次の回まで 残り 18 時間、透析先 未確認");
    expect(one(tanaka, RED, S.calm)).toMatchObject({ color: "red", reason: "本人が「無事じゃない」、透析先 未確認" });
  });

  it("時計が走っていなくても効く（停電なしの冷蔵）。頼り先ごとの言い方", () => {
    const inoue = person("p-08");
    const fridge: TriagePerson = {
      ...inoue,
      clocks: inoue.clocks.map((k) => ({ ...k, depends_on: "refrigeration" as const, depends_check: "unconfirmed" as const })),
    };
    expect(one(fridge, GREEN, S.dry30)).toMatchObject({ color: "yellow", reason: "無事だが冷蔵 未確認" });
    expect(one(checked(fridge), GREEN, S.dry30).color).toBe("green");
  });
});

describe("案 2: 未知のまま機器以外の時計を超えたら赤", () => {
  const medOnly: TriagePerson = {
    id: "med",
    clocks: [{ kind: "medication", category: "other", label: "薬", value: 24, unit: "hour", starts_on: "disaster" }],
    livesAlone: false,
    bedridden: false,
    hasSupporter: true,
    dementia: false,
    selfReportUnreliable: false,
  };
  const at = (h: number) => one(medOnly, UNKNOWN, sit(h, null));

  it("未知 ＋ 薬だけ（時計 24 時間）: 12 時間までは灰、過ぎたら黄、24 時間を超えたら赤", () => {
    expect(at(12).color).toBe("gray");
    expect(at(12.5).color).toBe("yellow");
    expect(at(24).color).toBe("yellow");
    expect(at(24.5)).toMatchObject({ color: "red", rule: "unknown_clock_over", reason: "薬 24 時間を超過" });
  });

  it("3 田中: 未知で透析の 2 日を超えたら赤", () => {
    expect(one(person("p-03"), UNKNOWN, S.out72)).toMatchObject({
      color: "red",
      rule: "unknown_clock_over",
      reason: "透析 次の回まで 2 日を超過、透析先 未確認",
    });
  });

  it("緑のまま機器以外の時計を超えたときは黄のまま（案 6 の行）", () => {
    expect(one(person("p-03"), [green(0, "family")], S.out72)).toMatchObject({
      color: "yellow",
      rule: "green_clock_half",
      reason: "無事だが透析 次の回まで 2 日を超過、透析先 未確認",
    });
  });

  it("未知 ＋ 停電が機器の時計を超えた: ちょうどは黄、超えたら赤", () => {
    const p = person("p-01");
    expect(one(p, UNKNOWN, sit(2)).color).toBe("yellow");
    expect(one(p, UNKNOWN, sit(2.1)).color).toBe("red");
  });
});

describe("案 3: 緑のまま機器の時計を超えた", () => {
  const yamada = person("p-01");

  it("緑の報告が電池の切れる前なら赤「緑の報告のあとに電池が切れた」", () => {
    expect(one(yamada, [green(0)], S.out2_5)).toMatchObject({
      color: "red",
      rule: "green_out_after_report",
      group: 1,
      reason: "緑の報告のあとに電池が切れた、酸素 内蔵電池 2 時間を超過",
    });
    // 電池がちょうど切れる時刻の報告も「前」（ちょうどはまだ超えていない）
    expect(one(yamada, [green(2)], S.out2_5).color).toBe("red");
  });

  it("電池が切れたあとの緑なら黄「電池が切れたあとに緑の報告」", () => {
    expect(one(yamada, [green(2.5, "family")], S.out2_5)).toMatchObject({
      color: "yellow",
      rule: "green_out_before_report",
      reason: "電池が切れたあとに緑の報告、酸素 内蔵電池 2 時間を超過",
    });
    expect(one(yamada, [green(2.1)], S.out6).color).toBe("yellow");
  });

  it("電池が切れる前は今のまま（半分を過ぎたら黄）", () => {
    const kobayashi = person("p-02");
    expect(one(kobayashi, [green(0)], S.out2_5)).toMatchObject({ color: "yellow", rule: "green_device_low" });
    expect(one(kobayashi, [green(0)], sit(3)).reason).toBe("無事だが人工呼吸器 内蔵電池 残り 0 分");
    expect(one(kobayashi, [green(0)], S.out6).color).toBe("red");
  });
});

describe("案 4: 本人の報告を当てにしない印", () => {
  const sato = person("p-04");

  it("本人の緑は未知として扱い、理由に「本人の緑は参考」。訓練の本人役も同じ", () => {
    expect(one(sato, [green(1)], S.out6)).toMatchObject({
      color: "gray",
      rule: "unknown",
      reason: "未確認 6 時間、本人の緑は参考",
      qualifiers: ["self_green_set_aside"],
    });
    expect(one(sato, [green(1, "agent")], S.out6).color).toBe("gray");
  });

  it("家族・支援者の緑は緑。赤はそのまま赤", () => {
    expect(one(sato, [green(1, "family")], S.out6)).toMatchObject({ color: "green", reason: "家族が「無事」" });
    expect(one(sato, [green(1, "supporter")], S.out6)).toMatchObject({ color: "green", reason: "支援者が「無事」" });
    expect(one(sato, [red({}, 1)], S.out6)).toMatchObject({ color: "red", reason: "本人が「無事じゃない」" });
  });

  it("本人の緑のあとに支援者の緑が来たら緑。支援者の緑のあとの本人の緑は、支援者の緑を使う", () => {
    expect(one(sato, [green(1), green(3, "supporter")], S.out6)).toMatchObject({ color: "green", reason: "支援者が「無事」" });
    expect(one(sato, [green(1, "supporter"), green(3)], S.out6)).toMatchObject({
      color: "green",
      reason: "支援者が「無事」、本人の緑は参考",
    });
  });

  it("印の無い人の本人の緑は緑。印を外せば緑", () => {
    expect(one(person("p-09"), [green(1)], S.out6).color).toBe("green");
    expect(one({ ...sato, selfReportUnreliable: false }, [green(1)], S.out6)).toMatchObject({
      color: "green",
      reason: "本人が「無事」",
    });
  });
});

describe("案 5: 支援者なし", () => {
  const med = (category: "other" | "anticoagulant", days: number) => [
    { kind: "medication" as const, category, label: "薬", value: days, unit: "day" as const, starts_on: "disaster" as const },
  ];
  const base = { livesAlone: true, bedridden: false, dementia: false, selfReportUnreliable: false };
  const alone: TriagePerson = { ...base, id: "z-alone", clocks: med("other", 7), hasSupporter: false };
  const backed: TriagePerson = { ...base, id: "a-backed", clocks: med("anticoagulant", 7), hasSupporter: true };

  it("理由に「支援者なし」を出す（色を問わない）", () => {
    expect(one(person("p-05"), UNKNOWN, S.out6)).toMatchObject({
      color: "gray",
      hasSupporter: false,
      reason: "未確認 6 時間、支援者なし",
      qualifiers: ["no_supporter"],
    });
    expect(one(person("p-05"), RED, S.calm).reason).toBe("本人が「無事じゃない」、支援者なし");
    expect(one(person("p-09"), UNKNOWN, S.out6)).toMatchObject({ hasSupporter: true, qualifiers: [] });
  });

  it("同じ色・同じ残りなら支援者なしが先（骨格の段より先に効く）", () => {
    expect(tierOf(alone)).toBe(8);
    expect(tierOf(backed)).toBe(5);
    const out = rank([backed, alone].map((p) => ({ person: p, signals: UNKNOWN })), S.out6);
    expect(out.map((r) => r.personId)).toEqual(["z-alone", "a-backed"]);
  });

  it("残りが違えば残りが先", () => {
    const later = { ...alone, clocks: med("other", 8) };
    const out = rank([later, backed].map((p) => ({ person: p, signals: UNKNOWN })), S.out6);
    expect(out.map((r) => r.personId)).toEqual(["a-backed", "z-alone"]);
  });
});

describe("案 6: 緑でも機器以外の時計の半分を過ぎたら黄", () => {
  const inoue = person("p-08");

  it("8 井上: 停電で冷蔵が止まって 2 日を過ぎたら、無事でも黄", () => {
    expect(one(inoue, GREEN, S.out30).color).toBe("green");
    expect(one(inoue, GREEN, S.out72)).toMatchObject({
      color: "yellow",
      rule: "green_clock_half",
      reason: "無事だがインスリン 残り 24 時間",
    });
  });
});

describe("案 9: 録音の分類は 5 つのまま", () => {
  it("けが・動けない・水が来た・機器が止まった・不明。うめき声・黙っているは不明に入る", () => {
    expect([...RECORDING_CLASSES]).toEqual(["injury", "immobile", "water", "device_stopped", "unknown"]);
  });
  it("赤 ＋ 不明は赤（赤だけの組）", () => {
    expect(one(person("p-01"), [red({ classes: ["unknown"] })], S.calm)).toMatchObject({ color: "red", rule: "red", group: 1 });
  });
});

describe("表の行", () => {
  it("行の id は全部そろっていて重ならない", () => {
    const all: Record<RuleId, true> = {
      red_injury: true,
      red: true,
      unknown_device_over: true,
      unknown_clock_over: true,
      unknown_half: true,
      unknown_unchecked: true,
      unknown: true,
      green_out_after_report: true,
      green_out_before_report: true,
      green_device_low: true,
      green_clock_half: true,
      green_unchecked: true,
      green: true,
    };
    expect(RULES.map((r) => r.id)).toEqual(Object.keys(all));
  });

  it("表の「理由の例」は本当の出力と同じ", () => {
    const cases: Array<[RuleId, TriagePerson, TriageSignal[], Situation]> = [
      ["red_injury", person("p-09"), [red({ canMove: false })], S.calm],
      ["red", person("p-09"), RED, S.calm],
      ["unknown_device_over", person("p-01"), UNKNOWN, S.out2_5],
      ["unknown_clock_over", checked(person("p-03")), UNKNOWN, S.out72],
      ["unknown_half", checked(person("p-03")), UNKNOWN, S.dry30],
      ["unknown_unchecked", person("p-03"), UNKNOWN, S.out6],
      ["unknown", person("p-09"), UNKNOWN, S.out6],
      ["green_out_after_report", person("p-01"), [green(0)], S.out2_5],
      ["green_out_before_report", person("p-01"), [green(2.5)], S.out2_5],
      ["green_device_low", person("p-01"), GREEN, sit(1.5)],
      ["green_clock_half", person("p-08"), GREEN, S.out72],
      ["green_unchecked", person("p-03"), GREEN, S.calm],
      ["green", person("p-09"), GREEN, S.calm],
    ];
    expect(cases.map(([id]) => id)).toEqual(RULES.map((r) => r.id));
    for (const [id, p, signals, s] of cases) {
      const r = one(p, signals, s);
      expect(r.rule, id).toBe(id);
      expect(r.reason, id).toBe(RULES.find((x) => x.id === id)!.example);
      expect(r.baseColor, id).toBe(RULES.find((x) => x.id === id)!.color);
    }
  });
});

describe("理由 1 行", () => {
  it("表の例と同じ言い方", () => {
    const r = (id: string, signals: TriageSignal[], s: Situation) => one(person(id), signals, s).reason;
    expect(r("p-01", UNKNOWN, S.out2_5)).toBe("酸素 内蔵電池 2 時間を超過");
    expect(r("p-01", GREEN, sit(1.5))).toBe("無事だが酸素 内蔵電池 残り 30 分");
    expect(r("p-09", RED, S.calm)).toBe("本人が「無事じゃない」");
    expect(r("p-09", [red({ canMove: false })], S.calm)).toBe("本人が「動けない」");
    expect(r("p-09", [red({ injured: true, canMove: false })], S.calm)).toBe("本人が「けが」「動けない」");
    expect(r("p-09", GREEN, S.calm)).toBe("本人が「無事」");
    expect(r("p-09", UNKNOWN, S.calm)).toBe("未確認");
    expect(r("p-09", UNKNOWN, S.out6)).toBe("未確認 6 時間");
  });
});

describe("並び", () => {
  const ids = (rs: { personId: string }[]) => rs.map((r) => r.personId);

  it("同じ色の中は時計の残りが短い順、同じなら骨格の順（停電 6 時間・全員未知）", () => {
    const out = rank(PEOPLE.map((p) => ({ person: p, signals: UNKNOWN })), S.out6);
    expect(ids(out)).toEqual(["p-01", "p-02", "p-03", "p-06", "p-08", "p-05", "p-07", "p-09", "p-04", "p-10"]);
  });

  it("赤 ＋ 動けないが一番上、次に赤だけ（うめき声は分類で不明）、黄、灰", () => {
    const signals: Record<string, TriageSignal[]> = {
      "p-10": [red({ canMove: false })],
      "p-01": [red({ classes: ["unknown"] })],
    };
    const out = rank(
      PEOPLE.map((p) => ({ person: p, signals: signals[p.id] ?? UNKNOWN })),
      S.out2_5,
    );
    expect(ids(out)).toEqual(["p-10", "p-01", "p-02", "p-03", "p-06", "p-08", "p-05", "p-07", "p-09", "p-04"]);
    expect(out.map((r) => r.color)).toEqual(colors("赤赤黄黄灰灰灰灰灰灰"));
  });

  it("緑は一番下", () => {
    const signals: Record<string, TriageSignal[]> = { "p-09": GREEN, "p-10": GREEN };
    const out = rank(
      PEOPLE.map((p) => ({ person: p, signals: signals[p.id] ?? UNKNOWN })),
      S.out72,
    );
    expect(ids(out).slice(-2)).toEqual(["p-09", "p-10"]);
    expect(out.slice(-2).map((r) => r.color)).toEqual(["green", "green"]);
  });

  it("並びは入れた順に左右されない", () => {
    const entries = PEOPLE.map((p) => ({ person: p, signals: UNKNOWN }));
    expect(ids(rank([...entries].reverse(), S.out30))).toEqual(ids(rank(entries, S.out30)));
  });
});

describe("ケアマネの上書き", () => {
  const p2 = person("p-02");
  const down = { to: "gray", baseAtOverride: "yellow", reason: "夫が電話に出た", by: "acct-yamamoto", at: "2026-11-02T05:00:00.000Z" } as const;

  it("理由つきで下げられ、表の色も残る", () => {
    const r = triage({ person: p2, signals: UNKNOWN, override: down }, S.out2_5);
    expect(r).toMatchObject({ color: "gray", baseColor: "yellow", group: 3 });
    expect(r.override).toMatchObject({ reason: "夫が電話に出た", expired: false });
  });

  it("下げたあとに表の色が悪くなったら、上書きは切れて表の色に戻る", () => {
    const r = triage({ person: p2, signals: UNKNOWN, override: down }, S.out6);
    expect(r).toMatchObject({ color: "red", baseColor: "red" });
    expect(r.override?.expired).toBe(true);
  });

  it("上げた色は、表の色が上がっても下がらない", () => {
    const up = { to: "red", baseAtOverride: "gray", reason: "近所で土砂", by: "acct-yamamoto", at: "2026-11-02T05:00:00.000Z" } as const;
    const p = person("p-03");
    const r = triage({ person: p, signals: UNKNOWN, override: up }, S.out30);
    expect(r).toMatchObject({ color: "red", baseColor: "yellow", group: 1 });
    expect(r.override?.expired).toBe(true);
  });

  it("理由の無い上書きは受けない", () => {
    expect(() => triage({ person: p2, signals: UNKNOWN, override: { ...down, reason: " " } }, S.out2_5)).toThrow();
  });

  it("上げた人は並びでもその色の組に入る", () => {
    const up = { to: "red", baseAtOverride: "gray", reason: "近所で土砂", by: "acct-yamamoto", at: "2026-11-02T05:00:00.000Z" } as const;
    const out = rank(
      PEOPLE.map((p) => ({ person: p, signals: UNKNOWN, override: p.id === "p-09" ? up : undefined })),
      S.out6,
    );
    expect(out.slice(0, 3).map((r) => r.personId)).toEqual(["p-01", "p-02", "p-09"]);
  });
});
