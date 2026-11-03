import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { createLinkRequest } from "@/lib/survey/links";

// アンケートのリンクを作る（docs/tasks/T42.md）。事業所の画面から、ケアマネの役だけ。URL は要求の origin から作る
export async function POST(request: Request) {
  const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isSameOrigin(request)) return json(403, { ok: false, error: "forbidden", label: "権限なし" });
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  const out = await createLinkRequest(env.DB, principal, raw, new Date(), new URL(request.url).origin);
  return json(out.status, out.body);
}
