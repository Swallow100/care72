import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { memoEditPost, signalError } from "@/lib/signals/http";

type Ctx = { params: Promise<{ id: string }> };

// 聞き取りの欄（T49）をケアマネが直す。直した欄は人の値になり AI の印が外れる。経過に「聞き取り修正 …」。
// 色と順は変わらない（聞き取りはルールの表に渡さない）。ケアマネの役だけ。事業所の外の信号は 404
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return memoEditPost(env.DB, principal, id, json, new Date().toISOString());
}
