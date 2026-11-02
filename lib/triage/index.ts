// ルールの表（docs/SPEC.md「医療の芯」）。安否の色と連絡の順位はこの表で出し、Claude は決めない。
// テストは triage.test.ts（先に書いた）。表に行が無い所は決めず、docs/PROGRESS.md の問いにした。
//
// | 入力                           | 色           | 理由の例                     |
// | 赤 ＋ けが・動けない           | 赤、最上位   | 本人が「動けない」           |
// | 赤だけ                         | 赤           | 本人が「無事じゃない」       |
// | 未知 ＋ 停電が機器の時計を超えた | 赤         | 酸素 内蔵電池 2 時間を超過   |
// | 未知 ＋ 時計の半分を過ぎた     | 黄           | 透析 翌日まで、未確認 6 時間 |
// | 未知 ＋ 薬だけ（時計 24 時間） | 灰           | 12 時間までは灰              |
// | 緑だが機器の時計が切れる       | 黄           | 無事だが酸素 残り 1 時間     |
// | 緑                             | 緑、一番下   | 本人が「無事」               |
//
// 同じ色の中は時計の残りが短い順、同じなら緊急度の骨格（1〜8）の順。
// 読み方（表から決めた所）:
// - 時計はきっかけ（停電・発災）から走る。停電していなければ停電で走る時計は止まったまま（残りは全部）。
// - 「超えた」「過ぎた」はちょうどを含まない（「12 時間までは灰」に合わせた）。
// - 「機器の時計」は時計の種類が機器（A）の物だけ。物（B）・薬（C）は半分の行だけに効く。

import type { ClockCategory, ClockRow, ClockUnit, RecordingClass } from "../db/types.ts";

/** 赤 危険・黄 要確認・灰 未知・緑 無事 */
export type Color = "red" | "yellow" | "gray" | "green";

/** 緊急度の骨格 1〜8（何で時間が決まるか） */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 表のどの行で決まったか（表の上から） */
export type RuleId =
  | "red_injury" // 赤 ＋ けが・動けない → 赤、最上位
  | "red" // 赤だけ → 赤
  | "unknown_device_over" // 未知 ＋ 停電が機器の時計を超えた → 赤
  | "unknown_half" // 未知 ＋ 時計の半分を過ぎた → 黄
  | "unknown" // 未知（時計の半分まで） → 灰
  | "green_device_low" // 緑だが機器の時計が切れる → 黄
  | "green"; // 緑 → 緑、一番下

export type TriageClock = Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on">;

export type TriagePerson = {
  id: string;
  clocks: TriageClock[];
  livesAlone: boolean;
  /** 寝たきり・歩行不可 */
  bedridden: boolean;
  /** 避難支援等実施者がいる */
  hasSupporter: boolean;
  dementia: boolean;
};

/** 本人・家族からの信号。赤は 4 問の答えと録音の分類を持てる */
export type TriageSignal =
  | { color: "green" }
  | { color: "red"; injured?: boolean | null; canMove?: boolean | null; classes?: RecordingClass[] }
  | { color: "unknown" };

/** 災害の情報 */
export type Situation = {
  /** 発災からの時間 */
  hoursSinceDisaster: number;
  /** 停電が始まってからの時間。停電していなければ null */
  hoursSinceOutage: number | null;
};

/** ケアマネの上書き。理由が要る */
export type Override = {
  to: Color;
  /** 上書きしたときの表の色。表の色がこれより悪くなったら上書きは切れる */
  baseAtOverride: Color;
  reason: string;
  by: string;
  at: string;
};

export type TriageResult = {
  personId: string;
  /** 上書きを当てたあとの色 */
  color: Color;
  /** 表の色 */
  baseColor: Color;
  rule: RuleId;
  /** 並びの組: 0 赤（けが・動けない）・1 赤・2 黄・3 灰・4 緑 */
  group: 0 | 1 | 2 | 3 | 4;
  /** 時計の残りの短い物（時間）。時計が無ければ Infinity */
  remainingHours: number;
  tier: Tier;
  /** 理由 1 行（表の行から） */
  reason: string;
  override?: Override & { expired: boolean };
};

export type TriageEntry = { person: TriagePerson; signal: TriageSignal; override?: Override };

/** 悪さの順。上書きが切れたかを見るのに使う */
export const SEVERITY: Record<Color, number> = { green: 0, gray: 1, yellow: 2, red: 3 };

const UNIT_HOURS: Record<ClockUnit, number> = { minute: 1 / 60, hour: 1, day: 24, week: 168 };

/** 時計の長さ（時間）。値が無い時計は未確認で null */
export function clockHours(clock: TriageClock): number | null {
  if (clock.value == null || clock.unit == null) return null;
  return clock.value * UNIT_HOURS[clock.unit];
}

const CATEGORY_TIER: Partial<Record<ClockCategory, Tier>> = {
  ventilator: 1, // 人工呼吸器・吸引（電源が止まると分単位）
  suction: 1,
  oxygen: 2, // 在宅酸素（予備ボンベの時間で決まる）
  dialysis: 3, // 透析（次の透析日までの日数）
  insulin: 4, // インスリン・経管栄養（日単位、保管と物の有無）
  tube_feeding: 4,
  anticoagulant: 5, // 抗凝固薬・ステロイド・抗てんかん薬（中断すると数日で危ない）
  steroid: 5,
  antiepileptic: 5,
};

/** 緊急度の骨格。いちばん上の段を取る */
export function tierOf(person: TriagePerson): Tier {
  let tier: Tier = 8;
  for (const k of person.clocks) {
    const t = CATEGORY_TIER[k.category];
    if (t !== undefined && t < tier) tier = t;
  }
  if (tier > 6 && person.dementia && person.livesAlone) tier = 6; // 認知症で独居（本人からの信号が当てにならない）
  if (tier > 7 && person.bedridden && !person.hasSupporter) tier = 7; // 寝たきり・歩行不可で支援者なし
  return tier;
}

