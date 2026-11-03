// 理由の 1 行を句の塊ごとに折れない箱で描く（lib/list/reason-chunks.ts。T80）。担当一覧・受入一覧の 375 で 1 字だけ次の行に落ちないように。
// 塊は inline-block（列より長ければ箱の中で折れる）、空白は箱の外の文字のまま。読み上げは元の 1 行と同じ文字。

import { Fragment } from "react";
import { REASON_SPACE, reasonChunks } from "@/lib/list/reason-chunks";

export function ReasonText({ text }: { text: string }) {
  return (
    <>
      {reasonChunks(text).map((c, i) =>
        c === REASON_SPACE ? (
          <Fragment key={i}>{" "}</Fragment>
        ) : (
          <span key={i} className="inline-block">
            {c}
          </span>
        ),
      )}
    </>
  );
}
