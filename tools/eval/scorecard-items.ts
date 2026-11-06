// 評価の点数の表（T157）の項目。項目ごとに、台・良い向き・しきい値・単位と、台の結果の JSON（数の JSON）から数を出す読み方を持つ。
// 読むのは回のフォルダの数の JSON だけ（訓練 summary.json・書類 result.json・声の会話 summary.json・ほかの台の scorecard.json）。
// 記録の jsonl（台詞・送った中身）は読まない。
//
// 1 つの列に同じ台の回が 2 つ以上ある（r5 の訓練は大雨と地震の 2 フォルダ）ときは、項目の agg で 1 つの数にする。比（分子・分母）は足してから割る。
// seedOnly の項目は台の数の JSON から出せない（講評の待ち・言葉の長さの最大など、記録の jsonl の側にある）ので、r1〜r5 の種の値だけを並べる。
//
// しきい値は「0 のはず」の物だけに付ける（漏れ・画面に出た禁じた中身・押せない手が打てた・表の 2 問の前の締め など）。
// ほかは本物の回ごとに選び方が違い、決まった線を引くと偽の回で外れが出るだけなので付けない（前の回より悪くなった印だけ）。

import type { DrillSummaryLike, FormsResultLike, TalkSummaryLike } from "./scorecard-shapes.ts";
import type { AcceptOp, Bench, RunClient } from "./findings.ts";

export type Better = "higher" | "lower" | null;
/** count 数・frac 比（分子/分母を並べる）・rate 割合（%）・score 点・sec 秒・usd ドル・tokens */
export type Unit = "count" | "frac" | "rate" | "score" | "sec" | "usd" | "tokens";
export type Agg = "sum" | "mean" | "max";

/** 1 回の結果の数。比は [分子, 分母] */
export type Raw = number | readonly [number, number] | null;

/** 読んだ回（台ごとの形） */
export type BenchData =
  | { bench: "drill"; run: string; client: RunClient; data: DrillSummaryLike }
  | { bench: "forms"; run: string; client: RunClient; data: FormsResultLike }
  | { bench: "talk"; run: string; client: RunClient; data: TalkSummaryLike }
  | { bench: Bench; run: string; client: RunClient; generic: GenericScorecard };

/**
 * ほかの台（T156 の使う側の模擬など）が回のフォルダに書く数の JSON（scorecard.json）。values の鍵は項目の id（`persona.` で始める）。
 * items で項目の名前・良い向き・しきい値を渡せる（渡さなければ id を名前に、向きなし）
 */
export type GenericScorecard = {
  version: 1;
  bench: Bench;
  run: string;
  client: RunClient;
  values: Record<string, number | [number, number] | null>;
  items?: Array<{ id: string; label: string; better?: Better; unit?: Unit; agg?: Agg; threshold?: { op: AcceptOp; value: number } }>;
};

export type Item = {
  id: string;
  bench: Bench;
  label: string;
  better: Better;
  unit: Unit;
  agg: Agg;
  threshold?: { op: AcceptOp; value: number };
  /** 台の数の JSON から出せない（種の値だけ） */
  seedOnly?: true;
  /**
   * 数え方を変えた注（T161）。前の回と比べるときに混ざらないよう、変えた回・作業と中身を短く。点数の表の「注」に出る。
   * 形は「r7〜（T161）: 〜」。前の回の列は前の数え方の数のまま（数え直していない）
   */
  notes?: readonly string[];
  drill?: (s: DrillSummaryLike) => Raw;
  forms?: (r: FormsResultLike) => Raw;
  talk?: (s: TalkSummaryLike) => Raw;
};

const zero = { op: "<=" as const, value: 0 };
const sumOf = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0);
const meanOf = (xs: ReadonlyArray<number | null | undefined>): number | null => {
  const ys = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return ys.length > 0 ? sumOf(ys) / ys.length : null;
};

// ---------- 訓練（tools/eval/drill の summary.json） ----------

