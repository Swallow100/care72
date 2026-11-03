// Claude の client。鍵は Cloudflare の env（配信は secret、手元は .dev.vars）から渡す。
// ここは env を受け取るだけで getCloudflareContext を呼ばない（テストで Cloudflare に触らないため）。
// 配信先で env を読むのは lib/claude/cloudflare.ts。

import Anthropic from "@anthropic-ai/sdk";
import { AiNotConfigured } from "./errors.ts";

/** AI の層が読む env。値は secret なので画面・ログ・応答に出さない */
export type AiEnv = {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** 配信の Secret が GEMINI_TTS の名前で入っている（11/3）ので、その名前も読む。正は GEMINI_API_KEY */
  GEMINI_TTS?: string;
  /** デモ事業所の 1 日の上限（回）。無ければ 200 */
  AI_DAILY_LIMIT?: string;
};

/** 空・空白だけの値は無いと同じ（.dev.vars.example を写しただけのとき） */
export function keyOf(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function hasAnthropicKey(env: AiEnv): boolean {
  return keyOf(env.ANTHROPIC_API_KEY) !== null;
}

/** Gemini の鍵。GEMINI_API_KEY が先、無ければ GEMINI_TTS */
export function geminiKeyOf(env: Pick<AiEnv, "GEMINI_API_KEY" | "GEMINI_TTS">): string | null {
  return keyOf(env.GEMINI_API_KEY) ?? keyOf(env.GEMINI_TTS);
}

export function hasGeminiKey(env: AiEnv): boolean {
  return geminiKeyOf(env) !== null;
}

export type ClaudeRequestOptions = { timeout?: number; maxRetries?: number };

/** askJson が使う所だけの形。テストはこれを満たす偽物を渡す（本物の API を呼ばない） */
export interface ClaudeClient {
  beta: {
    messages: {
      create(
        params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        options?: ClaudeRequestOptions,
      ): Promise<Anthropic.Beta.Messages.BetaMessage>;
    };
  };
}

/** 再試行は 1 回（429・5xx・つながらないとき。SDK が待ってから送り直す） */
export const MAX_RETRIES = 1;

/**
 * 鍵から client を作る。鍵が無ければ AiNotConfigured。
 * 鍵を先に確かめる: 引数なしの new Anthropic() は process.env などを探しに行き、別の例外になるため。
 */
export function createClaudeClient(env: AiEnv): ClaudeClient {
  const apiKey = keyOf(env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new AiNotConfigured("anthropic");
  return new Anthropic({ apiKey, maxRetries: MAX_RETRIES });
}
