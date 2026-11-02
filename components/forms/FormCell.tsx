// 紙面の欄の値（lib/forms の Cell）を描く。状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 選ぶ欄は ■（選んだ）と □。未確認は灰、台帳の pending は太字と理由（次の訪問の問い）。同意のない範囲は「省略」。

import type { Cell, Choice, Piece } from "@/lib/forms/matsuyama";
import { BLANK, withheldText } from "@/lib/forms/matsuyama";
import { PENDING_STATUS_LABELS } from "@/lib/labels";

function PieceText({ p }: { p: Piece }) {
  if (p.unconfirmed) {
    return p.reason ? (
      <span className="p-unc-r" data-pending={p.reason}>
        {BLANK.unconfirmed}（{PENDING_STATUS_LABELS[p.reason]}）
      </span>
    ) : (
      <span className="p-unc">{BLANK.unconfirmed}</span>
    );
  }
  const cls = [p.sub ? "p-sub" : "", p.strong ? "p-strong" : ""].filter(Boolean).join(" ");
  return cls ? <span className={cls}>{p.text}</span> : <span>{p.text}</span>;
}

function Line({ pieces }: { pieces: readonly Piece[] }) {
  return (
    <span className="ln">
      {pieces.map((p, i) => (
        <PieceText key={i} p={p} />
      ))}
    </span>
  );
}

function ChoiceText({ c }: { c: Choice }) {
  return (
    <span className={c.on ? "ch on" : "ch"} data-on={c.on ? "1" : "0"}>
      {c.on ? "■" : "□"}
      {c.label}
      {c.detail && <>（{c.detail}）</>}
      {c.sub && (
        <>
          （
          {c.sub.map((s, i) => (
            <span key={s.label}>
              {i > 0 && " "}
              <ChoiceText c={s} />
            </span>
          ))}
          ）
        </>
      )}
    </span>
  );
}

export function FormCell({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "value":
      return (
        <>
          {cell.lines.map((l, i) => (
            <Line key={i} pieces={l} />
          ))}
        </>
      );
    case "choice":
      return (
        <span className="ln">
          {cell.options.map((c) => (
            <ChoiceText key={c.label} c={c} />
          ))}
          {cell.after?.map((p, i) => (
            <PieceText key={`a${i}`} p={p} />
          ))}
          {cell.unconfirmed && <PieceText p={{ text: BLANK.unconfirmed, unconfirmed: true, reason: cell.unconfirmed.reason }} />}
        </span>
      );
    case "unconfirmed":
      return <PieceText p={{ text: BLANK.unconfirmed, unconfirmed: true, reason: cell.reason }} />;
    case "none":
      return <span>{BLANK.none}</span>;
    case "withheld":
      return (
        <span className="p-withheld" data-withheld={cell.consent}>
          {withheldText(cell.consent)}
        </span>
      );
    case "handwrite":
      return <span className="hand" aria-hidden="true" />;
  }
}
