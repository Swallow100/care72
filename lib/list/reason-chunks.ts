// 理由の 1 行（ルールの表の言葉）を、折ってよい所で分ける（T80、2 回目の点検の 375）。日本語はどの字の間でも折れるので、
// 375 の担当一覧で「本人が「けが」「動けない」」の最後の 1 字が次の行に落ちていた。言葉は表のまま（並べ直さない・削らない）、
// 画面で句の塊ごとに折れない箱にするための分け方だけ。塊が列より長いときは箱の中で折れる（はみ出さない）。
//
// 折ってよい所: 「、」のあと、空白、「」のあとの「（」」「」の間）。数と単位（「3 時間」「4.2 時間」）の間の空白では折らない。

/** 空白（塊の外に置く。つなぎ直すと元の 1 行と同じ） */
export const REASON_SPACE = " ";

/** 理由の 1 行を塊と空白の列に。join("") で元に戻る */
export function reasonChunks(text: string): string[] {
  const out: string[] = [];
  for (const seg of text.split(/(?<=、)/)) {
    if (seg === "") continue;
    const words = seg.split(" ");
    // 数だけの語は次の語（単位）とつなぐ
    const merged: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (/^[\d.]+$/.test(w) && i + 1 < words.length) {
        merged.push(`${w} ${words[i + 1]}`);
        i++;
      } else merged.push(w);
    }
    merged.forEach((w, i) => {
      if (i > 0) out.push(REASON_SPACE);
      if (w !== "") out.push(...w.split(/(?<=」)(?=「)/));
    });
  }
  return out;
}
