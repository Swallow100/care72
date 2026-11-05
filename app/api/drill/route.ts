import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillStepHooks } from "@/lib/drill/hooks";
import { drillError, listGet, startPost } from "@/lib/drill/http";

// 訓練記録の一覧（事業所ごと）と、訓練の開始（大雨・地震・仮想。10 分版は T124 で外し、開始は 400。前からある記録は一覧に出る）。ケアマネの役だけ（審査員のケアマネの役も）。
// 開始は 0 時間の刻みまで当てて保存する。同じケアマネに進行中があれば 409（T70。24 時間たった進行中は一覧・開始で中断）。鍵があれば 0 時間から本人役（T18）

export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  return listGet(env.DB, principal, new Date().toISOString());
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const json = await request.json().catch(() => null);
  return startPost(env.DB, principal, json, new Date().toISOString(), drillStepHooks(env, principal));
}
