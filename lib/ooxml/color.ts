// Excel・Word の色（ARGB・テーマの色と濃淡・番号の色）を CSS の #rrggbb に（T119）。

import { kid, kids, type XNode } from "./xml.ts";

/** Excel の番号の色（既定の 64 色。ECMA-376 18.8.27） */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** テーマの色（dk1 lt1 dk2 lt2 accent1〜6 hlink folHlink の順）。読めなければ Office の既定 */
export type Theme = { colors: string[]; minorEa: string | null; majorEa: string | null; minorLatin: string | null };

const DEFAULT_THEME_COLORS = ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
export const DEFAULT_THEME: Theme = { colors: DEFAULT_THEME_COLORS, minorEa: null, majorEa: null, minorLatin: null };

const SCHEME_NAMES = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

function colorOfNode(x: XNode | null): string | null {
  if (!x) return null;
  const srgb = kid(x, "srgbClr");
  if (srgb?.a.val) return srgb.a.val.toUpperCase();
  const sys = kid(x, "sysClr");
  if (sys) return (sys.a.lastClr ?? (sys.a.val === "window" ? "FFFFFF" : "000000")).toUpperCase();
  return null;
}

function fontOf(x: XNode | null, script: string): string | null {
  if (!x) return null;
  const ea = kid(x, "ea")?.a.typeface;
  if (ea) return ea;
  for (const f of kids(x, "font")) if (f.a.script === script && f.a.typeface) return f.a.typeface;
  return null;
}

export function parseTheme(root: XNode | null): Theme {
  if (!root) return DEFAULT_THEME;
  const elements = kid(root, "themeElements");
  const scheme = kid(elements, "clrScheme");
  const colors = SCHEME_NAMES.map((n, i) => colorOfNode(kid(scheme, n)) ?? DEFAULT_THEME_COLORS[i]);
  const fonts = kid(elements, "fontScheme");
  const minor = kid(fonts, "minorFont");
  const major = kid(fonts, "majorFont");
  return { colors, minorEa: fontOf(minor, "Jpan"), majorEa: fontOf(major, "Jpan"), minorLatin: kid(minor, "latin")?.a.typeface ?? null };
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const hex2 = (v: number) => clamp(v).toString(16).padStart(2, "0");

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/** 濃淡（-1〜1。Excel の tint） */
export function applyTint(rgb: string, tint: number): string {
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  const [h, s, l] = rgbToHsl(r, g, b);
  const nl = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const [nr, ng, nb] = hslToRgb(h, s, nl);
  return `${hex2(nr)}${hex2(ng)}${hex2(nb)}`.toUpperCase();
}

/** Excel の色の要素（rgb・theme・indexed・tint・auto）を #rrggbb に。色が無い・auto なら fallback */
export function excelColor(x: XNode | null | undefined, theme: Theme, fallback: string | null): string | null {
  if (!x) return fallback;
  let rgb: string | null = null;
  if (x.a.rgb) rgb = x.a.rgb.length === 8 ? x.a.rgb.slice(2) : x.a.rgb;
  else if (x.a.theme !== undefined) {
    // Excel のテーマの番号は lt1・dk1・lt2・dk2 の順で入れ替わっている
    const i = Number(x.a.theme);
    const map = [1, 0, 3, 2];
    rgb = theme.colors[i < 4 ? map[i] : i] ?? null;
  } else if (x.a.indexed !== undefined) {
    const i = Number(x.a.indexed);
    rgb = i === 64 ? "000000" : i === 65 ? "FFFFFF" : (INDEXED[i] ?? null);
  }
  if (!rgb || !/^[0-9a-fA-F]{6}$/.test(rgb)) return fallback;
  const tint = Number(x.a.tint ?? 0);
  if (tint) rgb = applyTint(rgb, tint);
  return `#${rgb.toUpperCase()}`;
}

/** DrawingML の色（srgbClr・schemeClr と lumMod・lumOff・shade・tint）を #rrggbb に */
export function drawingColor(x: XNode | null | undefined, theme: Theme): string | null {
  if (!x) return null;
  const c = kids(x)[0];
  if (!c) return null;
  let rgb: string | null = null;
  if (c.n === "srgbClr") rgb = c.a.val ?? null;
  else if (c.n === "schemeClr") {
    const name = c.a.val ?? "";
    const alias: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2", phClr: "accent1" };
    const i = SCHEME_NAMES.indexOf(alias[name] ?? name);
    rgb = i >= 0 ? theme.colors[i] : null;
  } else if (c.n === "sysClr") rgb = c.a.lastClr ?? (c.a.val === "window" ? "FFFFFF" : "000000");
  else if (c.n === "prstClr") rgb = c.a.val === "white" ? "FFFFFF" : c.a.val === "black" ? "000000" : null;
  if (!rgb || !/^[0-9a-fA-F]{6}$/.test(rgb)) return null;
  let r = parseInt(rgb.slice(0, 2), 16);
  let g = parseInt(rgb.slice(2, 4), 16);
  let b = parseInt(rgb.slice(4, 6), 16);
  for (const m of kids(c)) {
    const v = Number(m.a.val ?? 0) / 100000;
    if (m.n === "lumMod" || m.n === "lumOff") {
      const [h, s, l] = rgbToHsl(r, g, b);
      const nl = m.n === "lumMod" ? l * v : Math.min(1, l + v);
      [r, g, b] = hslToRgb(h, s, nl);
    } else if (m.n === "shade") {
      r *= v;
      g *= v;
      b *= v;
    } else if (m.n === "tint") {
      r = 255 - (255 - r) * v;
      g = 255 - (255 - g) * v;
      b = 255 - (255 - b) * v;
    }
  }
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}
