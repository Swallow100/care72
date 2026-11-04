// 経路地図の画面の計算（T102）。本人のページの避難の面の「経路地図」（components/map/RouteMap.tsx）が持つ下書きと、
// 拡大・縮小・上下左右・全体、地図を押した所、保存の変更（lib/intake/save.ts の evacMap。手で直すときだけ）を、画面から離した純粋な計算にしてある。
// - 避難先 1・2 の位置と経路地図は台帳の evacuation に（Claude には渡さない。lib/pseudonym の ClaudePerson に無い）
// - openrouteservice の線は、引いたときの避難先・手段・位置のままで経由点が無いときだけ使う。どれかを変えたら手入力の線（家 → 経由点 → 避難先）に戻る
// - 範囲は ROUTE_FRAME の枠に対する真ん中とズーム（整数）。紙は lib/map/route-image.ts がこの範囲を全部入れて描く

import * as z from "zod";
import { ROUTE_MODES, ROUTE_SOURCES, type GeoPoint, type Ledger, type RouteMap, type RouteMode } from "../db/types.ts";
import type { IntakeChange } from "../intake/changes.ts";
import { ROUTE_LABELS } from "../labels.ts";
import { roundPoint } from "./center.ts";
import { fitView, isGeoPoint, project, unproject, type Padding } from "./geo.ts";
import { ROUTE_FRAME, ROUTE_ZOOM } from "./route-image.ts";
import { handLine, LINE_MAX_POINTS, lineLength, modeOf } from "./route.ts";

/** 手で足せる経由点の数 */
export const ROUTE_VIA_MAX = 20;

/** 「全体」の余白（基準の px）。下は出典の字の分を広く、上は印の名前の分 */
export const ROUTE_PADDING: Padding = { top: 30, right: 24, bottom: 40, left: 24 };

/** 避難先を置いていないときのズーム（家だけ）。家のまわり 2 km ほど（避難先を探して押せる広さ） */
export const ROUTE_HOME_Z = 15;

export type RouteView = RouteMap["view"];

/** openrouteservice が引いた線と、引いたときの組（避難先・手段・避難先の位置） */
export type AutoLine = { to: 1 | 2; mode: RouteMode; dest: GeoPoint; line: GeoPoint[]; distanceM: number; durationS: number };

export type RouteDraft = {
  to: 1 | 2;
  mode: RouteMode;
  dest: { 1: GeoPoint | null; 2: GeoPoint | null };
  via: GeoPoint[];
  auto: AutoLine | null;
  view: RouteView;
  /** 地図を押すと置く物 */
  tool: "dest" | "via";
};

const samePoint = (a: GeoPoint | null | undefined, b: GeoPoint | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;

const pointOrNull = (p: unknown): GeoPoint | null => (isGeoPoint(p) ? { lat: p.lat, lng: p.lng } : null);

/** 台帳から下書き。経路地図があればその形、無ければ手段は台帳の「手段」の文字から、範囲は家と避難先が入る大きさ */
export function routeDraft(ledger: Ledger, fallback: GeoPoint): RouteDraft {
  const e = ledger.evacuation;
  const home = pointOrNull(ledger.basic.location);
  const dest = { 1: pointOrNull(e.destination1Location), 2: pointOrNull(e.destination2Location) };
  const map = e.routeMap;
  if (map && isGeoPoint(map.view?.center)) {
    const d = dest[map.to];
    return {
      to: map.to,
      mode: map.mode,
      dest,
      via: map.source === "hand" ? map.via.filter(isGeoPoint) : [],
      auto: map.source === "ors" && d ? { to: map.to, mode: map.mode, dest: d, line: map.line, distanceM: map.distanceM, durationS: map.durationS ?? 0 } : null,
      view: { center: map.view.center, z: clampZ(map.view.z) },
      tool: d ? "via" : "dest",
    };
  }
  // 避難先 1 の名前か位置があれば 1、無くて 2 だけあれば 2
  const to: 1 | 2 = !e.destination1 && !dest[1] && (e.destination2 || dest[2]) ? 2 : 1;
  return {
    to,
    mode: modeOf(e.transport),
    dest,
    via: [],
    auto: null,
    view: fitRoute([home, dest[to]].filter((p): p is GeoPoint => p !== null), fallback),
    tool: dest[to] ? "via" : "dest",
  };
}

/** 今の線（家と避難先の位置があるときだけ）。openrouteservice の線が今の組と同じなら ors、ほかは手入力 */
export function currentRoute(d: RouteDraft, home: GeoPoint | null): Omit<RouteMap, "view"> | null {
  const dest = d.dest[d.to];
  if (!home || !dest) return null;
  const a = d.auto;
  if (a && a.to === d.to && a.mode === d.mode && samePoint(a.dest, dest) && d.via.length === 0 && a.line.length >= 2) {
    return { to: d.to, mode: d.mode, source: "ors", line: a.line, via: [], distanceM: a.distanceM, durationS: a.durationS };
  }
  const line = handLine(home, d.via, dest);
  return { to: d.to, mode: d.mode, source: "hand", line, via: [...d.via], distanceM: Math.round(lineLength(line)) };
}

// ---------- 保存の変更（lib/intake/save.ts の evacMap） ----------

const Point = z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) });

