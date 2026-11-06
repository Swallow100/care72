// 避難先の候補（T112）。国土地理院の「指定緊急避難場所・指定避難所」データ（市町村が登録し公開に同意した物）を、
// 地理院タイル（GeoJSON、ズーム 10 だけ）で読み、家の近くの候補にする。経路地図の窓で「候補」を押したときだけ、ブラウザが読む。
// - 外へ出るのは層の名前とタイルの z/x/y だけ（https://cyberjapandata.gsi.go.jp/xyz/{層}/10/{x}/{y}.geojson）。
//   家の座標・氏名・台帳は送らない。同じホストの淡色地図（lib/map/layers.ts）はもっと細かいズームの z/x/y を前から読んでいる
// - データの一式（CSV・GeoJSON のダウンロード）は落とさず、リポジトリにも入れない（ダウンロードの頁は利用規約への同意の操作が要る）
// - 利用の条件: 国土地理院コンテンツ利用規約（公共データ利用規約 第1.0版）と、データの「ご利用上の注意」（最新でない・
//   載っていないことがあり市町村に確かめる、指定緊急避難場所は災害の種類ごと、随時更新、第三者に渡すときこの注意を伝える）。
//   出典と注意の頁へのリンクは窓の出典の行に出す（SHELTER_CREDIT）。確かめた日と中身は docs/progress/t112.md
// - 台帳に残すのは選んだ候補の名前（避難先 1・2 の文字）と位置だけ。住所・備考は残さない
// 属性の名前は地理院タイル一覧の「指定緊急避難場所・指定避難所」の項（name・address・remarks・disaster1〜8・accept）。

import * as z from "zod";
import type { GeoPoint, HazardKind, Ledger } from "../db/types.ts";
import { isGeoPoint, project, TILE, unproject, type Size, type View } from "./geo.ts";
import { distanceM } from "./route.ts";

export const SHELTER_HOST = "https://cyberjapandata.gsi.go.jp";

/** 地理院がこのデータを配っているズーム（10 だけ） */
export const SHELTER_ZOOM = 10;

/** 指定緊急避難場所の災害の種類（地理院の層 skhb01〜08、属性 disaster1〜8 と同じ順）と画面の言葉 */
export const SHELTER_DISASTERS = ["flood", "landslide", "surge", "quake", "tsunami", "fire", "inland", "volcano"] as const;
export type ShelterDisaster = (typeof SHELTER_DISASTERS)[number];
export const SHELTER_DISASTER_LABELS: Record<ShelterDisaster, string> = {
  flood: "洪水",
  landslide: "土砂",
  surge: "高潮",
  quake: "地震",
  tsunami: "津波",
  fire: "大火",
  inland: "内水",
  volcano: "火山",
};

/** 層: 指定緊急避難場所（災害の種類ごと）・指定避難所（一般 sih・福祉 sfh） */
export type ShelterLayer =
  | { id: `skhb0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`; kind: "emergency"; disaster: ShelterDisaster }
  | { id: "sih"; kind: "shelter" }
  | { id: "sfh"; kind: "welfare" };

const emergency = (d: ShelterDisaster): ShelterLayer =>
  ({ id: `skhb0${SHELTER_DISASTERS.indexOf(d) + 1}`, kind: "emergency", disaster: d }) as ShelterLayer;

/** 台帳のハザード → 読む指定緊急避難場所の種類。地震はいつも読む */
const HAZARD_DISASTERS: Record<HazardKind, ShelterDisaster[]> = {
  flood: ["flood", "inland"],
  landslide: ["landslide"],
  tsunami: ["tsunami"],
  other: [],
};

/**
 * 読む層: 指定避難所（一般・福祉）と、地震と台帳のハザードに合う指定緊急避難場所。
 * 要求の数を抑えるため、ハザードに無い種類（高潮・大火・火山など）は読まない
 */
