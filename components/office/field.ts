// 事業所の画面の client の欄の形（ケアマネ追加・改名・パスワードの欄で同じ）。部品どうしが互いを読まずに済むよう、ここに 1 か所（T148）。
// 地は面の中の灰色の上の白（panel）。受入一覧の白い面の上では OwnPassword.tsx が panel2 に替える。

/** 入れる欄の形 */
export const INPUT =
  "h-8 w-full min-w-0 rounded bg-panel px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
