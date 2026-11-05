// 言葉の長さの上限で切る所（T139）。評価の 4 回目で、本人役の言葉が上限（60 字）で文の途中から切れたまま画面と審査役に出た
// （着信の往復の返事は 11 中 9）。上限を超えた時は、上限の中の最後の文の切れ目（句点・感嘆・疑問）までにする。
// 切れ目が短すぎる所にしか無ければ読点まで（「…」を付けて、言いさしと分かる形に）。どちらも無ければ上限の手前で切って「…」。
// Claude を呼ばない。色と順には関わらない。輪にしない（ほかのファイルを読まない）

/** 文の終わりの字（閉じかっこは前の句点と一緒に残す） */
const END = /[。！？!?」』）)]/u;
/** 読点 */
const COMMA = /[、，,]/u;
/** 言いさしの印 */
export const CLIP_MARK = "…";

function lastIndex(chars: ReadonlyArray<string>, re: RegExp, from: number): number {
  for (let i = chars.length - 1; i >= from; i--) if (re.test(chars[i])) return i;
  return -1;
}

/**
 * 上限（字）を超えた言葉を文の切れ目で切る。上限の中に収まる言葉はそのまま。
 * 1. 上限の中の最後の文の終わり（上限の 3 分の 1 より後）まで
 * 2. 無ければ最後の読点（同じく 3 分の 1 より後）の前まで ＋「…」
 * 3. 無ければ短くても最初の文の終わりまで
 * 4. どれも無ければ上限の 1 字手前まで ＋「…」
 */
export function clipWords(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max);
  const floor = Math.floor(max / 3);
  const end = lastIndex(head, END, floor);
  if (end >= 0) return head.slice(0, end + 1).join("").trim();
  const comma = lastIndex(head.slice(0, max - 1), COMMA, floor);
  if (comma >= 0) return `${head.slice(0, comma).join("").trim()}${CLIP_MARK}`;
  const first = lastIndex(head, END, 0);
  if (first >= 0) return head.slice(0, first + 1).join("").trim();
  return `${head.slice(0, max - 1).join("").trim()}${CLIP_MARK}`;
}

/** 文の途中で終わっているか（台・テストの確かめ。文の終わりか「…」で終わらず、上限ちょうどの長さ） */
export function endsMidSentence(text: string, max: number): boolean {
  const t = text.trim();
  return Array.from(t).length >= max && !END.test(t.at(-1) ?? "") && !t.endsWith(CLIP_MARK);
}
