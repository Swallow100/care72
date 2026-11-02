// Claude を呼ぶ所はここ 1 か所（docs/tasks/T00.md）。台帳の入力・分類・ペルソナ・監督・採点は全部 askJson を通る。
//
// - 入力は lib/pseudonym が作った印付きの物だけ（型と実行時の両方で確かめる）。素の台帳・氏名は通らない。
// - 返事の JSON の形は構造化出力（output_config.format）で縛り、返った物を zod の schema で検査してから返す。
//   tool use の強制（tool_choice の any・tool）は Opus 5.5・Sonnet 5.5 で 400 になるので使わない（skill claude-api）。
// - 戻りには「AI」の印 { ai: true, model, purpose } を付ける。画面はこの印を出し、ケアマネが直せる形にする（CLAUDE.md）。
//   model は答えたモデル（断られて fallback に回ったときは回った先）。
// - 再試行は SDK の 1 回（429・5xx・つながらない）。形の違う返事は送り直さず失敗にする。
// - 呼ぶ前に事業所の 1 日の上限を確かめ、1 回 1 行を ai_calls に残す（lib/claude/usage.ts）。

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod";
import type { AiPurpose } from "../db/types.ts";
import { assertForClaude, isForClaude, type ForClaude } from "../pseudonym/index.ts";
import type { SourceId } from "../sources/index.ts";
import { sourcesSystem } from "../sources/prompt.ts";
import { createClaudeClient, MAX_RETRIES, type ClaudeClient } from "./client.ts";
import { AiBadOutput, AiCallFailed, AiRefused } from "./errors.ts";
import {
  PURPOSES,
  SERVER_FALLBACK_BETA,
  SERVER_FALLBACK_MODELS,
  type ClaudeModel,
  type ClaudePurpose,
} from "./models.ts";
import { beginCall, type AiContext, type UsedTokens } from "./usage.ts";

/**
 * Claude に渡せる入力。lib/pseudonym の印付きの物 1 つか、印付きの物に名前を付けて並べた物
 * （例 { 本人: pseudonymize(...).payload, 話した文: pseudonymizeText(...) }）。
 */
export type ClaudeInput = ForClaude<object> | Readonly<Record<string, ForClaude<object>>>;

/** 「AI」の印。画面に出す */
export type AiMark = { readonly ai: true; readonly model: string; readonly purpose: AiPurpose };
export type AiResult<T> = AiMark & { readonly value: T };

/**
 * 入力に添える写真・PDF（base64）。様式の読み取り（T08）の空の様式だけに使う。人の値（台帳・氏名）を入れない。
 * 入力の JSON には入れず、別の内容の塊として文の前に置く（skill claude-api: 文書は文の前）
 */
export type ClaudeAttachment =
  | { kind: "image"; mediaType: "image/jpeg" | "image/png"; data: string }
  | { kind: "pdf"; data: string };

export type AskJsonRequest<S extends z.ZodType> = {
  purpose: ClaudePurpose;
  /** 無ければ用途の既定（lib/claude/models.ts） */
  model?: ClaudeModel;
  /** 用途ごとの指示。氏名・住所・電話を書かない（コードの定数で持つ） */
  system: string;
  input: ClaudeInput;
  /** 写真・PDF（様式の読み取りだけ）。無ければ入力の JSON の文だけを送る */
  attachments?: ReadonlyArray<ClaudeAttachment>;
  /** 返事の形。いちばん外は z.object にする */
  schema: S;
  /**
   * 根拠として引いてよい出典（lib/sources の id）。渡すと system に「根拠は次の一覧の id だけ。無ければ「根拠なし」」と一覧を足す。
   * 返事の根拠の欄は lib/sources/prompt.ts の basisSchema で縛る。無い id は呼ぶ前に投げる（上限も減らさない）
   */
  sources?: ReadonlyArray<SourceId>;
};

/** どの用途にも先に付ける指示 */
export const COMMON_SYSTEM = [
  "入力の「A さん」は仮名、「支援者 1」「娘」などは役割名。元の氏名・住所・電話を推し量らず、出力にも書かない。",
  "診断・薬の量・医療の助言をしない。本人の状態を言い切らない。",
  "出力は下書きで、決めるのはケアマネ。決められない所は決めずに、そうと分かる形で返す。",
].join("\n");

export type AskJsonContext = AiContext & {
  /** 差し替え口（テスト）。無ければ env の鍵で作る */
  claude?: ClaudeClient;
};

