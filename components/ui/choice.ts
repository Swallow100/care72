// ラジオボタンとチェックボックスの大きさ（T79、11/4 の点検の低: 事業所の物が既定の 13px で押しにくかった）。
// 印そのものは 18px、押せる所は周りの label（高さ 36px 以上、地の色の箱）。選んだ印の色は操作の色（accent-accent）
export const CHOICE_INPUT = "size-[1.125rem] shrink-0 accent-accent";
/** 印と言葉を囲む押せる箱（面の上の灰色の地） */
export const CHOICE_LABEL = "flex min-h-9 cursor-pointer items-center gap-2 rounded bg-panel2 px-2.5 text-sm";
