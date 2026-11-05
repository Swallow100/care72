// 声の聞き取りの会話の次の 1 文を Claude（Haiku）に 1 回決めさせる所（docs/tasks/T137.md）。サーバーだけで使う。
//
// - Claude に渡すのは、仮名化の門（lib/pseudonym の pseudonymizeText）を通した会話の文と、決まった言葉の状況の文だけ。台帳は渡さない
// - Claude が決めるのは、話題（決まった範囲から 1 つ）・前置き（受け止めの一言）・問い（易しく短く）・つかめたか、だけ。
//   色と連絡の順、答えの読み取り（表の入力）、応答不明瞭の印、命に関わる言葉の扱いは決めない（lib/signals/talk.ts のコード）
// - 返った文はコードの門（gateLine）で確かめ、外れたら話題の決まった問いに戻す。鍵なし・上限・断られた・遅い・形の違いも決まった問い
// - 表の 2 問（けが・動けるか）を聞くまでは、Claude が「つかめた」と言っても終えない（その問いを決まった文で聞く）
// - 呼び方は分類と同じ数え（ai_calls の用途 classify）で、待ちと上限は TALK_SPEC（Haiku・low・短い出力・再試行なし）

import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused, AiTruncated } from "../claude/errors.ts";
import { TALK_SPEC } from "../claude/models.ts";
import { findLeaks, PseudonymLeakError, pseudonymizeText, type ForClaude, type PseudonymKey } from "../pseudonym/index.ts";
import { questionOf } from "./questions.ts";
import {
  fixedLine,
  gateLine,
  missingRequired,
  planTalk,
  TALK_MAX_AI,
  TALK_MAX_TURNS,
  TALK_QUESTION_MAX,
  TALK_PREFACE_MAX,
  TALK_TOPIC_SPECS,
  TALK_TOPICS,
  askedTurns,
  type TalkContext,
  type TalkEnd,
  type TalkLine,
  type TalkLog,
  type TalkPlan,
  type TalkTopic,
} from "./talk.ts";

export const TALK_SYSTEM = [
  "災害のあと、本人のスマホで本人と短い会話をしている。本人は高齢で、在宅で介護を受けている。次に本人に聞く 1 文を決める。聞くのは事実だけ。",
  "入力は JSON。「会話」はこれまでの問いと本人の答え（聞き取れなかった回は（無音）（不明瞭））。「状況」は聞ける話題と、話題ごとの決まった問い、残りの回数、本人が押した答え。",
  "返すのは topic・preface・question・done の 4 つだけ。",
  "",
  "- topic: 次に聞く話題。状況の「聞ける話題」の id から 1 つ。",
  `- question: 本人に聞く問い 1 つ。はい・いいえで答えられる形で、「か」か「？」で終わる。${TALK_QUESTION_MAX} 字まで。ひらがなを多く、短い言葉で、ゆっくり読める文。`,
  "  話題を初めて聞くときは、状況の「決まった問い」の文をそのまま使う。答えが噛み合わない・聞き取れない・違う話をしたときだけ、同じ話題をもっと易しい言葉で言い換える。",
  `- preface: 問いの前に言う受け止めの一言（${TALK_PREFACE_MAX} 字まで。無ければ空文字）。本人の言葉をそのままくり返す程度（「あしが いたいのですね」）。`,
  "- done: 聞ける話題の大事な物が聞けて状況がつかめた、または本人がもう答えられないなら true。",
  "",
  "決まり:",
  "1. 診断・病名・症状の重さ・薬の量・手当てや動き方の助言・「大丈夫です」と言い切ること・安心させる約束は言わない。",
  "2. 119・救急・病院・警察・電話をかける話はしない（決まった文が別にある）。「〜してください」と頼まない。",
  "3. 名前・住所・電話番号を聞かない・言わない。「A さん」は本人の仮名で、呼びかけに使わない。英字と数字を書かない。",
  "4. 本人が違う話をしても責めない。やさしく話題に戻す。方言・言いよどみは意味をくんで読むが、言っていない事を作らない。",
  "5. 1 回に聞くのは 1 つだけ。前に聞いて答えがあった事は聞かない。",
].join("\n");

export const TalkSchema = z.object({
  topic: z.enum(TALK_TOPICS),
  preface: z.string(),
  question: z.string(),
  done: z.boolean(),
});
export type TalkAnswer = z.output<typeof TalkSchema>;

/** Claude に渡す形。どちらも仮名化の門を通した文 */
export type TalkAiInput = { 会話: ForClaude<{ text: string }>; 状況: ForClaude<{ text: string }> };

/** 会話の文（問いと本人の言葉）。本人の言葉は伏せる前の文で、sealTalkInput が本人の鍵で伏せる */
export function dialogForAi(log: TalkLog): string {
  return log.turns
    .map((t) => {
      const reply = t.reply ?? (t.heard === "silent" ? "（無音）" : "（不明瞭）");
      return `問: ${t.ask}\n答: ${t.heard === "unclear" && t.reply ? `${reply}（不明瞭）` : reply}`;
    })
    .join("\n");
}

