import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { addCareManagerRequest, jsonResponse } from "@/lib/office/http";

// ケアマネ追加（docs/tasks/T30.md）: 名前と ID で 1 人足し、サーバーが作った初期パスワードを応答で 1 回だけ返す。
// 表にはハッシュだけ。平文はログに出さない（応答は no-store）。事業所の管理者だけ。事業所の経過に「ケアマネ追加」
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse({ status: 403, body: { ok: false, error: "forbidden", label: "権限なし" } });
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await addCareManagerRequest(env.DB, principal, raw, new Date().toISOString()));
}
