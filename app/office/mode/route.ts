import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { nowSec } from "@/lib/auth/session";
import { modePostEntered, outcomeResponse } from "@/lib/disaster/http";
import { officeSafety } from "@/lib/push/http";
import { loadVapid } from "@/lib/push/vapid";

// 災害モードの切替（フォームの POST）。大雨・地震・平時に戻す（確認の欄から）。切り替えた人と時刻が事業所の経過に残る。
// ケアマネの役だけ（管理者でなくても押せる）。行政・医療班・本人・家族は 403、ログインしていなければ 401
// 平時から災害モードに入ったら、応答のあとに本人・家族のスマホへ「大丈夫ですか」の通知を送る（T149。鍵が無ければ送らない）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const form = await request.formData().catch(() => null);
  const { outcome, entered } = await modePostEntered(env.DB, principal, form, new Date().toISOString());
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
