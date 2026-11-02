// ルールの表（docs/SPEC.md「医療の芯」と docs/DECISIONS.md の案 1〜6）。安否の色と連絡の順位はこの表で出し、Claude は決めない。
// 表の行は下の RULES。上から順に当て、最初に当たった行で色と理由の 1 行が決まる。理由には QUALIFIERS の言葉を足し、
// 並びは ORDER の順に比べる。行・足す言葉・優先の骨格の段（TIERS）には「なぜ」と出典の登録簿（lib/sources）の id を付ける。
// docs/TRIAGE.md と docs/SOURCES.md はこれらから作る（npm run docs:triage。一致はテストで確かめる）。
// 元が「案」の行は作者の確認待ち（docs/DECISIONS.md）。案のままでは本運用に使わない。
// テストは triage.test.ts と heavy-rain.test.ts（先に書いた）。
//
// 入力は時刻で持つ: 今・発災・停電の始まり（台帳の時計はここから走る）と、信号ごとの時刻と出どころ。
// 読み方は READING（docs/TRIAGE.md にも出る）。

import type {
  CheckStatus,
  ClockCategory,
  ClockRow,
  ClockUnit,
  DependsOn,
  RecordingClass,
  SignalColor,
  SignalSource,
} from "../db/types.ts";
import { DEPENDS_ON_LABELS } from "../labels.ts";
import type { SourceId } from "../sources/index.ts";

/**
 * 行の根拠（docs/tasks/T25.md）。表の行・足す言葉・骨格の段に 1 つずつ。
 * why は「なぜこの行があるか」の 1 文（事実 → ケアマネが確かめる物）。ケアマネと主治医だけが見る。本人・家族の 1 枚には出さない。
 * sourceIds は出典の登録簿（lib/sources）の id。登録簿に無い id は型とテストで落ちる。
 */
export type Basis = {
  why: string;
  sourceIds: ReadonlyArray<SourceId>;
};

/** 赤 至急・黄 要確認・灰 不明・緑 無事（赤は連絡の順の言葉で、本人の状態を言い切らない） */
export type Color = "red" | "yellow" | "gray" | "green";

/** 優先の骨格 1〜8（何で時間が決まるか） */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 表のどの行で決まったか（表の上から） */
export type RuleId =
  | "red_injury" // 赤 ＋ けが・動けない → 赤、最上位
  | "red" // 赤だけ → 赤
  | "unknown_device_over" // 不明 ＋ 停電が機器の時計を超えた → 赤
  | "unknown_clock_over" // 不明 ＋ 機器以外の時計を超えた → 赤（案 2）
  | "unknown_half" // 不明 ＋ 時計の半分を過ぎた → 黄
  | "unknown_unchecked" // 不明 ＋ 外の物に頼る時計が未確認 → 黄（案 1）
  | "unknown" // 不明（時計の半分まで） → 灰
  | "green_out_after_report" // 緑の報告のあとに機器の時計が切れた → 赤（案 3）
  | "green_out_before_report" // 機器の時計が切れたあとの緑 → 黄（案 3）
  | "green_device_low" // 緑だが機器の時計の半分を過ぎた → 黄
  | "green_clock_half" // 緑だが機器以外の時計の半分を過ぎた → 黄（案 6）
  | "green_unchecked" // 緑だが外の物に頼る時計が未確認 → 黄（案 1）
  | "green"; // 緑 → 緑、一番下

/** 理由に足す言葉 */
export type QualifierId = "unchecked" | "self_green_set_aside" | "no_supporter";

export type TriageClock = Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on"> & {
  /** 外の物に頼る時計の頼り先。無ければ頼らない */
  depends_on?: DependsOn | null;
  /** 頼り先の確認（人が付ける） */
  depends_check?: CheckStatus | null;
};

