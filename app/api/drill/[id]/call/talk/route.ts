import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { drillTalkHook } from "@/lib/drill/hooks";
import { drillError } from "@/lib/drill/http";
import { callTalkPost } from "@/lib/drill/incoming-talk";

type Ctx = { params: Promise<{ id: string }> };

// 掛かってきた電話の往復（{ step: 読んだ今の刻み, actions: 読んだ手の数, signal: 着信の安否の id, ask?: 決まった問い, text?: 自由の 1 文, end?: true }、
// docs/tasks/T127.md）。今の刻みの応答した着信だけ、3 往復まで。1 往復は本人役（Haiku × 1 回、外へ掛けた電話の往復と同じ口）で、ケアマネの時計が 2 分進む。
// 自由の文は仮名化の門を通し、伏せきれなければ 400「伏字不可」。鍵が無ければ固定の言葉で往復を残す
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const hook = drillTalkHook(env, principal);
  return callTalkPost(env.DB, principal, id, json, hook ? { hook } : {});
}
