import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { FORM_FILE_MAX_BYTES, toFormFile } from "@/lib/forms/form-read";
import { intakeError, intakeErrorOf } from "@/lib/intake/http";
import { readIntake } from "@/lib/intake/read";
import { loadPersonPage } from "@/lib/person";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// 入れる欄の「写真・PDF を読む」（T45）: ケアプラン・お薬手帳・紹介状などの写真（JPEG・PNG）か PDF を 1 枚受け取り、
// Opus が台帳の欄に分け、今の台帳と並べた差分を返す。書かない（保存は /api/intake/save）。写真・PDF は保存しない。
// ケアマネの役だけ（審査員のケアマネの役を含む）。本人は personInScope を通した人だけ。Claude の呼び出しは 1 要求 1 回
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return intakeError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "ai");
  if (no) return no;
  if (!principal || principal.role !== "care_manager" || !principal.office) return intakeError("forbidden");

  // 読む前に大きさで断る（multipart の枠の分だけ余裕を見る）
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > FORM_FILE_MAX_BYTES + 64 * 1024) return intakeError("file_large");
  const form = await request.formData().catch(() => null);
  const personId = form?.get("personId");
  const file = form?.get("file");
  if (typeof personId !== "string" || !ID.test(personId) || !file || typeof file === "string") return intakeError("invalid");
  if (file.size > FORM_FILE_MAX_BYTES) return intakeError("file_large");
  const checked = toFormFile(new Uint8Array(await file.arrayBuffer()));
  if (!checked.ok) return intakeError(checked.error === "type" ? "file_type" : checked.error === "empty" ? "file_empty" : "file_large");

  const rows = await loadPersonPage(env.DB, principal, personId);
  if (!rows) return intakeError("not_found");

  try {
    const ctx = await aiContextFor(principal.office.id);
    const proposal = await readIntake(rows, checked.file, ctx, { today: todayJst() });
    return Response.json(
      { ok: true, version: rows.person.version, kind: checked.file.kind, ...proposal },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const res = intakeErrorOf(e);
    if (res) return res;
    console.error("入れる欄の写真・PDF の読み取りに失敗", e instanceof Error ? e.name : typeof e);
    return intakeError("ai_failed");
  }
}