const runs = (s: DrillSummaryLike) => s.runs.map((r) => r.numbers);
/** 通話の往復の比（T158。通話の数の無い前の回は null） */
const talkFrac = (s: DrillSummaryLike, top: "repeats" | "repeatRaw", bottom: "replies" | "raw"): Raw => {
  const ns = runs(s).filter((n) => n.talk);
  if (ns.length === 0) return null;
  const d = sumOf(ns.map((n) => n.talk![bottom]));
  return d > 0 ? [sumOf(ns.map((n) => n.talk![top])), d] : null;
};
/** 仮想の回の出来事の無い人（T167。回の人ごとの数。仮想の回が無ければ null） */
const virtualNoKind = (s: DrillSummaryLike): Raw => {
  const ns = s.runs.filter((r) => r.scenario === "virtual" && r.numbers.persons).map((r) => r.numbers.persons!);
  const d = sumOf(ns.map((p) => p.people));
  return d > 0 ? [sumOf(ns.map((p) => p.noKind)), d] : null;
};
/** 世界の返事で捨てた名前（T174。前の回は数が無く null） */
const worldNamesDropped = (s: DrillSummaryLike): Raw => {
  const ns = runs(s).filter((n) => n.worldNames !== undefined);
  if (ns.length === 0) return null;
  const d = sumOf(ns.map((n) => n.worldNames!.total));
  return d > 0 ? [sumOf(ns.map((n) => n.worldNames!.dropped)), d] : null;
};
/** 通話の返事のうち本人役（AI）の割合（T167。前の回は数が無く null） */
const talkAiShare = (s: DrillSummaryLike): Raw => {
  const ns = runs(s).filter((n) => n.talk?.aiReplies !== undefined);
  if (ns.length === 0) return null;
  const d = sumOf(ns.map((n) => n.talk!.replies));
  return d > 0 ? [sumOf(ns.map((n) => n.talk!.aiReplies ?? 0)), d] : null;
};
const judgeAxes = ["realism", "difficulty", "variety", "consistency", "learning"] as const;

