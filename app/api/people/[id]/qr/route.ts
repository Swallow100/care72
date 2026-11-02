import { isSameOrigin, seeOther } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { personInScope } from "@/lib/auth/scope";
import { principalFromRequest } from "@/lib/auth/server";
import { issueQr } from "@/lib/qr/store";

type Ctx = { params: Promise<{ id: string }> };

// QR を作る・作り直す（本人のページの書類の QR の画面から）。版を 1 つ上げ、前の版の QR を無効にする。
// ケアマネ（審査員のケアマネの役を含む）だけ。壁は本人のページと同じ（範囲の外は 404）。
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "save");
  if (no) return no;
  if (principal!.role !== "care_manager") return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
  const { id } = await params;
  const brief = await personInScope(env.DB, principal!, id);
  if (!brief) return Response.json({ error: "not_found", label: "対象なし" }, { status: 404 });
  await issueQr(env.DB, brief.id, new Date().toISOString());
  return seeOther(request, `/people/${encodeURIComponent(brief.id)}/forms/qr`);
}
