import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillFreeHook, planFree } from "@/lib/drill/free-action";
import { drillError, freePost } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// 自由対応を打つ前の読み替え（T110。{ step, actions, person, text }）。鍵があれば監督役（Opus × 1 回）が、表の手かそのままの手に読み替え、
// 相手・所要・押せない理由を返す。確かめは訓練に置き、同じ文と本人で手の POST（kind free）を送ると Claude を呼ばずに打つ。
// 鍵が無ければ読み替えずに記録。伏せきれない文は 400「伏字不可」（Claude に送らない）。読んだ刻み・手の数と違えば 409
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const free = drillFreeHook(env, principal);
  return freePost(env.DB, principal, id, json, (state, input) => planFree({ ...state, participants: state.participants }, input, free));
}
