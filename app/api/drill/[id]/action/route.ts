import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillStepHooks } from "@/lib/drill/hooks";
import { actionPost, drillError } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// ケアマネの手を 1 つ打つ（{ step: 読んだ今の刻み, actions: 読んだ手の数, kind, person, target }、docs/tasks/T20.md）。
// 読んだ刻み・手の数と違えば 409（二度押し・ほかの画面）、終わった訓練は 409。相手は台帳の連絡先から決める。
// 手の途中で次の刻みの時刻を越えたら、その刻みも進める（鍵があれば監督と本人役。無ければ想定の表の固定の状況と安否）。
// 電話に出た人の言う事は、鍵があれば本人役（Haiku × 1 回）、無ければ固定の言葉
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const hooks = drillStepHooks(env, principal);
  return actionPost(env.DB, principal, id, json, new Date().toISOString(), hooks ? { hooks } : {});
}
