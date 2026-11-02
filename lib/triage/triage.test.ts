// ルールの表のテスト。docs/SPEC.md「医療の芯」の表と、架空の 10 人 × 信号（緑・赤・未知）× 停電の経過時間の組。
// 入力は時刻で持つ（今・発災・停電の始まり・信号の時刻）。ここでは発災の時刻を基準に「何時間あと」で書く。
// 表に行が無い所は決めずに it.todo に置き、docs/PROGRESS.md の問いにした。

import { describe, expect, it } from "vitest";
import type { SignalSource } from "../db/types.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toTriagePerson } from "./from-ledger.ts";
import {
  clockHours,
  rank,
  tierOf,
  triage,
  type Color,
  type Situation,
  type TriagePerson,
  type TriageSignal,
} from "./index.ts";

const PEOPLE: TriagePerson[] = SEED_PEOPLE.map(toTriagePerson);
const person = (id: string) => PEOPLE.find((p) => p.id === id)!;

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

describe("緊急度の骨格", () => {
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
    };
    expect(tierOf(base)).toBe(7);
    expect(tierOf({ ...base, hasSupporter: true })).toBe(8);
    expect(tierOf({ ...base, bedridden: false, dementia: true })).toBe(8);
    expect(tierOf({ ...base, bedridden: false, dementia: true, livesAlone: true })).toBe(6);
  });

  it("台帳から: 5 は寝たきりで支援者なし、4 は認知症で独居", () => {
    expect(person("p-05")).toMatchObject({ bedridden: true, hasSupporter: false });
    expect(person("p-04")).toMatchObject({ dementia: true, livesAlone: true, hasSupporter: true });
  });
});

describe("信号の読み方", () => {
  const p = person("p-09");

  it("信号が無ければ未知", () => {
    expect(triage({ person: p, signals: [] }, S.out6)).toMatchObject({ color: "gray", rule: "unknown" });
  });

  it("いちばん新しい信号を使う（入れた順ではなく時刻の順）", () => {
    const signals = [green(3), red({}, 1)];
    expect(triage({ person: p, signals }, S.out6).color).toBe("green");
    expect(triage({ person: p, signals: [...signals].reverse() }, S.out6).color).toBe("green");
    expect(triage({ person: p, signals: [green(1), red({}, 3)] }, S.out6).color).toBe("red");
  });

  it("今より後の時刻の信号は使わない（訓練の早送りで先の信号が入っていても）", () => {
    expect(triage({ person: p, signals: [green(10)] }, S.out6)).toMatchObject({ color: "gray", rule: "unknown" });
    expect(triage({ person: p, signals: [green(6)] }, S.out6).color).toBe("green");
  });

  it("同じ時刻の信号は、あとに入れた方を使う", () => {
    expect(triage({ person: p, signals: [green(2), red({}, 2)] }, S.out6).color).toBe("red");
    expect(triage({ person: p, signals: [red({}, 2), green(2)] }, S.out6).color).toBe("green");
  });

  it("未知の信号（ケアマネが「つながらない」と入れた等）は未知", () => {
    const unknown: TriageSignal = { color: "unknown", source: "care_manager", at: iso(3) };
    expect(triage({ person: p, signals: [green(1), unknown] }, S.out6).color).toBe("gray");
  });

  it("理由の言い方は誰からの信号か（本人・家族・支援者。訓練の本人役は本人）", () => {
    expect(triage({ person: p, signals: [green(0, "family")] }, S.calm).reason).toBe("家族が「無事」");
    expect(triage({ person: p, signals: [green(0, "supporter")] }, S.calm).reason).toBe("支援者が「無事」");
    expect(triage({ person: p, signals: [green(0, "agent")] }, S.calm).reason).toBe("本人が「無事」");
    expect(triage({ person: p, signals: [{ ...red(), source: "family" }] }, S.calm).reason).toBe("家族が「無事じゃない」");
  });

  it("時刻の形が違えば止める", () => {
    expect(() => triage({ person: p, signals: [{ color: "green", source: "self", at: "きのう" }] }, S.out6)).toThrow();
  });
});

describe("10 人 × 未知 × 停電の経過時間", () => {
  //                                    1 2 3 4 5 6 7 8 9 10
  it("発災直後・停電なし: 全員灰", () => expect(colorsFor(UNKNOWN, S.calm)).toEqual(colors("灰灰灰灰灰灰灰灰灰灰")));
  it("停電 1 時間: 酸素の電池（2 時間）はちょうど半分で、まだ灰", () =>
    expect(colorsFor(UNKNOWN, S.out1)).toEqual(colors("灰灰灰灰灰灰灰灰灰灰")));
  it("停電 2.5 時間: 1 は酸素の電池を超えて赤、2 は呼吸器の電池（3 時間）の半分を過ぎて黄", () =>
    expect(colorsFor(UNKNOWN, S.out2_5)).toEqual(colors("赤黄灰灰灰灰灰灰灰灰")));
  it("停電 6 時間: 2 も電池を超えて赤", () => expect(colorsFor(UNKNOWN, S.out6)).toEqual(colors("赤赤灰灰灰灰灰灰灰灰")));
  it("停電 30 時間: 3 は透析（2 日）の半分を過ぎて黄", () =>
    expect(colorsFor(UNKNOWN, S.out30)).toEqual(colors("赤赤黄灰灰灰灰灰灰灰")));
  it("停電 72 時間: 5・6・8 も半分を過ぎて黄。7 と 9 は灰のまま", () =>
    expect(colorsFor(UNKNOWN, S.out72)).toEqual(colors("赤赤黄灰黄黄灰黄灰灰")));
  it("停電なしで 30 時間: 電池とインスリン（停電で走る）は走らず、3 だけ黄", () =>
    expect(colorsFor(UNKNOWN, S.dry30)).toEqual(colors("灰灰黄灰灰灰灰灰灰灰")));
  it("停電が発災より遅れて始まれば、停電で走る時計は停電から数える", () => {
    // 発災から 6 時間、停電は 4 時間めから（停電 2 時間）: 1 の電池はちょうど 2 時間でまだ黄、2 は半分を過ぎて黄
    expect(colorsFor(UNKNOWN, sit(6, 4))).toEqual(colors("黄黄灰灰灰灰灰灰灰灰"));
  });
});

