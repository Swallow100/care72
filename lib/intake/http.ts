// 入れる欄の API（app/api/intake）の応答の形。失敗は種類と画面の言葉で返す（本文・鍵・値は返さない）。

import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import { INTAKE_LABELS } from "../labels.ts";
import { PseudonymLeakError } from "../pseudonym/index.ts";

export type IntakeErrorCode =
  | "ai_not_configured"
  | "ai_limit"
  | "ai_refused"
  | "ai_failed"
  | "leak"
  | "invalid"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "file_type"
  | "file_large"
  | "file_empty";

const LABELS: Record<IntakeErrorCode, string> = {
  file_type: INTAKE_LABELS.fileType,
  file_large: INTAKE_LABELS.fileLarge,
  file_empty: INTAKE_LABELS.fileEmpty,
  ai_not_configured: INTAKE_LABELS.aiNotConfigured,
  ai_limit: INTAKE_LABELS.aiLimit,
  ai_refused: INTAKE_LABELS.aiRefused,
  ai_failed: INTAKE_LABELS.aiFailed,
  leak: INTAKE_LABELS.leak,
  invalid: INTAKE_LABELS.invalid,
  not_found: "該当なし",
  forbidden: "権限なし",
  conflict: INTAKE_LABELS.conflict,
};

const STATUS: Record<IntakeErrorCode, number> = {
  file_type: 415,
  file_large: 413,
  file_empty: 400,
  ai_not_configured: 503,
  ai_limit: 429,
  ai_refused: 422,
  ai_failed: 502,
  leak: 422,
  invalid: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
};

/**
 * AI 失敗の理由。ai_calls の error（refused・bad_output・timeout・api_error）に合わせ、
 * bad_output のうち途中で切れた物（max_tokens）だけ分ける。値・本文・形の違う場所は返さない
 */
export type AiFailReason = "schema" | "max_tokens" | "refused" | "timeout" | "api_error";

export function intakeError(code: IntakeErrorCode, reason?: AiFailReason): Response {
  return Response.json(
    { ok: false, error: code, label: LABELS[code], ...(reason ? { reason } : {}) },
    { status: STATUS[code], headers: { "Cache-Control": "no-store" } },
  );
}

/** AI の失敗の例外から理由を引く。AI の返事の失敗でなければ null */
export function aiFailReasonOf(e: unknown): AiFailReason | null {
  if (e instanceof AiRefused) return "refused";
  if (e instanceof AiBadOutput) return e.reason === "max_tokens" ? "max_tokens" : "schema";
  if (e instanceof AiCallFailed) return e.code;
  return null;
}

/** AI の層・仮名化の層の例外を応答に。知らない例外は null（呼ぶ側が投げ直す） */
export function intakeErrorOf(e: unknown): Response | null {
  if (e instanceof AiNotConfigured) return intakeError("ai_not_configured");
  if (e instanceof AiLimitReached) return intakeError("ai_limit");
  if (e instanceof AiRefused) return intakeError("ai_refused", "refused");
  if (e instanceof AiBadOutput || e instanceof AiCallFailed) return intakeError("ai_failed", aiFailReasonOf(e) ?? undefined);
  if (e instanceof PseudonymLeakError) return intakeError("leak");
  return null;
}
