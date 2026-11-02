// 訓練の講評（docs/tasks/T22.md）。Opus に 1 回。数字は機械（lib/drill/score.ts）で、言葉だけ Opus。
//
// - 入力は機械で数えた結果と手の履歴の文だけ。本人は仮名（A さん、lib/pseudonym の pseudonymize の並び）、連絡先は区分・続柄
//   （「家族 娘」）で、名前・住所・電話・町名を渡さない。文は pseudonymizeText を通す（監督の理由など、訓練記録に氏名が戻っている物も伏せる）
// - 返事の形: { summary, findings: [{ person, kind, text, basis }] }。basis は出典の登録簿（lib/sources）の id か「根拠なし」。
//   登録簿に無い根拠の指摘は捨てる（作った根拠を残さない）。kind・basis は文字で受け、コードで絞る（1 つの外れで全部を落とさない）
// - 行動の評価だけ（手の順番・報告の時刻・空欄・着信への応答）。診断・病名・薬・処置・医療の助言を書かせない（system と言葉の検査）。
//   「死亡」「関連死」と書かせない（「条件に達した」まで）。検査に掛かった指摘は捨てる
// - 仮名は氏名に戻して残す（サーバーと画面の中だけ。ケアマネの画面は名前を出す）
// - 出力は下書き。画面に AI の印を付け、ケアマネが直せる（直した物は別に残す。lib/drill/record.ts）

import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import type { DrillScenario, DrillStatus } from "../db/types.ts";
import { COLOR_LABELS } from "../labels.ts";
import {
  findLeaks,
  pseudonymize,
  pseudonymizeText,
  PseudonymLeakError,
  restoreText,
  type ForClaude,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { isSourceId, SOURCE_IDS, type SourceId } from "../sources/index.ts";
import { NO_BASIS } from "../sources/prompt.ts";
import { personOfAlias } from "./director.ts";
import type { ActionRecord } from "./engine.ts";
import { ACTION_LABELS, SCENARIO_LABELS, STATUS_LABELS } from "./labels.ts";
import type { CallRecord } from "./responses.ts";
import { scenarioOf } from "./scenarios.ts";
import { FORM9_PLAN_LABELS, minuteText, reachedText } from "./score-labels.ts";
import type { DrillScore, ScoreNumbers } from "./score.ts";

// ---------- 形 ----------

export const REVIEW_KINDS = ["order", "report", "blank", "reached", "call", "other"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export type ReviewFinding = {
  /** 本人（台帳の id）。全体のことは null */
  person: string | null;
  kind: ReviewKind;
  text: string;
  /** 出典の登録簿の id。根拠なしは null */
  basis: SourceId | null;
};

export type ReviewBody = { summary: string; findings: ReviewFinding[] };

/** 講評の失敗（lib/claude の失敗の名前。画面と記録に残す） */
export type ReviewError = "not_configured" | "limit" | "refused" | "bad_output" | "failed" | "leak";

/** 講評が引ける出典（登録簿の全部） */
export const REVIEW_SOURCES: ReadonlyArray<SourceId> = SOURCE_IDS;

/** 指摘の数・文の長さの上限 */
export const FINDINGS_MAX = 8;
export const FINDING_TEXT_MAX = 120;
export const SUMMARY_MAX = 240;

export const REVIEW_SYSTEM = [
  "災害の訓練（発災から 72 時間。人は全部架空）の講評を書く。ケアマネが打った手の順番、市役所への報告の時刻、様式 9（災害時利用者一覧表）の空欄、",
  "着信への応答を、機械で数えた結果と手の履歴から振り返り、次の訓練で直す所を示す。入力は JSON の「記録」。",
  "",
  "返す JSON:",
  `- summary: 全体の講評（${SUMMARY_MAX - 40} 字まで）。次の訓練で試す事を 1〜2 つ。`,
  `- findings: 指摘の配列。0〜${FINDINGS_MAX} 個。`,
  "  - person: 本人の仮名（「A さん」）。全体のことは「全体」。",
  "  - kind: order（対応の順番）・report（市役所への報告）・blank（様式 9 の空欄）・reached（時計が切れるまで手が届かなかった）・call（着信への応答）・other のどれか。",
  `  - text: 行動についての 1〜2 文（${FINDING_TEXT_MAX - 20} 字まで）。いつ・誰に・どの手を打てばよかったかを、手の言葉（本人電話・連絡先電話・訪問・訪問依頼・受入依頼・行政報告）で書く。`,
  `  - basis: 根拠の出典の id。当てはまる物が無ければ「${NO_BASIS}」。`,
  "",
  "決まり:",
  "1. 数字は機械で数えた物。数え直さない・変えない・新しい数字を作らない。",
  "2. 書くのは行動の評価（手の順番・時刻・様式 9 の空欄・着信への応答）だけ。診断・病名・薬・処置・医療の助言を書かない。本人の体の状態を言い切らない。",
  "3. 「死亡」「関連死」「亡くなる」と書かない。時計が切れるまで手が届かなかった人は「条件に達した」と書く。",
  "4. 色と順位はルールの表が決めた物。色・順位を付け直す・変えることを書かない。",
  "5. 仮名と役割名のほかの名前、場所の名前を書かない。",
  "6. 責める書き方をしない。次の訓練で試す形で書く。",
].join("\n");

export const ReviewSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      person: z.string(),
      kind: z.string(),
      text: z.string(),
      basis: z.string(),
    }),
  ),
});

