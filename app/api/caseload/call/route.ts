import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { callPost, listError } from "@/lib/list/http";

// 電話の記録（担当一覧の行の詳細の電話のボタンと「不通」）。押した事実を本人の経過に残す。電話そのものは tel: のリンク
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return listError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const json = await request.json().catch(() => null);
  return callPost(env.DB, principal, json, new Date().toISOString());
}
