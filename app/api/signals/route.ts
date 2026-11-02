import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { signalError, signalPost } from "@/lib/signals/http";

// 本人のスマホの信号（無事・無事じゃない と答え）。役「本人のスマホ」だけ。本人の id と出どころはログインから決める。
// 災害モードの間だけ受ける（平時は 409）。送り直し（同じ id）は重ねない。保存すると担当一覧の色がルールの表で変わる
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const json = await request.json().catch(() => null);
  return signalPost(env.DB, principal, json, new Date().toISOString());
}
