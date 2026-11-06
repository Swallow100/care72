// 評価の台（docs/tasks/T108.md）のまとめ。回ごとの数・多様さ・審査役をまとめた JSON（リポジトリの外）と、
// 前の回との差の表の md（docs/progress/eval-drill-<日時>.md。数だけで、台詞・名前を書かない）と、差の 1 行。
// 前の回は同じ client（偽か本物）の物と比べる（偽と本物を比べても意味が無い）。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scaleLabel, type DrillScale } from "../../../lib/drill/scale.ts";
import type { RunNumbers } from "./checks.ts";
import type { DiversityNumbers } from "./diversity.ts";
import { JUDGE_AXES, JUDGE_LABELS, type JudgeAxis, type JudgeScore } from "./judge.ts";
import { ROOM_BUDGET_USD } from "./prices.ts";

export type RunSummary = { index: number; seed: string; scenario: string; scale: DrillScale | null; participants: number; numbers: RunNumbers };

export type Totals = {
  finished: number;
  minuteMean: number | null;
  bannedRaw: number;
  bannedShown: number;
  otherRaw: number;
  shapeFailed: number;
  retries: number;
  leaks: number;
  contradictions: number;
  offBandRate: number | null;
  aiStop: number;
  worldNote: number;
  opFailed: number;
  exceptions: number;
  callsPerRun: number | null;
  capRatioMax: number | null;
  dayRatioMax: number | null;
  /** 1 訓練の数えに入らない呼び出し（T118） */
  uncounted: number;
  /** 手の決まり（T110 の terms）で決まりどおりに断った手（T121。失敗した要求に入れない） */
  termsRefused?: number;
  /** 手の決まりで押せないはずの手が打てた数・夜の訪問の所要が足りない数（T121。決まりを送った回は 0 のはず） */
  termsRan?: number;
  termsDark?: number;
  /** 想定に合わない物（T125。直したあとは 0 のはず）と、1 つの門が捨てた・直した数 */
  fitMisfit?: number;
  fitGated?: number;
  /** 自由対応（T129）: 画面に出た内部の名前・表の手から変化なしに落ちた数（0 のはず）と、不可の手を「できる」と答えた生の返事 */
  freeInnerShown?: number;
  freeDropped?: number;
  freeCanMismatch?: number;
  /** 帳面との矛盾（T130。門が効いていれば 0）と、門が落とした・直した数 */
  factHits?: number;
  gated?: number;
  /** 帳面（台帳・時計・前の連絡）と本人役の言葉の食い違い（T158、checks.ts の FACT_WORD_RULES） */
  factWords?: number;
  /** 通話の往復（T158）: 返事・前の返事とほぼ同じ返事・通話の中のいる所の食い違い・生の返事とそのうちの繰り返し */
  talkReplies?: number;
  talkRepeats?: number;
  talkPlaceDrift?: number;
  talkRaw?: number;
  talkRepeatRaw?: number;
  advanceP50: number | null;
  advanceP95: number | null;
  usdPerRun: number | null;
  usdTotal: number;
  roomSteps: number;
};

export type Summary = {
  version: 1;
  stamp: string;
  client: "fake" | "real";
  seed: string;
  world: string;
  args: Record<string, unknown>;
  runs: RunSummary[];
  totals: Totals;
  diversity: DiversityNumbers;
  judge: JudgeScore[];
  judgeMean: Record<JudgeAxis, number | null>;
  notes: string[];
};

const sum = (xs: ReadonlyArray<number>) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: ReadonlyArray<number | null>): number | null => {
  const ys = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return ys.length > 0 ? sum(ys) / ys.length : null;
};
const max = (xs: ReadonlyArray<number | null>): number | null => {
  const ys = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return ys.length > 0 ? Math.max(...ys) : null;
};

