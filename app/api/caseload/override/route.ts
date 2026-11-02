import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { listError, overridePost } from "@/lib/list/http";

// ケアマネの上書き（担当一覧の行の詳細の「優先修正」）。表の色を上げる・下げる（理由が要る）、解除。経過に残る。
// ケアマネの役だけ、事業所の中の本人だけ、災害モードの間だけ。上書きしたときの表の色はサーバーで決める
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return listError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const json = await request.json().catch(() => null);
  return overridePost(env.DB, principal, json, new Date().toISOString());
}
