// 地図の雨の色の段（T116）。1 時間の降水量（mm/h）の 8 段と色。気象庁の降水ナウキャスト（雨雲の動き）の凡例と同じ段と色で、
// 平時の地図に重ねる本物の雨雲（旗 JMA_NOWCAST、components/map/NowcastLayer.tsx）と訓練の筋書きの雨（lib/map/drill-rain.ts）を
// 同じ読み方にする。本物の雨雲は気象庁の画像をそのまま重ね、凡例だけこの表で描く（T151。前は気象庁の凡例の画像で、地図を大きく隠した）。
// 出典は登録簿の jma-nowc-legend（色の値は気象情報の配色の指針の降水量の段の値。11/6 に気象庁の雨雲のタイルの色の表と同じ値であることを確かめた。T151b）。
// 雨は色と連絡順に使わない（lib/triage はこの表を読まない）。地点ごとの雨量は作らない（絵と凡例だけ）。

import type { SourceId } from "../sources/index.ts";

export type RainStep = {
  /** 段の下の境（mm/h。この値を含む） */
  min: number;
  /** 段の上の境（mm/h。この値は次の段）。いちばん強い段は null */
  max: number | null;
  /** 塗りの色（凡例と同じ値）。ライトとダークで同じ（下の地図はダークでも明るい） */
  color: string;
  /** 凡例の読み上げの言葉 */
  label: string;
};

/** 8 段（弱い方から）。凡例は横の帯で、左が弱い（components/map/RainScaleLegend.tsx。T151） */
export const RAIN_STEPS = [
  { min: 0, max: 1, color: "#f2f2ff", label: "1 未満" },
  { min: 1, max: 5, color: "#a0d2ff", label: "1〜5" },
  { min: 5, max: 10, color: "#218cff", label: "5〜10" },
  { min: 10, max: 20, color: "#0041ff", label: "10〜20" },
  { min: 20, max: 30, color: "#faf500", label: "20〜30" },
  { min: 30, max: 50, color: "#ff9900", label: "30〜50" },
  { min: 50, max: 80, color: "#ff2800", label: "50〜80" },
  { min: 80, max: null, color: "#b40068", label: "80 以上" },
] as const satisfies readonly RainStep[];

/** 段の下の境（段の名前の代わり。0・1・5・10・20・30・50・80） */
export type RainMin = (typeof RAIN_STEPS)[number]["min"];

/** 段と色の出典（出典の登録簿の id） */
export const RAIN_STEPS_SOURCE: SourceId = "jma-nowc-legend";

/**
 * 地図に重ねるときの不透明度（輪をまとめた 1 枚に掛ける。段どうしの色は混ぜない）。下の地図・浸水と土砂の層・道が透けるように。
 * 色の値は凡例と同じで、透かすのは地図の上だけ（凡例の見本は透かさない）
 */
export const RAIN_OPACITY = 0.75;

/** 降水量（mm/h）の段。0 以下・数でない値は雨なし（null）。境の値は上の段（1 は 1〜5） */
export function rainStepOf(mm: number): (typeof RAIN_STEPS)[number] | null {
  if (!(mm > 0)) return null;
  let step: (typeof RAIN_STEPS)[number] = RAIN_STEPS[0];
  for (const s of RAIN_STEPS) if (mm >= s.min) step = s;
  return step;
}

/** 段の色 */
export function rainColor(min: RainMin): string {
  return RAIN_STEPS.find((s) => s.min === min)!.color;
}

/** 凡例の読み上げの段（弱い方から。凡例の帯は左が弱い。T151） */
const STEP_WORDS = RAIN_STEPS.map((s) => s.label).join("、");

/** 訓練の雨の凡例の読み上げ */
export const RAIN_LEGEND_LABEL = `想定の雨 1 時間の降水量 mm/h: ${STEP_WORDS}`;

/** 本物の雨雲の凡例の読み上げ（hm は画像の時刻「02:20」） */
export function nowcastLegendLabel(hm: string): string {
  return `雨雲 ${hm} 時点 1 時間の降水量 mm/h: ${STEP_WORDS}`;
}