const DRILL: Item[] = [
  { id: "drill.finished", bench: "drill", label: "72 時間まで終わった回", better: "higher", unit: "frac", agg: "sum", drill: (s) => [s.totals.finished, s.runs.length] },
  {
    id: "drill.judge.consistency",
    bench: "drill",
    label: "審査役 人ごとの筋（1〜5）",
    better: "higher",
    unit: "score",
    agg: "mean",
    notes: ["r8〜（T165）: 審査役に渡す流れ（storyText）に、着いた人・届いた物、手の結果の訳・着く見込み、通話の往復と着信の要約、訪問の様子、訓練の中の時刻を足し、同じ時刻・同じ人の出来事を 1 行に。物差しの文と点の付け方は同じだが、入力が違うので r7 までの点と並べて比べない"],
    drill: (s) => s.judgeMean.consistency ?? null,
  },
  {
    id: "drill.judge.mean",
    bench: "drill",
    label: "審査役 5 つの平均（1〜5）",
    better: "higher",
    unit: "score",
    agg: "mean",
    notes: ["r8〜（T165）: 審査役に渡す流れを足した（drill.judge.consistency の注）。r7 までの点と並べて比べない"],
    drill: (s) => meanOf(judgeAxes.map((a) => s.judgeMean[a])),
  },
  { id: "drill.hurtToSafe", bench: "drill", label: "赤（動けない）から手なしで緑", better: "lower", unit: "count", agg: "sum", threshold: zero, drill: (s) => sumOf(runs(s).map((n) => n.contradictions.byRule.hurt_to_safe ?? 0)) },
  { id: "drill.offBand", bench: "drill", label: "時間帯の目安の外", better: "lower", unit: "rate", agg: "sum", drill: (s) => [sumOf(runs(s).map((n) => n.timeOdds.offBand)), sumOf(runs(s).map((n) => n.timeOdds.checked))] },
  { id: "drill.kindOverlap", bench: "drill", label: "出来事の種類の重なり（回どうし）", better: "lower", unit: "score", agg: "mean", drill: (s) => s.diversity.sequence.kindJaccard },
  // T165: 人ごとの筋。同じ回の人ごとの出来事の種類の数と、人どうしの種類の集合の重なり（前の回の summary には無いので null）
  { id: "drill.personKinds", bench: "drill", label: "人ごとの出来事の種類の数（平均）", better: "higher", unit: "score", agg: "mean", drill: (s) => s.diversity.persons.kindsPerPerson ?? null },
  { id: "drill.personNoKind", bench: "drill", label: "出来事の無い人の割合", better: "lower", unit: "score", agg: "mean", drill: (s) => s.diversity.persons.noKindShare ?? null },
  { id: "drill.personNoKindVirtual", bench: "drill", label: "仮想の回の出来事の無い人", better: "lower", unit: "frac", agg: "sum", drill: virtualNoKind },
  // T174: 世界の返事の名前のうち地理に無く捨てた物。r10 が 1 回目（基準づくり）
  { id: "drill.worldNamesDropped", bench: "drill", label: "世界の返事で捨てた名前", better: "lower", unit: "frac", agg: "sum", drill: worldNamesDropped },
  { id: "drill.personKindOverlap", bench: "drill", label: "人どうしの筋の似かた（種類の重なり）", better: "lower", unit: "score", agg: "mean", drill: (s) => s.diversity.persons.kindJaccard ?? null },
  { id: "drill.cut", bench: "drill", label: "本人役の言葉が文の途中で切れた", better: "lower", unit: "frac", agg: "sum", threshold: zero, drill: (s) => [sumOf(runs(s).map((n) => n.cut?.hits ?? 0)), sumOf(runs(s).map((n) => n.cut?.checked ?? 0))] },
  { id: "drill.overmask", bench: "drill", label: "画面の（氏名）で元の語に名前が無い", better: "lower", unit: "frac", agg: "sum", threshold: zero, drill: (s) => [sumOf(runs(s).map((n) => n.overmask?.hits ?? 0)), sumOf(runs(s).map((n) => n.overmask?.checked ?? 0))] },
  { id: "drill.talkCut", bench: "drill", label: "着信の往復の返事が切れた", better: "lower", unit: "frac", agg: "sum", seedOnly: true },
  { id: "drill.speechMax", bench: "drill", label: "言葉の長さの最大（字）", better: null, unit: "count", agg: "max", seedOnly: true },
  { id: "drill.reviewFindings", bench: "drill", label: "講評の指摘の数", better: null, unit: "count", agg: "max", seedOnly: true },
  { id: "drill.reviewWait", bench: "drill", label: "講評の待ち（秒、最長）", better: "lower", unit: "sec", agg: "max", seedOnly: true },
  { id: "drill.busyPaths", bench: "drill", label: "つながりにくい間 電話・伝言・押し", better: null, unit: "count", agg: "sum", seedOnly: true },
  { id: "drill.downPaths", bench: "drill", label: "不通の間 電話・伝言・押し", better: null, unit: "count", agg: "sum", seedOnly: true },
  { id: "drill.fitMisfit", bench: "drill", label: "想定に合わない物", better: "lower", unit: "count", agg: "sum", threshold: zero, drill: (s) => s.totals.fitMisfit ?? 0 },
  { id: "drill.factGated", bench: "drill", label: "帳面の門で落とした・直した数", better: null, unit: "count", agg: "sum", drill: (s) => s.totals.gated ?? 0 },
  // T158: 人ごとの事実（台帳・時計・前の連絡）と本人役の言葉の食い違い、通話の往復の繰り返し・いる所の揺れ
  { id: "drill.factWords", bench: "drill", label: "帳面と本人役の言葉の食い違い", better: "lower", unit: "count", agg: "sum", drill: (s) => sumOf(runs(s).map((n) => n.facts?.words ?? 0)) },
  { id: "drill.clockDrift", bench: "drill", label: "電池の残りの数の流れの食い違い", better: "lower", unit: "count", agg: "sum", drill: (s) => sumOf(runs(s).map((n) => n.facts?.byRule.clock_drift ?? 0)) },
  { id: "drill.talkRepeat", bench: "drill", label: "通話の前の返事とほぼ同じ返事", better: "lower", unit: "frac", agg: "sum", drill: (s) => talkFrac(s, "repeats", "replies") },
  { id: "drill.talkRepeatRaw", bench: "drill", label: "往復の生の返事の繰り返し（門の前）", better: "lower", unit: "frac", agg: "sum", drill: (s) => talkFrac(s, "repeatRaw", "raw") },
  { id: "drill.talkAiShare", bench: "drill", label: "通話の返事のうち本人役（AI）の割合", better: "lower", unit: "frac", agg: "sum", drill: talkAiShare },
  { id: "drill.talkPlaceDrift", bench: "drill", label: "通話の中のいる所の食い違い", better: "lower", unit: "count", agg: "sum", drill: (s) => (runs(s).some((n) => n.talk) ? sumOf(runs(s).map((n) => n.talk?.placeDrift ?? 0)) : null) },
  { id: "drill.freeInner", bench: "drill", label: "自由対応 画面の内部の名前", better: "lower", unit: "count", agg: "sum", threshold: zero, drill: (s) => s.totals.freeInnerShown ?? 0 },
  { id: "drill.freeCan", bench: "drill", label: "自由対応 不可を「できる」（生の返事）", better: "lower", unit: "count", agg: "sum", drill: (s) => s.totals.freeCanMismatch ?? 0 },
  { id: "drill.bannedRaw", bench: "drill", label: "禁じた中身 本人役の生の返事", better: "lower", unit: "count", agg: "sum", drill: (s) => s.totals.bannedRaw },
  { id: "drill.bannedShown", bench: "drill", label: "禁じた中身 画面に出た物", better: "lower", unit: "count", agg: "sum", threshold: zero, drill: (s) => s.totals.bannedShown },
  { id: "drill.leaks", bench: "drill", label: "仮名の漏れ（送った中身）", better: "lower", unit: "count", agg: "sum", threshold: zero, drill: (s) => s.totals.leaks },
  { id: "drill.termsRan", bench: "drill", label: "押せない手が打てた・夜の所要不足", better: "lower", unit: "count", agg: "sum", threshold: zero, drill: (s) => (s.totals.termsRan ?? 0) + (s.totals.termsDark ?? 0) },
  { id: "drill.contradictions", bench: "drill", label: "矛盾（全部）", better: "lower", unit: "count", agg: "sum", drill: (s) => s.totals.contradictions },
  { id: "drill.opFailed", bench: "drill", label: "失敗した要求", better: "lower", unit: "count", agg: "sum", drill: (s) => s.totals.opFailed + s.totals.exceptions },
  { id: "drill.worldNote", bench: "drill", label: "世界の部屋の代替・停止の印", better: "lower", unit: "count", agg: "sum", drill: (s) => s.totals.worldNote },
  { id: "drill.callsPerRun", bench: "drill", label: "AI の呼び出し（1 回の訓練）", better: null, unit: "count", agg: "mean", drill: (s) => s.totals.callsPerRun },
  // T158: 1 訓練の上限 150 との比の最大（直しで呼び出しを増やさない）
  { id: "drill.capRatioMax", bench: "drill", label: "1 訓練の上限 150 との比（最大）", better: "lower", unit: "rate", agg: "max", drill: (s) => s.totals.capRatioMax },
  { id: "drill.advanceP50", bench: "drill", label: "進める 1 回の待ち p50（秒）", better: "lower", unit: "sec", agg: "mean", drill: (s) => (s.totals.advanceP50 === null ? null : s.totals.advanceP50 / 1000) },
  { id: "drill.usd", bench: "drill", label: "訓練の実費の見込み（USD）", better: "lower", unit: "usd", agg: "sum", drill: (s) => s.totals.usdTotal },
];

