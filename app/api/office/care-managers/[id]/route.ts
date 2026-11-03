import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { careManagerActionRequest, jsonResponse } from "@/lib/office/http";

type Ctx = { params: Promise<{ id: string }> };

// ケアマネの改名・管理者の付け外し・停止と再開・パスワードの再発行（docs/tasks/T61.md）。事業所の管理者だけ。
// JSON { action: "rename" | "admin" | "disable" | "reset_password", displayName?, admin?, disabled? }。
// 種のデモ事業所のアカウント（山本・審査員）は 403 fixed。再発行の平文は応答にだけ入る（no-store。ログに出さない）
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return jsonResponse({ status: 403, body: { ok: false, error: "forbidden", label: "権限なし" } });
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const raw = await request.json().catch(() => null);
  return jsonResponse(await careManagerActionRequest(env.DB, principal, id, raw, new Date().toISOString()));
}
