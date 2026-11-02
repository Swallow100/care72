import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse, releaseRequest } from "@/lib/custody/http";

// 搬送・退所（受け持ちを閉じる。docs/tasks/T23.md）。本人の経過に「搬送 行き先」か「退所」、第三者提供の記録を閉じる。
// 自分の受け持ちだけ。行政・医療班だけ
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await releaseRequest(env.DB, principal, raw, new Date().toISOString()));
}
