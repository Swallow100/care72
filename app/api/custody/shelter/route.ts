import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse, shelterRequest } from "@/lib/custody/http";

// 受入の入口: 避難所の名前で絞った一覧（既に誰かが受け入れた人。docs/tasks/T23.md）。行政・医療班だけ。
// ヒットはカナ・生年月日・年齢だけ
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await shelterRequest(env.DB, principal, raw, todayJst()));
}
