import { todayJst } from "@/lib/age";
import { principalFromRequest } from "@/lib/auth/server";
import { staffCsvResponse } from "@/lib/forms/staff-csv";

// 受け持ちの CSV を落とす（T62）。自分のアカウントが受け入れた人を全員、表の順（連絡順）で。
// 理由と医療の列は同意の範囲の濾しが入ったまま（lib/custody/board.ts）。
// ログインしていなければ 401、医療班・行政の役でなければ 403。中身は lib/forms/staff-csv.ts
export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  return staffCsvResponse(env.DB, principal, { today: todayJst(), now: new Date().toISOString() });
}
