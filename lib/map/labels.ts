// 地図の画面の言葉（T46 の全画面）。ボタン・状態は 2〜4 字の漢語。新しく出した言葉は docs/progress/t46.md の「言葉」に載せる。

export const MAP_UI = {
  /** 地図の見出しと、全画面の読み上げの名前 */
  title: "地図",
  /** 小さな地図から全画面へ */
  full: "全画面",
  /** 全画面を閉じる（Escape と同じ） */
  close: "閉じる",
  zoomIn: "拡大",
  zoomOut: "縮小",
  /** 全員が入るズームに戻す */
  fit: "全体",
  /** 今のズームの段（ズーム 13） */
  zoom: "ズーム",
  /** 層を選んでいるが、今のズームの段では出せない（ハザードの層はズーム 17 まで） */
  outOfRange: "範囲外",
  /** 位置の無い人の数（位置なし 1 人） */
  unplaced: "位置なし",
} as const;

/** まとめたピンの数（他 2 人）。顔の人の名前の印の横に出す */
export function othersLabel(n: number): string {
  return `他 ${n} 人`;
}
