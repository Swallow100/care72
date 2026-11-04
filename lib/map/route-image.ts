// 避難経路の地図の画像（T102）。台帳の経路地図（Ledger.evacuation.routeMap）から、地理院タイルの上に家・経由の点・避難先と線を描いた SVG を作る。
// - 計画書の 2 頁の避難経路の欄（T101 の受け口）は routeMapSvg の文字列を枠の中に埋め込む（<img> の src にしない。
//   画像として読んだ SVG は中の地図のタイルを読み込まないため）。経路地図の画面の絵（components/map/RouteSceneSvg.tsx）も同じ routeScene から描く
// - 範囲はケアマネが経路地図で決めた真ん中とズーム（ROUTE_FRAME の枠）。欄の縦横の比が違えば、その範囲が全部入るように広げる（縮めて切らない）
// - 出典は枠の中の下に小さく: 地理院タイル（国土地理院の出典の記載例「地理院タイルに○○を追記して掲載」の形）と、
//   openrouteservice の線なら HeiGIT の利用規約の表記。手で引いた線には openrouteservice の表記を出さない
// - 色は操作の色 1 色（状態の 4 色は使わない。地図の状態の色はピンだけの決まり）。グラデーション・光る影は使わない
// - 台帳に経路地図か家の位置が無ければ null（紙は文字の経路だけ）
// 名前・住所の文字は入れない（家の印は「家」、避難先は「避難先1」）。

import type { GeoPoint, Ledger, RouteMap } from "../db/types.ts";
import { isGeoPoint, project, tileUrl, type Size } from "./geo.ts";
import { BASE_LAYER } from "./layers.ts";
import { distanceM, ORS_ATTRIBUTION } from "./route.ts";

/** 経路地図の枠の基準の大きさ（px）。保存した範囲（真ん中とズーム）はこの枠に対する物。計画書の避難経路の欄の横長に合わせて 2:1 */
export const ROUTE_FRAME: Size = { w: 480, h: 240 };

/** 経路地図のズームの範囲（全画面の地図と同じ 9〜18。淡色地図のズーム 5〜8 の別の出所の併記に掛からない） */
export const ROUTE_ZOOM = { minZ: 9, maxZ: BASE_LAYER.maxZ } as const;

/** 地理院タイルの出典（国土地理院の出典の記載例の形）と、リンク先（地理院タイル一覧） */
export const GSI_ROUTE_CREDIT = { text: "地理院タイルに避難経路を追記して掲載", href: BASE_LAYER.attribution.href } as const;

/** 印の言葉 */
export const ROUTE_MARKS = { home: "家", dest: (to: 1 | 2) => `避難先${to}` } as const;

/** 点（viewBox の左上からの座標。ズーム z の世界の px） */
export type ScenePoint = { x: number; y: number };

export type RouteScene = {
  /** viewBox の幅と高さ（ズーム z の世界の px）。左上は 0,0 */
  w: number;
  h: number;
  /** 出力の 1 単位あたりの viewBox の px（線の太さ・字の大きさをこれで割り戻す） */
  scale: number;
  tiles: Array<{ href: string; x: number; y: number; size: number }>;
  /** 描く線（家 → 道 → 避難先。openrouteservice の線の端が家・避難先から離れていれば、その間も結ぶ） */
  line: ScenePoint[];
  /** 家（経路地図の画面で家の位置がまだ無いときだけ null。紙は家が無ければ描かない） */
  home: ScenePoint | null;
  dest: ScenePoint | null;
  via: ScenePoint[];
  destLabel: string;
  /** 枠の中の下に出す出典（上から） */
  credits: string[];
};

/**
 * 絵の中身を作る。size は出力の枠の大きさ（単位は呼ぶ側。px でも mm でもよい）。
 * detail はタイルを何段細かくするか（0 は画面と同じ。紙で線をくっきりさせたいときに 1。地図の字はその分小さくなる）
 */
