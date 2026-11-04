// 避難経路の API の中身（T102、app/api/evac-route）。経路地図の画面の「経路作成」が呼ぶ。
// - ケアマネの役だけ。本人は personInScope を通した事業所の中の人だけ（lib/person.ts の loadPersonPage）
// - 家の位置はブラウザから受け取らず、台帳（basic.location）から読む。避難先はまだ保存していない位置でも引けるよう要求から受け、
//   家から ROUTE_MAX_KM の中だけ（鍵の枠をほかの点で使わせない）
// - 外へ送るのは家（約 150 m の格子に丸めた点）と避難先の座標と手段だけ（lib/map/route.ts の fetchRoute）。氏名・住所・台帳は読んでも送らない
// - 応答は線と長さと時間、または理由の印だけ（外の返事の文・鍵は返さない）

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { ROUTE_MODES } from "../db/types.ts";
import { ROUTE_LABELS } from "../labels.ts";
import { loadPersonPage } from "../person.ts";
import { isGeoPoint } from "./geo.ts";
import { fetchRoute, withinReach, type RouteFailure, type RouteResult } from "./route.ts";

export const EvacRouteRequestSchema = z.object({
  personId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  to: z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }),
  mode: z.enum(ROUTE_MODES),
});
export type EvacRouteRequest = z.output<typeof EvacRouteRequestSchema>;

/** 要求の断り: 該当なし・権限なし・家の位置が無い・避難先が遠すぎ */
export type EvacRouteRefusal = "not_found" | "forbidden" | "no_home" | "too_far";
export type EvacRouteResult = RouteResult | { ok: false; error: EvacRouteRefusal };

/** 経路を引く。fetch はテストで偽の物を渡す */
export async function evacRoute(
  db: D1Database,
  principal: Principal,
  req: EvacRouteRequest,
  key: string | undefined,
  fetchImpl?: typeof fetch,
): Promise<EvacRouteResult> {
  if (principal.role !== "care_manager") return { ok: false, error: "forbidden" };
  const rows = await loadPersonPage(db, principal, req.personId);
  if (!rows) return { ok: false, error: "not_found" };
  const home = parseLedger(rows.person.ledger).basic.location;
  if (!isGeoPoint(home)) return { ok: false, error: "no_home" };
  if (!withinReach(home, req.to)) return { ok: false, error: "too_far" };
  // 家は fetchRoute が格子に丸めてから送る（正確な家の座標は外へ出さない）
  return fetchRoute({ key, home, to: req.to, mode: req.mode, fetch: fetchImpl });
}

const STATUS: Record<EvacRouteRefusal | RouteFailure | "invalid", number> = {
  not_found: 404,
  forbidden: 403,
  no_home: 422,
  too_far: 422,
  invalid: 400,
  // 経路の失敗は要求の誤りではない（画面は手入力の線に戻る）ので 200 で理由を返す
  no_key: 200,
  no_route: 200,
  limit: 200,
  failed: 200,
};

const LABELS: Record<EvacRouteRefusal | RouteFailure | "invalid", string> = {
  not_found: "該当なし",
  forbidden: "権限なし",
  no_home: ROUTE_LABELS.noHome,
  too_far: ROUTE_LABELS.too_far,
  invalid: "形が違う",
  no_key: ROUTE_LABELS.no_key,
  no_route: ROUTE_LABELS.no_route,
  limit: ROUTE_LABELS.limit,
  failed: ROUTE_LABELS.failed,
};

/** 応答（失敗は種類と画面の言葉だけ） */
export function evacRouteResponse(r: EvacRouteResult | { ok: false; error: "invalid" }): Response {
  const headers = { "Cache-Control": "no-store" };
  if (r.ok) return Response.json(r, { headers });
  return Response.json({ ok: false, error: r.error, label: LABELS[r.error] }, { status: STATUS[r.error], headers });
}