export type TriagePerson = {
  id: string;
  clocks: TriageClock[];
  livesAlone: boolean;
  /** 寝たきり・歩行不可 */
  bedridden: boolean;
  /** 避難支援等実施者がいる */
  hasSupporter: boolean;
  dementia: boolean;
  /** 本人の報告を当てにしない印（人が台帳で付ける。案 4） */
  selfReportUnreliable: boolean;
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
  /** 録音・自由文の Claude の分類（AI の印を付けて出す） */
  classes?: RecordingClass[];
  /** ケアマネが直した分類（人の分類。AI の印を付けない。Claude の分類より先に効く） */
  staffClasses?: RecordingClass[];
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
  /** 避難支援等実施者がいる（並びで「支援者なし」を先にする） */
  hasSupporter: boolean;
  tier: Tier;
  /** 理由 1 行（表の行の言葉に、足す言葉を「、」でつなぐ） */
  reason: string;
  /** 理由に足した言葉 */
  qualifiers: QualifierId[];
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

/** 優先の骨格。いちばん上の段を取る */
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

/** 時計の区分が骨格のどの段か。骨格に入らない区分（認知症・その他）は null。本人のページで時計ごとに「なぜ」を出すときに使う */
export function categoryTier(category: ClockCategory): Tier | null {
  return CATEGORY_TIER[category] ?? null;
}

/** 優先の骨格の段ごとの根拠。段の名前は lib/labels.ts の TIER_LABELS。1〜8 が順に 1 つずつ（テストで確かめる） */
export const TIERS: ReadonlyArray<{ tier: Tier } & Basis> = [
  {
    tier: 1,
    why: "人工呼吸器・吸引器は停電で内蔵電池に替わり、電池が切れると止まる → 外部電池・手で使う吸引器と電源のある避難先",
    sourceIds: ["nanbyo-shishin-2017", "nanbyo-tsuiho-2022"],
  },
  {
    tier: 2,
    why: "酸素濃縮器は停電で止まる → 予備ボンベの本数と電源のある避難先",
    sourceIds: ["jrs-respiratory-2012", "nanbyo-shishin-2017"],
  },
  {
    tier: 3,
    why: "透析は断水・停電・施設の被災でできなくなる → 次の透析日と受け入れ先",
    sourceIds: ["jadp-dialysis-2023"],
  },
  {
    tier: 4,
    why: "インスリン・栄養剤は手元の分が切れると続けられない → 持ち出す量と次の入手先",
    sourceIds: ["jadec-insulin-2023", "nanbyo-shishin-2017"],
  },
  {
    tier: 5,
    why: "抗凝固薬・ステロイド・抗てんかん薬は急にやめると危ない → 持ち出す量と処方の控え（お薬手帳）",
    sourceIds: ["jcs-disaster-2014", "nanbyo-shishin-2017"],
  },
  {
    tier: 6,
    why: "認知症の人は急な環境の変化に戸惑い、思うように話せないことがある → 本人の報告だけに頼らず家族・支援者に確かめる",
    sourceIds: ["mhlw-dementia-2018"],
  },
  {
    tier: 7,
    why: "寝たきり・歩けない人は自分で避難できず、支援者がいなければ見に行く人もいない → 避難を支える人を計画で決める",
    sourceIds: ["cao-shishin-2021", "saigai-kiroku-2018"],
  },
  {
    tier: 8,
    why: "医療の時計が無い人も安否は確かめる → 信号と経過の時間で並べる",
    sourceIds: ["mhlw-bcp-2020"],
  },
];

/** 段の根拠 */
export function tierBasis(tier: Tier): Basis {
  const found = TIERS.find((t) => t.tier === tier);
  if (!found) throw new Error(`骨格の段の根拠が無い: ${tier}`);
  return found;
}

/** 入力の読み方。docs/TRIAGE.md の「読み方」に出る */
export const READING: ReadonlyArray<{ text: string; origin: string }> = [
  { text: "信号は時刻のいちばん新しい物を使う。今より後の時刻の信号は使わない。信号が無ければ不明", origin: "決めた所" },
  {
    text: "本人の報告を当てにしない印（人が台帳で付ける）がある人は、本人（訓練の本人役を含む）の緑を使わない。家族・支援者・ケアマネの緑は使う。赤はそのまま赤",
    origin: "案 4",
  },
  { text: "時計は停電か発災から走る。停電していなければ停電で走る時計は止まったまま", origin: "仕様書" },
  { text: "「超えた」「過ぎた」はちょうどを含まない。仕様書の「12 時間までは灰」に合わせた", origin: "決めた所" },
  { text: "機器の時計は種類が機器（A）の時計。機器以外の時計は物（B）・薬（C）。本人の状態（D）は走らない", origin: "決めた所" },
  {
    text: "外の物に頼る時計は頼り先（透析先・冷蔵・配達）のある時計。確認（確認済・未確認）は人が台帳で付け、Claude は付けない",
    origin: "案 1",
  },
  {
    text: "けが・動けないが 4 問の答え（ボタン）から来たら理由は「本人が「動けない」」、録音・自由文の分類（Claude）から来たら「録音の分類（AI）: 動けない」と AI の印を付け、ケアマネが直した分類から来たら「分類（ケアマネ）: 動けない」（AI の印なし）。分類が Claude か人かは信号の classified_by で見る。答えにある言葉は分類から、人の分類にある言葉は Claude の分類から重ねない。いくつかあれば「、」でつなぐ",
    origin: "案（11/2 夕方 b）・T12",
  },
];

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`時刻の形が違う: ${iso}`);
  return t;
}