export function routeScene(input: { map: RouteMap; home: GeoPoint | null; dest: GeoPoint | null; size: Size; detail?: number }): RouteScene {
  const { map, home, dest, size } = input;
  const z = Math.min(ROUTE_ZOOM.maxZ, Math.max(ROUTE_ZOOM.minZ, Math.round(map.view.z)));
  const c = project(map.view.center, z);
  // 保存した範囲（ROUTE_FRAME）が全部入る大きさに広げる
  const a = size.w / size.h;
  const base = ROUTE_FRAME.w / ROUTE_FRAME.h;
  const w = a >= base ? ROUTE_FRAME.h * a : ROUTE_FRAME.w;
  const h = a >= base ? ROUTE_FRAME.h : ROUTE_FRAME.w / a;
  const x0 = c.x - w / 2;
  const y0 = c.y - h / 2;
  const at = (p: GeoPoint): ScenePoint => {
    const q = project(p, z);
    return { x: round1(q.x - x0), y: round1(q.y - y0) };
  };

  // タイル（段は z + detail。淡色地図の範囲に収める）
  const tz = Math.min(BASE_LAYER.maxZ, Math.max(BASE_LAYER.minZ, z + Math.max(0, Math.round(input.detail ?? 0))));
  const span = 256 * 2 ** (z - tz);
  const max = 2 ** tz - 1;
  const tiles: RouteScene["tiles"] = [];
  for (let ty = Math.floor(y0 / span); ty <= Math.floor((y0 + h) / span); ty++) {
    for (let tx = Math.floor(x0 / span); tx <= Math.floor((x0 + w) / span); tx++) {
      if (ty < 0 || ty > max || tx < 0 || tx > max) continue;
      tiles.push({ href: tileUrl(BASE_LAYER.url, { z: tz, x: tx, y: ty }), x: round1(tx * span - x0), y: round1(ty * span - y0), size: round1(span) });
    }
  }

  // 線: openrouteservice の線は道の上から始まるので、家・避難先から 2 m より離れていれば端を足す
  const pts = map.line.filter(isGeoPoint);
  const end = dest ?? pts[pts.length - 1] ?? null;
  const drawn = [...(home && (pts.length === 0 || distanceM(home, pts[0]) > 2) ? [home] : []), ...pts];
  if (end && (drawn.length === 0 || distanceM(drawn[drawn.length - 1], end) > 2)) drawn.push(end);
  // 家が無い（画面だけ）・避難先が無いときは線を引かない
  if (!home || !end) drawn.length = 0;

  const credits: string[] = [GSI_ROUTE_CREDIT.text];
  if (map.source === "ors") credits.push(ORS_ATTRIBUTION.text);
  return {
    w: round1(w),
    h: round1(h),
    scale: w / size.w,
    tiles,
    line: drawn.map(at),
    home: home ? at(home) : null,
    dest: end ? at(end) : null,
    via: map.source === "hand" ? map.via.filter(isGeoPoint).map(at) : [],
    destLabel: ROUTE_MARKS.dest(map.to),
    credits,
  };
}

/** 台帳から絵の中身。経路地図か家の位置が無ければ null（紙は文字の経路だけ） */
export function routeSceneOf(ledger: Ledger, size: Size, detail = 0): RouteScene | null {
  const map = ledger.evacuation.routeMap;
  const home = ledger.basic.location;
  if (!map || !isGeoPoint(home) || !isGeoPoint(map.view?.center)) return null;
  const dest = map.to === 2 ? ledger.evacuation.destination2Location : ledger.evacuation.destination1Location;
  return routeScene({ map, home, dest: isGeoPoint(dest) ? dest : null, size, detail });
}

/** 描き方の大きさ（出力の単位で）。紙は mm、画面は px */
export const ROUTE_STYLE = {
  mm: { line: 0.9, halo: 0.5, pin: 1.6, via: 0.9, font: 2.6, credit: 1.9, pad: 0.8 },
  px: { line: 4, halo: 2, pin: 7, via: 4, font: 12, credit: 9, pad: 3 },
} as const;
export type RouteUnit = keyof typeof ROUTE_STYLE;

/** 紙の色（ライトの操作の色・面・本文。CSS の変数が届かない所でも同じ色に） */
export const ROUTE_PAPER_COLORS = { accent: "#116bdf", panel: "#ffffff", ink: "#161b21" } as const;

const FONT = "Inter, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif";

/**
 * SVG の文字列。T101 の受け口は枠の中にこの文字列をそのまま埋め込む（dangerouslySetInnerHTML。<img> にしない）。
 * size は枠の大きさ、unit は mm か px。台帳に経路地図か家の位置が無ければ null
 */
export function routeMapSvg(ledger: Ledger, size: Size, opts: { unit?: RouteUnit; detail?: number } = {}): string | null {
  const scene = routeSceneOf(ledger, size, opts.detail ?? 0);
  if (!scene) return null;
  return sceneSvg(scene, size, opts.unit ?? "mm");
}

