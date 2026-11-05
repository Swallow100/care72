import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { PHONE_ACCOUNT_STATUS, savePhoneAccount } from "@/lib/phone/account";
import { phoneAccountErrorWords } from "@/lib/phone/labels";

// 本人・家族のスマホの ID とパスワード（docs/tasks/T149.md）。スマホ入口のリンクで開いた本人・家族が、その場で作る（作り直す）。
// 中身は lib/phone/account.ts（リンクのセッションだけ、同意の決まり、ID とパスワードの決まり、ケアマネの ID とも重ならない）。
// 平文のパスワードは表・ログ・応答に出さない。応答は作った ID と、断りの理由の言葉（やさしい日本語）だけ。
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const r = await savePhoneAccount(
    env.DB,
    principal,
    { loginId: body?.loginId, password: body?.password, password2: body?.password2 },
    new Date().toISOString(),
  );
  if (!r.ok) {
    return Response.json(
      { error: r.error, words: phoneAccountErrorWords(r.error, r.problems) },
      { status: PHONE_ACCOUNT_STATUS[r.error], headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json({ ok: true, loginId: r.loginId, created: r.created }, { headers: { "Cache-Control": "no-store" } });
}
