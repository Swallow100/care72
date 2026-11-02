import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { createPersonRequest, jsonResponse } from "@/lib/office/http";

// 利用者追加（docs/tasks/T30.md）: 氏名・カナ・生年月日・性別・担当ケアマネで 1 人作り、本人のページの URL を返す。
// ケアマネの役だけ（管理者でなくても）。担当は同じ事業所のケアマネだけ。本人の経過と事業所の経過に「利用者追加」
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse({ status: 403, body: { ok: false, error: "forbidden", label: "権限なし" } });
  const { principal, env } = await principalFromRequest(request);
  const raw = await request.json().catch(() => null);
  return jsonResponse(await createPersonRequest(env.DB, principal, raw, { at: new Date().toISOString(), today: todayJst() }));
}
