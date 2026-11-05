import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { todayJst } from "@/lib/age";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { mappingError } from "@/lib/forms/mapping-http";
import { reviewPost } from "@/lib/forms/review-post";

// 書類の紙の見直し（T136）。描く物（plan）・AI の見直し（run、塗った頁の JPEG）・再考（redo）・確認済（confirm）・直しを戻す（undo）。
// 中身は lib/forms/review-post.ts。ケアマネの役で自分の事業所の人だけ（範囲の外は 404）。AI を呼ぶ物は AI の権限と本人の AI 提供の同意
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mappingError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "ai");
  if (no) return no;
  return reviewPost(
    {
      db: env.DB,
      get: (key) => env.RECORDINGS.get(key),
      today: todayJst(),
      aiContext: aiContextFor,
    },
    principal,
    request,
  );
}
