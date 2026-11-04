import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { evacRoute, evacRouteResponse, EvacRouteRequestSchema } from "@/lib/map/route-api";

// 避難経路（T102）: 家（台帳の位置）から避難先への経路を openrouteservice で引く。経路地図の画面の「経路作成」を押したときだけ。
// ケアマネの役だけ。外へ送るのは 2 点の座標と手段だけ。鍵（ORS_API_KEY）が無い・失敗したときは理由の印を返し、画面は手入力の線に戻る
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return evacRouteResponse({ ok: false, error: "forbidden" });
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "save");
  if (no) return no;
  if (!principal) return evacRouteResponse({ ok: false, error: "forbidden" });

  const body = EvacRouteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return evacRouteResponse({ ok: false, error: "invalid" });
  return evacRouteResponse(await evacRoute(env.DB, principal, body.data, env.ORS_API_KEY));
}