// ---------- 書類（tools/eval/forms の result.json） ----------

const formRead = (r: FormsResultLike, id: string): Raw => {
  const f = r.forms.find((x) => x.id === id);
  return f?.read ? [f.read.hit + f.read.alt, f.read.goldFields] : null;
};
const formPaper = (r: FormsResultLike, id: string): Raw => {
  const ps = r.papers.filter((p) => p.form === id && p.score);
  return ps.length > 0 ? [sumOf(ps.map((p) => p.score!.hit)), sumOf(ps.map((p) => p.score!.filled))] : null;
};
/**
 * 一覧の様式の共有の外れか（T161）: 2 つ目の事業所が写せず、訳が「1 つ目に読めない頁があった」（共有に入れないのが決め）でない物。
 * 訳の無い前の回（6 回目まで）の写せなかった物も外れ。書類の指摘（tools/eval/forms/findings.ts の sharedMiss）も同じ数え方
 */
export function sharedMissOf(f: { catalog?: { shared: boolean | null; sharedWhy?: string } }): boolean {
  return f.catalog?.shared === false && f.catalog.sharedWhy !== "unread";
}
const catalogTried = (r: FormsResultLike) => r.forms.filter((f) => f.catalog && f.catalog.shared !== null);

const looks = (r: FormsResultLike, k: "unplaced" | "blanks" | "overlap" | "outside") => sumOf(r.papers.map((p) => p.look?.[k] ?? 0));
/** T160 で足した置けなかった欄の種類。前の回の結果に無ければ空（0 と見せない） */
const lookKinds = (r: FormsResultLike, k: "unplacedDate" | "unplacedPicked" | "unplacedContact" | "markNoContent"): number | null =>
  r.papers.some((p) => p.look?.[k] !== undefined) ? sumOf(r.papers.map((p) => p.look?.[k] ?? 0)) : null;
const reviews = (r: FormsResultLike) => r.papers.map((p) => p.review).filter((x): x is NonNullable<typeof x> => !!x);
const hasReview = (r: FormsResultLike) => reviews(r).length > 0;

