import { todayJst } from "@/lib/age";
import { principalFromRequest } from "@/lib/auth/server";
import { caseloadCsvResponse } from "@/lib/forms/caseload-csv";

// 担当一覧の CSV を落とす（T62。UTF-8 の BOM、CRLF。Excel でそのまま開ける）。
// URL の並びと絞込（sort・dir・color・area・mark・q）は担当一覧と同じ読み方で、今 画面に出ている行をその順で書く。
// ログインしていなければ 401、ケアマネの役でなければ 403、担当が無ければ 404（様式 9 の CSV と同じ）。中身は lib/forms/caseload-csv.ts
export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  return caseloadCsvResponse(env.DB, principal, new URL(request.url).searchParams, {
    today: todayJst(),
    now: new Date().toISOString(),
  });
}