export function totalsOf(runs: ReadonlyArray<RunSummary>): Totals {
  const n = runs.map((r) => r.numbers);
  const checked = sum(n.map((x) => x.timeOdds.checked));
  return {
    finished: n.filter((x) => x.status === "finished").length,
    minuteMean: mean(n.map((x) => x.minute)),
    bannedRaw: sum(n.map((x) => x.banned.raw)),
    bannedShown: sum(n.map((x) => x.banned.shown)),
    otherRaw: sum(n.map((x) => x.banned.otherRaw)),
    shapeFailed: sum(n.map((x) => x.shape.failed)),
    retries: sum(n.map((x) => x.shape.retries)),
    leaks: sum(n.map((x) => x.leaks)),
    contradictions: sum(n.map((x) => x.contradictions.total)),
    offBandRate: checked > 0 ? sum(n.map((x) => x.timeOdds.offBand)) / checked : null,
    aiStop: sum(n.map((x) => x.stops.aiStop)),
    worldNote: sum(n.map((x) => x.stops.worldNote)),
    opFailed: sum(n.map((x) => x.stops.opFailed)),
    exceptions: sum(n.map((x) => x.stops.exceptions)),
    callsPerRun: mean(n.map((x) => x.aiCalls.total)),
    capRatioMax: max(n.map((x) => x.budget.capRatio)),
    dayRatioMax: max(n.map((x) => x.budget.dayRatio)),
    uncounted: sum(n.map((x) => x.budget.uncounted ?? 0)),
    termsRefused: sum(n.map((x) => x.terms?.refused ?? 0)),
    termsRan: sum(n.map((x) => x.terms?.ran ?? 0)),
    termsDark: sum(n.map((x) => x.terms?.dark ?? 0)),
    fitMisfit: sum(n.map((x) => x.fit?.misfit ?? 0)),
    fitGated: sum(n.map((x) => x.fit?.gated ?? 0)),
    freeInnerShown: sum(n.map((x) => x.free?.innerShown ?? 0)),
    freeDropped: sum(n.map((x) => x.free?.dropped ?? 0)),
    freeCanMismatch: sum(n.map((x) => x.free?.canMismatch ?? 0)),
    factHits: sum(n.map((x) => x.facts?.hits ?? 0)),
    gated: sum(n.map((x) => Object.values(x.facts?.gated ?? {}).reduce((a, b) => a + b, 0))),
    factWords: sum(n.map((x) => x.facts?.words ?? 0)),
    talkReplies: sum(n.map((x) => x.talk?.replies ?? 0)),
    talkRepeats: sum(n.map((x) => x.talk?.repeats ?? 0)),
    talkPlaceDrift: sum(n.map((x) => x.talk?.placeDrift ?? 0)),
    talkRaw: sum(n.map((x) => x.talk?.raw ?? 0)),
    talkRepeatRaw: sum(n.map((x) => x.talk?.repeatRaw ?? 0)),
    advanceP50: mean(n.map((x) => x.timing.advanceP50)),
    advanceP95: max(n.map((x) => x.timing.advanceP95)),
    usdPerRun: mean(n.map((x) => x.cost.usd)),
    usdTotal: sum(n.map((x) => x.cost.usd)),
    roomSteps: sum(n.map((x) => x.cost.roomSteps)),
  };
}

export function judgeMeanOf(scores: ReadonlyArray<JudgeScore>): Record<JudgeAxis, number | null> {
  return Object.fromEntries(JUDGE_AXES.map((a) => [a, mean(scores.map((s) => s.scores?.[a] ?? null))])) as Record<JudgeAxis, number | null>;
}