const FORMS: Item[] = [
  // 回した＝飛ばした物（原本なし・上限）を除く（種の r4「13/13（取れず 1）」と同じ数え方）
  { id: "forms.readOk", bench: "forms", label: "様式 読めた／回した", better: "higher", unit: "frac", agg: "sum", forms: (r) => [r.forms.filter((f) => f.status === "ok").length, r.forms.filter((f) => f.status !== "skipped").length] },
  { id: "forms.read.matsuyama", bench: "forms", label: "松山市の計画書 欄の当たり", better: "higher", unit: "frac", agg: "sum", forms: (r) => formRead(r, "matsuyama") },
  {
    id: "forms.read.kiroku",
    bench: "forms",
    label: "災害診療記録 欄の当たり",
    better: "higher",
    unit: "frac",
    agg: "sum",
    notes: [
      "r7〜（T161）: 正解の表の「□アレルギー（　）」を □ と括弧の 2 欄に（欄の数が 29 → 30）。r6 までは □ と括弧を合わせた 1 つの字の欄",
      "r8〜（T164）: 正解の表の常用薬の種類の行（抗血小板薬・抗凝固薬・糖尿病治療薬・ステロイド・抗てんかん薬・その他）を □ と括弧（「抗血小板薬（　）」）の 2 欄に（欄の数が 30 → 36）。7 回目の答えでは 26/30 → 32/36",
    ],
    forms: (r) => formRead(r, "kiroku"),
  },
  { id: "forms.read.form9", bench: "forms", label: "様式 9 欄の当たり", better: "higher", unit: "frac", agg: "sum", forms: (r) => formRead(r, "form9") },
  { id: "forms.paper.matsuyama", bench: "forms", label: "紙 松山市の計画書", better: "higher", unit: "rate", agg: "sum", notes: ["r7〜（T161）: 値の比べで文の終わりの句点（。．.）の有無を同じに（全角半角・空白の違いは前から外れにしていない）。r6 までの列は句点の違いも外れに数えた数"], forms: (r) => formPaper(r, "matsuyama") },
  {
    id: "forms.paper.kiroku",
    bench: "forms",
    label: "紙 災害診療記録",
    better: "higher",
    unit: "rate",
    agg: "sum",
    notes: [
      "r7〜（T161）: 値の比べで文の終わりの句点（。．.）の有無を同じに（全角半角・空白の違いは前から外れにしていない）。r6 までの列は句点の違いも外れに数えた数",
      "r7〜（T161）: 正解の表の既往症・予防接種を □ の並び（choice、原本の選択肢）に、「□アレルギー（　）」を □ と括弧の 2 欄に。r6 までは 3 つとも字の欄で、□ に印を付けた紙を置き間違いと数えた（6 回目の答えをこの正解の表と数え方で数え直すと 87.6% → 96.3%。残りはアレルギーの括弧の欄〔AI が □ だけに読んだ。決まり 21 の効き目は r7 で確かめる〕と声の入力の 2 つ）",
      "r4 までは種の台帳に既往症・予防接種・アレルギーの値が無く、この 3 欄は両方空いて数に入らなかった（r4 の 96.1% と r6 からの数は比べられない）",
      "r8〜（T164）: 正解の表の常用薬の種類の行を □ と括弧の 2 欄に（括弧にその種類の薬の名前。紙の字のある欄が 7 回目の答えで 567 → 600）、正解の □・選ぶ欄に形の違う AI の欄を合わせたときは同じ場所の同じ形の欄で比べる（連絡先）。7 回目の答えを数え直すと 476/567 → T164 の紙の直しとこの数え方で 559/600。6 回目の答えは 547/567 → 547/600（6 回目の AI は括弧を読んでいないので括弧の 33 が取りこぼし）",
    ],
    forms: (r) => formPaper(r, "kiroku"),
  },
  { id: "forms.paper.form9", bench: "forms", label: "紙 様式 9", better: "higher", unit: "rate", agg: "sum", notes: ["r7〜（T161）: 値の比べで文の終わりの句点（。．.）の有無を同じに（全角半角・空白の違いは前から外れにしていない）。r6 までの列は句点の違いも外れに数えた数"], forms: (r) => formPaper(r, "form9") },
  // 一覧の様式の共有の対応表（T161）。回した＝2 つ目の事業所で読んだ様式。外れは写せなかった物のうち、1 つ目に読めない頁が無かった物
  {
    id: "forms.shared",
    bench: "forms",
    label: "一覧の様式 共有を写せた",
    better: "higher",
    unit: "frac",
    agg: "sum",
    forms: (r) => (catalogTried(r).length > 0 ? [catalogTried(r).filter((f) => f.catalog!.shared === true).length, catalogTried(r).length] : null),
  },
  {
    id: "forms.sharedMiss",
    bench: "forms",
    label: "一覧の様式 共有の外れ（AI を呼び直す）",
    better: "lower",
    unit: "count",
    agg: "sum",
    forms: (r) => (catalogTried(r).length > 0 ? catalogTried(r).filter(sharedMissOf).length : null),
  },
  { id: "forms.unplaced", bench: "forms", label: "置けなかった欄", better: "lower", unit: "count", agg: "sum", forms: (r) => looks(r, "unplaced") },
  { id: "forms.blanks", bench: "forms", label: "台帳あり空欄", better: "lower", unit: "count", agg: "sum", forms: (r) => looks(r, "blanks") },
  // T160: 日付の欄・選ぶ欄の当て・連絡先（評価の 6 回目の直すべき所の 5〜7）
  { id: "forms.dateFix", bench: "forms", label: "日付の要修正（見直し）", better: "lower", unit: "count", agg: "sum", forms: (r) => (hasReview(r) ? sumOf(reviews(r).map((x) => x.rule.kinds.date ?? 0)) : null) },
  { id: "forms.unplacedDate", bench: "forms", label: "置けない日付", better: "lower", unit: "count", agg: "sum", forms: (r) => lookKinds(r, "unplacedDate") },
  { id: "forms.unplacedPicked", bench: "forms", label: "当てたのに紙に出ない選択肢", better: "lower", unit: "count", agg: "sum", forms: (r) => lookKinds(r, "unplacedPicked") },
  { id: "forms.unplacedContact", bench: "forms", label: "連絡先の置けず", better: "lower", unit: "count", agg: "sum", forms: (r) => lookKinds(r, "unplacedContact") },
  { id: "forms.markNoContent", bench: "forms", label: "印を付けた □ の中身が紙に無い", better: "lower", unit: "count", agg: "sum", forms: (r) => lookKinds(r, "markNoContent") },
  // T164: 紙の置き間違い（正解の表のある様式の、違う字＋余分な字）と、正解の紙に無い □ の印（台帳の値に当たらない選択肢の印）
  {
    id: "forms.paperWrong",
    bench: "forms",
    label: "紙 置き間違い（違う字・余分な字）",
    better: "lower",
    unit: "count",
    agg: "sum",
    notes: [
      "r8〜（T164）: 正解の表の災害診療記録の常用薬の種類の行を □ と括弧の 2 欄に（7 回目の紙の字のある欄 567 → 600）、正解の □・選ぶ欄に形の違う AI の欄を合わせたときは同じ場所の同じ形の欄で比べる（連絡先）。7 回目の答えを数え直すと、直す前 348、T164 の紙の直し 134（前の数え方）、紙の直しとこの数え方 73。6 回目の答えは直す前も後も 104（195 は 6 回目の本物の回の数で、T160・T161 の前のコード）",
    ],
    forms: (r) => (r.papers.some((p) => p.score) ? sumOf(r.papers.map((p) => (p.score ? p.score.wrong + p.score.extra : 0))) : null),
  },
  {
    id: "forms.markExtra",
    bench: "forms",
    label: "正解に無い印",
    better: "lower",
    unit: "count",
    agg: "sum",
    forms: (r) => (r.papers.some((p) => p.score?.markExtra !== undefined) ? sumOf(r.papers.map((p) => p.score?.markExtra ?? 0)) : null),
  },
  { id: "forms.reviewDup", bench: "forms", label: "見直しの重複", better: "lower", unit: "count", agg: "sum", forms: (r) => (hasReview(r) ? sumOf(reviews(r).map((x) => x.rule.kinds.duplicate ?? 0)) : null) },
  { id: "forms.reviewCheck", bench: "forms", label: "見直しの要確認", better: "lower", unit: "count", agg: "sum", forms: (r) => (hasReview(r) ? sumOf(reviews(r).map((x) => x.rule.check)) : null) },
  // T175: 同じ様式の読み取りの回ごとの差。--drift-from で前の回（同じコードで数え直した物）と比べた回だけ数が入る
  { id: "forms.reviewDrift", bench: "forms", label: "見直しの要確認の前の回との差", better: "lower", unit: "count", agg: "sum", forms: (r) => r.drift?.check ?? null },
  { id: "forms.reviewFix", bench: "forms", label: "見直しの要修正", better: "lower", unit: "count", agg: "sum", forms: (r) => (hasReview(r) ? sumOf(reviews(r).map((x) => x.rule.fix)) : null) },
  { id: "forms.aiReviewFound", bench: "forms", label: "AI の照合 使った所", better: null, unit: "count", agg: "sum", forms: (r) => (reviews(r).some((x) => x.ai) ? sumOf(reviews(r).map((x) => x.ai?.found ?? 0)) : null) },
  { id: "forms.aiReviewKinds", bench: "forms", label: "AI の照合 判読難・欄違い・不一致", better: null, unit: "count", agg: "sum", seedOnly: true },
  { id: "forms.intake", bench: "forms", label: "入力 当たり", better: "higher", unit: "rate", agg: "sum", notes: ["r7〜（T161）: 値の比べで文の終わりの句点（。．.）の有無を同じに（全角半角・空白の違いは前から外れにしていない）。r6 までの列は句点の違いも外れに数えた数"], forms: (r) => intakePair(r) },
  { id: "forms.inputsFailed", bench: "forms", label: "入力の失敗", better: "lower", unit: "count", agg: "sum", forms: (r) => r.inputs.filter((i) => i.status === "failed").length },
  { id: "forms.leaks", bench: "forms", label: "送った文の漏れ（氏名・電話・町名）", better: "lower", unit: "count", agg: "sum", threshold: zero, forms: (r) => r.leaks.strongHits },
  { id: "forms.birthLeaks", bench: "forms", label: "送った文の生年月日", better: "lower", unit: "count", agg: "sum", threshold: zero, forms: (r) => r.leaks.birthHits },
  { id: "forms.imagesNotRedacted", bench: "forms", label: "送った画像の塗りが黒くない", better: "lower", unit: "count", agg: "sum", threshold: zero, forms: (r) => r.leaks.imagesNotRedacted },
  { id: "forms.readMaxOutput", bench: "forms", label: "様式の読み取り 1 回の出力の最大（上限 20,000）", better: "lower", unit: "tokens", agg: "max", threshold: { op: "<=", value: 19_999 }, forms: (r) => r.calls.formReadMaxOutput ?? null },
  { id: "forms.readWait", bench: "forms", label: "様式の読み取りの待ち 1 様式の平均（秒）", better: "lower", unit: "sec", agg: "mean", seedOnly: true },
  { id: "forms.aiFailed", bench: "forms", label: "AI の失敗", better: "lower", unit: "count", agg: "sum", forms: (r) => r.calls.failed },
  { id: "forms.usd", bench: "forms", label: "書類の実費の見込み（USD）", better: "lower", unit: "usd", agg: "sum", forms: (r) => r.calls.costUsd },
];

