import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse, searchRequest } from "@/lib/custody/http";

// 受入の入口: 氏名・カナ・生年月日の検索（docs/tasks/T23.md）。事業所をまたぐ。行政・医療班だけ。
// 検索の言葉は本文（JSON）で受け取り、URL に載せない。ヒットはカナ・生年月日・年齢だけ（住所・電話・漢字の氏名なし）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await searchRequest(env.DB, principal, raw, todayJst()));
}
