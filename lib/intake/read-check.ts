// 写真・PDF を読む受け口（app/api/intake/read）の中身の確かめ（T52。サーバーだけ）。送る形は lib/intake/read-form.ts。

import { toFormFile, type FormFile } from "../forms/form-read.ts";
import { hasJpegMetadata, isJpeg } from "../redact/jpeg.ts";

export type RedactedImageError = "not_redacted" | "file_empty" | "file_large";

/**
 * 送られた画像を確かめて、Claude に添える形にする。塗った後の JPEG（付け足しなし）だけを通す。
 * PDF・PNG・EXIF などの付いた JPEG は not_redacted（黒塗りの画面を通っていない）
 */
export function checkRedactedImage(bytes: Uint8Array): { ok: true; file: FormFile } | { ok: false; error: RedactedImageError } {
  const f = toFormFile(bytes);
  if (!f.ok) return { ok: false, error: f.error === "empty" ? "file_empty" : f.error === "too_large" ? "file_large" : "not_redacted" };
  if (f.file.kind !== "image" || !isJpeg(bytes) || hasJpegMetadata(bytes)) return { ok: false, error: "not_redacted" };
  return f;
}
