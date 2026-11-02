import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillHooks } from "@/lib/drill/hooks";
import { drillError, listGet, startPost } from "@/lib/drill/http";

// 訓練記録の一覧（事業所ごと）と、訓練の開始（大雨・地震・10 分版）。ケアマネの役だけ（審査員のケアマネの役も）。
// 開始は 0 時間の刻みまで当てて保存する。事業所に進行中があれば 409。鍵があれば 0 時間から本人役（T18）

export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  return listGet(env.DB, principal);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const json = await request.json().catch(() => null);
  return startPost(env.DB, principal, json, new Date().toISOString(), drillHooks(env, principal));
}
