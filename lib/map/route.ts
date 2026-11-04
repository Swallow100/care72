// 避難経路（T102）。openrouteservice（OpenStreetMap の道で経路を引く外のサービス、HeiGIT）で、家から避難先への経路を引く。
// - 外へ送るのは 2 点の座標（経度・緯度）と手段（URL の徒歩・車）だけ。氏名・住所・町名・避難先の名前・台帳は送らない。
//   家の位置はサーバーが台帳から読み（app/api/evac-route/route.ts）、避難先は家から ROUTE_MAX_KM の中だけ
// - 鍵は Cloudflare の secret の ORS_API_KEY。無いとき・失敗したとき（上限・経路なし・時間切れ）は投げずに理由を返し、
//   画面は家・経由の点・避難先を直線で結ぶ形（handLine）に戻る
// - 外の返事の文はそのまま画面に出さない（理由の印だけ）。鍵は応答・ログに出さない
// - 引くのはケアマネが「経路作成」を押したときだけ。引いた線は台帳に残し（RouteMap）、紙に刷るたびに外へ要求しない
// 利用の条件（無料の枠・出典・結果の使い方）と確かめた日は docs/progress/t102.md。
// 要求の形は公式の JS の道具（GIScience/openrouteservice-js）と同じ: POST {host}/v2/directions/{profile}/geojson、
// 見出し Authorization に鍵、本文 coordinates は [経度, 緯度] の並び。

import * as z from "zod";
import type { GeoPoint, RouteMode } from "../db/types.ts";
import { roundPoint } from "./center.ts";
import { isGeoPoint } from "./geo.ts";
import type { Attribution } from "./layers.ts";

export const ORS_HOST = "https://api.openrouteservice.org";

/** 手段 → openrouteservice の profile */
export const ORS_PROFILES: Record<RouteMode, string> = { foot: "foot-walking", car: "driving-car" };

/** 出典の表記（HeiGIT の利用規約の Attribution and License の文のまま）。地図の枠の中の下に出す */
export const ORS_ATTRIBUTION: Attribution = {
  text: "© openrouteservice by HeiGIT | Data from OpenStreetMap",
  href: "https://account.heigit.org/info/tos",
};

/** 外の要求の時間の上限（ms） */
export const ROUTE_TIMEOUT_MS = 8000;

/** 家から避難先までの直線の上限（km）。これより遠い点は外へ送らない（鍵の枠を外の点で使わせない） */
export const ROUTE_MAX_KM = 30;

/** 台帳に残す線の点の数の上限 */
export const LINE_MAX_POINTS = 400;

/** 失敗の理由: 鍵なし・経路なし（道が見つからない・点が道から遠い）・上限（1 日・1 分の枠）・失敗（時間切れ・そのほか） */
export const ROUTE_FAILURES = ["no_key", "no_route", "limit", "failed"] as const;
export type RouteFailure = (typeof ROUTE_FAILURES)[number];

export type RouteResult = { ok: true; line: GeoPoint[]; distanceM: number; durationS: number } | { ok: false; error: RouteFailure };

/**
 * 台帳の「手段」の文字から手段を決める。車（娘の車・家族の車）は車、ほかと空は徒歩。
 * 車いす・車椅子は徒歩の道（歩道）を使うので徒歩
 */
export function modeOf(transport: string | undefined | null): RouteMode {
  const t = (transport ?? "").replace(/車いす|車椅子|車イス/g, "");
  return t.includes("車") ? "car" : "foot";
}

/** 外へ送る要求（URL・見出し・本文）。本文は 2 点の座標と instructions（道順の文は要らない）だけ */
export function orsRequest(from: GeoPoint, to: GeoPoint, mode: RouteMode, key: string): { url: string; init: RequestInit } {
  const body = {
    coordinates: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    instructions: false,
  };
  return {
    url: `${ORS_HOST}/v2/directions/${ORS_PROFILES[mode]}/geojson`,
    init: {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/geo+json, application/json" },
      body: JSON.stringify(body),
    },
  };
}

const Position = z.array(z.number()).min(2);
const OrsGeoJson = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(Position).min(2) }),
        properties: z
          .object({ summary: z.object({ distance: z.number().optional(), duration: z.number().optional() }).optional() })
          .optional(),
      }),
    )
    .min(1),
});
const OrsError = z.object({ error: z.union([z.object({ code: z.number() }), z.string()]) });

