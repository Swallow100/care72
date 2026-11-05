// 入れる欄（components/person/Intake.tsx）のやり取りの並べ方と、今の問いの選び方（T138）。画面を持たない関数だけ（テストで確かめる）。
//
// やり取りは「組」に分けて、新しい組を上に並べる。組の中は起きた順（上から読める）:
// - 文・写真の組: ケアマネの入力（右）→ AI の返事（左。失敗のあとの再試行の返事も同じ組）
// - 問いの組: 問い（左）→ ケアマネの答え（右）。文で答える問いは、そのあとに AI の返事（左）が続く
// 組を逆にするだけで、吹き出しの順は逆にしない（逆にすると答えが問いの上に来て読めない）。

/** 吹き出しの書き手。you はケアマネ（右）、ai は Claude の出力（左）、ask は定型の問い（左）、app は失敗の 1 行 */
type Who = "you" | "ai" | "ask" | "app";

/**
 * やり取りを組に分け、新しい組を先に返す。
 * 組の始まりは 問い（ask）と、問いの直後でないケアマネの入力（you）。AI の返事と失敗の行はその前の組に入る
 */
export function logTurns<E extends { who: Who }>(log: readonly E[]): E[][] {
  const turns: E[][] = [];
  for (const [i, e] of log.entries()) {
    const prev = log[i - 1];
    const starts = turns.length === 0 || e.who === "ask" || (e.who === "you" && prev?.who !== "ask");
    if (starts) turns.push([e]);
    else turns[turns.length - 1].push(e);
  }
  return turns.reverse();
}

/** 畳まずに見せる組の数（新しい方から）。古い組は「以前 N 件」で開く */
export const TURNS_SHOWN = 4;

/**
 * 見せる組と畳んだ組の数。all のときは全部。keep の組（まだ保存していない変更点のある組）は古くても畳まない
 */
export function visibleTurns<E>(turns: readonly E[][], all: boolean, keep: (turn: readonly E[]) => boolean): { shown: E[][]; folded: number } {
  if (all) return { shown: [...turns], folded: 0 };
  const shown = turns.filter((t, i) => i < TURNS_SHOWN || keep(t));
  return { shown, folded: turns.length - shown.length };
}

/**
 * 今の問いと残りの数。hidden はこの画面で答えた・「次回」にした欄で、保存のあとページを読み直す前から次の問いに替える。
 * 保存に失敗した答えは hidden に入れない（同じ問いが残る）
 */
export function currentAsk<Q extends { key: string }>(queue: readonly Q[], hidden: readonly string[]): { question: Q | null; left: number } {
  // 選び方は lib/intake/ask.ts の nextQuestion と同じ（並びの先頭から、飛ばした欄を除く）
  const open = queue.filter((q) => !hidden.includes(q.key));
  return { question: open[0] ?? null, left: open.length };
}
