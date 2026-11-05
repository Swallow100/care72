"use client";

// 対応の欄（components/drill/ActionPanel.tsx）に本人・手・相手を渡す口（docs/tasks/T132.md）。画面の中の小さな状態で、URL は変えない。
// 送る側（行の詳細の連絡先の行 components/drill/ContactPick.tsx、T126 の候補など）は pickAct を呼ぶだけ、
// 受ける側（対応の欄）は useActPick で受けて、本人・手・相手を選んだ形にする。対応の欄が無い画面（再生）では何も起きない。
// 手の可否は送る側が決まりの表の結果を読んで決める（押せない手は送らない）。対応の欄は受けた物をそのまま選ぶだけ。

import { useEffect, useRef } from "react";
import type { DrillAction } from "@/lib/db/types";

export type ActPick = {
  /** 対象の本人の id */
  person: string;
  /** 手 */
  kind: DrillAction;
  /** 相手（台帳の連絡先の id）。相手を選ばない手（本人電話）・固定の相手の手は null */
  target: string | null;
};

const EVENT = "care72:act-pick";

/** 対応の欄に本人・手・相手を渡し、対応の欄を画面に入れる（離れた所にあるとき） */
export function pickAct(p: ActPick): void {
  window.dispatchEvent(new CustomEvent<ActPick>(EVENT, { detail: p }));
  document.querySelector("[data-action-panel]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** 渡された物を受ける（外すときは返した関数を呼ぶ）。useActPick の中身 */
export function onActPick(on: (p: ActPick) => void): () => void {
  const h = (e: Event) => on((e as CustomEvent<ActPick>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** 対応の欄が受ける口。on は毎回新しい関数でよい（最後に渡した物を呼ぶ） */
export function useActPick(on: (p: ActPick) => void): void {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => onActPick((p) => ref.current(p)), []);
}
