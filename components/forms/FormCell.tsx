// 紙面の欄の値（lib/forms の Cell）を描く。状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 選ぶ欄は ■（選んだ）と □。未確認は灰、台帳の pending は太字と理由（次の訪問の問い）。同意のない範囲は「省略」。

import type { Cell, Choice, Piece } from "@/lib/forms/matsuyama";
import { BLANK, withheldText } from "@/lib/forms/matsuyama";
import { PENDING_STATUS_LABELS } from "@/lib/labels";

/** 電話番号・日付・時刻・小数（090-0000-0011、2026-11-02、12:00、0.5）。紙ではこの途中で行を割らない */
const NUMBER_RUN = /(\d+(?:[-‐:/.]\d+)+)/;

/** 文の中の番号の並びを 1 つの塊（.nowrap）にする。ほかの所は禁則の決まりのまま折り返す */
export function KeepNumbers({ text }: { text: string }) {
  const parts = text.split(NUMBER_RUN);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((t, i) =>
        i % 2 === 1 ? (
          <span key={i} className="nowrap">
            {t}
          </span>
        ) : (
          t
        ),
      )}
    </>
  );
}

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
  return (
    <span className={cls || undefined}>
      <KeepNumbers text={p.text} />
    </span>
  );
}

const isSeparator = (p: Piece) => p.sub === true && p.text === "／";

/**
 * 1 行の値。「／」で区切った塊（薬 1 つの回数・用量、機器の電池・予備など）は塊の途中で行を割らず、塊の切れ目で折り返す。
 * 区切りの「／」は前の塊の終わりに付ける（行頭に「／」を出さない）
 */
function Pieces({ pieces }: { pieces: readonly Piece[] }) {
  if (!pieces.some(isSeparator)) {
    return (
      <>
        {pieces.map((p, i) => (
          <PieceText key={i} p={p} />
        ))}
      </>
    );
  }
  const groups: Piece[][] = [[]];
  for (const p of pieces) {
    groups[groups.length - 1].push(p);
    if (isSeparator(p)) groups.push([]);
  }
  return (
    <>
      {groups
        .filter((g) => g.length > 0)
        .map((g, i) => (
          <span key={i} className="grp">
            {g.map((p, j) => (
              <PieceText key={j} p={p} />
            ))}
          </span>
        ))}
    </>
  );
}

function Line({ pieces }: { pieces: readonly Piece[] }) {
  return (
    <span className="ln">
      <Pieces pieces={pieces} />
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
          {cell.after && <Pieces pieces={cell.after} />}
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