/** 経路が見つからない・点が道から遠い・距離が上限の外（openrouteservice の内部の番号） */
const NO_ROUTE_CODES = new Set([2004, 2009, 2010]);

/** 返事の本文 → 結果。形が違えば失敗。[経度, 緯度] を { lat, lng } に戻す */
export function parseOrs(status: number, json: unknown): RouteResult {
  if (status === 429 || status === 403) return { ok: false, error: "limit" };
  if (status !== 200) {
    const e = OrsError.safeParse(json);
    if (e.success && typeof e.data.error === "object" && NO_ROUTE_CODES.has(e.data.error.code)) return { ok: false, error: "no_route" };
    return { ok: false, error: "failed" };
  }
  const r = OrsGeoJson.safeParse(json);
  if (!r.success) return { ok: false, error: "failed" };
  const f = r.data.features[0];
  const line = f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  if (!line.every(isGeoPoint)) return { ok: false, error: "failed" };
  const simple = simplifyLine(line);
  const s = f.properties?.summary;
  return { ok: true, line: simple, distanceM: Math.round(s?.distance ?? lineLength(line)), durationS: Math.round(s?.duration ?? 0) };
}

/**
 * 経路を引く。鍵が無ければ外へ要求しない（no_key）。投げない（時間切れ・通信の失敗も failed）。
 * fetch はテストで偽の物を渡す（本物の openrouteservice はテストで呼ばない）
 */
export async function fetchRoute(args: {
  key: string | undefined;
  from: GeoPoint;
  to: GeoPoint;
  mode: RouteMode;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<RouteResult> {
  const key = args.key?.trim();
  if (!key) return { ok: false, error: "no_key" };
  if (!isGeoPoint(args.from) || !isGeoPoint(args.to)) return { ok: false, error: "failed" };
  const { url, init } = orsRequest(roundPoint(args.from), roundPoint(args.to), args.mode, key);
  const doFetch = args.fetch ?? fetch;
  try {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(args.timeoutMs ?? ROUTE_TIMEOUT_MS) });
    const json: unknown = await res.json().catch(() => null);
    return parseOrs(res.status, json);
  } catch {
    return { ok: false, error: "failed" };
  }
}

// ---------- 線の計算 ----------

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 2 点の間の長さ（m、大円） */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 線の長さ（m） */
export function lineLength(line: ReadonlyArray<GeoPoint>): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += distanceM(line[i - 1], line[i]);
  return m;
}

/** 避難先が家から ROUTE_MAX_KM の中か */
export function withinReach(home: GeoPoint, dest: GeoPoint): boolean {
  return distanceM(home, dest) <= ROUTE_MAX_KM * 1000;
}

/** 手で引く線: 家 → 経由の点 → 避難先 */
export function handLine(home: GeoPoint, via: ReadonlyArray<GeoPoint>, dest: GeoPoint): GeoPoint[] {
  return [home, ...via, dest];
}

/**
 * 線を間引く（Douglas-Peucker。点から線までの離れが toleranceM 以下の点を落とす）。
 * それでも max を超えれば許す離れを倍にしてやり直す。点は 5 桁（約 1 m）に丸める。両端は残す
 */
export function simplifyLine(line: ReadonlyArray<GeoPoint>, toleranceM = 3, max = LINE_MAX_POINTS): GeoPoint[] {
  if (line.length <= 2) return line.map(roundPoint);
  // 平らに広げた m の座標（線の真ん中の緯度で経度を縮める）
  const lat0 = rad(line.reduce((s, p) => s + p.lat, 0) / line.length);
  const xy = line.map((p) => ({ x: rad(p.lng) * Math.cos(lat0) * EARTH_M, y: rad(p.lat) * EARTH_M }));
  let tol = toleranceM;
  for (;;) {
    const keep = new Array<boolean>(line.length).fill(false);
    keep[0] = keep[line.length - 1] = true;
    const stack: Array<[number, number]> = [[0, line.length - 1]];
    while (stack.length > 0) {
      const [a, b] = stack.pop()!;
      let far = -1;
      let farD = tol;
      for (let i = a + 1; i < b; i++) {
        const d = segmentDistance(xy[i], xy[a], xy[b]);
        if (d > farD) {
          far = i;
          farD = d;
        }
      }
      if (far >= 0) {
        keep[far] = true;
        stack.push([a, far], [far, b]);
      }
    }
    const out = line.filter((_, i) => keep[i]).map(roundPoint);
    if (out.length <= max) return out;
    tol *= 2;
  }
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
