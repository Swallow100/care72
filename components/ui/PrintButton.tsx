"use client";

// 紙面の印刷（ブラウザの印刷の画面。PDF にするのもここから）。主の操作なので操作の色、プリンターのアイコン。
// T147: 押すと、刷る頁だけを画面に出した見本（lib/forms/print.ts の previewPrint）に切り替えてから、ブラウザの印刷の画面
// （プリンターを選ぶ所）を開く。印刷の画面を閉じても見本は残り、上の帯の「印刷」でもう一度、「見本終了」（Esc）で元の画面へ。
// auto を付けると、開いたときに 1 回だけ見本と印刷の画面を出す（本人のページの書類の行の「印刷」から ?print=1 で来たとき）。
// 書体を読み終えてから出す（読み終える前に出すと、紙の字が仮の書体になる）。
// T162: 押したことが印刷の画面の出る前から分かるように、見本の帯に「印刷窓 準備中」→「印刷窓 表示済 時刻」の状態と「再印刷」。
// 帯の左に「戻る」（紙面の画面の戻ると同じ行き先。見本を閉じて前の画面へ）。見本の間も上の帯（画面の切替）は残す（帯は上の帯の直下に留める）。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoPrint, closePreview, previewPrint, PRINT_PREVIEW_ATTR, PRINT_PREVIEW_LABELS as L, printPhaseText, type PrintPhase } from "@/lib/forms/print";
import { Button } from "./Button";
import { CloseIcon, PrintIcon } from "./Icon";
import { BackLink } from "./Panel";

/** 見本の帯を置く所（上の帯 components/AppHeader の直下。無ければ body の頭） */
export const PRINT_PREVIEW_SLOT_ATTR = "data-print-preview-slot";

function previewSlot(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute(PRINT_PREVIEW_SLOT_ATTR, "");
  el.className = "print-preview-slot";
  const header = document.querySelector("[data-app-header]");
  if (header) header.after(el);
  else document.body.prepend(el);
  return el;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function PrintButton({ auto = false, label = "印刷", back }: { auto?: boolean; label?: string; /** 見本の帯の「戻る」の行き先（紙面の画面の戻ると同じ） */ back?: string }) {
  const done = useRef(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PrintPhase>("idle");
  const [at, setAt] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const shown = () => {
    setPhase("shown");
    setAt(hhmm(new Date()));
  };

  useEffect(() => {
    if (!auto || done.current) return;
    // 開発の Strict Mode で 2 回走っても 1 回だけ（ref で止める）
    done.current = true;
    // URL から print=1 を外してから出す（読み直しで何度も出さない。手順は lib/forms/print.ts、テストあり）。見本も出す
    if (new URL(window.location.href).searchParams.get("print") === "1") {
      document.documentElement.setAttribute(PRINT_PREVIEW_ATTR, "1");
      setOpen(true);
      setPhase("preparing");
    }
    void autoPrint(window).then((printed) => (printed ? shown() : setPhase("idle")));
  }, [auto]);

  useEffect(() => {
    if (!open) return;
    const el = previewSlot();
    setSlot(el);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      closePreview(document);
      el.remove();
      setSlot(null);
      setPhase("idle");
    };
  }, [open]);

  const start = () => {
    setOpen(true);
    setPhase("preparing");
    void previewPrint(window).then(shown);
  };

  const again = () => {
    setPhase("preparing");
    // 準備中の字を描いてから印刷の画面を出す（window.print は出ている間、画面の描き直しを止める）
    window.setTimeout(() => {
      window.print();
      shown();
    }, 0);
  };

  const busy = phase === "preparing";
  return (
    <>
      <Button kind="main" icon={PrintIcon} onClick={start} disabled={busy} data-print-button data-pending={busy && !open ? "" : undefined}>
        {label}
      </Button>
      {open &&
        slot &&
        createPortal(
          <div className="print-preview-bar" role="region" aria-label={L.title} aria-busy={busy || undefined} data-print-preview-bar data-print-phase={phase}>
            {back && <BackLink href={back} label={L.back} />}
            <span className="font-bold">{L.title}</span>
            <span role="status" className="text-sm" data-print-status={phase}>
              {phase !== "idle" && (
                <>
                  <span className="text-muted">{L.window}</span> <span className="font-bold">{printPhaseText(phase)}</span>
                  {phase === "shown" && at && <span className="ml-1 text-muted tabular-nums">{at}</span>}
                </>
              )}
            </span>
            <span className="ml-auto flex gap-2">
              <Button kind="main" size="sm" icon={PrintIcon} onClick={again} disabled={busy} data-print-again data-pending={busy ? "" : undefined}>
                {phase === "shown" ? L.again : L.print}
              </Button>
              <Button kind="plain" size="sm" icon={CloseIcon} onClick={() => setOpen(false)} data-print-close>
                {L.close}
              </Button>
            </span>
          </div>,
          slot,
        )}
    </>
  );
}
