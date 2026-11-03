import { getCloudflareContext } from "@opennextjs/cloudflare";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { openPhoneLink } from "@/lib/qr/phone-open";

// D1 を毎回読む（版を表と比べる）
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

// 本人・家族のスマホ入口（docs/tasks/T69a.md）。ケアマネが本人のページの「スマホ入口」から出したリンク（/s/<token>）を開く口。
// ログインも新規登録も無い: リンクが通れば本人用は /me・家族用は /family のセッションを cookie に付けて 303、通らなければ /s/invalid。
// 中身は lib/qr/phone-open.ts（保存させない・Referer に載せない・検索に載せない見出しもそこで付ける）。Claude は呼ばない。
export async function GET(request: Request, { params }: Ctx) {
  const { token } = await params;
  const { env } = await getCloudflareContext({ async: true });
  return openPhoneLink(request, env.DB, sessionSecret(env), token, nowSec());
}