export type ReviewAnswer = z.output<typeof ReviewSchema>;

/** Claude に渡す要求。入力は伏せた文だけ（型で縛る）。モデルと考える深さは用途 scoring の既定（Opus） */
export function buildReviewRequest(record: ForClaude<{ text: string }>): AskJsonRequest<typeof ReviewSchema> {
  return {
    purpose: "scoring",
    system: REVIEW_SYSTEM,
    input: { 記録: record },
    schema: ReviewSchema,
    sources: REVIEW_SOURCES,
  };
}

// ---------- 入力の文 ----------

export type ReviewIncident = { at: number; text: string; person?: string | null };

/** 講評に渡す物（id のまま。文にするときに仮名にする） */
export type ReviewContext = {
  scenario: DrillScenario;
  status: DrillStatus;
  score: DrillScore;
  actions: ReadonlyArray<ActionRecord>;
  calls: ReadonlyArray<CallRecord>;
  incidents: ReadonlyArray<ReviewIncident>;
  /** 同じ事業所の前の訓練の数字。無ければ null */
  previous: (ScoreNumbers & { scenario: DrillScenario }) | null;
};

const SCENE_WORDS = { heavy_rain: "大雨（警戒レベル 3 → 4 → 浸水）", earthquake: "地震（南海トラフ 震度 6強・津波・停電）" } as const;

/** 状態の色の言葉（左の表の色。lib/triage の色の名前） */
const triageWord = (c: string | undefined) => (c && c in COLOR_LABELS ? COLOR_LABELS[c as keyof typeof COLOR_LABELS] : null);

const MISS_WORDS = {
  late: "先に別の人へ手",
  missing: "手なし",
  declined: "赤の着信を拒否",
  unknown: "並びの記録なし",
} as const;

const RESULT_WORDS: Readonly<Record<string, string>> = {
  ringing: "呼出",
  connected: "通話",
  noLine: "不通",
  closed: "休止",
  arrived: "到着",
  blocked: "通行止",
  turnedBack: "引返し",
  dispatched: "手配済",
  noDispatch: "手配不可",
  accepted: "受入",
  refused: "断られた",
  reported: "報告済",
  evacuated: "避難済",
  noAnswer: "応答なし",
  silent: "無言",
  noNumber: "番号なし",
};

