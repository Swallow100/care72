import { principalFromRequest } from "@/lib/auth/server";
import { logGet } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// 手と出来事のログ（T110）。既定は CSV（訓練記録の紙と同じ行。UTF-8 の BOM・CRLF）、?judge=1 は自由対応の AI の判断の記録（伏せた入力と出力の要約）の JSON。
// 保存した物を読むだけで Claude を呼ばない。訓練の途中は、ケアマネが知り得ない出来事を出さない
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  return logGet(env.DB, principal, id, new URL(request.url), new Date().toISOString());
}