/** 前の回（同じ client、この回より前の名前）。無ければ null */
export function findPrevious(root: string, stamp: string, client: Summary["client"]): Summary | null {
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < stamp)
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const name of dirs) {
    const file = join(root, name, "summary.json");
    if (!existsSync(file)) continue;
    try {
      const s = JSON.parse(readFileSync(file, "utf8")) as Summary;
      if (s.version === 1 && s.client === client) return s;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------- 比べる項目 ----------

type Metric = { label: string; get: (s: Summary) => number | null; format: (n: number) => string; /** 低いほど良い */ lowerBetter?: boolean };

const int = (n: number) => String(Math.round(n));
const two = (n: number) => n.toFixed(2);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const per = (s: Summary, n: number) => (s.runs.length > 0 ? n / s.runs.length : null);

export const METRICS: ReadonlyArray<Metric> = [
  { label: "回", get: (s) => s.runs.length, format: int },
  { label: "終わった回", get: (s) => s.totals.finished, format: int },
  { label: "禁じた中身（本人役の生の返事）/回", get: (s) => per(s, s.totals.bannedRaw), format: two, lowerBetter: true },
  { label: "禁じた中身（画面に出た物）", get: (s) => s.totals.bannedShown, format: int, lowerBetter: true },
  { label: "禁じた語（世界・監督の生の返事）/回", get: (s) => per(s, s.totals.otherRaw), format: two, lowerBetter: true },
  { label: "形の失敗・失敗した呼び出し", get: (s) => s.totals.shapeFailed, format: int, lowerBetter: true },
  { label: "再試行", get: (s) => s.totals.retries, format: int, lowerBetter: true },
  { label: "仮名の漏れ（送った中身）", get: (s) => s.totals.leaks, format: int, lowerBetter: true },
  { label: "矛盾/回", get: (s) => per(s, s.totals.contradictions), format: two, lowerBetter: true },
  { label: "帳面との矛盾/回（T130）", get: (s) => per(s, s.totals.factHits ?? 0), format: two, lowerBetter: true },
  { label: "帳面の門で落とした・直した数", get: (s) => s.totals.gated ?? 0, format: int },
  { label: "帳面と本人役の言葉の食い違い（T158）", get: (s) => s.totals.factWords ?? 0, format: int, lowerBetter: true },
  { label: "通話の前の返事とほぼ同じ返事（T158）", get: (s) => (s.totals.talkReplies ? (s.totals.talkRepeats ?? 0) / s.totals.talkReplies : null), format: pct, lowerBetter: true },
  { label: "通話の中のいる所の食い違い（T158）", get: (s) => s.totals.talkPlaceDrift ?? 0, format: int, lowerBetter: true },
  { label: "往復の生の返事の繰り返し（門の前、T158）", get: (s) => (s.totals.talkRaw ? (s.totals.talkRepeatRaw ?? 0) / s.totals.talkRaw : null), format: pct, lowerBetter: true },
  { label: "時間の目安の帯の外（監督の差し込み）", get: (s) => s.totals.offBandRate, format: pct },
  { label: "停止の印（上限）", get: (s) => s.totals.aiStop, format: int, lowerBetter: true },
  { label: "世界の代替・停止の印", get: (s) => s.totals.worldNote, format: int, lowerBetter: true },
  { label: "失敗した要求", get: (s) => s.totals.opFailed + s.totals.exceptions, format: int, lowerBetter: true },
  { label: "手の決まりで断った手（決まりどおり）", get: (s) => s.totals.termsRefused ?? 0, format: int },
  { label: "手の決まりで押せない手が打てた・夜の所要不足", get: (s) => (s.totals.termsRan ?? 0) + (s.totals.termsDark ?? 0), format: int, lowerBetter: true },
  { label: "想定に合わない物（出来事・言葉・所要の理由・着信）", get: (s) => s.totals.fitMisfit ?? 0, format: int, lowerBetter: true },
  { label: "1 つの門が捨てた・直した物", get: (s) => s.totals.fitGated ?? 0, format: int },
  { label: "自由対応の画面の内部の名前・変化なしに落ちた手", get: (s) => (s.totals.freeInnerShown ?? 0) + (s.totals.freeDropped ?? 0), format: int, lowerBetter: true },
  { label: "自由対応で不可の手を「できる」と答えた（生の返事）", get: (s) => s.totals.freeCanMismatch ?? 0, format: int, lowerBetter: true },
  { label: "AI の呼び出し/回（ai_calls）", get: (s) => s.totals.callsPerRun, format: two },
  { label: "1 訓練の上限 150 との比（最大）", get: (s) => s.totals.capRatioMax, format: pct },
  { label: "1 日の上限 200 との比（最大）", get: (s) => s.totals.dayRatioMax, format: pct },
  { label: "1 訓練の数えに入らない呼び出し", get: (s) => s.totals.uncounted ?? 0, format: int, lowerBetter: true },
  { label: "進める 1 回の時間 p50（ms）", get: (s) => s.totals.advanceP50, format: int, lowerBetter: true },
  { label: "進める 1 回の時間 p95（ms、最大）", get: (s) => s.totals.advanceP95, format: int, lowerBetter: true },
  { label: "出来事の種類（AI）", get: (s) => s.diversity.kinds.distinct, format: int },
  { label: "種類の偏りの少なさ（正規化エントロピー）", get: (s) => s.diversity.kinds.entropy, format: two },
  { label: "最多の種類の割合", get: (s) => s.diversity.kinds.topShare, format: pct, lowerBetter: true },
  { label: "出来事の重なり（回どうし Jaccard）", get: (s) => s.diversity.sequence.kindJaccard, format: two, lowerBetter: true },
  { label: "出来事の並びの重なり（2 つ組）", get: (s) => s.diversity.sequence.bigramJaccard, format: two, lowerBetter: true },
  { label: "本人役の言葉の重なり（回どうし 3-gram）", get: (s) => s.diversity.words.crossRunJaccard, format: two, lowerBetter: true },
  { label: "言葉の異なり（3-gram）", get: (s) => s.diversity.words.distinct3, format: two },
  { label: "同じ文の割合", get: (s) => s.diversity.words.duplicateRate, format: pct, lowerBetter: true },
  { label: "同じ人・違う回の言葉の離れ", get: (s) => s.diversity.persons.samePersonAcrossRuns, format: two },
  { label: "違う人・同じ回の言葉の離れ", get: (s) => s.diversity.persons.differentPersonsSameRun, format: two },
  { label: "審査役の平均（5 つの物差し）", get: (s) => mean(JUDGE_AXES.map((a) => s.judgeMean[a])), format: two },
  { label: "費用/回（見積もり、部屋を除く）", get: (s) => s.totals.usdPerRun, format: usd },
];

/** 差の 1 行の項目（壊れ方と単調さの要） */
const LINE: ReadonlyArray<readonly [string, string]> = [
  ["禁(生)/回", "禁じた中身（本人役の生の返事）/回"],
  ["禁(画面)", "禁じた中身（画面に出た物）"],
  ["形", "形の失敗・失敗した呼び出し"],
  ["漏れ", "仮名の漏れ（送った中身）"],
  ["矛盾/回", "矛盾/回"],
  ["帯外", "時間の目安の帯の外（監督の差し込み）"],
  ["停止", "停止の印（上限）"],
  ["種類", "出来事の種類（AI）"],
  ["重なり", "出来事の重なり（回どうし Jaccard）"],
  ["言葉", "本人役の言葉の重なり（回どうし 3-gram）"],
  ["呼出/回", "AI の呼び出し/回（ai_calls）"],
  ["費用/回", "費用/回（見積もり、部屋を除く）"],
];

const show = (m: Metric, s: Summary | null) => {
  if (!s) return "—";
  const v = m.get(s);
  return v === null ? "—" : m.format(v);
};

/** 前の回との差の 1 行 */
export function diffLine(prev: Summary | null, cur: Summary): string {
  const parts = LINE.map(([short, label]) => {
    const m = METRICS.find((x) => x.label === label)!;
    return prev ? `${short} ${show(m, prev)}→${show(m, cur)}` : `${short} ${show(m, cur)}`;
  });
  const head = prev ? `前回比（${cur.client === "fake" ? "偽" : "本物"}、${prev.stamp}→${cur.stamp}）` : `初回（${cur.client === "fake" ? "偽" : "本物"}、${cur.stamp}）`;
  return `${head}: ${parts.join("、")}`;
}

function delta(m: Metric, prev: Summary | null, cur: Summary): string {
  if (!prev) return "";
  const a = m.get(prev);
  const b = m.get(cur);
  if (a === null || b === null) return "";
  const d = b - a;
  if (Math.abs(d) < 1e-9) return "±0";
  const txt = m.format(Math.abs(d));
  const sign = d > 0 ? "+" : "−";
  const mark = m.lowerBetter === undefined ? "" : (d < 0) === m.lowerBetter ? "（良）" : "（悪）";
  return `${sign}${txt}${mark}`;
}

/** md（数だけ）。人は出さず、想定・規模・人数だけ */
export function markdown(cur: Summary, prev: Summary | null, line: string): string {
  const client = cur.client === "fake" ? "偽の client（数は作り物。比べる基準にしない）" : "本物の Claude";
  const rows = METRICS.map((m) => `| ${m.label} | ${show(m, prev)} | ${show(m, cur)} | ${delta(m, prev, cur)} |`);
  const runs = cur.runs.map((r) => {
    const n = r.numbers;
    return `| ${r.index} | ${r.scenario} | ${r.scale ? scaleLabel(r.scale) : "表"} | ${r.participants} | ${n.status} | ${Math.round(n.minute / 60)}h | ${n.advances} | ${n.acts} | ${n.aiCalls.total} | ${n.banned.raw} | ${n.banned.shown} | ${n.shape.failed} | ${n.leaks} | ${n.contradictions.total} | ${n.timeOdds.offBand}/${n.timeOdds.checked} | ${n.stops.aiStop + n.stops.worldNote} | ${usd(n.cost.usd)} |`;
  });
  const kinds = Object.entries(cur.diversity.kinds.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`);
  const judge = cur.judge.map((j) =>
    j.scores ? `| ${j.run} | ${JUDGE_AXES.map((a) => j.scores![a]).join(" | ")} |` : `| ${j.run} | ${JUDGE_AXES.map(() => "—").join(" | ")} |`,
  );
  return [
    `# 訓練の評価の台 ${cur.stamp}`,
    "",
    `T108 の台（tools/eval/drill）の 1 回分。${client}。数だけ（台詞と記録はリポジトリの外の care72-qa/eval/drill/${cur.stamp}/）。`,
    "",
    `- 回し方: \`npm run eval:drill -- --runs ${cur.runs.length} --seed ${cur.seed}${cur.world !== "session" ? ` --world ${cur.world}` : ""}\`（同じ種で同じ回の選び方。本物の返事は同じにならない）`,
    `- 前の回: ${prev ? `${prev.stamp}（${prev.runs.length} 回）` : "なし"}`,
    `- 差の 1 行: ${line}`,
    `- 費用: 合計 ${usd(cur.totals.usdTotal)}（ai_calls の token から。部屋の ${cur.totals.roomSteps} 刻みは token が残らず外。部屋は 1 訓練 ${usd(ROOM_BUDGET_USD)} まで）`,
    ...cur.notes.map((x) => `- ${x}`),
    "",
    "| 項目 | 前回 | 今回 | 差 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## 回ごと",
    "",
    "| 回 | 想定 | 規模 | 参加 | 状態 | 着いた時刻 | 進めた | 手 | AI | 禁(生) | 禁(画面) | 形 | 漏れ | 矛盾 | 帯外 | 停止 | 費用 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runs,
    "",
    "## AI が作った出来事の種類",
    "",
    "| 種類 | 数 |",
    "| --- | --- |",
    ...(kinds.length > 0 ? kinds : ["| なし | 0 |"]),
    "",
    "## 審査役（1〜5）",
    "",
    `| 回 | ${JUDGE_AXES.map((a) => JUDGE_LABELS[a]).join(" | ")} |`,
    `| --- | ${JUDGE_AXES.map(() => "---").join(" | ")} |`,
    ...(judge.length > 0 ? judge : [`| なし | ${JUDGE_AXES.map(() => "—").join(" | ")} |`]),
    "",
  ].join("\n");
}
