import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillTalkHook } from "@/lib/drill/hooks";
import { drillError } from "@/lib/drill/http";
import { talkPost } from "@/lib/drill/talk";

type Ctx = { params: Promise<{ id: string }> };

// 通話の往復（{ step: 読んだ今の刻み, actions: 読んだ手の数, action: 手の番号, ask?: 決まった問い, text?: 自由の 1 文, end?: true }、docs/tasks/T93.md）。
// 電話に出て言葉があった最新の手だけ、3 往復まで。1 往復は本人役（Haiku × 1 回）で、ケアマネの時計が 2 分進む。
// 自由の文は仮名化の門を通し、伏せきれなければ 400「伏字不可」。鍵が無ければ固定の言葉で往復を残す
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const hook = drillTalkHook(env, principal);
  return talkPost(env.DB, principal, id, json, hook ? { hook } : {});
}
