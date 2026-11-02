// 紙面の画面の上の帯（画面だけ。紙には出さない）。左上に戻る 1 つ、題と氏名、確かめの印、右に操作と印刷。
// 計画書・医療要約・本人の 1 枚・差し込み・QR で同じ形。印刷は window.print を呼ぶだけ（紙の見た目と @media print は紙面の側）。
// hide は印刷で消す class（紙面は screen-only、QR は qr-screen-only）。

import { BackLink } from "./Panel";
import { PrintButton } from "./PrintButton";

export function PaperBar({
  back,
  title,
  name,
  children,
  actions,
  print = true,
  autoPrint = false,
  hide = "screen-only",
  contained = false,
}: {
  back: string;
  title: React.ReactNode;
  name?: React.ReactNode;
  /** 確かめの印（未確認・手書き・QR の状態など） */
  children?: React.ReactNode;
  /** 印刷の左に並べる操作 */
  actions?: React.ReactNode;
  print?: boolean;
  /** 本人のページの書類の行の「印刷」から（?print=1）来たら、開いたときに 1 回だけ印刷の画面を出す */
  autoPrint?: boolean;
  hide?: string;
  /** 外の枠の幅に従う（QR の画面）。既定は紙の幅に合わせる */
  contained?: boolean;
}) {
  const box = contained ? "" : "mx-auto mb-4 max-w-[calc(210mm+2rem)] px-4";
  return (
    <div className={`${hide} ${box} flex flex-wrap items-center gap-x-3 gap-y-2`} data-paper-bar>
      <BackLink href={back} />
      <div className="text-[1rem] font-bold">
        {title} {name && <span className="font-normal text-muted">{name}</span>}
      </div>
      {children}
      {(actions || print) && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
          {print && <PrintButton auto={autoPrint} />}
        </div>
      )}
    </div>
  );
}

/** searchParams の print が "1" か（本人のページの書類の行の「印刷」から来たとき） */
export function wantsPrint(v: string | string[] | undefined): boolean {
  return v === "1";
}
