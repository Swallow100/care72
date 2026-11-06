// 地図に重ねる色の層は 1 度に 1 つ（T151b）。雨雲（平時の気象庁の雨雲・訓練の筋書きの雨）と浸水・土砂・津波の層は色が混ざって取り違えるので、
// - 雨雲を付けたら浸水・土砂・津波の層は外す（付いていた層は覚えておく）
// - 雨雲を外したら、雨雲を付ける前に付いていた層に戻す
// - 浸水などを付けたら雨雲は外す（覚えていた層も戻す）
// 全部の地図（担当一覧の右の面・全画面・訓練の地図。components/map/CaseMap.tsx）がこの 1 か所を使う。位置を置く地図と経路の窓は層を持たない。
// 雨も層も色と連絡順には使わない。

import type { HazardKind } from "../db/types.ts";

/** 選んだ層: 浸水・土砂・津波の層（雨雲を付けている間は、付ける前の層を覚えている）と、雨雲 */
export type LayerPick = { on: ReadonlySet<HazardKind>; rainOn: boolean };

/** 雨雲を地図に描いているか（雨雲が選ばれていて、描く雨〔気象庁の時刻・訓練の雨〕がある） */
export function rainShown(p: LayerPick, rainAvailable: boolean): boolean {
  return rainAvailable && p.rainOn;
}

const NONE: ReadonlySet<HazardKind> = new Set();

/** 今描く浸水・土砂・津波の層（雨雲を描いている間は無し。毎回同じ空の組を返す） */
export function shownHazards(p: LayerPick, rainAvailable: boolean): ReadonlySet<HazardKind> {
  return rainShown(p, rainAvailable) ? NONE : p.on;
}

/** 雨雲の切替。付けると層は描かなくなり（覚えたまま）、外すと前の層に戻る */
export function pickRain(p: LayerPick): LayerPick {
  return { on: p.on, rainOn: !p.rainOn };
}

/**
 * 浸水・土砂・津波の層の切替。雨雲を描いているときに押すと、雨雲を外して前の層に戻し、押した層も付ける。
 * 雨雲を描いていないときは、その層だけ付け外しする（付けたら雨雲は外したままにする）
 */
export function pickHazard(p: LayerPick, id: HazardKind, rainAvailable: boolean): LayerPick {
  if (rainShown(p, rainAvailable)) return { on: new Set([...p.on, id]), rainOn: false };
  const next = new Set(p.on);
  if (next.has(id)) {
    next.delete(id);
    return { on: next, rainOn: p.rainOn };
  }
  next.add(id);
  return { on: next, rainOn: false };
}
