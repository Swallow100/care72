import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PhoneLinkSwitch } from "@/components/phone/PhoneLinkPanel";
import { Page } from "@/components/ui/Panel";
import { getPrincipal } from "@/lib/auth/server";
import { ADMIN_LABEL, homePath, JUDGE_LABEL, ROLE_LABELS } from "@/lib/auth/roles";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { PHONE_LINK_LABELS } from "@/lib/qr/phone-labels";
import { PHONE_LINK_INVALID_PATH } from "@/lib/qr/phone-link";
import { resolvePhoneLink } from "@/lib/qr/phone-link-store";
import { linkReplacesLogin, phoneLinkOpenPath } from "@/lib/qr/phone-open";

// D1 と今のログインを毎回読む
export const dynamic = "force-dynamic";

// トークンを持った URL なので、検索に載せず Referer にも載せない
export const metadata: Metadata = {
  title: `${PHONE_LINK_LABELS.loggedIn} | ケア72`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

// スマホ入口のリンクを、ケアマネ・行政・医療班・審査員のログイン中の端末で開いたときの 1 枚（設計の答え 11/4。docs/progress/t69a.md）。
// 黙って替えない: 「切替」で今のログインを終えて本人・家族の頁を開く（POST /s/<token>）、「戻る」で今の役の入口へ。誰のリンクかは出さない。
// リンクが通らなければ無効の頁へ、ログインしていない・本人・家族のログインならこの 1 枚を出さずにそのまま開く（/s/<token>）。
export default async function PhoneLinkSwitchPage({ params }: Props) {
  const { token } = await params;
  const { env } = await getCloudflareContext({ async: true });
  if (!(await resolvePhoneLink(env.DB, sessionSecret(env), token, nowSec()))) redirect(PHONE_LINK_INVALID_PATH);
  const principal = await getPrincipal();
  if (!principal || !linkReplacesLogin(principal)) redirect(phoneLinkOpenPath(token));
  const role = principal.admin ? ADMIN_LABEL : ROLE_LABELS[principal.role];
  const who = [principal.judge ? JUDGE_LABEL : null, role, principal.displayName].filter(Boolean).join(" ");
  return (
    <Page width="text">
      <PhoneLinkSwitch token={token} who={who} back={homePath(principal.role)} />
    </Page>
  );
}