function intakePair(r: FormsResultLike): Raw {
  const xs = r.inputs.map((i) => i.intake).filter((x): x is NonNullable<typeof x> => !!x);
  const expected = sumOf(xs.map((x) => x.expected));
  return expected > 0 ? [sumOf(xs.map((x) => x.hit)), expected] : null;
}

// ---------- 声の会話（tools/eval/talk の summary.json） ----------

const TALK: Item[] = [
  { id: "talk.banned", bench: "talk", label: "声の会話 読んだ文の言わない事", better: "lower", unit: "count", agg: "sum", threshold: zero, talk: (s) => s.totals.banned },
  { id: "talk.leaks", bench: "talk", label: "声の会話 渡した文の名前・電話", better: "lower", unit: "count", agg: "sum", threshold: zero, talk: (s) => s.totals.leaks },
  { id: "talk.closedEarly", bench: "talk", label: "声の会話 表の 2 問の前に締めた筋", better: "lower", unit: "count", agg: "sum", threshold: zero, talk: (s) => s.totals.closedEarly },
  { id: "talk.gate", bench: "talk", label: "声の会話 門で外した数", better: null, unit: "count", agg: "sum", talk: (s) => s.totals.gate },
  { id: "talk.fallback", bench: "talk", label: "声の会話 決まった問いに戻した数", better: "lower", unit: "count", agg: "sum", talk: (s) => s.totals.fallback },
  { id: "talk.aiCalls", bench: "talk", label: "声の会話 呼び出し", better: null, unit: "count", agg: "sum", talk: (s) => s.totals.aiCalls },
];