describe("10 人 × 緑 × 停電の経過時間", () => {
  it("発災直後・停電 1 時間・停電なし 30 時間: 全員緑", () => {
    for (const s of [S.calm, S.out1, S.dry30]) expect(colorsFor(GREEN, s)).toEqual(colors("緑緑緑緑緑緑緑緑緑緑"));
  });
  it("停電 2.5 時間から: 機器の時計の半分を過ぎた 1 と 2 は無事でも黄", () => {
    for (const s of [S.out2_5, S.out6, S.out30, S.out72]) {
      expect(colorsFor(GREEN, s)).toEqual(colors("黄黄緑緑緑緑緑緑緑緑"));
    }
  });
});

describe("10 人 × 赤 × 停電の経過時間", () => {
  it("どの時間でも全員赤", () => {
    for (const s of Object.values(S)) expect(colorsFor(RED, s)).toEqual(colors("赤赤赤赤赤赤赤赤赤赤"));
  });
  it("赤だけは組 1、けが・動けないは組 0（最上位）", () => {
    const p = person("p-09");
    const one = (sig: TriageSignal) => triage({ person: p, signals: [sig] }, S.calm);
    expect(one(red())).toMatchObject({ rule: "red", group: 1 });
    expect(one(red({ injured: true }))).toMatchObject({ rule: "red_injury", group: 0 });
    expect(one(red({ canMove: false })).group).toBe(0);
    expect(one(red({ classes: ["immobile"] })).group).toBe(0);
    expect(one(red({ classes: ["injury"] })).group).toBe(0);
    // 水が来た・機器が止まった・不明は「赤だけ」
    expect(one(red({ classes: ["water", "unknown"] })).group).toBe(1);
  });
});

describe("表の行の境目", () => {
  const medOnly: TriagePerson = {
    id: "med",
    clocks: [{ kind: "medication", category: "other", label: "薬", value: 24, unit: "hour", starts_on: "disaster" }],
    livesAlone: false,
    bedridden: false,
    hasSupporter: true,
    dementia: false,
  };

  it("未知 ＋ 薬だけ（時計 24 時間）: 12 時間までは灰、過ぎたら黄", () => {
    const at = (h: number) => triage({ person: medOnly, signals: UNKNOWN }, sit(h, null));
    expect(at(12).color).toBe("gray");
    expect(at(12.5).color).toBe("yellow");
    // 薬の時計は切れても機器ではないので黄のまま（表に行が無い。PROGRESS.md の問い）
    expect(at(30).color).toBe("yellow");
  });

  it("未知 ＋ 停電が機器の時計を超えた: ちょうどは黄、超えたら赤", () => {
    const p = person("p-01");
    expect(triage({ person: p, signals: UNKNOWN }, sit(2)).color).toBe("yellow");
    expect(triage({ person: p, signals: UNKNOWN }, sit(2.1)).color).toBe("red");
  });
});

describe("理由 1 行", () => {
  it("表の例と同じ言い方", () => {
    const r = (id: string, signals: TriageSignal[], s: Situation) => triage({ person: person(id), signals }, s).reason;
    expect(r("p-01", UNKNOWN, S.out2_5)).toBe("酸素 内蔵電池 2 時間を超過");
    expect(r("p-01", GREEN, sit(1.5))).toBe("無事だが酸素 内蔵電池 残り 30 分");
    expect(r("p-03", UNKNOWN, S.dry30)).toBe("透析 次の回まで 残り 18 時間、未確認 30 時間");
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
    expect(out.map((r) => r.color)).toEqual(colors("赤赤黄灰灰灰灰灰灰灰"));
  });

  it("緑は一番下", () => {
    const signals: Record<string, TriageSignal[]> = { "p-08": GREEN, "p-10": GREEN };
    const out = rank(
      PEOPLE.map((p) => ({ person: p, signals: signals[p.id] ?? UNKNOWN })),
      S.out72,
    );
    expect(ids(out).slice(-2)).toEqual(["p-08", "p-10"]);
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

describe("表に行が無いので決めていない所（docs/PROGRESS.md の問い）", () => {
  it.todo("3 田中: 緑だが透析先が未確認で黄（10 人の表にはあるが、ルールの表に行が無い）");
  it.todo("4 佐藤: 認知症で本人の信号が当てにならない人の緑を、緑のまま受けるか");
  it.todo("5 伊藤: 寝たきり・支援者なしで「次に上がる」をどう並びに出すか（骨格はステロイドの 5 が先に効く）");
  it.todo("未知で機器以外の時計（透析・インスリン・栄養剤・薬）が切れたとき、黄のままか赤に上げるか");
  it.todo("緑のまま機器の時計が切れたとき（電池を超えた）、黄のままか赤に上げるか");
});