type ClockState = {
  clock: TriageClock;
  hours: number;
  /** 走り出した時刻（ms）。走っていなければ null */
  start: number | null;
  elapsed: number;
  remaining: number;
  running: boolean;
};

function clockStates(person: Pick<TriagePerson, "clocks">, s: Situation): ClockState[] {
  const now = ms(s.now);
  return person.clocks.flatMap((clock): ClockState[] => {
    if (clock.starts_on === "none") return [];
    const hours = clockHours(clock);
    if (hours === null) return [];
    const startIso = clock.starts_on === "disaster" ? s.disasterAt : s.outageAt;
    const start = startIso === null ? null : ms(startIso);
    const running = start !== null && now >= start;
    const elapsed = running ? (now - start) / HOUR_MS : 0;
    return [{ clock, hours, start: running ? start : null, elapsed, remaining: hours - elapsed, running }];
  });
}

/** 時計 1 つの今の残り（担当一覧の行の詳細で出す時計の事実）。色と並びは triage が決め、ここは使わない */
export type ClockRemaining = {
  /** 時計の長さ（時間） */
  hours: number;
  /** 走っているか（停電の時計は停電が始まってから） */
  running: boolean;
  /** 走り出してからの時間 */
  elapsed: number;
  /** 残り（時間）。超えたら負 */
  remaining: number;
  /** 超えた（ちょうどは含まない。表と同じ読み方） */
  over: boolean;
};

/** 時計 1 つの残り。走らない時計（本人の状態）・値の無い時計は null。停電の地区は呼ぶ側が Situation に当ててから渡す */
export function clockRemaining(clock: TriageClock, s: Situation): ClockRemaining | null {
  const [c] = clockStates({ clocks: [clock] }, s);
  if (!c) return null;
  return { hours: c.hours, running: c.running, elapsed: c.elapsed, remaining: c.remaining, over: isOver(c) };
}

/** 本人からの信号か（訓練の本人役を含む） */
const isFromSelf = (sig: TriageSignal) => sig.source === "self" || sig.source === "agent";

/**
 * 使う信号: 今までの信号のうち時刻のいちばん新しい物（同じ時刻ならあとに入れた物）。
 * 本人の報告を当てにしない人の本人の緑は使わない。いちばん新しい信号がその緑なら setAside。
 */
function readSignals(
  person: TriagePerson,
  signals: ReadonlyArray<TriageSignal>,
  s: Situation,
): { signal: TriageSignal | null; setAside: boolean } {
  const now = ms(s.now);
  const past = signals
    .map((sig, i) => ({ sig, i, t: ms(sig.at) }))
    .filter((x) => x.t <= now)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.sig);
  const ignored = (sig: TriageSignal) => person.selfReportUnreliable && sig.color === "green" && isFromSelf(sig);
  const usable = past.filter((sig) => !ignored(sig));
  const latest = past.at(-1);
  return { signal: usable.at(-1) ?? null, setAside: latest !== undefined && ignored(latest) };
}

