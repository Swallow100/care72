import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { answersPost, signalError } from "@/lib/signals/http";

type Ctx = { params: Promise<{ id: string }> };

// 赤のあとの聞き取りの答え（T49）。本人・家族のスマホが押すたびに、それまでの答えの全部を送る（後勝ち）。
// 答えは信号の answers に、今の 4 問の列にも同じ値（ルールの表が読むのは 4 つの列だけ。ほかの答えは色と順に使わない）。
// 書けるのは自分が送った赤の信号だけ。災害モードの間だけ（平時は 409）
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return answersPost(env.DB, principal, id, json);
}