export function shelterLayers(ledger: Pick<Ledger, "evacuation">): ShelterLayer[] {
  const ds = new Set<ShelterDisaster>(["quake"]);
  for (const h of ledger.evacuation.hazards) for (const d of HAZARD_DISASTERS[h.kind] ?? []) ds.add(d);
  return [
    { id: "sih", kind: "shelter" },
    { id: "sfh", kind: "welfare" },
    ...SHELTER_DISASTERS.filter((d) => ds.has(d)).map(emergency),
  ];
}

/** 家のまわりの何 km まで候補にするか */
export const SHELTER_RADIUS_KM = 5;
/** 一覧に出す候補の数の上限（近い順） */
export const SHELTER_MAX = 10;
/** 要求の時間の上限（ms） */
export const SHELTER_TIMEOUT_MS = 8000;

export type Tile = { x: number; y: number };

/** 家のまわり radiusKm の四角を覆うズーム 10 のタイル（1〜4 枚。家の座標そのものは要求に入らない） */
export function shelterTiles(home: GeoPoint, radiusKm = SHELTER_RADIUS_KM): Tile[] {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.1, Math.cos((home.lat * Math.PI) / 180)));
  const nw = project({ lat: Math.min(85, home.lat + dLat), lng: home.lng - dLng }, SHELTER_ZOOM);
  const se = project({ lat: Math.max(-85, home.lat - dLat), lng: home.lng + dLng }, SHELTER_ZOOM);
  const max = 2 ** SHELTER_ZOOM - 1;
  const out: Tile[] = [];
  for (let y = Math.max(0, Math.floor(nw.y / TILE)); y <= Math.min(max, Math.floor(se.y / TILE)); y++) {
    for (let x = Math.max(0, Math.floor(nw.x / TILE)); x <= Math.min(max, Math.floor(se.x / TILE)); x++) out.push({ x, y });
  }
  return out;
}

/** 要求の URL（層とタイルの z/x/y だけ） */
export function shelterUrl(layer: ShelterLayer["id"], t: Tile): string {
  return `${SHELTER_HOST}/xyz/${layer}/${SHELTER_ZOOM}/${t.x}/${t.y}.geojson`;
}

/** 候補 1 つ（同じ名前・同じ所の施設は層をまとめて 1 つ） */
export type ShelterCandidate = {
  /** 名前と位置から作る印（一覧の key） */
  id: string;
  name: string;
  at: GeoPoint;
  /** 指定緊急避難場所としての災害の種類（読んだ層の分だけ） */
  disasters: ShelterDisaster[];
  /** 指定避難所（一般）・福祉避難所 */
  shelter: boolean;
  welfare: boolean;
  /** 家からの直線の長さ（m） */
  distanceM: number;
};

/** 名前の長さの上限（避難先の文字の欄に入れる） */
export const SHELTER_NAME_MAX = 60;

const Feature = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.array(z.number()).min(2) }).nullable(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
});
const Collection = z.object({ features: z.array(z.unknown()) });

type Raw = { name: string; at: GeoPoint; disasters: ShelterDisaster[]; shelter: boolean; welfare: boolean };

const on = (v: unknown) => v === 1 || v === "1";

/** 名前の文字（制御文字を外し、空白を 1 つに、上限まで）。空は null */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? [...s].slice(0, SHELTER_NAME_MAX).join("") : null;
}

/** 1 枚のタイルの GeoJSON → 施設の並び（形の違う物・位置の無い物・名前の無い物は落とす） */
export function parseShelterTile(layer: ShelterLayer, json: unknown): Raw[] {
  const c = Collection.safeParse(json);
  if (!c.success) return [];
  const out: Raw[] = [];
  for (const f of c.data.features) {
    const r = Feature.safeParse(f);
    if (!r.success || !r.data.geometry) continue;
    const [lng, lat] = r.data.geometry.coordinates;
    const at = { lat, lng };
    const p = r.data.properties ?? {};
    const name = cleanName(p.name);
    if (!isGeoPoint(at) || !name) continue;
    // 指定緊急避難場所は disaster1〜8 の 1 を全部拾う（層の種類はその 1 つ）
    const disasters =
      layer.kind === "emergency"
        ? SHELTER_DISASTERS.filter((d, i) => d === layer.disaster || on(p[`disaster${i + 1}`]))
        : SHELTER_DISASTERS.filter((_, i) => on(p[`disaster${i + 1}`]));
    out.push({ name, at, disasters, shelter: layer.kind === "shelter", welfare: layer.kind === "welfare" });
  }
  return out;
}