/** 講評の入力の文（仮名で書く。aliasOf: 台帳の id → 仮名）。数字は score の物だけ */
export function reviewText(ctx: ReviewContext, aliasOf: ReadonlyMap<string, string>): string {
  const who = (p: string | null | undefined) => (p && aliasOf.has(p) ? aliasOf.get(p)! : "（不明）");
  const s = ctx.score;
  const kind = scenarioOf(ctx.scenario).kind;
  const lines: string[] = [];
  lines.push(
    `想定: ${SCENE_WORDS[kind]}${ctx.scenario === "short" ? `（${SCENARIO_LABELS.short}）` : ""}。発災から 72 時間。訓練の終わり ${minuteText(s.endMinute)}（${STATUS_LABELS[ctx.status]}）`,
    `参加者: ${s.participants.map(who).join("・")}（${s.participants.length} 人）`,
    "",
    "機械で数えた結果（数え直さない）:",
  );
  // 順番
  lines.push(`- 対応の順番の一致: ${s.order.matched}/${s.order.total}（その人への最初の手が、その時の左の表で手のまだ無い人の一番上か）`);
  for (const m of s.order.misses) {
    const parts = m.why.map((w) => (w === "late" && m.expected ? `${MISS_WORDS.late}（その時の一番上は ${who(m.expected)}）` : MISS_WORDS[w]));
    lines.push(`  - ${who(m.person)}: ${parts.join("、")}`);
  }
  // 報告
  lines.push(
    s.report.minute === null
      ? `- 市役所への報告: 未報告（行政報告の手 ${s.report.tries} 回）`
      : `- 市役所への報告: 発災から ${minuteText(s.report.minute)}に届いた（行政報告の手 ${s.report.tries} 回）`,
  );
  // 様式 9
  lines.push(`- 様式 9 の空欄: ${s.form9.blanks}`);
  for (const r of s.form9.rows) lines.push(`  - ${who(r.person)}: ${r.columns.map((c) => FORM9_PLAN_LABELS[c]).join("・")}`);
  // 条件
  lines.push(`- 条件に達した人（時計が切れるまでに、その人へ届いた手が無い）: ${s.reached.length}`);
  for (const r of s.reached) {
    lines.push(`  - ${who(r.person)}: ${reachedText(r)}（切れた時刻 ${minuteText(r.outMinute)}、切れるまでの届かなかった手 ${r.tries}）`);
  }
  // 着信
  const c = s.calls;
  lines.push(`- 着信: ${c.total} 件（応答 ${c.answered}・拒否 ${c.declined}・未応答 ${c.open}。赤の拒否 ${c.redDeclined}）`);
  // 前回
  const p = ctx.previous;
  lines.push(
    p
      ? `前回（同じ事業所の前の訓練、${SCENARIO_LABELS[p.scenario]}）: 順番 ${p.order.matched}/${p.order.total}・報告 ${p.report === null ? "未報告" : minuteText(p.report)}・空欄 ${p.form9}・条件 ${p.reached}`
      : "前回: なし",
  );

  // 手の履歴と着信（時刻の順）
  lines.push("", "手の履歴（時刻は発災から。色と順位はその手の前の左の表）:");
  type Line = { at: number; order: number; text: string };
  const hist: Line[] = [];
  ctx.actions.forEach((a, i) => {
    const t = a.before.triage;
    const color = triageWord(t?.color);
    const before = a.person ? `（${[color, t?.rank != null ? `${t.rank} 位` : null].filter(Boolean).join(" ") || "色なし"}）` : "";
    const target = [a.person ? who(a.person) : "全体", a.calleeLabel].filter(Boolean).join(" ");
    const result = a.result ? (RESULT_WORDS[a.result.status] ?? a.result.status) : "返事なし";
    hist.push({ at: a.atMinute, order: i * 2, text: `${minuteText(a.atMinute)} ${ACTION_LABELS[a.kind]} → ${target}${before} → ${result}` });
  });
  ctx.calls.forEach((x, i) => {
    const res = x.response === "answer" ? "応答" : x.response === "decline" ? "拒否" : "未応答";
    const color = x.color === "red" ? "赤" : x.color === "green" ? "緑" : "安否不明";
    hist.push({ at: x.minute, order: i * 2 + 1, text: `${minuteText(x.minute)} 着信 ${who(x.person)}（${color}）→ ${res}` });
  });
  hist.sort((a, b) => a.at - b.at || a.order - b.order);
  if (hist.length === 0) lines.push("- なし");
  for (const h of hist) lines.push(`- ${h.text}`);

  lines.push("", "状況（想定の表と監督の差し込み）:");
  if (ctx.incidents.length === 0) lines.push("- なし");
  for (const e of ctx.incidents) lines.push(`- ${minuteText(Math.round(e.at * 60))} ${e.text}${e.person && aliasOf.has(e.person) ? `（${who(e.person)}）` : ""}`);
  return lines.join("\n");
}

// ---------- 返事の検査 ----------

