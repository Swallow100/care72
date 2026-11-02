// 表の見た目。表は 1 つの面にまとめ、行は地の色の 1px のすき間で分ける（線は引かない。白い棒を行ごとに浮かせない）。
// 見出しの行は面の中の灰色。セルは詰めて密度を上げ、PC の幅（1280px・1440px）では横に送らない。
// 使い方: <div className={TABLE_BOX}><table className={TABLE}> … <th className={TH}> … <td className={TD}>

/** 表の入れ物。角は外側に 1 回だけ。横に送らない（収まらない列は字を詰めるか、1024px で省く） */
export const TABLE_BOX = "overflow-hidden rounded-lg bg-base";

/** 表。行のすき間（1px）に地の色が見える */
export const TABLE = "w-full border-separate border-spacing-x-0 border-spacing-y-px text-left text-sm";

/** 見出しのセル */
export const TH = "bg-panel2 px-2 py-1.5 align-middle text-xs leading-5 font-bold whitespace-nowrap text-muted";

/** 本文のセル */
export const TD = "bg-panel px-2 py-1.5 align-top";

/** 詰めたセル（様式 9 のように列の多い表） */
export const TD_TIGHT = "bg-panel px-1.5 py-1 align-top";
