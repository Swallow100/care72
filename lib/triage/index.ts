// ルールの表（docs/SPEC.md「医療の芯」）。安否の色と連絡の順位はこの表で出し、Claude は決めない。
// 表の行は下の RULES。上から順に当て、最初に当たった行で色と理由の 1 行が決まる。
// テストは triage.test.ts（先に書いた）。表に行が無い所は決めず、docs/PROGRESS.md の問いにした。
//
// 入力は時刻で持つ: 今・発災・停電の始まり（台帳の時計はここから走る）と、信号ごとの時刻。
// 読み方（表から決めた所）:
// - 信号は時刻の新しい物を使う。今より後の時刻の信号は使わない。信号が無ければ未知。
// - 時計はきっかけ（停電・発災）から走る。停電していなければ停電で走る時計は止まったまま（残りは全部）。
// - 「超えた」「過ぎた」はちょうどを含まない（「12 時間までは灰」に合わせた）。
// - 「機器の時計」は時計の種類が機器（A）の物だけ。物（B）・薬（C）は半分の行だけに効く。

import type {
  ClockCategory,
  ClockRow,
  ClockUnit,
  RecordingClass,
  SignalColor,
  SignalSource,
} from "../db/types.ts";

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

/** 本人・家族・支援者・ケアマネからの信号 1 つ。赤は 4 問の答えと録音の分類を持てる */
export type TriageSignal = {
  color: SignalColor;
  source: SignalSource;
  /** 信号の時刻（ISO 8601） */
  at: string;
  /** 赤の 4 問の「けが」。null は答えていない */
  injured?: boolean | null;
  /** 赤の 4 問の「動けるか」。null は答えていない */
  canMove?: boolean | null;
  classes?: RecordingClass[];
};

/** 災害の情報。時刻は ISO 8601 */
export type Situation = {
  /** 今 */
  now: string;
  /** 発災（災害モードに切り替えた時刻） */
  disasterAt: string;
  /** 停電が始まった時刻。停電していなければ null */
  outageAt: string | null;
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

/** 1 人ぶんの入力。signals は信号の全部（順は問わない） */
export type TriageEntry = { person: TriagePerson; signals: ReadonlyArray<TriageSignal>; override?: Override };

/** 悪さの順。上書きが切れたかを見るのに使う */
export const SEVERITY: Record<Color, number> = { green: 0, gray: 1, yellow: 2, red: 3 };

const UNIT_HOURS: Record<ClockUnit, number> = { minute: 1 / 60, hour: 1, day: 24, week: 168 };
const HOUR_MS = 3_600_000;

/** 時計の長さ（時間）。値が無い時計は未確認で null */
export function clockHours(clock: Pick<TriageClock, "value" | "unit">): number | null {
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

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`時刻の形が違う: ${iso}`);
  return t;
}

type ClockState = {
  clock: TriageClock;
  hours: number;
  elapsed: number;
  remaining: number;
  running: boolean;
};

function clockStates(person: TriagePerson, s: Situation): ClockState[] {
  const now = ms(s.now);
  return person.clocks.flatMap((clock): ClockState[] => {
    if (clock.starts_on === "none") return [];
    const hours = clockHours(clock);
    if (hours === null) return [];
    const startIso = clock.starts_on === "disaster" ? s.disasterAt : s.outageAt;
    const start = startIso === null ? null : ms(startIso);
    const running = start !== null && now >= start;
    const elapsed = running ? (now - start) / HOUR_MS : 0;
    return [{ clock, hours, elapsed, remaining: hours - elapsed, running }];
  });
}

/** 使う信号: 今までの信号のうち、時刻のいちばん新しい物（同じ時刻ならあとに入れた物） */
function latestSignal(signals: ReadonlyArray<TriageSignal>, s: Situation): TriageSignal | null {
  const now = ms(s.now);
  let best: { sig: TriageSignal; t: number } | null = null;
  for (const sig of signals) {
    const t = ms(sig.at);
    if (t > now) continue;
    if (best === null || t >= best.t) best = { sig, t };
  }
  return best?.sig ?? null;
}

const isDevice = (c: ClockState) => c.clock.kind === "device";
const isOver = (c: ClockState) => c.running && c.elapsed > c.hours;
const isPastHalf = (c: ClockState) => c.running && c.elapsed > c.hours / 2;
const isOutageDevice = (c: ClockState) => isDevice(c) && c.clock.starts_on === "outage";
const shortest = (cs: ClockState[]) => cs.reduce((a, b) => (b.remaining < a.remaining ? b : a));

const round1 = (x: number) => Math.round(x * 10) / 10;

/** 時間を画面の言い方に: 1 時間未満は分、2 日未満は時間、それ以上は日 */
export function formatHours(h: number): string {
  const v = Math.abs(h);
  if (v < 1) return `${Math.round(v * 60)} 分`;
  if (v < 48) return `${round1(v)} 時間`;
  return `${round1(v / 24)} 日`;
}

/** 信号の出どころの言い方。訓練の本人役（agent）は本人 */
const WHO: Record<SignalSource, string> = {
  self: "本人",
  agent: "本人",
  family: "家族",
  supporter: "支援者",
  care_manager: "ケアマネ",
};

/** 表の行が見る物 */
type RuleInput = {
  signal: TriageSignal | null;
  states: ClockState[];
  hoursSinceDisaster: number;
};

const over = (c: ClockState) => `${c.clock.label} ${formatHours(c.hours)}を超過`;
const left = (c: ClockState) => (isOver(c) ? over(c) : `${c.clock.label} 残り ${formatHours(c.remaining)}`);
const unconfirmed = (x: RuleInput) => (x.hoursSinceDisaster > 0 ? `未確認 ${formatHours(x.hoursSinceDisaster)}` : "未確認");
const who = (x: RuleInput) => (x.signal ? WHO[x.signal.source] : "本人");

