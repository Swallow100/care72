// 入れる欄の API（app/api/intake）の応答の形。失敗は種類と画面の言葉で返す（本文・鍵・値は返さない）。

import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import { AI_CONSENT_REFUSED_LABEL } from "../consent/labels.ts";
import type { ConsentKind, ConsentStatus } from "../db/types.ts";
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
  | "file_empty"
  /** 黒塗りの画面を通っていない写真・PDF（生の PDF・PNG・EXIF の付いた JPEG。T52） */
  | "not_redacted"
  /** 同じ緊急・支援の順を 2 人に付けた（T57） */
  | "order_clash"
  /** 本人の電話（self）が 2 つになる（T68） */
  | "self_twice"
  /** AI 提供（ai_overseas）が不同意の人の台帳を入れる欄の AI に渡さない（T74） */
  | "consent_refused";

const LABELS: Record<IntakeErrorCode, string> = {
  file_type: INTAKE_LABELS.fileType,
  file_large: INTAKE_LABELS.fileLarge,
  file_empty: INTAKE_LABELS.fileEmpty,
  not_redacted: INTAKE_LABELS.notRedacted,
  ai_not_configured: INTAKE_LABELS.aiNotConfigured,
  ai_limit: INTAKE_LABELS.aiLimit,
  ai_refused: INTAKE_LABELS.aiRefused,
  ai_failed: INTAKE_LABELS.aiFailed,
  leak: INTAKE_LABELS.leak,
  invalid: INTAKE_LABELS.invalid,
  not_found: "該当なし",
  forbidden: "権限なし",
  conflict: INTAKE_LABELS.conflict,
  order_clash: INTAKE_LABELS.orderClash,
  self_twice: INTAKE_LABELS.selfTwice,
  consent_refused: AI_CONSENT_REFUSED_LABEL,
};

const STATUS: Record<IntakeErrorCode, number> = {
  file_type: 415,
  file_large: 413,
  file_empty: 400,
  not_redacted: 415,
  ai_not_configured: 503,
  ai_limit: 429,
  ai_refused: 422,
  ai_failed: 502,
  leak: 422,
  invalid: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  order_clash: 422,
  self_twice: 422,
  consent_refused: 403,
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

/**
 * 入れる欄の AI の入口（文を分ける /api/intake/extract・写真と PDF を読む /api/intake/read）の同意の確かめ（T74）。
 * AI 提供（ai_overseas。Claude〔海外の事業者〕に仮名化した台帳を渡すこと）が「不同意」の人は 403「同意 拒否」で断り、Claude を呼ばない。
 * 未確認・同意・行なしは通す（本運用では使う前に確かめる。README の本運用の条件）。
 * 録音の分類・まとめ（本人が押して話した物。AI の告知を聞いている）と訓練の本人役（架空の人）はここを通らず、断らない。
 * 見え方（lib/consent/scope.ts）には使わない
 */
export function aiConsentRefusal(consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>): Response | null {
  return isAiConsentRefused(consents) ? intakeError("consent_refused") : null;
}

/** AI 提供が「不同意」か（入口の 403 と、本人のページを開いた時点の入れる欄の「同意 拒否」〔lib/intake/props.ts〕が同じ物を見る） */
export function isAiConsentRefused(consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>): boolean {
  return consents.some((c) => c.kind === "ai_overseas" && c.status === "refused");
}