/** 実行時の確かめ。型を as で外して渡されたときも止める */
function assertClaudeInput(input: unknown): asserts input is ClaudeInput {
  if (isForClaude(input)) return;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const parts = Object.values(input);
    if (parts.length > 0 && parts.every(isForClaude)) return;
  }
  assertForClaude(input);
  // ここには来ない（assertForClaude が投げる）
  throw new Error("仮名化の層（lib/pseudonym）を通っていない物は Claude に渡さない");
}

function attachmentBlock(a: ClaudeAttachment): Anthropic.Beta.Messages.BetaContentBlockParam {
  return a.kind === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
    : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } };
}

/** 利用者の発話。添え物が無ければ入力の JSON の文だけ、あれば写真・PDF を先に並べてから JSON の文 */
function userContent<S extends z.ZodType>(req: AskJsonRequest<S>): string | Anthropic.Beta.Messages.BetaContentBlockParam[] {
  const text = JSON.stringify(req.input);
  if (!req.attachments || req.attachments.length === 0) return text;
  return [...req.attachments.map(attachmentBlock), { type: "text", text }];
}

export function buildParams<S extends z.ZodType>(
  req: AskJsonRequest<S>,
  model: ClaudeModel,
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const spec = PURPOSES[req.purpose];
  const format = zodOutputFormat(req.schema);
  return {
    model,
    max_tokens: spec.maxTokens,
    system: [
      { type: "text", text: COMMON_SYSTEM },
      { type: "text", text: req.system },
      ...(req.sources ? [{ type: "text" as const, text: sourcesSystem(req.sources) }] : []),
    ],
    messages: [{ role: "user", content: userContent(req) }],
    output_config: { effort: spec.effort, format: { type: "json_schema", schema: format.schema } },
    // 断られたら、断られた種類に合うモデルにサーバー側で回す。Haiku には送らない
    ...(SERVER_FALLBACK_MODELS.has(model) ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

function usedTokens(m: Anthropic.Beta.Messages.BetaMessage): UsedTokens {
  const u = m.usage;
  return {
    model: m.model,
    inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  };
}

/** 返事から JSON を取り出し、schema で確かめる */
export function readJson<S extends z.ZodType>(m: Anthropic.Beta.Messages.BetaMessage, schema: S): z.output<S> {
  if (m.stop_reason === "refusal") throw new AiRefused(m.stop_details?.category ?? null);
  if (m.stop_reason === "max_tokens") throw new AiBadOutput("max_tokens");
  if (m.stop_reason !== "end_turn") throw new AiBadOutput("stop_reason");
  const text = m.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new AiBadOutput("no_text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiBadOutput("not_json");
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) {
    throw new AiBadOutput(
      "schema",
      checked.error.issues.map((i) => (i.path.length ? i.path.join(".") : "(全体)")),
    );
  }
  return checked.data;
}

/**
 * Claude に仮名の入力を渡し、決まった形の JSON を受け取る。
 * 失敗: AiNotConfigured（鍵なし）・AiLimitReached（上限）・AiCallFailed（API）・AiRefused（断られた）・AiBadOutput（形が違う）。
 */
export async function askJson<S extends z.ZodType>(
  req: AskJsonRequest<S>,
  ctx: AskJsonContext,
): Promise<AiResult<z.output<S>>> {
  assertClaudeInput(req.input);
  const spec = PURPOSES[req.purpose];
  const model = req.model ?? spec.model;
  // 鍵を先に確かめる（鍵が無いときは上限を減らさない）
  const claude = ctx.claude ?? createClaudeClient(ctx.env);
  const params = buildParams(req, model);

  const ticket = await beginCall(ctx, req.purpose, model);
  let message: Anthropic.Beta.Messages.BetaMessage;
  try {
    message = await claude.beta.messages.create(params, { timeout: spec.timeoutMs, maxRetries: MAX_RETRIES });
  } catch (e) {
    const code = e instanceof Anthropic.APIConnectionTimeoutError ? "timeout" : "api_error";
    await ticket.fail(code);
    throw new AiCallFailed(code, e);
  }

  const used = usedTokens(message);
  let value: z.output<S>;
  try {
    value = readJson(message, req.schema);
  } catch (e) {
    await ticket.fail(e instanceof AiRefused ? "refused" : "bad_output", used);
    throw e;
  }
  await ticket.ok(used);
  return { ai: true, model: message.model, purpose: req.purpose, value };
}
