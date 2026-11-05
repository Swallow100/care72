import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { assetsGet, assetsPost } from "@/lib/forms/form-assets";

// 事業所が紙に置く画像（T135）。一覧と取り込み。中身は lib/forms/form-assets.ts（Claude には送らない）
export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  return assetsGet(env.DB, principal);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ ok: false, label: "権限なし" }, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, label: "形式不正" }, { status: 400 });
  return assetsPost(env.DB, { put: (key, value, options) => env.RECORDINGS.put(key, value, options) }, principal, form);
}
