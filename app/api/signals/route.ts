import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { signalError, signalPost } from "@/lib/signals/http";

// 本人・家族のスマホの信号（無事・無事じゃない と答え。家族は 分からない も）。役「本人のスマホ」「家族のスマホ」だけ。
// 本人の id と出どころはログインから決める（家族はログインの連絡先の行から）。
// 災害モードの間だけ受ける（平時は 409）。送り直し（同じ id）は重ねない。保存すると担当一覧の色がルールの表で変わる
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const json = await request.json().catch(() => null);
  return signalPost(env.DB, principal, json, new Date().toISOString());
}