/** 絵の中身 → SVG の文字列（色は紙の色） */
export function sceneSvg(scene: RouteScene, size: Size, unit: RouteUnit): string {
  const s = ROUTE_STYLE[unit];
  const k = scene.scale;
  const C = ROUTE_PAPER_COLORS;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.w} ${scene.h}" width="${size.w}${unit}" height="${size.h}${unit}" ` +
      `preserveAspectRatio="xMidYMid meet" font-family="${FONT}" data-route-map>`,
  );
  out.push(`<rect width="${scene.w}" height="${scene.h}" fill="${C.panel}"/>`);
  for (const t of scene.tiles) {
    out.push(`<image href="${esc(t.href)}" x="${t.x}" y="${t.y}" width="${t.size}" height="${t.size}" preserveAspectRatio="none"/>`);
  }
  const pts = scene.line.map((p) => `${p.x},${p.y}`).join(" ");
  if (scene.line.length >= 2) {
    // 線の下に白い縁（淡色地図の道の上で線が埋もれないように）
    out.push(
      `<polyline points="${pts}" fill="none" stroke="${C.panel}" stroke-width="${r2((s.line + s.halo * 2) * k)}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    out.push(
      `<polyline points="${pts}" fill="none" stroke="${C.accent}" stroke-width="${r2(s.line * k)}" stroke-linejoin="round" stroke-linecap="round" data-route-line/>`,
    );
  }
  for (const v of scene.via) {
    out.push(`<circle cx="${v.x}" cy="${v.y}" r="${r2(s.via * k)}" fill="${C.panel}" stroke="${C.accent}" stroke-width="${r2(s.halo * k)}" data-route-via/>`);
  }
  if (scene.home) out.push(pinSvg(scene.home, ROUTE_MARKS.home, "circle", s, k));
  if (scene.dest) out.push(pinSvg(scene.dest, scene.destLabel, "square", s, k));
  out.push(creditSvg(scene, s, k));
  out.push(`</svg>`);
  return out.join("");
}

function pinSvg(p: ScenePoint, label: string, shape: "circle" | "square", s: (typeof ROUTE_STYLE)[RouteUnit], k: number): string {
  const C = ROUTE_PAPER_COLORS;
  const r = s.pin * k;
  const ring = s.halo * k;
  const mark =
    shape === "circle"
      ? `<circle cx="${p.x}" cy="${p.y}" r="${r2(r)}" fill="${C.accent}" stroke="${C.panel}" stroke-width="${r2(ring)}"/>`
      : `<rect x="${r2(p.x - r)}" y="${r2(p.y - r)}" width="${r2(r * 2)}" height="${r2(r * 2)}" fill="${C.accent}" stroke="${C.panel}" stroke-width="${r2(ring)}"/>`;
  // 印の上に名前（白い縁取りの字）
  const text =
    `<text x="${p.x}" y="${r2(p.y - r - ring * 2)}" text-anchor="middle" font-size="${r2(s.font * k)}" font-weight="700" fill="${C.ink}" ` +
    `stroke="${C.panel}" stroke-width="${r2(s.halo * 1.6 * k)}" paint-order="stroke" stroke-linejoin="round">${esc(label)}</text>`;
  return `<g data-route-pin="${shape === "circle" ? "home" : "dest"}">${mark}${text}</g>`;
}

function creditSvg(scene: RouteScene, s: (typeof ROUTE_STYLE)[RouteUnit], k: number): string {
  const C = ROUTE_PAPER_COLORS;
  const fs = s.credit * k;
  const pad = s.pad * k;
  const lineH = fs * 1.3;
  const height = lineH * scene.credits.length + pad;
  const y0 = scene.h - height;
  const lines = scene.credits
    .map((t, i) => `<text x="${r2(pad)}" y="${r2(y0 + pad / 2 + lineH * (i + 1) - (lineH - fs) / 2 - fs * 0.15)}" font-size="${r2(fs)}" fill="${C.ink}">${esc(t)}</text>`)
    .join("");
  // 下の帯（幅いっぱい。字の幅を見込まずに済み、字が地図に重ならない）
  return `<g data-route-credit><rect x="0" y="${r2(y0)}" width="${scene.w}" height="${r2(height)}" fill="${C.panel}" fill-opacity="0.85"/>${lines}</g>`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
