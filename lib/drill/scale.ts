// 仮想の訓練の規模（T104）。開始の前にケアマネが選ぶか「おまかせ」（幅の中から開始の時に 1 回引く）。Claude を呼ばない。
//
// - 幅は大雨が警戒レベル 3〜5、地震が震度 5強〜7。訓練にならない小さな規模（震度 1 など）にしない
// - 仮想（世界の部屋・1 回呼び）だけに効く。固定の筋（大雨想定・地震想定・10 分版）の規模は想定の表のまま
// - 引いた値は開始の時に DrillOptions.scale に残す（再生・再開で引き直さない）
// - 下限はコードで守る: 最初の区切りに規模の出来事（警戒レベルと大雨、または地震の震度）を世界の出来事として当てる（AI の印なし）。
//   世界が返す余震は規模の震度を超えない（超えた分は規模の震度に）。大雨の訓練では余震を当てない
// - 輪にしない: lib/drill のほかのファイルを型だけ読む

import type { DrillIncident } from "./incident-types.ts";

export const RAIN_LEVELS = [3, 4, 5] as const;
export type RainLevel = (typeof RAIN_LEVELS)[number];
export const QUAKE_LEVELS = ["5強", "6弱", "6強", "7"] as const;
export type QuakeLevel = (typeof QUAKE_LEVELS)[number];

export type DrillScale = { kind: "heavy_rain"; level: RainLevel } | { kind: "earthquake"; level: QuakeLevel };

/** 選べる規模（開始の画面の並び）。おまかせはこの中から等しく引く */
export const SCALE_CHOICES: ReadonlyArray<DrillScale> = [
  ...RAIN_LEVELS.map((level) => ({ kind: "heavy_rain" as const, level })),
  ...QUAKE_LEVELS.map((level) => ({ kind: "earthquake" as const, level })),
];

/** 震度の並び（小さい順）。余震を規模の震度で抑えるのに使う */
const INTENSITY_ORDER = ["1", "2", "3", "4", "5弱", "5強", "6弱", "6強", "7"] as const;

export function isDrillScale(v: unknown): v is DrillScale {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as { kind?: unknown; level?: unknown };
  if (o.kind === "heavy_rain") return (RAIN_LEVELS as readonly unknown[]).includes(o.level);
  if (o.kind === "earthquake") return (QUAKE_LEVELS as readonly unknown[]).includes(o.level);
  return false;
}

/** 形を整えた規模（余計な鍵を落とす）。違えば null */
export function cleanScale(v: unknown): DrillScale | null {
  if (!isDrillScale(v)) return null;
  return v.kind === "heavy_rain" ? { kind: "heavy_rain", level: v.level } : { kind: "earthquake", level: v.level };
}

/** 画面の選ぶ欄の値（「heavy_rain:4」）と、その逆 */
export const scaleKey = (s: DrillScale): string => `${s.kind}:${s.level}`;
export function scaleOfKey(key: string): DrillScale | null {
  return SCALE_CHOICES.find((s) => scaleKey(s) === key) ?? null;
}

/**
 * おまかせの乱数。訓練の id と開始の時刻から作る（訓練ごとに違い、同じ訓練なら同じ。テストで決まる）。FNV-1a の 32 bit を [0, 1) に
 */
export function seededRand(seed: string): () => number {
  let h = 0x811c9dc5;
  for (const ch of seed) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return () => h / 0x1_0000_0000;
}

/** おまかせ: 幅の中から等しく 1 つ（rand は 0 以上 1 未満） */
export function pickScale(rand: () => number = Math.random): DrillScale {
  const r = rand();
  const i = Math.min(SCALE_CHOICES.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * SCALE_CHOICES.length)));
  return SCALE_CHOICES[i];
}

/** 画面の言葉（「大雨 警戒レベル 4」「地震 震度 6弱」） */
export function scaleLabel(s: DrillScale): string {
  return s.kind === "heavy_rain" ? `大雨 警戒レベル ${s.level}` : `地震 震度 ${s.level}`;
}

/** 世界に渡す 1 行（決まっている災害と規模） */
export function scaleWords(s: DrillScale): string {
  return s.kind === "heavy_rain"
    ? `この訓練の災害は大雨（警戒レベル ${s.level}）。決まっているので、大雨の流れで進める（地震・余震を起こさない）`
    : `この訓練の災害は地震（最大震度 ${s.level}）。決まっているので、地震の流れで進める（余震は震度 ${s.level} を超えない）`;
}

/** 最初の区切りに当てる規模の出来事（世界の出来事、AI の印なし）。大雨は警戒レベルと大雨、地震は震度 */
export function scaleIncidents(s: DrillScale, hour = 0): DrillIncident[] {
  const base = { actor: "world" as const, at: hour, ai: false };
  if (s.kind === "heavy_rain") {
    return [
      { ...base, change: { kind: "alert", level: s.level }, text: `警戒レベル ${s.level}` },
      { ...base, change: { kind: "weather", state: "rain" }, text: "大雨" },
    ];
  }
  return [{ ...base, change: { kind: "quake", intensity: s.level }, text: `地震 震度 ${s.level}` }];
}

const rank = (v: string): number => (INTENSITY_ORDER as readonly string[]).indexOf(v);

/**
 * 世界の返した出来事を規模に合わせる。地震の訓練: 震度が規模を超える物は規模の震度に（文も）。
 * 大雨の訓練: 震度の出来事（余震）は当てない。ほかの出来事はそのまま
 */
export function fitToScale(incidents: ReadonlyArray<DrillIncident>, s: DrillScale | null | undefined): DrillIncident[] {
  if (!s) return [...incidents];
  const out: DrillIncident[] = [];
  for (const e of incidents) {
    if (e.change.kind !== "quake") {
      out.push(e);
      continue;
    }
    if (s.kind === "heavy_rain") continue;
    const r = rank(e.change.intensity);
    if (r < 0 || r <= rank(s.level)) {
      out.push(e);
      continue;
    }
    out.push({ ...e, change: { kind: "quake", intensity: s.level }, text: `余震 震度 ${s.level}` });
  }
  return out;
}