type ClockState = {
  clock: TriageClock;
  hours: number;
  elapsed: number;
  remaining: number;
  running: boolean;
};

function clockStates(person: TriagePerson, s: Situation): ClockState[] {
  return person.clocks.flatMap((clock): ClockState[] => {
    if (clock.starts_on === "none") return [];
    const hours = clockHours(clock);
    if (hours === null) return [];
    const since = clock.starts_on === "disaster" ? s.hoursSinceDisaster : s.hoursSinceOutage;
    const running = since !== null;
    const elapsed = running ? Math.max(0, since) : 0;
    return [{ clock, hours, elapsed, remaining: hours - elapsed, running }];
  });
}

const isOver = (c: ClockState) => c.running && c.elapsed > c.hours;
const isPastHalf = (c: ClockState) => c.running && c.elapsed > c.hours / 2;
const isOutageDevice = (c: ClockState) => c.clock.kind === "device" && c.clock.starts_on === "outage";
const shortest = (cs: ClockState[]) => cs.reduce((a, b) => (b.remaining < a.remaining ? b : a));

const round1 = (x: number) => Math.round(x * 10) / 10;

/** 時間を画面の言い方に: 1 時間未満は分、2 日未満は時間、それ以上は日 */
export function formatHours(h: number): string {
  const v = Math.abs(h);
  if (v < 1) return `${Math.round(v * 60)} 分`;
  if (v < 48) return `${round1(v)} 時間`;
  return `${round1(v / 24)} 日`;
}

function unconfirmed(s: Situation): string {
  return s.hoursSinceDisaster > 0 ? `未確認 ${formatHours(s.hoursSinceDisaster)}` : "未確認";
}

function left(c: ClockState): string {
  return c.remaining > 0 ? `${c.clock.label} 残り ${formatHours(c.remaining)}` : `${c.clock.label} ${formatHours(c.hours)}を超過`;
}

type Base = { color: Color; rule: RuleId; reason: string };

function baseRule(signal: TriageSignal, states: ClockState[], s: Situation): Base {
  if (signal.color === "red") {
    const words: string[] = [];
    if (signal.injured === true || signal.classes?.includes("injury")) words.push("けが");
    if (signal.canMove === false || signal.classes?.includes("immobile")) words.push("動けない");
    if (words.length > 0) {
      return { color: "red", rule: "red_injury", reason: `本人が${words.map((w) => `「${w}」`).join("")}` };
    }
    return { color: "red", rule: "red", reason: "本人が「無事じゃない」" };
  }

  const devices = states.filter(isOutageDevice);

  if (signal.color === "unknown") {
    const over = devices.filter(isOver);
    if (over.length > 0) {
      const c = shortest(over);
      return { color: "red", rule: "unknown_device_over", reason: `${c.clock.label} ${formatHours(c.hours)}を超過` };
    }
    const half = states.filter(isPastHalf);
    if (half.length > 0) {
      return { color: "yellow", rule: "unknown_half", reason: `${left(shortest(half))}、${unconfirmed(s)}` };
    }
    return { color: "gray", rule: "unknown", reason: unconfirmed(s) };
  }

  const low = devices.filter(isPastHalf);
  if (low.length > 0) {
    return { color: "yellow", rule: "green_device_low", reason: `無事だが${left(shortest(low))}` };
  }
  return { color: "green", rule: "green", reason: "本人が「無事」" };
}

function applyOverride(base: Color, o: Override): { color: Color; detail: Override & { expired: boolean } } {
  if (!o.reason.trim()) throw new Error("上書きには理由が要る");
  // 上書きしたあとに表の色が悪くなったら、上書きは切れる。上げてあった色より下げはしない
  const expired = SEVERITY[base] > SEVERITY[o.baseAtOverride];
  const color = expired ? (SEVERITY[base] >= SEVERITY[o.to] ? base : o.to) : o.to;
  return { color, detail: { ...o, expired } };
}

function groupOf(color: Color, base: Base): TriageResult["group"] {
  if (color === "red") return base.rule === "red_injury" ? 0 : 1;
  if (color === "yellow") return 2;
  if (color === "gray") return 3;
  return 4;
}

/** 1 人の色・理由・並びの鍵 */
export function triage(entry: TriageEntry, situation: Situation): TriageResult {
  const { person, signal } = entry;
  const states = clockStates(person, situation);
  const base = baseRule(signal, states, situation);
  const applied = entry.override ? applyOverride(base.color, entry.override) : undefined;
  const color = applied ? applied.color : base.color;
  return {
    personId: person.id,
    color,
    baseColor: base.color,
    rule: base.rule,
    group: groupOf(color, base),
    remainingHours: states.length > 0 ? Math.min(...states.map((c) => c.remaining)) : Infinity,
    tier: tierOf(person),
    reason: base.reason,
    ...(applied ? { override: applied.detail } : {}),
  };
}

function cmp(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 並べる: 組（赤 けが・動けない → 赤 → 黄 → 灰 → 緑）、時計の残りが短い順、骨格の順、最後に id */
export function compareResults(a: TriageResult, b: TriageResult): number {
  return (
    cmp(a.group, b.group) ||
    cmp(a.remainingHours, b.remainingHours) ||
    cmp(a.tier, b.tier) ||
    (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0)
  );
}

export function rank(entries: ReadonlyArray<TriageEntry>, situation: Situation): TriageResult[] {
  return entries.map((e) => triage(e, situation)).sort(compareResults);
}
