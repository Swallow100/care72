"use client";

// 紙面の印刷（ブラウザの印刷の画面。PDF にするのもここから）。主の操作なので操作の色、プリンターのアイコン。
// T147: 押すと、刷る頁だけを画面に出した見本（lib/forms/print.ts の previewPrint）に切り替えてから、ブラウザの印刷の画面
// （プリンターを選ぶ所）を開く。印刷の画面を閉じても見本は残り、上の帯の「印刷」でもう一度、「閉じる」（Esc）で元の画面へ。
// auto を付けると、開いたときに 1 回だけ見本と印刷の画面を出す（本人のページの書類の行の「印刷」から ?print=1 で来たとき）。
// 書体を読み終えてから出す（読み終える前に出すと、紙の字が仮の書体になる）。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoPrint, closePreview, previewPrint, PRINT_PREVIEW_ATTR, PRINT_PREVIEW_LABELS as L } from "@/lib/forms/print";
import { Button } from "./Button";
import { CloseIcon, PrintIcon } from "./Icon";

export function PrintButton({ auto = false, label = "印刷" }: { auto?: boolean; label?: string }) {
  const done = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!auto || done.current) return;
    // 開発の Strict Mode で 2 回走っても 1 回だけ（ref で止める）
    done.current = true;
    // URL から print=1 を外してから出す（読み直しで何度も出さない。手順は lib/forms/print.ts、テストあり）。見本も出す
    if (new URL(window.location.href).searchParams.get("print") === "1") {
      document.documentElement.setAttribute(PRINT_PREVIEW_ATTR, "1");
      setOpen(true);
    }
    void autoPrint(window);
  }, [auto]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      closePreview(document);
    };
  }, [open]);

  const start = () => {
    setOpen(true);
    void previewPrint(window);
  };

  return (
    <>
      <Button kind="main" icon={PrintIcon} onClick={start} data-print-button>
        {label}
      </Button>
      {open &&
        createPortal(
          <div className="print-preview-bar" role="region" aria-label={L.title} data-print-preview-bar>
            <span className="font-bold">{L.title}</span>
            <span className="ml-auto flex gap-2">
              <Button kind="main" size="sm" icon={PrintIcon} onClick={() => window.print()} data-print-again>
                {L.print}
              </Button>
              <Button kind="plain" size="sm" icon={CloseIcon} onClick={() => setOpen(false)} data-print-close>
                {L.close}
              </Button>
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
