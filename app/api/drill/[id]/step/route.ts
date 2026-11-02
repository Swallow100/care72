import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillHooks } from "@/lib/drill/hooks";
import { drillError, stepPost } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// 1 刻みだけ進める（{ step: 画面で読んだ今の刻み }）。1 要求で全刻みを回さない（早送りもブラウザから 1 刻みずつ）。
// 読んだ刻みと違えば 409（二度押し・早送りの重なり）、終わった訓練は 409。
// 鍵があれば本人役（Haiku × 参加者、T18）を渡す。無ければ想定の表の固定の安否
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return stepPost(env.DB, principal, id, json, new Date().toISOString(), drillHooks(env, principal));
}