const isDevice = (c: ClockState) => c.clock.kind === "device";
const isOver = (c: ClockState) => c.running && c.elapsed > c.hours;
const isPastHalf = (c: ClockState) => c.running && c.elapsed > c.hours / 2;
const shortest = (cs: ClockState[]) => cs.reduce((a, b) => (b.remaining < a.remaining ? b : a));
/** 時計が切れる時刻（ms）。走っている時計だけ */
const runsOutAt = (c: ClockState) => c.start! + c.hours * HOUR_MS;

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

/** 表の行と足す言葉が見る物 */
type RuleInput = {
  person: TriagePerson;
  signal: TriageSignal | null;
  /** 本人の緑を使わなかった（いちばん新しい信号が当てにしない本人の緑） */
  setAside: boolean;
  states: ClockState[];
  hoursSinceDisaster: number;
  /** 確認が未確認の頼り先（透析先・冷蔵・配達）。重ねない */
  unchecked: DependsOn[];
};

const over = (c: ClockState) => `${c.clock.label} ${formatHours(c.hours)}を超過`;
const left = (c: ClockState) => (isOver(c) ? over(c) : `${c.clock.label} 残り ${formatHours(c.remaining)}`);
const unconfirmed = (x: RuleInput) => (x.hoursSinceDisaster > 0 ? `連絡なし ${formatHours(x.hoursSinceDisaster)}` : "連絡なし");
const who = (x: RuleInput) => (x.signal ? WHO[x.signal.source] : "本人");
const uncheckedWords = (x: RuleInput) => x.unchecked.map((d) => `${DEPENDS_ON_LABELS[d]} 未確認`).join("、");

/**
 * けが・動けないの言葉を出どころで分ける。answered は 4 問の答え（人が押したボタン）、staff はケアマネが直した分類（人）、
 * classified は録音・自由文の分類（Claude）。答えにある言葉は分類から、人の分類にある言葉は Claude の分類から重ねない
 */
function injuryWords(sig: TriageSignal | null): { answered: string[]; staff: string[]; classified: string[] } {
  const answered: string[] = [];
  const staff: string[] = [];
  const classified: string[] = [];
  if (!sig) return { answered, staff, classified };
  const pick = (word: string, byButton: boolean, cls: RecordingClass) => {
    if (byButton) answered.push(word);
    else if (sig.staffClasses?.includes(cls)) staff.push(word);
    else if (sig.classes?.includes(cls)) classified.push(word);
  };
  pick("けが", sig.injured === true, "injury");
  pick("動けない", sig.canMove === false, "immobile");
  return { answered, staff, classified };
}

/** Claude の分類から来た言葉の印。画面でも文書でもこの形で AI の出力と分かるようにする */
const AI_CLASSIFIED_PREFIX = "録音の分類（AI）: ";
/** ケアマネが直した分類から来た言葉（人の判断なので AI の印を付けない） */
const STAFF_CLASSIFIED_PREFIX = "分類（ケアマネ）: ";

/**
 * 赤 ＋ けが・動けないの理由。答えは「本人が「動けない」」、人の分類は「分類（ケアマネ）: 動けない」、
 * Claude の分類は「録音の分類（AI）: 動けない」。いくつかあれば「、」でつなぐ
 */
function injuryReason(x: RuleInput): string | null {
  const { answered, staff, classified } = injuryWords(x.signal);
  const parts: string[] = [];
  if (answered.length > 0) parts.push(`${who(x)}が${answered.map((w) => `「${w}」`).join("")}`);
  if (staff.length > 0) parts.push(`${STAFF_CLASSIFIED_PREFIX}${staff.join("・")}`);
  if (classified.length > 0) parts.push(`${AI_CLASSIFIED_PREFIX}${classified.join("・")}`);
  return parts.length > 0 ? parts.join("、") : null;
}

/** 緑の信号のときに切れている機器の時計を、緑の報告の前に切れた物とあとに切れた物に分ける */
function devicesOut(x: RuleInput): { afterReport: ClockState[]; beforeReport: ClockState[] } {
  const out = x.states.filter((c) => isDevice(c) && isOver(c));
  if (!x.signal) return { afterReport: [], beforeReport: out };
  const reported = ms(x.signal.at);
  // ちょうど切れる時刻の報告はまだ超えていないので「報告のあとに切れた」
  return {
    afterReport: out.filter((c) => runsOutAt(c) >= reported),
    beforeReport: out.filter((c) => runsOutAt(c) < reported),
  };
}

