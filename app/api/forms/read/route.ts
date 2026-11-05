import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { formsScope } from "@/lib/forms/mapping-db";
import { mappingError } from "@/lib/forms/mapping-http";
import { formReadPost } from "@/lib/forms/read-post";
import { FORM_READ_BODY_MAX_BYTES } from "@/lib/forms/read-upload";

// 様式の読み取り: 空の様式の写真・PDF を、黒塗りの画面（components/person/RedactSheet.tsx）を通した頁の画像（JPEG、付け足しなし）で
// 頁の順に 1〜10 枚受け取り（T146。頁の画像の合計は 16 MB まで）、Opus に欄と台帳の項目の対応表（T86 から欄ごとの値の場所と書体も）を出させ、下書きで保存する。
// 中身（印と画像の確かめ → 同じ画像の見分け → Opus 1 回 → 保存 → 頁の画像を R2 に置く）は lib/forms/read-post.ts。
// ケアマネの役だけ（管理者・審査員のケアマネの役を含む）。範囲は事業所。Claude は頁ごとに 1 回（同時に 5 頁まで並べる）。
// Claude に渡すのは塗った後の頁の画像と台帳の項目表（値は無い）だけ。台帳の値・氏名は渡さない
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mappingError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "ai");
  if (no) return no;
  const scope = formsScope(principal);
  if (!scope) return mappingError("forbidden");

  // 読む前に大きさで断る（頁の画像の合計の上限・頁の印刷の字の位置・multipart の枠。T146）
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > FORM_READ_BODY_MAX_BYTES) return mappingError("file_large");
  const form = await request.formData().catch(() => null);
  if (!form) return mappingError("invalid");

  return formReadPost(
    {
      db: env.DB,
      bucket: {
        put: (key, value, options) => env.RECORDINGS.put(key, value, options),
        get: (key) => env.RECORDINGS.get(key),
      },
      aiContext: aiContextFor,
    },
    scope,
    form,
  );
}