/** 講評に書かせない言葉（診断・状態の言い切り・生き死に・薬の量） */
export const REVIEW_BANNED = /診断|判定|重症|病気が(?:わか|分か)|死|亡くな|心肺停止|意識が(?:ない|無い)|投与|処方|用量|服用量|増量|減量|mg|ミリグラム/;

/** 文 1 つの検査: 空・使わない言葉・元の情報が残る物は null。仮名は氏名に戻し、長さで切る */
export function reviewWords(raw: string, key: PseudonymKey, max: number): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (REVIEW_BANNED.test(t)) return null;
  if (findLeaks(t, key).length > 0) return null;
  return Array.from(restoreText(t, key)).slice(0, max).join("");
}

const isReviewKind = (v: string): v is ReviewKind => (REVIEW_KINDS as readonly string[]).includes(v);

/**
 * 返事を講評にする。知らない仮名・登録簿に無い根拠・検査に掛かった文の指摘は捨てる。kind が一覧の外なら other。
 * members は参加者（仮名を戻す先）。summary が検査に掛かれば空
 */
export function reviewBody(answer: ReviewAnswer, ctx: { key: PseudonymKey; members: ReadonlySet<string> }): ReviewBody {
  const findings: ReviewFinding[] = [];
  for (const f of answer.findings) {
    if (findings.length >= FINDINGS_MAX) break;
    const target = f.person.trim();
    let person: string | null = null;
    if (target !== "全体" && target !== "") {
      person = personOfAlias(target, ctx.key);
      if (!person || !ctx.members.has(person)) continue;
    }
    const b = f.basis.trim();
    let basis: SourceId | null = null;
    if (b !== NO_BASIS && b !== "") {
      if (!isSourceId(b) || !REVIEW_SOURCES.includes(b)) continue;
      basis = b;
    }
    const text = reviewWords(f.text, ctx.key, FINDING_TEXT_MAX);
    if (!text) continue;
    const k = f.kind.trim();
    findings.push({ person, kind: isReviewKind(k) ? k : "other", text, basis });
  }
  return { summary: reviewWords(answer.summary, ctx.key, SUMMARY_MAX) ?? "", findings };
}

// ---------- 呼び口 ----------

export type ReviewDeps = {
  /** 事業所の本人の台帳（仮名化の前）。lib/drill/persona.ts の loadPersonaSources */
  sources: ReadonlyMap<string, PseudonymInput>;
  ai: AskJsonContext;
  /** 年齢を数える日（JST、YYYY-MM-DD） */
  on?: string;
};

export type ReviewOutcome = { ok: true; body: ReviewBody; model: string } | { ok: false; error: ReviewError };

export function reviewError(e: unknown): ReviewError | null {
  if (e instanceof AiNotConfigured) return "not_configured";
  if (e instanceof AiLimitReached) return "limit";
  if (e instanceof AiRefused) return "refused";
  if (e instanceof AiBadOutput) return "bad_output";
  if (e instanceof AiCallFailed) return "failed";
  if (e instanceof PseudonymLeakError) return "leak";
  return null;
}

/**
 * 講評を 1 回作る。参加者を並びの順に A さん・B さん…と伏せ、記録の文を pseudonymizeText に通して Opus に渡す。
 * 指摘も要約も残らなければ形の違い（bad_output）
 */
export async function createReview(deps: ReviewDeps, ctx: ReviewContext): Promise<ReviewOutcome> {
  try {
    const members = ctx.score.participants.filter((p) => deps.sources.has(p));
    const list = members.map((p) => deps.sources.get(p)!);
    const { key } = pseudonymize(list, deps.on ? { on: deps.on } : {});
    const aliasOf = new Map(key.people.map((p) => [p.personId, p.alias]));
    const record = pseudonymizeText(reviewText(ctx, aliasOf), key);
    const r = await askJson(buildReviewRequest(record), deps.ai);
    const body = reviewBody(r.value, { key, members: new Set(members) });
    if (!body.summary && body.findings.length === 0) return { ok: false, error: "bad_output" };
    return { ok: true, body, model: r.model };
  } catch (e) {
    const code = reviewError(e);
    if (code) return { ok: false, error: code };
    console.error("講評に失敗", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "failed" };
  }
}