/** 保存の形。経路は行き先の避難先の位置があるときだけ */
export const EvacMapSchema = z
  .object({
    dest1: Point.nullable(),
    dest2: Point.nullable(),
    route: z
      .object({
        to: z.union([z.literal(1), z.literal(2)]),
        mode: z.enum(ROUTE_MODES),
        source: z.enum(ROUTE_SOURCES),
        line: z.array(Point).min(2).max(LINE_MAX_POINTS),
        via: z.array(Point).max(ROUTE_VIA_MAX),
        distanceM: z.number().min(0).max(1_000_000),
        durationS: z.number().min(0).max(864_000).optional(),
        view: z.object({ center: Point, z: z.number().int().min(ROUTE_ZOOM.minZ).max(ROUTE_ZOOM.maxZ) }),
      })
      .nullable(),
  })
  .refine((v) => v.route === null || (v.route.to === 1 ? v.dest1 : v.dest2) !== null, { message: "route_without_dest" });

export type EvacMapValue = z.output<typeof EvacMapSchema>;

/** 台帳の今の値（保存の形） */
export function evacMapOf(ledger: Ledger): EvacMapValue {
  const e = ledger.evacuation;
  return { dest1: pointOrNull(e.destination1Location), dest2: pointOrNull(e.destination2Location), route: e.routeMap ?? null };
}

/** 下書き → 保存の値 */
export function evacMapValue(d: RouteDraft, home: GeoPoint | null): EvacMapValue {
  const r = currentRoute(d, home);
  return { dest1: d.dest[1], dest2: d.dest[2], route: r ? { ...r, view: { center: roundPoint(d.view.center), z: d.view.z } } : null };
}

/** 保存の変更。台帳の今の値と同じなら null（送らない） */
export function routeChange(ledger: Ledger, d: RouteDraft): IntakeChange | null {
  const home = pointOrNull(ledger.basic.location);
  const next = evacMapValue(d, home);
  return sameEvacMap(evacMapOf(ledger), next) ? null : { t: "evacMap", value: next };
}

function sameEvacMap(a: EvacMapValue, b: EvacMapValue): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** 比べる形（キーの順をそろえる） */
function normalize(v: EvacMapValue) {
  const p = (x: GeoPoint | null) => (x ? { lat: x.lat, lng: x.lng } : null);
  const r = v.route;
  return {
    dest1: p(v.dest1),
    dest2: p(v.dest2),
    route: r
      ? {
          to: r.to,
          mode: r.mode,
          source: r.source,
          line: r.line.map(p),
          via: r.via.map(p),
          distanceM: r.distanceM,
          durationS: r.durationS ?? null,
          view: { center: p(r.view.center), z: r.view.z },
        }
      : null,
  };
}

/** 台帳の場所の名前（経過の「ケアマネが直した: 〜」） */
export const EVAC_MAP_FIELDS = {
  "evacuation.destination1Location": "避難先1 位置",
  "evacuation.destination2Location": "避難先2 位置",
  "evacuation.routeMap": ROUTE_LABELS.open,
} as const;

/**
 * 避難先の位置と経路地図を台帳に当てる（手で直すときだけ。lib/intake/save.ts）。null は外す。同じ値なら変えない。
 * 経路の行き先の避難先の位置が無くなる保存は経路も外す
 */
export function applyEvacMap(ledger: Ledger, changes: ReadonlyArray<IntakeChange>): { ledger: Ledger; fields: string[] } {
  let out = ledger;
  const fields = new Set<string>();
  for (const c of changes) {
    if (c.t !== "evacMap") continue;
    const cur = evacMapOf(out);
    const next = normalize(c.value);
    const evacuation = { ...out.evacuation };
    const put = <K extends "destination1Location" | "destination2Location">(key: K, v: GeoPoint | null, was: GeoPoint | null) => {
      if (samePoint(v, was)) return;
      if (v) evacuation[key] = { lat: v.lat, lng: v.lng };
      else delete evacuation[key];
      fields.add(`evacuation.${key}`);
    };
    put("destination1Location", next.dest1, cur.dest1);
    put("destination2Location", next.dest2, cur.dest2);
    let route = c.value.route;
    if (route && !(route.to === 1 ? next.dest1 : next.dest2)) route = null;
    if (JSON.stringify(normalize({ ...cur, route })) !== JSON.stringify(normalize(cur))) {
      if (route) evacuation.routeMap = toRouteMap(route);
      else delete evacuation.routeMap;
      fields.add("evacuation.routeMap");
    }
    out = { ...out, evacuation };
  }
  return { ledger: out, fields: [...fields] };
}

