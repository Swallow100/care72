import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { fail, jsonResponse, registerRequest } from "@/lib/custody/http";

// 新規登録（台帳に無い人をその場で。docs/tasks/T23.md）。氏名・カナ・年齢か生年月日・薬・機器・連絡先・避難所。
// 事業所は所属なし。登録した人の受け持ちに入る。行政・医療班だけ
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse(fail("forbidden"));
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await registerRequest(env.DB, principal, raw, { at: new Date().toISOString(), today: todayJst() }));
}
