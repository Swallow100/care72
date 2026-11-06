// 仮想モードの開始の時に、事業所の周りの公的なデータを読む（T170）。Workers の中で 1 回だけ、結果は drills.world に写す（刻みごとに読まない）。Claude を呼ばない。
//
// - 外へ出るのはタイルの z/x/y だけ（本人の座標・住所・氏名を要求に入れない。lib/map/shelters.ts と同じ決め。もっと細かいズームの z/x/y は地図が前から読む）
//   - 指定避難所: 地理院の sih・sfh（ズーム 10、約 30 km の四角）。形と利用の条件は lib/map/shelters.ts（T112）。データを落として置かない
//   - 川の注記: 地理院の experimental_anno（ズーム 15、約 1 km の四角）。デモ事業所は確かめた表があるので読まない
// - 読めなければ（時間切れ・形の違い）その分は無しで、地理は一般の言い方のまま。訓練の開始を止めない
// - 名前は門（formLeaks）に引っかかる形を外す。部屋への文が止まらないように。福祉避難所は法人の名前が先に来る物を外す（会社の名前で出来事を読ませない）

import * as z from "zod";
import type { GeoPoint } from "../db/types.ts";
import { isGeoPoint, project, TILE } from "../map/geo.ts";
import { parseShelterTile, SHELTER_HOST, shelterTiles, shelterUrl, type ShelterLayer, type Tile } from "../map/shelters.ts";
import { formLeaks } from "../pseudonym/forms.ts";
import type { RealGeo } from "./real-geo-apply.ts";

export type { RealGeo } from "./real-geo-apply.ts";

/** 注記のズーム（地理院の注記はズーム 15 で読める） */
export const ANNO_ZOOM = 15;
/** 1 要求の時間の上限（ms）。開始を長く待たせない */
export const REAL_GEO_TIMEOUT_MS = 2500;
/** 注記のタイルの上限（Workers の 1 要求の外への要求の数を抑える） */
export const ANNO_TILES_MAX = 16;
/** 避難所を読む周りの広さ（km） */
const SHELTER_KM = 3;
/** 写す避難所の数の上限（drills.world を太らせない） */
const SHELTER_KEEP = 40;

export type RealGeoRequest = {
  /** 地域を読む点（本人のピンや事業所の真ん中。要求には z/x/y だけが出る） */
  points: ReadonlyArray<GeoPoint>;
  region: string | null;
  /** 川の注記も読むか（デモ事業所は false） */
  rivers: boolean;
  now: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const SHELTER_LAYERS: ReadonlyArray<ShelterLayer> = [
  { id: "sih", kind: "shelter" },
  { id: "sfh", kind: "welfare" },
];

/** 法人の名前が先に来る物（「社会福祉法人 ○○ 高齢者福祉施設…」「㈱○○ …」）。世界の文に会社の名前を出さない */
const CORPORATE = /株式会社|有限会社|合同会社|㈱|㈲|（株）|（有）|\(株\)|\(有\)|法人|財団|組合/u;

const Anno = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.array(z.number()).min(2) }),
  properties: z.object({ annoCtg: z.string(), knj: z.string() }),
});

/** 点の周りの注記のタイル（まず点のあるタイル、余れば周りの 8 枚。重なりを外して上限まで。町名や座標は入らない） */
export function annoTiles(points: ReadonlyArray<GeoPoint>, max = ANNO_TILES_MAX): Tile[] {
  const seen = new Map<string, Tile>();
  const add = (t: Tile) => {
    if (seen.size < max) seen.set(`${t.x}/${t.y}`, t);
  };
  const centers = points.map((p) => {
    const at = project(p, ANNO_ZOOM);
    return { x: Math.floor(at.x / TILE), y: Math.floor(at.y / TILE) };
  });
  for (const c of centers) add(c);
  for (const c of centers) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add({ x: c.x + dx, y: c.y + dy });
  return [...seen.values()];
}

export function annoUrl(t: Tile): string {
  return `${SHELTER_HOST}/xyz/experimental_anno/${ANNO_ZOOM}/${t.x}/${t.y}.geojson`;
}

/** 注記のタイル → 川の名前と位置（河川・用水の注記だけ。形の違う物は落とす） */
export function parseAnnoRivers(json: unknown): Array<{ name: string; at: GeoPoint }> {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) => {
    const r = Anno.safeParse(f);
    if (!r.success || !r.data.properties.annoCtg.startsWith("河川、湖沼（河川")) return [];
    const [lng, lat] = r.data.geometry.coordinates;
    const at = { lat, lng };
    const name = r.data.properties.knj.trim();
    return isGeoPoint(at) && name ? [{ name, at }] : [];
  });
}

/** 門に引っかからない名前か */
const safeName = (name: string) => formLeaks(name).length === 0;

/** 読む。投げない。全部失敗しても川も避難所も空の形を返す（呼ぶ側は空なら一般の言い方のまま） */
export async function loadRealGeo(req: RealGeoRequest): Promise<RealGeo> {
  const doFetch = req.fetch ?? fetch;
  const timeout = req.timeoutMs ?? REAL_GEO_TIMEOUT_MS;
  const points = req.points.filter(isGeoPoint);
  const read = async (url: string): Promise<unknown> => {
    try {
      const res = await doFetch(url, { method: "GET", signal: AbortSignal.timeout(timeout) });
      return res.ok ? await res.json().catch(() => null) : null;
    } catch {
      return null;
    }
  };

  const tiles = new Map<string, Tile>();
  for (const p of points) for (const t of shelterTiles(p, SHELTER_KM)) tiles.set(`${t.x}/${t.y}`, t);
  const shelterJobs = SHELTER_LAYERS.flatMap((layer) => [...tiles.values()].map((t) => ({ layer, url: shelterUrl(layer.id, t) })));
  const riverJobs = req.rivers ? annoTiles(points).map(annoUrl) : [];
  const [shelterRows, riverRows] = await Promise.all([
    Promise.all(shelterJobs.map(async (j) => parseShelterTile(j.layer, await read(j.url)))),
    Promise.all(riverJobs.map(async (u) => parseAnnoRivers(await read(u)))),
  ]);

  const shelters = shelterRows
    .flat()
    .filter((s) => safeName(s.name) && !(s.welfare && CORPORATE.test(s.name)))
    .map((s) => ({ name: s.name, at: { lat: Number(s.at.lat.toFixed(5)), lng: Number(s.at.lng.toFixed(5)) }, welfare: s.welfare }));
  const near = (at: GeoPoint) => Math.min(...points.map((p) => Math.hypot(p.lat - at.lat, p.lng - at.lng)));
  const kept = [...shelters].sort((a, b) => near(a.at) - near(b.at)).slice(0, SHELTER_KEEP);
  const rivers = riverRows.flat().filter((r) => safeName(r.name));
  return { at: req.now, region: req.region, rivers, shelters: kept };
}

/** 読めた物があるか（無ければ状態に写さない） */
export function hasRealGeo(g: RealGeo): boolean {
  return g.shelters.length > 0 || g.rivers.length > 0;
}
