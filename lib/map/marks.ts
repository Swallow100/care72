// 地図に重ねる場所の印（T170。仮想の訓練の世界の出来事）。人のピンと別の物で、人の状態の色を使わない。
// 出来事は訓練の想定なので、地図の上に「デモ」の帯を出す（components/map/CaseMap.tsx）。

import type { GeoPoint } from "../db/types.ts";

export type MapMark = {
  id: string;
  at: GeoPoint;
  /** 全画面の言葉（場所と出来事） */
  label: string;
  /** 小さな地図の言葉（出来事だけ） */
  short: string;
  title: string;
};

/** 地図の上の帯の言葉 */
export const MARK_BAND = { head: "デモ", title: "世界の出来事", tail: "訓練の想定" } as const;
