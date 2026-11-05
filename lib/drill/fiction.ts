// 訓練の人の印と、仮想モードの結末を出すか（T70 の続き）。Claude を呼ばない。
//
// - デモ事業所: 訓練の人は種の 10 人（作った例）。印は今までどおり「架空」（AI が演じる架空の人、T48）。仮想モードの結末も出す（T53）
// - デモ以外の事業所: 本人役は本物の利用者の台帳から作る（T70）。印は「本人役」（AI が演じる訓練の本人役）。
//   仮想モードの結末（AI が決める生き死に）は出さない。実在の人の仮名に結末を付けないため。世界（部屋・1 回呼び）に結末を求めず、
//   返ってきても捨てる（lib/drill/world-apply.ts の endings）。条件に達した人（時計の計算）の数は出してよい

import { isSeedOfficeId } from "../auth/demo.ts";

/** fictional はデモ事業所の架空の人、role はデモ以外の事業所の訓練の本人役 */
export type FictionKind = "fictional" | "role";

export function fictionKindOf(officeId: string): FictionKind {
  return isSeedOfficeId(officeId) ? "fictional" : "role";
}

/** 仮想モードの結末を出す（世界に決めさせる）事業所か。デモ事業所だけ */
export function endingsAllowed(officeId: string): boolean {
  return fictionKindOf(officeId) === "fictional";
}