// ---------- 使う側の模擬（tools/eval/persona の scorecard.json、T156） ----------
// 数は回のフォルダの scorecard.json の values（rawOf の generic）から読む。筋ごとの数は persona.<筋>.〜（筋は personas.ts の PERSONA_IDS）

const PERSONA_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["first", "初めて触るケアマネ"],
  ["veteran", "慣れたケアマネ"],
  ["admin", "管理者"],
  ["medical", "医療班"],
  ["judge10", "審査員の 10 分"],
];
const PERSONA_LOST: ReadonlyArray<readonly [string, string]> = [
  ["not_found", "見つからない"],
  ["misread", "読み違い"],
  ["dead_end", "行き止まり"],
  ["back", "戻り"],
  ["error", "エラー"],
  ["timeout", "時間切れ"],
];

const PERSONA: Item[] = [
  { id: "persona.reached", bench: "persona", label: "使う人 目標の達成", better: "higher", unit: "frac", agg: "sum" },
  { id: "persona.extra", bench: "persona", label: "使う人 最短より多い手（達した目標）", better: "lower", unit: "count", agg: "sum" },
  { id: "persona.steps", bench: "persona", label: "使う人 手の数", better: null, unit: "count", agg: "sum" },
  { id: "persona.lost", bench: "persona", label: "使う人 迷いの数", better: "lower", unit: "count", agg: "sum" },
  ...PERSONA_LOST.map(([k, l]): Item => ({ id: `persona.lost.${k}`, bench: "persona", label: `使う人 ${l}`, better: "lower", unit: "count", agg: "sum" })),
  { id: "persona.gate", bench: "persona", label: "使う人 門で止めた筋（種の外の値）", better: "lower", unit: "count", agg: "sum", threshold: zero },
  { id: "persona.forbidden", bench: "persona", label: "使う人 出てはいけない物が出た数（医療班の書き足しの欄・カメラ起動の消え）", better: "lower", unit: "count", agg: "sum", threshold: zero },
  { id: "persona.ease", bench: "persona", label: "使う人 審査役の通しやすさ（1〜5）", better: "higher", unit: "score", agg: "mean" },
  { id: "persona.usd", bench: "persona", label: "使う人 実費の見込み（USD）", better: "lower", unit: "usd", agg: "sum" },
  ...PERSONA_PATHS.flatMap(([p, l]): Item[] => [
    { id: `persona.${p}.reached`, bench: "persona", label: `${l} 目標の達成`, better: "higher", unit: "frac", agg: "sum" },
    { id: `persona.${p}.steps`, bench: "persona", label: `${l} 手の数`, better: "lower", unit: "count", agg: "sum" },
    { id: `persona.${p}.lost`, bench: "persona", label: `${l} 迷いの数`, better: "lower", unit: "count", agg: "sum" },
  ]),
];