export type Rule = Basis & {
  id: RuleId;
  /** どの信号の行か（不明は信号が無いときも） */
  signal: SignalColor;
  /** 表の「入力」 */
  input: string;
  color: Color;
  /** 表の「理由の例」。triage.test.ts で本当の出力と同じかを確かめる */
  example: string;
  /** 行の元（仕様書の表か、docs/DECISIONS.md の案の番号） */
  origin: string;
  /** 理由の言葉に頼り先の未確認を含む（足す言葉で重ねない） */
  saysUnchecked?: true;
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
    why: "けが・動けないは自分で避難できないという知らせ → 最初に電話し、行ける人を探す",
    sourceIds: ["mhlw-bcp-2020", "cao-shishin-2021"],
    match: injuryReason,
  },
  {
    id: "red",
    signal: "red",
    input: "赤だけ（録音の水が来た・機器が止まった・不明を含む）",
    color: "red",
    example: "本人が「無事じゃない」",
    origin: "仕様書",
    why: "本人・家族が助けを求めた → 中身が分からなくても先に電話",
    sourceIds: ["mhlw-bcp-2020"],
    match: (x) => `${who(x)}が「無事じゃない」`,
  },
  {
    id: "unknown_device_over",
    signal: "unknown",
    input: "不明 ＋ 停電が機器の時計を超えた",
    color: "red",
    example: "酸素 内蔵電池 2 時間を超過",
    origin: "仕様書",
    why: "返事がないまま停電が機器の電池の時間を超えた → 機器が止まっているおそれがあり至急",
    sourceIds: ["nanbyo-shishin-2017", "nanbyo-tsuiho-2022", "jrs-respiratory-2012"],
    match: (x) => firstOf(x.states.filter((c) => isDevice(c) && isOver(c)), over),
  },
  {
    id: "unknown_clock_over",
    signal: "unknown",
    input: "不明 ＋ 機器以外の時計（透析・インスリン・栄養剤・薬）を超えた",
    color: "red",
    example: "透析 次の回まで 2 日を超過",
    origin: "案 2",
    why: "返事がないまま透析・インスリン・栄養剤・薬の限度を過ぎた → 続けられていないおそれがあり至急",
    sourceIds: ["jadp-dialysis-2023", "jadec-insulin-2023", "nanbyo-shishin-2017", "jcs-disaster-2014"],
    match: (x) => firstOf(x.states.filter((c) => !isDevice(c) && isOver(c)), over),
  },
  {
    id: "unknown_half",
    signal: "unknown",
    input: "不明 ＋ 時計の半分を過ぎた",
    color: "yellow",
    example: "透析 次の回まで 残り 18 時間、連絡なし 30 時間",
    origin: "仕様書",
    why: "返事がないまま時計の半分を過ぎた → 切れる前に確かめる",
    sourceIds: ["mhlw-bcp-2020", "nanbyo-shishin-2017"],
    match: (x) => firstOf(x.states.filter(isPastHalf), (c) => `${left(c)}、${unconfirmed(x)}`),
  },
  {
    id: "unknown_unchecked",
    signal: "unknown",
    input: "不明 ＋ 外の物に頼る時計の確認が未確認",
    color: "yellow",
    example: "透析先 未確認、連絡なし 6 時間",
    origin: "案 1 を不明に広げた",
    why: "透析先・冷蔵・配達は外の事情で止まる → 本人に連絡がつかない間に頼り先を確かめる",
    sourceIds: ["jadp-dialysis-2023", "jadec-insulin-2023"],
    saysUnchecked: true,
    match: (x) => (x.unchecked.length > 0 ? `${uncheckedWords(x)}、${unconfirmed(x)}` : null),
  },
  {
    id: "unknown",
    signal: "unknown",
    input: "不明（時計の半分まで。薬だけで時計 24 時間なら 12 時間までは灰）",
    color: "gray",
    example: "連絡なし 6 時間",
    origin: "仕様書",
    why: "連絡がつかないだけでは様子は分からない → 時計の短い人から順に確かめる",
    sourceIds: ["mhlw-bcp-2020", "cao-shishin-2021"],
    match: (x) => unconfirmed(x),
  },
  {
    id: "green_out_after_report",
    signal: "green",
    input: "緑 ＋ 緑の報告のあとに機器の時計が切れた",
    color: "red",
    example: "緑の報告のあとに電池が切れた、酸素 内蔵電池 2 時間を超過",
    origin: "案 3",
    why: "緑の報告は電池が切れる前の物 → 今も機器が動いているかは分からない",
    sourceIds: ["nanbyo-tsuiho-2022", "nanbyo-shishin-2017"],
    match: (x) => firstOf(devicesOut(x).afterReport, (c) => `緑の報告のあとに電池が切れた、${over(c)}`),
  },
  {
    id: "green_out_before_report",
    signal: "green",
    input: "緑 ＋ 機器の時計が切れたあとの緑の報告",
    color: "yellow",
    example: "電池が切れたあとに緑の報告、酸素 内蔵電池 2 時間を超過",
    origin: "案 3（言い方を時計の事実に）",
    why: "電池が切れたあとに緑 → ボンベ・外部電池・発電機で動いている見込み。電源の中身を確かめる",
    sourceIds: ["nanbyo-shishin-2017", "jrs-respiratory-2012"],
    match: (x) => firstOf(devicesOut(x).beforeReport, (c) => `電池が切れたあとに緑の報告、${over(c)}`),
  },
  {
    id: "green_device_low",
    signal: "green",
    input: "緑だが機器の時計の半分を過ぎた（切れる前）",
    color: "yellow",
    example: "無事だが酸素 内蔵電池 残り 30 分",
    origin: "仕様書",
    why: "無事でも機器の電池の残りが少ない → 切れる前に予備の電源か電源のある避難先を確かめる",
    sourceIds: ["nanbyo-tsuiho-2022", "jrs-respiratory-2012"],
    match: (x) => firstOf(x.states.filter((c) => isDevice(c) && isPastHalf(c)), (c) => `無事だが${left(c)}`),
  },
  {
    id: "green_clock_half",
    signal: "green",
    input: "緑だが機器以外の時計の半分を過ぎた（超えたときも）",
    color: "yellow",
    example: "無事だがインスリン 残り 24 時間",
    origin: "案 6",
    why: "無事でも透析・薬・栄養剤の残りが減っている → 次の入手先を確かめる",
    sourceIds: ["jadp-dialysis-2023", "jadec-insulin-2023", "nanbyo-shishin-2017"],
    match: (x) => firstOf(x.states.filter((c) => !isDevice(c) && isPastHalf(c)), (c) => `無事だが${left(c)}`),
  },
  {
    id: "green_unchecked",
    signal: "green",
    input: "緑だが外の物に頼る時計の確認が未確認",
    color: "yellow",
    example: "無事だが透析先 未確認",
    origin: "案 1",
    why: "本人が無事でも頼り先（透析先・冷蔵・配達）が止まっていれば数日のうちに続けられない → 頼り先を確かめる",
    sourceIds: ["jadp-dialysis-2023", "jadec-insulin-2023"],
    saysUnchecked: true,
    match: (x) => (x.unchecked.length > 0 ? `無事だが${uncheckedWords(x)}` : null),
  },
  {
    id: "green",
    signal: "green",
    input: "緑",
    color: "green",
    example: "本人が「無事」",
    origin: "仕様書",
    why: "本人・家族が無事と答えた → 連絡の順は一番下。時計が進めば上の行に移る",
    sourceIds: ["mhlw-bcp-2020"],
    match: (x) => `${who(x)}が「無事」`,
  },
];