function injuryWords(sig: TriageSignal | null): string[] {
  if (!sig) return [];
  const words: string[] = [];
  if (sig.injured === true || sig.classes?.includes("injury")) words.push("けが");
  if (sig.canMove === false || sig.classes?.includes("immobile")) words.push("動けない");
  return words;
}

export type Rule = {
  id: RuleId;
  /** どの信号の行か（未知は信号が無いときも） */
  signal: SignalColor;
  /** 表の「入力」 */
  input: string;
  color: Color;
  /** 表の「理由の例」。triage.test.ts で本当の出力と同じかを確かめる */
  example: string;
  /** 行の元（仕様書の表か、docs/DECISIONS.md の案の番号） */
  origin: string;
  /** 当たれば理由の 1 行を返す。当たらなければ null */
  match: (x: RuleInput) => string | null;
};

function firstOf(cs: ClockState[], say: (c: ClockState) => string): string | null {
  return cs.length > 0 ? say(shortest(cs)) : null;
}

/** ルールの表。上から順に当てる。信号ごとの最後の行はいつも当たる */
export const RULES: ReadonlyArray<Rule> = [
  {
    id: "red_injury",
    signal: "red",
    input: "赤 ＋ けが・動けない",
    color: "red",
    example: "本人が「動けない」",
    origin: "仕様書",
    match: (x) => {
      const words = injuryWords(x.signal);
      return words.length > 0 ? `${who(x)}が${words.map((w) => `「${w}」`).join("")}` : null;
    },
  },
  {
    id: "red",
    signal: "red",
    input: "赤だけ",
    color: "red",
    example: "本人が「無事じゃない」",
    origin: "仕様書",
    match: (x) => `${who(x)}が「無事じゃない」`,
  },
  {
    id: "unknown_device_over",
    signal: "unknown",
    input: "未知 ＋ 停電が機器の時計を超えた",
    color: "red",
    example: "酸素 内蔵電池 2 時間を超過",
    origin: "仕様書",
    match: (x) => firstOf(x.states.filter((c) => isOutageDevice(c) && isOver(c)), over),
  },
  {
    id: "unknown_half",
    signal: "unknown",
    input: "未知 ＋ 時計の半分を過ぎた",
    color: "yellow",
    example: "透析 次の回まで 残り 18 時間、未確認 30 時間",
    origin: "仕様書",
    match: (x) => firstOf(x.states.filter(isPastHalf), (c) => `${left(c)}、${unconfirmed(x)}`),
  },
  {
    id: "unknown",
    signal: "unknown",
    input: "未知（時計の半分まで。薬だけで時計 24 時間なら 12 時間までは灰）",
    color: "gray",
    example: "未確認 6 時間",
    origin: "仕様書",
    match: (x) => unconfirmed(x),
  },
  {
    id: "green_device_low",
    signal: "green",
    input: "緑だが機器の時計の半分を過ぎた",
    color: "yellow",
    example: "無事だが酸素 内蔵電池 残り 30 分",
    origin: "仕様書",
    match: (x) => firstOf(x.states.filter((c) => isOutageDevice(c) && isPastHalf(c)), (c) => `無事だが${left(c)}`),
  },
  {
    id: "green",
    signal: "green",
    input: "緑",
    color: "green",
    example: "本人が「無事」",
    origin: "仕様書",
    match: (x) => `${who(x)}が「無事」`,
  },
];

function baseRule(x: RuleInput): { rule: Rule; reason: string } {
  const color: SignalColor = x.signal?.color ?? "unknown";
  for (const rule of RULES) {
    if (rule.signal !== color) continue;
    const reason = rule.match(x);
    if (reason !== null) return { rule, reason };
  }
  throw new Error(`ルールの表に当たる行が無い: ${color}`);
}

function applyOverride(base: Color, o: Override): { color: Color; detail: Override & { expired: boolean } } {
  if (!o.reason.trim()) throw new Error("上書きには理由が要る");
  // 上書きしたあとに表の色が悪くなったら、上書きは切れる。上げてあった色より下げはしない
  const expired = SEVERITY[base] > SEVERITY[o.baseAtOverride];
  const color = expired ? (SEVERITY[base] >= SEVERITY[o.to] ? base : o.to) : o.to;
  return { color, detail: { ...o, expired } };
}

function groupOf(color: Color, rule: RuleId): TriageResult["group"] {
  if (color === "red") return rule === "red_injury" ? 0 : 1;
  if (color === "yellow") return 2;
  if (color === "gray") return 3;
  return 4;
}

/** 1 人の色・理由・並びの鍵 */
export function triage(entry: TriageEntry, situation: Situation): TriageResult {
  const { person } = entry;
  const states = clockStates(person, situation);
  const input: RuleInput = {
    signal: latestSignal(entry.signals, situation),
    states,
    hoursSinceDisaster: Math.max(0, (ms(situation.now) - ms(situation.disasterAt)) / HOUR_MS),
  };
  const { rule, reason } = baseRule(input);
  const applied = entry.override ? applyOverride(rule.color, entry.override) : undefined;
  const color = applied ? applied.color : rule.color;
  return {
    personId: person.id,
    color,
    baseColor: rule.color,
    rule: rule.id,
    group: groupOf(color, rule.id),
    remainingHours: states.length > 0 ? Math.min(...states.map((c) => c.remaining)) : Infinity,
    tier: tierOf(person),
    reason,
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
