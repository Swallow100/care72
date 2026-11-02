import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse, receiveRequest } from "@/lib/custody/http";

// 受入（検索・避難所の一覧から。docs/tasks/T23.md）。受け持ち・本人の経過「受入 避難所」・第三者提供の記録を書く。
// 行政・医療班だけ。QR の頁からはフォームの POST（/staff/receive）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await receiveRequest(env.DB, principal, raw, new Date().toISOString()));
}
