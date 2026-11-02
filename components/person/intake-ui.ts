// 入れる欄の部品の見た目。操作の色は --accent の 1 色、押したときは灰色だけ（data-press）。
// 選んだ印にテーマ色の下地を敷かない（太字と下線・枠）。

/** 主のボタン（抽出・保存）。押したときは地の色を残して灰色を重ねる（data-press="overlay"） */
export const BTN_MAIN =
  "rounded bg-accent px-3 py-1 text-sm font-bold text-on-accent disabled:bg-panel2 disabled:text-muted";

/** 主のボタンの隣に並ぶボタン（話す・停止）。大きさは主のボタンと同じで、地は面の中の灰色 */
export const BTN_SIDE = "rounded bg-panel2 px-3 py-1 text-sm font-bold disabled:text-muted";

/** ふつうのボタン（取消・不明・無回答・次回・修正） */
export const BTN = "rounded bg-panel2 px-2 py-1 text-xs font-bold disabled:text-muted";

/** 入力の欄（面の上） */
export const INPUT =
  "w-full min-w-0 rounded bg-panel2 px-2 py-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** 入力の欄（面の中の区分の上。地が panel2 なので欄は白） */
export const INPUT_IN =
  "w-full min-w-0 rounded bg-panel px-2 py-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** ふつうのボタン（面の中の区分の上） */
export const BTN_IN = "rounded bg-panel px-2 py-1 text-xs font-bold disabled:text-muted";

/** 欄の名前と入力を並べる段 */
export const FIELD_ROW = "grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-2";

/** チェックの印（操作の色） */
export const CHECK = "size-3.5 shrink-0 accent-accent";
