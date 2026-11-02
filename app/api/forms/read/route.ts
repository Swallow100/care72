import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { FORM_FILE_MAX_BYTES, formHash, readForm, toFormFile } from "@/lib/forms/form-read";
import { findMappingByHash, formsScope, insertReadMapping } from "@/lib/forms/mapping-db";
import { mappingError, mappingErrorOf, NO_STORE } from "@/lib/forms/mapping-http";

// 様式の読み取り: 写真（JPEG・PNG）か PDF の空の様式を受け取り、Opus に欄と台帳の項目の対応表を出させ、下書きで保存する。
// ケアマネの役だけ（管理者・審査員のケアマネの役を含む）。範囲は事業所。Claude の呼び出しは 1 要求 1 回。
// 同じ写真・PDF（SHA-256 が同じ）が事業所にあれば読まずにその対応表を返す（上限も減らさない）。
// Claude に渡すのは写真・PDF と台帳の項目表（値は無い）だけ。台帳の値・氏名は渡さない。写真・PDF は保存しない
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mappingError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "ai");
  if (no) return no;
  const scope = formsScope(principal);
  if (!scope) return mappingError("forbidden");

  // 読む前に大きさで断る（multipart の枠の分だけ余裕を見る）
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > FORM_FILE_MAX_BYTES + 64 * 1024) return mappingError("file_large");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return mappingError("invalid");
  if (file.size > FORM_FILE_MAX_BYTES) return mappingError("file_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = toFormFile(bytes);
  if (!checked.ok) return mappingError(checked.error === "type" ? "file_type" : checked.error === "empty" ? "file_empty" : "file_large");

  const hash = await formHash(bytes);
  const known = await findMappingByHash(env.DB, scope.officeId, hash);
  if (known) return Response.json({ ok: true, id: known.id, reused: true }, { headers: NO_STORE });

  try {
    const ctx = await aiContextFor(scope.officeId);
    const read = await readForm(checked.file, ctx);
    const saved = await insertReadMapping(env.DB, {
      id: crypto.randomUUID(),
      officeId: scope.officeId,
      hash,
      kind: checked.file.kind,
      mapping: read.mapping,
      model: read.mark.model,
      by: scope.accountId,
      at: new Date().toISOString(),
    });
    return Response.json({ ok: true, id: saved.id, reused: saved.reused, rejected: read.rejected.length }, { headers: NO_STORE });
  } catch (e) {
    const res = mappingErrorOf(e);
    if (res) return res;
    console.error("様式の読み取りに失敗", e instanceof Error ? e.name : typeof e);
    return mappingError("ai_failed");
  }
}
