// 役の一覧（lib/auth/choices.ts の roleChoicesFor）を画面の行にまとめる（T180）。ヘッダーの役変更（components/ui/RoleMenu.tsx）と
// 役選択の画面（app/login/role）で同じ形。D1 にも Next にも触らない（client の部品からも読む）。
//
// row の無い項目は 1 行に 1 つ（デモの 4 つの役と「新規事業所」）。row のある項目は、続く同じ row の項目と 1 行にまとめる
// （左に row の言葉、右に項目のボタン。新規事業所のケアマネ・医療班・利用者ごとの本人と家族）。note は押せない 1 行。

export type ChoiceLike = { role: string; label: string; sub: string | null; row?: string; name?: string; note?: true };

export type ChoiceBlock<T extends ChoiceLike> =
  | { kind: "one"; item: T }
  | { kind: "row"; label: string; items: T[] }
  | { kind: "note"; label: string };

export function choiceBlocks<T extends ChoiceLike>(items: readonly T[]): ChoiceBlock<T>[] {
  const out: ChoiceBlock<T>[] = [];
  for (const item of items) {
    if (item.note) {
      out.push({ kind: "note", label: item.label });
      continue;
    }
    if (item.row === undefined) {
      out.push({ kind: "one", item });
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === "row" && last.label === item.row) last.items.push(item);
    else out.push({ kind: "row", label: item.row, items: [item] });
  }
  return out;
}

/** 続く row・note の塊を 1 つの面にまとめる（新規事業所の中の役。地の色を 1 段変えて「新規事業所」の下に置く） */
export function choiceGroups<T extends ChoiceLike>(items: readonly T[]): Array<{ nested: boolean; blocks: ChoiceBlock<T>[] }> {
  const out: Array<{ nested: boolean; blocks: ChoiceBlock<T>[] }> = [];
  for (const b of choiceBlocks(items)) {
    const nested = b.kind !== "one";
    const last = out.at(-1);
    if (last && last.nested === nested) last.blocks.push(b);
    else out.push({ nested, blocks: [b] });
  }
  return out;
}
