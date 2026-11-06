import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { nowSec } from "@/lib/auth/session";
import { PUSH_ERROR_STATUS, safetyPost } from "@/lib/push/http";
import { safetyLabel } from "@/lib/push/view";
import { loadVapid } from "@/lib/push/vapid";

type Ctx = { params: Promise<{ id: string }> };

// 担当一覧の行の「安否確認」（docs/tasks/T149.md）。本人と家族のスマホへ「大丈夫ですか」の通知を送る。
// ケアマネの役だけ、壁の中の本人だけ、災害モードの間だけ、同じ人へ 1 分に 1 回。鍵（VAPID）が無ければ送らず「通知 未設定」。
// 中身は lib/push/http.ts。通知の文は固定で名前を入れない。色と連絡順には触れない。
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const r = await safetyPost(env.DB, await loadVapid(env), fetch, principal, id, nowSec());
  const label = safetyLabel(r);
  if (!r.ok) return Response.json({ error: r.error, label }, { status: PUSH_ERROR_STATUS[r.error] });
  return Response.json({ ok: true, sent: r.sent, total: r.total, label }, { headers: { "Cache-Control": "no-store" } });
}
