import { isSameOrigin, seeOther } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { PHONE_LINK_API_LABELS } from "@/lib/qr/phone-labels";
import { issuePhoneLinkFor, PHONE_LINK_ISSUE_STATUS } from "@/lib/qr/phone-link-http";

type Ctx = { params: Promise<{ id: string }> };

const LABELS = {
  login_required: "ログイン要",
  forbidden: PHONE_LINK_API_LABELS.forbidden,
  not_found: PHONE_LINK_API_LABELS.notFound,
  unlisted: PHONE_LINK_API_LABELS.unlisted,
  no_consent: PHONE_LINK_API_LABELS.noConsent,
} as const;

// スマホ入口を発行・再発行する（本人のページの書類の「スマホ入口」の画面から。docs/tasks/T69a.md）。
// 版を 1 つ上げ、前のリンクを全部無効にする。中身は lib/qr/phone-link-http.ts（ケアマネだけ、壁は本人のページと同じ、一覧外・同意なしは 409）。
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const r = await issuePhoneLinkFor(env.DB, principal, id, new Date().toISOString());
  if (!r.ok) return Response.json({ error: r.error, label: LABELS[r.error] }, { status: PHONE_LINK_ISSUE_STATUS[r.error] });
  return seeOther(request, `/people/${encodeURIComponent(r.personId)}/phone`);
}
