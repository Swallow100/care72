import { principalFromRequest } from "@/lib/auth/server";
import { replayGet } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// 再生の読み。保存した刻みから見る刻み（?step=）の状況・被害状況・左の表の色と順を返す。Claude を呼ばない
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  return replayGet(env.DB, principal, id, new URL(request.url).searchParams.get("step"));
}
