// 紙面の欄の値（lib/forms の Cell）を描く。状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 選ぶ欄は ■（選んだ）と □。未確認は小さく灰、台帳の pending は理由を括弧で（次の訪問の問い）。同意のない範囲は「省略」。
// 紙では値を太くしない（T47。太字は元の様式で太い所だけで、紙面の部品と paper.css が持つ）。
// 字は紙の書き方（数字と単位・年月日を詰める。lib/forms/paper-text.ts）。本人の言葉（Piece の raw）は台帳の文のまま。

import type { Cell, Choice, Piece } from "@/lib/forms/matsuyama";
import { BLANK, withheldText } from "@/lib/forms/matsuyama";
import { paperText } from "@/lib/forms/paper-text";
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

function PieceText({ p, tight }: { p: Piece; tight: boolean }) {
  if (p.unconfirmed) {
    return p.reason ? (
      <span className="p-unc-r" data-pending={p.reason}>
        {BLANK.unconfirmed}（{PENDING_STATUS_LABELS[p.reason]}）
      </span>
    ) : (
      <span className="p-unc">{BLANK.unconfirmed}</span>
    );
  }
  // 強め（strong）は画面の要約（QR の頁）でだけ太くする。紙（tight）では元の様式に無い太字を出さない（T47）
  const cls = [p.sub ? "p-sub" : "", p.strong && !tight ? "p-strong" : ""].filter(Boolean).join(" ");
  return (
    <span className={cls || undefined}>
      <KeepNumbers text={tight && !p.raw ? paperText(p.text) : p.text} />
    </span>
  );
}

const isSeparator = (p: Piece) => p.sub === true && p.text === "／";

/**
 * 1 行の値。「／」で区切った塊（薬 1 つの回数・用量、機器の電池・予備など）は塊の途中で行を割らず、塊の切れ目で折り返す。
 * 区切りの「／」は前の塊の終わりに付ける（行頭に「／」を出さない）
 */
function Pieces({ pieces, tight }: { pieces: readonly Piece[]; tight: boolean }) {
  if (!pieces.some(isSeparator)) {
    return (
      <>
        {pieces.map((p, i) => (
          <PieceText key={i} p={p} tight={tight} />
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
              <PieceText key={j} p={p} tight={tight} />
            ))}
          </span>
        ))}
    </>
  );
}

function Line({ pieces, tight }: { pieces: readonly Piece[]; tight: boolean }) {
  return (
    <span className="ln">
      <Pieces pieces={pieces} tight={tight} />
    </span>
  );
}

function ChoiceText({ c, tight }: { c: Choice; tight: boolean }) {
  const tx = (s: string) => (tight ? paperText(s) : s);
  return (
    <span className={c.on ? "ch on" : "ch"} data-on={c.on ? "1" : "0"}>
      {c.on ? "■" : "□"}
      {tx(c.label)}
      {c.detail && <>（{tx(c.detail)}）</>}
      {c.sub && (
        <>
          （
          {c.sub.map((s, i) => (
            <span key={s.label}>
              {i > 0 && " "}
              <ChoiceText c={s} tight={tight} />
            </span>
          ))}
          ）
        </>
      )}
    </span>
  );
}

/**
 * 欄の値。tight は紙の書き方（数字と単位・年月日を詰める）で、紙面の部品は既定のまま。
 * 画面で使う所（QR の頁の要約 components/qr/QrSummary）は false で、画面の書き方（「84 歳」）のまま
 */
export function FormCell({ cell, tight = true }: { cell: Cell; tight?: boolean }) {
  switch (cell.kind) {
    case "value":
      return (
        <>
          {cell.lines.map((l, i) => (
            <Line key={i} pieces={l} tight={tight} />
          ))}
        </>
      );
    case "choice":
      return (
        <span className="ln">
          {cell.options.map((c) => (
            <ChoiceText key={c.label} c={c} tight={tight} />
          ))}
          {cell.after && <Pieces pieces={cell.after} tight={tight} />}
          {cell.unconfirmed && (
            <PieceText p={{ text: BLANK.unconfirmed, unconfirmed: true, reason: cell.unconfirmed.reason }} tight={tight} />
          )}
        </span>
      );
    case "unconfirmed":
      return <PieceText p={{ text: BLANK.unconfirmed, unconfirmed: true, reason: cell.reason }} tight={tight} />;
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