/** 状況の文（決まった言葉だけ。名前・住所を入れない） */
export function situationForAi(log: TalkLog, plan: Extract<TalkPlan, { kind: "ask" }>, ctx: TalkContext): string {
  const topics = plan.topics.map((t) => `${t}（${TALK_TOPIC_SPECS[t].label}。決まった問い「${TALK_TOPIC_SPECS[t].text}」）`).join("、");
  const pressed = Object.entries(ctx.answers)
    .map(([id, a]) => {
      const q = questionOf(id as Parameters<typeof questionOf>[0]);
      return `${q.label} ${q.choices.find((c) => c.id === a!.choice)?.label ?? ""}`;
    })
    .join("・");
  const missing = missingRequired(log, ctx);
  return [
    `聞ける話題: ${topics}`,
    `まだ聞いていない大事な話題: ${missing.length > 0 ? missing.join("、") : "なし"}`,
    `本人が押した答え: ${pressed || "なし"}`,
    `残りの回数: ${Math.max(TALK_MAX_TURNS - askedTurns(log), 0)}`,
  ].join("\n");
}

export function sealTalkInput(log: TalkLog, plan: Extract<TalkPlan, { kind: "ask" }>, ctx: TalkContext, key: PseudonymKey): TalkAiInput {
  return {
    会話: pseudonymizeText(dialogForAi(log), key),
    状況: pseudonymizeText(situationForAi(log, plan, ctx), key),
  };
}

export function buildTalkRequest(input: TalkAiInput): AskJsonRequest<typeof TalkSchema> {
  return { purpose: "classify", spec: TALK_SPEC, system: TALK_SYSTEM, input, schema: TalkSchema };
}

/** Claude が呼べなかった・外れた理由（記録と評価の台で数える） */
export type TalkAiError = "not_configured" | "limit" | "refused" | "bad_output" | "failed" | "leak" | "gate" | "topic" | "cap";

/** 次の手の答え。ask は読む 1 文、close は締め、danger・buttons は端末がコードで決める物（サーバーも同じ決まりで返す） */
export type TalkReply =
  | { kind: "ask"; line: TalkLine; called: boolean; error?: TalkAiError; gate?: string }
  | { kind: "close"; end: TalkEnd; called: boolean }
  | { kind: "danger"; danger: Extract<TalkPlan, { kind: "danger" }>["danger"]; called: false }
  | { kind: "buttons"; called: false };

function errorOf(e: unknown): TalkAiError | null {
  if (e instanceof AiNotConfigured) return "not_configured";
  if (e instanceof AiLimitReached) return "limit";
  if (e instanceof AiRefused) return "refused";
  if (e instanceof AiBadOutput || e instanceof AiTruncated) return "bad_output";
  if (e instanceof AiCallFailed) return "failed";
  if (e instanceof PseudonymLeakError) return "leak";
  return null;
}

/**
 * 1 往復を聞いたあとの次の手。コードの決まり（planTalk）を先に当て、次の 1 文を聞くときだけ Claude を 1 回呼ぶ。
 * ai が null（鍵の無い端末・上限の外）なら決まった問い。Claude を呼んだら called（端末が会話の記録の aiCalls に足す）
 */
export async function nextTalk(
  log: TalkLog,
  ctx: TalkContext,
  ai: { ctx: () => Promise<AskJsonContext>; key: PseudonymKey } | null,
): Promise<TalkReply> {
  const plan = planTalk(log, ctx);
  if (plan.kind === "danger") return { kind: "danger", danger: plan.danger, called: false };
  if (plan.kind === "buttons") return { kind: "buttons", called: false };
  if (plan.kind === "close") return { kind: "close", end: plan.end, called: false };
  const fallback = (error?: TalkAiError, called = false, gate?: string): TalkReply => ({
    kind: "ask",
    line: fixedLine(plan.fallback),
    called,
    ...(error ? { error } : {}),
    ...(gate ? { gate } : {}),
  });
  if (!ai) return fallback("not_configured");
  if (log.aiCalls >= TALK_MAX_AI) return fallback("cap");

  let answer: TalkAnswer;
  try {
    const input = sealTalkInput(log, plan, ctx, ai.key);
    answer = (await askJson(buildTalkRequest(input), await ai.ctx())).value;
  } catch (e) {
    const error = errorOf(e);
    if (!error) throw e;
    // 伏せきれない・鍵なしは呼んでいない。ほかは呼んだ（上限に数えた）
    return fallback(error, error !== "leak" && error !== "not_configured" && error !== "limit");
  }

  if (answer.done) {
    const missing = missingRequired(log, ctx);
    if (missing.length === 0) return { kind: "close", end: "grasped", called: true };
    // 表の 2 問を聞くまでは終えない（決まった問いで聞く）
    return { kind: "ask", line: fixedLine(missing[0]), called: true };
  }
  if (!plan.topics.includes(answer.topic as TalkTopic)) return fallback("topic", true);
  const g = gateLine(answer);
  if (!g.ok) return { kind: "ask", line: fixedLine(answer.topic), called: true, error: "gate", gate: g.reason };
  // 読む文に元の氏名・電話などが残っていないか（Claude は伏せた文しか見ていないが、念のため）
  if (findLeaks(g.text, ai.key).length > 0) return { kind: "ask", line: fixedLine(answer.topic), called: true, error: "leak" };
  return { kind: "ask", line: { text: g.text, question: g.question, easy: null, by: "ai", topic: answer.topic }, called: true };
}
