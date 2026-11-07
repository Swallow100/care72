import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillStepHooks } from "@/lib/drill/hooks";
import { drillError, stepPost } from "@/lib/drill/http";
import { personReviewsAfterStep } from "@/lib/drill/record-http";

type Ctx = { params: Promise<{ id: string }> };

// 1 刻みだけ進める（{ step: 画面で読んだ今の刻み }）。1 要求で全刻みを回さない（早送りもブラウザから 1 刻みずつ）。
// 読んだ刻みと違えば 409（二度押し・早送りの重なり）、終わった訓練は 409。
// 鍵があれば本人役（Haiku × 参加者、T18）を渡す。無ければ想定の表の固定の安否。
// 進めたあと、まだ続く訓練なら、流れの落ち着いた人の講評（T185、Haiku）を応答のあとに作る（waitUntil。進める操作を待たせない）。
// 終わった刻みでは作らない（終わりの講評が全体と並べて作る）
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const res = await stepPost(env.DB, principal, id, json, new Date().toISOString(), drillStepHooks(env, principal));
  if (res.ok) {
    const body = (await res.clone().json().catch(() => null)) as { status?: string } | null;
    if (body?.status === "running") {
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(personReviewsAfterStep(env, principal, id).catch((e) => console.error("人ごとの講評", e instanceof Error ? e.name : typeof e)));
    }
  }
  return res;
}