export const ITEMS: ReadonlyArray<Item> = [...DRILL, ...FORMS, ...TALK, ...PERSONA];

export function itemOf(id: string): Item | undefined {
  return ITEMS.find((x) => x.id === id);
}

/** 1 回の結果の生の数（項目の読み方で） */
export function rawOf(item: Item, d: BenchData): Raw {
  if ("generic" in d) {
    const v = d.generic.values[item.id];
    return v === undefined ? null : v;
  }
  if (item.bench !== d.bench || item.seedOnly) return null;
  if (d.bench === "drill") return item.drill?.(d.data) ?? null;
  if (d.bench === "forms") return item.forms?.(d.data) ?? null;
  if (d.bench === "talk") return item.talk?.(d.data) ?? null;
  return null;
}

/** 列の数（同じ台の回が 2 つ以上なら agg で 1 つに。比は足してから割る）。分子・分母も返す */
export function combine(item: Item, raws: ReadonlyArray<Raw>): { value: number | null; frac?: readonly [number, number] } {
  const xs = raws.filter((x): x is NonNullable<Raw> => x !== null);
  if (xs.length === 0) return { value: null };
  if (xs.some((x) => Array.isArray(x))) {
    const pairs = xs.filter((x): x is readonly [number, number] => Array.isArray(x));
    const a = sumOf(pairs.map((p) => p[0]));
    const b = sumOf(pairs.map((p) => p[1]));
    return { value: b > 0 ? a / b : null, frac: [a, b] };
  }
  const ns = xs as number[];
  if (item.agg === "sum") return { value: sumOf(ns) };
  if (item.agg === "max") return { value: Math.max(...ns) };
  return { value: meanOf(ns) };
}

/** 回 1 つの項目の数（守り〔guards〕の確かめに使う。台の項目と、ほかの台の scorecard.json の値） */
export function valuesOf(d: BenchData): Record<string, number> {
  const out: Record<string, number> = {};
  const items = "generic" in d ? genericItems(d.generic) : ITEMS.filter((x) => x.bench === d.bench);
  for (const item of items) {
    const v = combine(item, [rawOf(item, d)]).value;
    if (v !== null) out[item.id] = v;
  }
  return out;
}

/** ほかの台の scorecard.json の項目（items が無ければ id を名前に、向きなし） */
export function genericItems(g: GenericScorecard): Item[] {
  const meta = new Map((g.items ?? []).map((x) => [x.id, x]));
  const ids = [...new Set([...(g.items ?? []).map((x) => x.id), ...Object.keys(g.values)])];
  return ids.map((id) => {
    const m = meta.get(id);
    const v = g.values[id];
    return {
      id,
      bench: g.bench,
      label: m?.label ?? id,
      better: m?.better ?? null,
      unit: m?.unit ?? (Array.isArray(v) ? "frac" : "count"),
      agg: m?.agg ?? "sum",
      ...(m?.threshold ? { threshold: m.threshold } : {}),
    };
  });
}