function toRouteMap(r: NonNullable<EvacMapValue["route"]>): RouteMap {
  const p = (x: GeoPoint) => ({ lat: x.lat, lng: x.lng });
  return {
    to: r.to,
    mode: r.mode,
    source: r.source,
    line: r.line.map(p),
    via: r.source === "hand" ? r.via.map(p) : [],
    distanceM: Math.round(r.distanceM),
    ...(r.source === "ors" && r.durationS != null ? { durationS: Math.round(r.durationS) } : {}),
    view: { center: p(r.view.center), z: r.view.z },
  };
}

/** 変更の言葉（差分の右側。lib/intake/changes.ts の changeText） */
export function evacMapText(v: EvacMapValue): string {
  if (!v.route) return `${ROUTE_LABELS.open} 外す`;
  return `${ROUTE_LABELS.open} ${routeSummary(v.route)}`;
}

/** 線の要約（「徒歩 1.2 km 約 18 分 自動」「車 3.4 km 手入力」） */
export function routeSummary(r: Pick<RouteMap, "mode" | "source" | "distanceM" | "durationS">): string {
  const km = r.distanceM >= 1000 ? `${(r.distanceM / 1000).toFixed(1)} km` : `${Math.round(r.distanceM)} m`;
  const min = r.source === "ors" && r.durationS ? `約 ${Math.max(1, Math.round(r.durationS / 60))} 分` : null;
  return [ROUTE_LABELS[r.mode], km, min, ROUTE_LABELS[r.source]].filter(Boolean).join(" ");
}

// ---------- 範囲の計算 ----------

function clampZ(z: number): number {
  return Math.min(ROUTE_ZOOM.maxZ, Math.max(ROUTE_ZOOM.minZ, Math.round(z)));
}

/** 点が全部入るいちばん大きいズームと真ん中（家と避難先・線）。点が無ければ fallback をズーム 13、1 つなら ROUTE_HOME_Z */
export function fitRoute(points: ReadonlyArray<GeoPoint>, fallback: GeoPoint): RouteView {
  if (points.length === 0) return { center: roundPoint(fallback), z: 13 };
  if (points.length === 1) return { center: roundPoint(points[0]), z: ROUTE_HOME_Z };
  const v = fitView(points, { minZ: ROUTE_ZOOM.minZ, maxZ: ROUTE_ZOOM.maxZ, fallback, padding: ROUTE_PADDING, size: ROUTE_FRAME });
  return { center: roundPoint(unproject(v.center, v.z)), z: v.z };
}

/** 1 段の拡大・縮小（真ん中を据える） */
export function zoomRoute(v: RouteView, dz: 1 | -1): RouteView {
  return { center: v.center, z: clampZ(v.z + dz) };
}

/** 動かす向き。「左」は西が見える向き（地図の全画面の ← と同じ） */
export type PanDir = "left" | "right" | "up" | "down";

/** 枠の 4 分の 1 だけ動かす */
export function panRoute(v: RouteView, dir: PanDir): RouteView {
  const c = project(v.center, v.z);
  const dx = dir === "left" ? -ROUTE_FRAME.w / 4 : dir === "right" ? ROUTE_FRAME.w / 4 : 0;
  const dy = dir === "up" ? -ROUTE_FRAME.h / 4 : dir === "down" ? ROUTE_FRAME.h / 4 : 0;
  return { center: roundPoint(unproject({ x: c.x + dx, y: c.y + dy }, v.z)), z: v.z };
}

/** 枠の中の押した所（左上からの比 0〜1）→ 緯度経度（5 桁） */
export function pointInFrame(v: RouteView, fx: number, fy: number): GeoPoint {
  const c = project(v.center, v.z);
  return roundPoint(unproject({ x: c.x + (fx - 0.5) * ROUTE_FRAME.w, y: c.y + (fy - 0.5) * ROUTE_FRAME.h }, v.z));
}

/** 地図を押した: 置く物が避難先なら今の避難先の位置を、経由点なら経由点を足す（上限まで） */
export function pickPoint(d: RouteDraft, p: GeoPoint): RouteDraft {
  if (d.tool === "dest") return { ...d, dest: { ...d.dest, [d.to]: p } };
  if (d.via.length >= ROUTE_VIA_MAX) return d;
  return { ...d, via: [...d.via, p] };
}
