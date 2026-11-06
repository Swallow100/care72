import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { nowSec } from "@/lib/auth/session";
import { outcomeResponse } from "@/lib/disaster/http";
import { officeSafety } from "@/lib/push/http";
import { loadVapid } from "@/lib/push/vapid";
import { startPost } from "@/lib/seed/http";

// 種の事業所（デモ・確認用）の「発災開始」（フォームの POST、T153）。平時から大雨の想定（警戒レベル 4・浸水 3 m の町で停電・山田の赤）に入る。
// ケアマネの役（審査員 3 つと確認用の山本）だけ。ほかの事業所・行政・医療班・本人・家族は 403、ログインしていなければ 401。
// 入ったら、応答のあとに本人・家族のスマホへ「大丈夫ですか」の通知を送る（T149 の app/office/mode と同じ。鍵が無ければ送らない）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  const { outcome, entered } = await startPost(env.DB, env.RECORDINGS, principal, form, new Date().toISOString());
  if (entered) {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(
      (async () => officeSafety(env.DB, await loadVapid(env), fetch, entered, nowSec()))().catch(() => {
        // 送れなくても切替は済んでいる（本人・家族の頁は 30 秒ごとの読み直しで 2 つのボタンに替わる）
      }),
    );
  }
  return outcomeResponse(request, outcome);
}