/** 同じ名前で 50 m の中は同じ施設（層ごとに同じ施設が入っている） */
const SAME_M = 50;

/** 施設の並び → 家から radiusKm の中の候補（同じ施設をまとめ、近い順に max まで） */
export function shelterCandidates(raws: ReadonlyArray<Raw>, home: GeoPoint, opts: { radiusKm?: number; max?: number } = {}): ShelterCandidate[] {
  const radius = (opts.radiusKm ?? SHELTER_RADIUS_KM) * 1000;
  const merged: Raw[] = [];
  for (const r of raws) {
    const same = merged.find((m) => m.name === r.name && distanceM(m.at, r.at) <= SAME_M);
    if (same) {
      for (const d of r.disasters) if (!same.disasters.includes(d)) same.disasters.push(d);
      same.shelter ||= r.shelter;
      same.welfare ||= r.welfare;
    } else {
      merged.push({ ...r, disasters: [...r.disasters] });
    }
  }
  return merged
    .map((m) => ({
      id: `${m.name}@${m.at.lat.toFixed(5)},${m.at.lng.toFixed(5)}`,
      name: m.name,
      at: { lat: Number(m.at.lat.toFixed(5)), lng: Number(m.at.lng.toFixed(5)) },
      disasters: SHELTER_DISASTERS.filter((d) => m.disasters.includes(d)),
      shelter: m.shelter,
      welfare: m.welfare,
      distanceM: Math.round(distanceM(home, m.at)),
    }))
    .filter((c) => c.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name, "ja"))
    .slice(0, opts.max ?? SHELTER_MAX);
}

export type ShelterResult = { ok: true; candidates: ShelterCandidate[] } | { ok: false };

/**
 * 候補を読む（ブラウザから。fetch はテストで偽の物を渡す）。層 × タイルを並べて読み、404（その所にデータが無い）は空。
 * 全部の要求が失敗したときだけ失敗（ok: false）。投げない。要求に見出し・本文は付けない
 */
