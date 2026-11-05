"use client";

// 対応の欄（components/drill/ActionPanel.tsx）に本人・手・相手を渡す 1 つの口（docs/tasks/T132.md、T126 の候補と共有）。
// 画面の中の小さな状態（window の出来事）で、URL は変えない。送る側は pickAct を呼ぶだけ:
//   - 本人の詳細の打てる手の候補（T126、components/drill/ActionHints.tsx の DetailHints）: 本人と手（相手は無し）
//   - 本人の詳細の連絡先の行（T132、components/drill/ContactPick.tsx）: 本人と連絡の手とその連絡先
// 受ける側（対応の欄）は useActPick で受けて、本人・手・相手を選んだ形にし、自分を見える所へ送る。
// 対応の欄が無い画面（再生・終わった訓練）では何も起きない。手の可否は送る側が決まりの表の結果を読んで決める（押せない物は送らない）。

import { useEffect, useRef } from "react";
import type { DrillAction } from "@/lib/db/types";

export type ActPick = {
  /** 対象の本人の id */
  person: string;
  /** 手 */
  kind: DrillAction;
  /**
   * 相手（台帳の連絡先の id）。無い・null なら対応の欄の既定（固定の相手のある手は固定の相手、ほかは未選択）。
   * 本人電話は相手を選ばない手なので null
   */
  target?: string | null;
};

/** 出来事の名前（T126 の候補と T132 の連絡先の行で共有） */
export const ACT_PICK_EVENT = "care72:act-pick";

/** 対応の欄に本人・手・相手を渡す */
export function pickAct(p: ActPick): void {
  window.dispatchEvent(new CustomEvent<ActPick>(ACT_PICK_EVENT, { detail: p }));
}

/** 渡された物を受ける（外すときは返した関数を呼ぶ）。useActPick の中身 */
export function onActPick(on: (p: ActPick) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<ActPick>).detail;
    if (d) on(d);
  };
  window.addEventListener(ACT_PICK_EVENT, h);
  return () => window.removeEventListener(ACT_PICK_EVENT, h);
}

/** 対応の欄が受ける口。on は毎回新しい関数でよい（最後に渡した物を呼ぶ） */
export function useActPick(on: (p: ActPick) => void): void {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => onActPick((p) => ref.current(p)), []);
}
