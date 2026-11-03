// 本人・家族のスマホの平時の画面: 本人の 1 枚（T06）の文をそのまま大きな字で（家族は段を絞る。T11）。紙の表（components/forms/OwnSheet.tsx）と同じ文で、
// 描き方だけスマホの幅に。電話は押すとかけられる（番号の無い行は紙では手で書く線なので、ここでは行ごと出さない。T77）。
// 119 の 1 行は一般の案内で、押してもかからない（押し間違いで救急にかけないように）。状態を持たない。

import { EasyWords } from "@/components/forms/EasyText";
import type { OwnBlock, OwnBlockId, OwnLine, OwnSheet } from "@/lib/forms/own-sheet";

export function SheetLine({ line }: { line: OwnLine }) {
  const tone = line.tone === "lead" ? "text-[1.75rem] font-bold" : line.tone === "sub" ? "text-lg text-muted" : "text-xl";
  return (
    <li className={tone} data-line={line.key}>
      <span>
        <EasyWords words={line.words} />
      </span>
      {line.phone?.number && (
        <a
          href={`tel:${line.phone.number}`}
          className="ml-2 inline-block rounded px-1 font-bold text-accent tabular-nums"
          data-press
          data-tel={line.phone.number}
        >
          {line.phone.number}
        </a>
      )}
    </li>
  );
}

/** 1 枚の段（見出しと行）。家族のスマホの答えたあとの「持って いく もの」も使う */
export function SheetBlock({ block }: { block: OwnBlock }) {
  return (
    <section className="rounded-lg bg-panel px-4 py-3" data-block={block.id}>
      <h2 className="text-lg font-bold text-muted">
        <EasyWords words={block.heading} />
      </h2>
      <ul className="mt-1 space-y-1">
        {block.lines.map((l) => (
          <SheetLine key={l.key} line={l} />
        ))}
      </ul>
    </section>
  );
}

/**
 * スマホの電話の段は、番号のある行だけ（T77、docs/progress/qa-20261104.md の低）。紙は番号の無い所に手で書く線を引くが、
 * スマホでは書けないので、番号の無い行（ケアマネ・かかりつけ。台帳・事業所に電話の欄がまだ無い）は出さない。行が無くなれば段ごと出さない
 */
export function phoneBlocks(blocks: readonly OwnBlock[]): OwnBlock[] {
  return blocks
    .map((b) => (b.id === "call" ? { ...b, lines: b.lines.filter((l) => Boolean(l.phone?.number)) } : b))
    .filter((b) => b.lines.length > 0);
}

/** only を渡すと、その段だけを並べる（家族・支援者のスマホ T11 は 逃げるところ・来てくれる人・持っていく物・電話） */
export function PhoneSheet({ sheet, only }: { sheet: OwnSheet; only?: readonly OwnBlockId[] }) {
  const blocks = phoneBlocks(only ? sheet.blocks.filter((b) => only.includes(b.id)) : sheet.blocks);
  return (
    <div className="phone-text space-y-3" data-phone="normal" data-person={sheet.personId}>
      <h1 className="px-1 text-2xl font-bold">
        <EasyWords words={sheet.title} />
      </h1>
      {blocks.map((b) => (
        <SheetBlock key={b.id} block={b} />
      ))}
      <p className="rounded-lg bg-panel px-4 py-3 text-xl" data-block="emergency">
        <EasyWords words={sheet.emergency} />
      </p>
    </div>
  );
}
