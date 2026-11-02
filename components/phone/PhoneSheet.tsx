// 本人のスマホの平時の画面: 本人の 1 枚（T06）の文をそのまま大きな字で。紙の表（components/forms/OwnSheet.tsx）と同じ文で、
// 描き方だけスマホの幅に。電話は押すとかけられる（番号の無い所は紙では手で書く線なので、ここでは出さない）。
// 119 の 1 行は一般の案内で、押してもかからない（押し間違いで救急にかけないように）。状態を持たない。

import { EasyWords } from "@/components/forms/EasyText";
import type { OwnLine, OwnSheet } from "@/lib/forms/own-sheet";

function Line({ line }: { line: OwnLine }) {
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

export function PhoneSheet({ sheet }: { sheet: OwnSheet }) {
  return (
    <div className="phone-text space-y-3" data-phone="normal" data-person={sheet.personId}>
      <h1 className="px-1 text-2xl font-bold">
        <EasyWords words={sheet.title} />
      </h1>
      {sheet.blocks.map((b) => (
        <section key={b.id} className="rounded-lg bg-panel px-4 py-3" data-block={b.id}>
          <h2 className="text-lg font-bold text-muted">
            <EasyWords words={b.heading} />
          </h2>
          <ul className="mt-1 space-y-1">
            {b.lines.map((l) => (
              <Line key={l.key} line={l} />
            ))}
          </ul>
        </section>
      ))}
      <p className="rounded-lg bg-panel px-4 py-3 text-xl" data-block="emergency">
        <EasyWords words={sheet.emergency} />
      </p>
    </div>
  );
}