export async function fetchShelters(args: {
  home: GeoPoint;
  layers: ReadonlyArray<ShelterLayer>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<ShelterResult> {
  if (!isGeoPoint(args.home)) return { ok: false };
  const doFetch = args.fetch ?? fetch;
  const tiles = shelterTiles(args.home);
  const jobs = args.layers.flatMap((layer) => tiles.map((t) => ({ layer, url: shelterUrl(layer.id, t) })));
  const results = await Promise.all(
    jobs.map(async ({ layer, url }): Promise<Raw[] | null> => {
      try {
        const res = await doFetch(url, { method: "GET", signal: AbortSignal.timeout(args.timeoutMs ?? SHELTER_TIMEOUT_MS) });
        if (res.status === 404) return [];
        if (!res.ok) return null;
        return parseShelterTile(layer, await res.json().catch(() => null));
      } catch {
        return null;
      }
    }),
  );
  if (jobs.length > 0 && results.every((r) => r === null)) return { ok: false };
  return { ok: true, candidates: shelterCandidates(results.flatMap((r) => r ?? []), args.home) };
}

// ---------- 担当一覧の地図の避難所（T169） ----------
// 同じデータを、地図を強く拡大したときだけ読む。候補（上）と同じく、外へ出るのは層とズーム 10 のタイルの z/x/y だけ（1 辺 約 30 km）。
// 淡色地図はもっと細かいズームの z/x/y を前から読んでいるので、外へ出る物は増えない。データはリポジトリに入れない。

/**
 * 地図に避難所と計画の避難先を出すズームの段。これより引いた地図には出さない（ズーム 15 は 1920 の全画面に旗が 200 を超えて並び、
 * 地図も人も読めなかった。16 は 1280 で 30 ほどで、名前も読める）
 */
export const SHELTER_MAP_ZOOM = 16;

/**
 * 地図で読む層: 指定避難所（一般・福祉）と、地図の層の切替と同じ災害（洪水・土砂・津波）と地震の指定緊急避難場所。
 * 1 人の台帳に合わせる候補と違い、地図は担当全員の物なので固定（重ねた層を切り替えても印が変わらない）
 */
export const MAP_SHELTER_LAYERS: readonly ShelterLayer[] = [
  { id: "sih", kind: "shelter" },
  { id: "sfh", kind: "welfare" },
  ...(["flood", "landslide", "quake", "tsunami"] as const).map(emergency),
];

/** 緯度経度の四角を覆うズーム 10 のタイル */
export function shelterTilesInBox(north: number, west: number, south: number, east: number): Tile[] {
  const nw = project({ lat: Math.min(85, north), lng: west }, SHELTER_ZOOM);
  const se = project({ lat: Math.max(-85, south), lng: east }, SHELTER_ZOOM);
  const max = 2 ** SHELTER_ZOOM - 1;
  const out: Tile[] = [];
  for (let y = Math.max(0, Math.floor(nw.y / TILE)); y <= Math.min(max, Math.floor(se.y / TILE)); y++) {
    for (let x = Math.max(0, Math.floor(nw.x / TILE)); x <= Math.min(max, Math.floor(se.x / TILE)); x++) out.push({ x, y });
  }
  return out;
}

/** 枠が映す範囲を覆うタイル（表示のズームと中心から） */
export function shelterTilesForView(view: View, size: Size): Tile[] {
  const nw = unproject({ x: view.center.x - size.w / 2, y: view.center.y - size.h / 2 }, view.z);
  const se = unproject({ x: view.center.x + size.w / 2, y: view.center.y + size.h / 2 }, view.z);
  return shelterTilesInBox(nw.lat, nw.lng, se.lat, se.lng);
}

/** 地図の避難所 1 つ（同じ施設は層をまとめて 1 つ。住所・備考は持たない） */
export type MapShelter = { id: string; name: string; at: GeoPoint; disasters: ShelterDisaster[]; shelter: boolean; welfare: boolean };

/** 同じ施設（同じ名前で 50 m の中）を 1 つに。名前の同じ物だけ比べる（1 枚のタイルに千を超えて並ぶので） */
export function mergeMapShelters(raws: ReadonlyArray<Raw>): MapShelter[] {
  const byName = new Map<string, Raw[]>();
  for (const r of raws) {
    const list = byName.get(r.name) ?? [];
    const same = list.find((m) => distanceM(m.at, r.at) <= SAME_M);
    if (same) {
      for (const d of r.disasters) if (!same.disasters.includes(d)) same.disasters.push(d);
      same.shelter ||= r.shelter;
      same.welfare ||= r.welfare;
    } else {
      list.push({ ...r, disasters: [...r.disasters] });
      byName.set(r.name, list);
    }
  }
  return [...byName.values()].flat().map((m) => ({
    id: `${m.name}@${m.at.lat.toFixed(5)},${m.at.lng.toFixed(5)}`,
    name: m.name,
    at: m.at,
    disasters: SHELTER_DISASTERS.filter((d) => m.disasters.includes(d)),
    shelter: m.shelter,
    welfare: m.welfare,
  }));
}

/** 読んだタイル（鍵は 層/x/y）。動かすたび・読み直しのたびに要求しない。失敗した物は残さず、次に見たときに読み直す */
const tileCache = new Map<string, Promise<Raw[] | null>>();

/** テスト用: 読んだタイルを忘れる */
export function clearShelterCache(): void {
  tileCache.clear();
}

function readTile(layer: ShelterLayer, t: Tile, doFetch: typeof fetch, timeoutMs: number): Promise<Raw[] | null> {
  const key = `${layer.id}/${t.x}/${t.y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const job = (async (): Promise<Raw[] | null> => {
    try {
      const res = await doFetch(shelterUrl(layer.id, t), { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return [];
      if (!res.ok) return null;
      return parseShelterTile(layer, await res.json().catch(() => null));
    } catch {
      return null;
    }
  })().then((r) => {
    if (r === null) tileCache.delete(key);
    return r;
  });
  tileCache.set(key, job);
  return job;
}

export type MapShelterResult = { ok: true; list: MapShelter[] } | { ok: false };

/** タイルの避難所を読む（ブラウザから）。層ごとの失敗は飛ばし、全部の要求が失敗したときだけ失敗。投げない。要求に見出し・本文は付けない */
export async function fetchMapShelters(args: { tiles: ReadonlyArray<Tile>; fetch?: typeof fetch; timeoutMs?: number }): Promise<MapShelterResult> {
  const doFetch = args.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const jobs = MAP_SHELTER_LAYERS.flatMap((layer) => args.tiles.map((t) => readTile(layer, t, doFetch, args.timeoutMs ?? SHELTER_TIMEOUT_MS)));
  const results = await Promise.all(jobs);
  if (jobs.length > 0 && results.every((r) => r === null)) return { ok: false };
  return { ok: true, list: mergeMapShelters(results.flatMap((r) => r ?? [])) };
}

/** 枠の中に置いた印の名前の横幅の見積もり（px。11px の字と左右の余白） */
const NAME_CHAR_W = 11;
const NAME_H = 18;
const NAME_PAD = 40;
/** 名前の印の横幅の上限（components/map/PlaceMarks.tsx の max-w-56。長い施設名は切る） */
const NAME_MAX_W = 224;

/**
 * 名前を出す印を選ぶ（前に置いた名前と重なる物は印だけ。title で読める）。先に計画の避難先を入れて渡すと、そちらの名前が残る。
 * x・y は枠の中の px、印の右に名前が出る
 */
export function shelterNameIds(placed: ReadonlyArray<{ id: string; x: number; y: number; name: string }>, taken: ReadonlyArray<{ x: number; y: number; w: number }> = []): Set<string> {
  const boxes = taken.map((b) => ({ ...b }));
  const out = new Set<string>();
  for (const p of placed) {
    const w = Math.min(NAME_MAX_W, [...p.name].length * NAME_CHAR_W + NAME_PAD);
    const hit = boxes.some((b) => p.x < b.x + b.w && b.x < p.x + w && Math.abs(p.y - b.y) < NAME_H);
    if (hit) continue;
    boxes.push({ x: p.x, y: p.y, w });
    out.add(p.id);
  }
  return out;
}

/** 候補の種類の言葉（「避難所・福祉・緊急避難 洪水・地震」の順の材料） */
export function candidateKinds(c: Pick<ShelterCandidate, "disasters" | "shelter" | "welfare">, labels: { emergency: string; shelter: string; welfare: string }): string {
  const parts: string[] = [];
  if (c.shelter) parts.push(labels.shelter);
  if (c.welfare) parts.push(labels.welfare);
  if (c.disasters.length > 0) parts.push(`${labels.emergency} ${c.disasters.map((d) => SHELTER_DISASTER_LABELS[d]).join("・")}`);
  return parts.join("・");
}

/** 地図を押した所の近くの候補（radiusM の中でいちばん近い物）。無ければ null */
export function snapCandidate(cands: ReadonlyArray<ShelterCandidate>, p: GeoPoint, radiusM: number): ShelterCandidate | null {
  let best: ShelterCandidate | null = null;
  let bestD = radiusM;
  for (const c of cands) {
    const d = distanceM(c.at, p);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** 出典と注意（国土地理院コンテンツ利用規約の出典の書き方: 出典と、加工した旨。注意の頁へのリンク） */
export const SHELTER_CREDIT = {
  text: "国土地理院「指定緊急避難場所・指定避難所データ」を加工して作成",
  href: "https://www.gsi.go.jp/bousaichiri/hinanbasho.html",
  /** ご利用上の注意（最新でない・載っていないことがある、市町村に確かめる） */
  notice: "最新は市町村に確認",
  noticeHref: "https://www.gsi.go.jp/bousaichiri/hinanbasho-menseki.html",
} as const;
