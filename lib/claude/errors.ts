// AI の呼び出しの失敗。画面はこの種類で出し分ける（例: AiNotConfigured なら「AI 未設定」、AiLimitReached なら記録の再生）。
// メッセージに入れた物・返った物（本文）を書かない。ログに残るので。

import type { AiCallError } from "../db/types.ts";

export type AiService = "anthropic" | "gemini";

/** 鍵が無い（.dev.vars か Cloudflare の secret に入っていない） */
export class AiNotConfigured extends Error {
  readonly service: AiService;
  constructor(service: AiService) {
    super(`AI 未設定: ${service === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY"} が無い`);
    this.name = "AiNotConfigured";
    this.service = service;
  }
}

/** 事業所の 1 日の上限に達した */
export class AiLimitReached extends Error {
  readonly officeId: string;
  readonly limit: number;
  /** 数えた日（JST、YYYY-MM-DD） */
  readonly day: string;
  constructor(officeId: string, limit: number, day: string) {
    super(`AI の 1 日の上限（${limit} 回）に達した: ${day}`);
    this.name = "AiLimitReached";
    this.officeId = officeId;
    this.limit = limit;
    this.day = day;
  }
}

/** 断られた（stop_reason が refusal。fallback の先も断った） */
export class AiRefused extends Error {
  readonly category: string | null;
  constructor(category: string | null) {
    super(`AI に断られた${category ? `（${category}）` : ""}`);
    this.name = "AiRefused";
    this.category = category;
  }
}

export type BadOutputReason = "max_tokens" | "stop_reason" | "no_text" | "not_json" | "schema";

/** 返った物が使えない（JSON でない・形が違う・途中で切れた）。issues は形の違う場所だけで、値は持たない */
export class AiBadOutput extends Error {
  readonly reason: BadOutputReason;
  readonly issues: string[];
  constructor(reason: BadOutputReason, issues: string[] = []) {
    super(`AI の返した物が使えない: ${reason}${issues.length ? `（${issues.join("、")}）` : ""}`);
    this.name = "AiBadOutput";
    this.reason = reason;
    this.issues = issues;
  }
}

/** API に届かない・API の失敗（再試行のあとも）。元の SDK の例外は cause に */
export class AiCallFailed extends Error {
  readonly code: Extract<AiCallError, "timeout" | "api_error">;
  constructor(code: Extract<AiCallError, "timeout" | "api_error">, cause: unknown) {
    super(`AI の呼び出しに失敗: ${code}`, { cause });
    this.name = "AiCallFailed";
    this.code = code;
  }
}
