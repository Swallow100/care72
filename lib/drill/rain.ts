// 訓練の想定の雨（docs/tasks/T103.md、強さを降水量にしたのは T116）。大雨の想定（lib/drill/scenarios.ts の heavy_rain と、それを寄せた
// 10 分版）の地図の雨の表。地図（lib/map/drill-rain.ts）はこの表の種と時刻ごとの形から雨の帯を作る。時計も乱数も読まないので、
// サーバーと手元で同じ絵になる。
//
// - 形と道筋は架空。発災のすぐあとに強まり、半日ほど強い雨が続いて、1 日ほどかけて弱まって抜ける長さは、出典の登録簿の過去の雨
//   （basis）を参考にした。気象庁の雨雲の画像・数値は使っていない（画面には「デモ」の印と「想定値」を出す）
// - 強さは帯の芯の 1 時間の降水量（mm/h）。地図は気象庁の降水ナウキャストと同じ 8 段の色で塗る（lib/map/rain-scale.ts。T116）
// - 想定の出来事との合わせ: 0 時間 警戒レベル 3 で南西から近づく（芯 10〜20）→ 1 時間 レベル 4（芯 30〜50）→ 3 時間 川の氾濫
//   （いちばん強い）→ 9 時間 山すその道の土砂（雨の芯が北東の山へ）→ 24 時間 レベル 3 に引き下げ（芯 5〜10）→ 30 時間で抜ける → 72 時間 解除
// - 表の芯の降水量は、その時刻の世界の警戒レベルの上限（lib/map/demo.ts の RAIN_CAP_MM）より弱い。描くときも上限より上の段は描かない
//   （連続の時計で表の時刻の間を補ったときも、地図の雨が被害状況より強くならない）
// - 雨は色と連絡順に使わない（lib/triage はこの表を読まない）。本人ごとの「家の雨」も作らない（地点の予報にしない）

import type { DrillScenario } from "../db/types.ts";
import type { SourceId } from "../sources/index.ts";

/**
 * 雨の帯の 1 つの時刻の形。位置は利用者の位置の範囲の真ん中（lib/map/drill-rain.ts の rainAnchor）から東・北へ km。
 * length は帯の長さ（km）、width は帯の半分の幅（km）、peak は帯の芯の 1 時間の降水量（mm/h。0 は雨なし）
 */
export type RainKey = { hour: number; east: number; north: number; length: number; width: number; peak: number };

export type RainTrack = {
  /** 縁の形と小さな雨の置き方の種（決まった整数） */
  seed: number;
  /** 帯の向き（東から北へ、度）。線状に並ぶ雨の帯の向き */
  axisDeg: number;
  /** 帯の中の雨の塊が帯に沿って流れる速さ（km/時。縁の凹凸が北東へ流れる） */
  flow: number;
  /** 時刻ごとの形（時刻の順）。間は線で補う。最後の時刻（peak 0）のあとは雨なし */
  keys: readonly RainKey[];
  /** 参考にした過去の雨（出典の登録簿の id） */
  basis: SourceId;
};

/** 大雨の想定の雨。南西から北東へ帯がゆっくり動き、3 時間でいちばん強く、24 時間で弱いだけ、30 時間で抜ける */
export const HEAVY_RAIN_TRACK: RainTrack = {
  seed: 7203,
  axisDeg: 32,
  flow: 6,
  keys: [
    // 強い芯（帯の南西寄り）が 3 時間に南の低い所（浸水の想定の地区の辺り）、9 時間に北東の山すそを通るように置いた。
    // 帯は本物の線状の雨より小さい（担当一覧の地図の 1 枚に縁が見える大きさ）。
    // 芯の降水量: レベル 3 の時刻は 20 未満、レベル 4 の時刻は 50 未満（警戒レベルの上限より弱い）
    { hour: 0, east: -2.1, north: -5.6, length: 14, width: 1.9, peak: 14 },
    { hour: 1, east: 0.2, north: -3.4, length: 17, width: 2.2, peak: 34 },
    { hour: 3, east: 2, north: -1.7, length: 20, width: 2.4, peak: 46 },
    { hour: 6, east: 3.5, north: 0.8, length: 20, width: 2.4, peak: 40 },
    { hour: 9, east: 4.9, north: 3.2, length: 19, width: 2.3, peak: 33 },
    { hour: 12, east: 6.7, north: 5.6, length: 17, width: 2.1, peak: 24 },
    { hour: 18, east: 9.5, north: 8.3, length: 14, width: 1.8, peak: 15 },
    { hour: 24, east: 12, north: 10.5, length: 11, width: 1.5, peak: 8 },
    { hour: 30, east: 14.5, north: 12.5, length: 8, width: 1.1, peak: 0 },
  ],
  basis: "jma-h30-july-rain-2018",
};

/** 想定ごとの雨の表。10 分版は大雨を寄せた物なので同じ表。地震と仮想（街の出来事は世界の部屋が決める）は持たない */
export const RAIN_TRACKS: Readonly<Partial<Record<DrillScenario, RainTrack>>> = {
  heavy_rain: HEAVY_RAIN_TRACK,
  short: HEAVY_RAIN_TRACK,
};

export function rainTrackOf(id: DrillScenario): RainTrack | null {
  return RAIN_TRACKS[id] ?? null;
}
