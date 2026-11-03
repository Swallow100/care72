import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { FORM_FILE_MAX_BYTES } from "@/lib/forms/form-read";
import { intakeError, intakeErrorOf } from "@/lib/intake/http";
import { readIntake } from "@/lib/intake/read";
import { checkRedactedImage } from "@/lib/intake/read-check";
import { RAW_FILE_FIELD, READ_FORM, readMetaOf } from "@/lib/intake/read-form";
import { loadPersonPage } from "@/lib/person";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// 入れる欄の「写真・PDF を読む」（T45・T52）: ケアプラン・お薬手帳・紹介状などの写真・PDF の頁を、黒塗りの画面で
// 写った氏名・住所・電話・町名を塗った後の画像（JPEG、付け足しなし）で 1 枚受け取り、Opus が台帳の欄に分け、今の台帳と並べた差分を返す。
// 生の写真・PDF（前の file の欄・PDF・PNG・EXIF の付いた JPEG）は「未加工」で断る（lib/intake/read-form.ts）。
// 書かない（保存は /api/intake/save。経過の「写真を読んだ（隠した所 N か所）」は保存のときに）。画像は保存しない。
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
  if (!form) return intakeError("invalid");
  // 生の写真・PDF（黒塗りの画面を通っていない）は中身を見ずに断る
  if (form.has(RAW_FILE_FIELD)) return intakeError("not_redacted");
  const personId = form.get(READ_FORM.personId);
  const image = form.get(READ_FORM.image);
  const meta = readMetaOf(form);
  if (typeof personId !== "string" || !ID.test(personId) || !image || typeof image === "string") return intakeError("invalid");
  if (!meta) return intakeError("not_redacted");
  if (image.size > FORM_FILE_MAX_BYTES) return intakeError("file_large");
  const checked = checkRedactedImage(new Uint8Array(await image.arrayBuffer()));
  if (!checked.ok) return intakeError(checked.error);

  const rows = await loadPersonPage(env.DB, principal, personId);
  if (!rows) return intakeError("not_found");

  try {
    const ctx = await aiContextFor(principal.office.id);
    const proposal = await readIntake(rows, checked.file, ctx, { today: todayJst() });
    return Response.json(
      { ok: true, version: rows.person.version, read: meta, ...proposal },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const res = intakeErrorOf(e);
    if (res) return res;
    console.error("入れる欄の写真・PDF の読み取りに失敗", e instanceof Error ? e.name : typeof e);
    return intakeError("ai_failed");
  }
}
