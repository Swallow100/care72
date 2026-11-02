// 様式の対応表の API（app/api/forms）の応答の形。失敗は種類と画面の言葉で返す（本文・鍵・値は返さない）。

import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import { PseudonymLeakError } from "../pseudonym/index.ts";
import { MAPPING_LABELS } from "./mapping.ts";

export type MappingErrorCode =
  | "ai_not_configured"
  | "ai_limit"
  | "ai_refused"
  | "ai_failed"
  | "invalid"
  | "unknown_item"
  | "file_type"
  | "file_large"
  | "file_empty"
  | "not_found"
  | "forbidden"
  | "conflict";

const LABELS: Record<MappingErrorCode, string> = {
  ai_not_configured: MAPPING_LABELS.aiNotConfigured,
  ai_limit: MAPPING_LABELS.aiLimit,
  ai_refused: MAPPING_LABELS.aiRefused,
  ai_failed: MAPPING_LABELS.aiFailed,
  invalid: MAPPING_LABELS.invalid,
  unknown_item: MAPPING_LABELS.unknownItem,
  file_type: MAPPING_LABELS.fileType,
  file_large: MAPPING_LABELS.fileLarge,
  file_empty: MAPPING_LABELS.fileEmpty,
  not_found: MAPPING_LABELS.notFound,
  forbidden: MAPPING_LABELS.forbidden,
  conflict: MAPPING_LABELS.conflict,
};

const STATUS: Record<MappingErrorCode, number> = {
  ai_not_configured: 503,
  ai_limit: 429,
  ai_refused: 422,
  ai_failed: 502,
  invalid: 400,
  unknown_item: 400,
  file_type: 415,
  file_large: 413,
  file_empty: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
};

export function mappingError(code: MappingErrorCode, at?: string): Response {
  return Response.json(
    { ok: false, error: code, label: LABELS[code], ...(at ? { at } : {}) },
    { status: STATUS[code], headers: { "Cache-Control": "no-store" } },
  );
}

export function mappingErrorLabel(code: string): string {
  return LABELS[code as MappingErrorCode] ?? MAPPING_LABELS.aiFailed;
}

/** AI の層・仮名化の層の例外を応答に。知らない例外は null（呼ぶ側が投げ直す） */
export function mappingErrorOf(e: unknown): Response | null {
  if (e instanceof AiNotConfigured) return mappingError("ai_not_configured");
  if (e instanceof AiLimitReached) return mappingError("ai_limit");
  if (e instanceof AiRefused) return mappingError("ai_refused");
  if (e instanceof AiBadOutput || e instanceof AiCallFailed) return mappingError("ai_failed");
  if (e instanceof PseudonymLeakError) return mappingError("invalid");
  return null;
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
