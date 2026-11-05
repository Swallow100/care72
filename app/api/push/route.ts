import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { PUSH_ERROR_STATUS, subscribePost, unsubscribePost, type PushError } from "@/lib/push/http";
import { PUSH_LABELS } from "@/lib/push/labels";

// 「大丈夫ですか」の通知の購読（docs/tasks/T149.md）。本人・家族の頁で通知を許可した端末が、ブラウザの購読（PushSubscription の JSON）を送る。
// POST は入れる（同じ endpoint は後勝ち。開くたびに送り直す）、DELETE は外す。本人・家族の役だけ（本人・連絡先はセッションから）。
// 中身は lib/push/http.ts。送り先は Web Push の事業者の https の宛先だけ（lib/push/subscription.ts）。

const LABELS: Record<PushError, string> = {
  login_required: PUSH_LABELS.loginRequired,
  forbidden: PUSH_LABELS.forbidden,
  invalid: PUSH_LABELS.invalid,
  not_found: PUSH_LABELS.notFound,
};

async function handle(request: Request, run: typeof subscribePost | typeof unsubscribePost) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const body = await request.json().catch(() => null);
  const r = await run(env.DB, principal, body, new Date().toISOString());
  if (!r.ok) return Response.json({ error: r.error, label: LABELS[r.error] }, { status: PUSH_ERROR_STATUS[r.error] });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  return handle(request, subscribePost);
}

export async function DELETE(request: Request) {
  return handle(request, unsubscribePost);
}