export type Qualifier = Basis & {
  id: QualifierId;
  /** 足すとき */
  when: string;
  /** 足す言葉の例 */
  text: string;
  origin: string;
  apply: (x: RuleInput, rule: Rule) => string | null;
};

/** 理由に足す言葉。色は変えない。この順に「、」でつなぐ */
export const QUALIFIERS: ReadonlyArray<Qualifier> = [
  {
    id: "unchecked",
    when: "外の物に頼る時計の確認が未確認（色を決めた行が言っていなければ）",
    text: "透析先 未確認",
    origin: "案 1",
    why: "頼り先（透析先・冷蔵・配達）が動いているかは本人の答えでは分からない → 理由に添えて見落とさない",
    sourceIds: ["jadp-dialysis-2023"],
    apply: (x, rule) => (x.unchecked.length > 0 && !rule.saysUnchecked ? uncheckedWords(x) : null),
  },
  {
    id: "self_green_set_aside",
    when: "本人の報告を当てにしない印があり、いちばん新しい信号が本人の緑",
    text: "本人の緑は参考",
    origin: "案 4",
    why: "認知症の人は思うように話せないことがある → 本人の緑より家族・支援者の答えを使う",
    sourceIds: ["mhlw-dementia-2018"],
    apply: (x) => (x.setAside ? "本人の緑は参考" : null),
  },
  {
    id: "no_supporter",
    when: "避難支援等実施者がいない（色を問わない）",
    text: "支援者なし",
    origin: "案 5",
    why: "支援者がいない人は見に行く人がいない → 同じ残りなら先に電話",
    sourceIds: ["cao-shishin-2021", "saigai-kiroku-2018"],
    apply: (x) => (x.person.hasSupporter ? null : "支援者なし"),
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

function uncheckedOf(person: TriagePerson): DependsOn[] {
  const out: DependsOn[] = [];
  for (const k of person.clocks) {
    if (k.depends_on && k.depends_check === "unconfirmed" && !out.includes(k.depends_on)) out.push(k.depends_on);
  }
  return out;
}

/** 1 人の色・理由・並びの鍵 */
export function triage(entry: TriageEntry, situation: Situation): TriageResult {
  const { person } = entry;
  const states = clockStates(person, situation);
  const { signal, setAside } = readSignals(person, entry.signals, situation);
  const input: RuleInput = {
    person,
    signal,
    setAside,
    states,
    hoursSinceDisaster: Math.max(0, (ms(situation.now) - ms(situation.disasterAt)) / HOUR_MS),
    unchecked: uncheckedOf(person),
  };
  const { rule, reason } = baseRule(input);
  const added = QUALIFIERS.flatMap((q) => {
    const text = q.apply(input, rule);
    return text === null ? [] : [{ id: q.id, text }];
  });
  const applied = entry.override ? applyOverride(rule.color, entry.override) : undefined;
  const color = applied ? applied.color : rule.color;
  return {
    personId: person.id,
    color,
    baseColor: rule.color,
    rule: rule.id,
    group: groupOf(color, rule.id),
    remainingHours: states.length > 0 ? Math.min(...states.map((c) => c.remaining)) : Infinity,
    hasSupporter: person.hasSupporter,
    tier: tierOf(person),
    reason: [reason, ...added.map((q) => q.text)].join("、"),
    qualifiers: added.map((q) => q.id),
    ...(applied ? { override: applied.detail } : {}),
  };
}

function cmp(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export type OrderKey = {
  /** docs/TRIAGE.md の並びの言い方 */
  label: string;
  origin: string;
  compare: (a: TriageResult, b: TriageResult) => number;
};

/** 並びの鍵。上から順に比べ、同じなら次へ */
export const ORDER: ReadonlyArray<OrderKey> = [
  { label: "色: 赤 けが・動けない → 赤 → 黄 → 灰 → 緑", origin: "仕様書", compare: (a, b) => cmp(a.group, b.group) },
  { label: "時計の残りが短い順", origin: "仕様書", compare: (a, b) => cmp(a.remainingHours, b.remainingHours) },
  {
    label: "支援者なしが先",
    origin: "案 5",
    compare: (a, b) => cmp(a.hasSupporter ? 1 : 0, b.hasSupporter ? 1 : 0),
  },
  { label: "優先の骨格の段 1〜8", origin: "仕様書", compare: (a, b) => cmp(a.tier, b.tier) },
  {
    label: "id",
    origin: "決めた所",
    compare: (a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
  },
];

export function compareResults(a: TriageResult, b: TriageResult): number {
  for (const key of ORDER) {
    const d = key.compare(a, b);
    if (d !== 0) return d;
  }
  return 0;
}

export function rank(entries: ReadonlyArray<TriageEntry>, situation: Situation): TriageResult[] {
  return entries.map((e) => triage(e, situation)).sort(compareResults);
}
