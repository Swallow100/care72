"use client";

// 押すとその下に開く一覧（役変更など）。別の画面に移らず、すぐ開く。外を押す・Esc で閉じる。
// 開く前から中身を描いておくので、押した瞬間に出る（サーバーを待たない）。

import { useEffect, useId, useRef, useState } from "react";
import { buttonClass, type ButtonKind, type ButtonSize } from "./Button";
import { OpenIcon } from "./Icon";

export function Menu({
  label,
  icon: I,
  kind = "plain",
  size = "md",
  align = "right",
  hint,
  children,
}: {
  label: string;
  /** 開くと何があるか（読み上げの名前と、マウスを載せたときの字。T166） */
  hint?: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  kind?: ButtonKind;
  size?: ButtonSize;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={hint ? `${label} ${hint}` : undefined}
        title={hint}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass(kind, size, open ? "outline-2 -outline-offset-2 outline-accent" : "")}
        data-press
      >
        {I && <I aria-hidden className="size-4 shrink-0" />}
        {label}
        <OpenIcon aria-hidden className={`size-4 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={id}
        hidden={!open}
        className={`absolute top-full z-30 mt-1 min-w-56 rounded-lg bg-panel p-1 shadow-[0_2px_8px_rgb(0_0_0/0.18)] dark:bg-panel2 dark:shadow-[0_2px_10px_rgb(0_0_0/0.6)] ${align === "right" ? "right-0" : "left-0"}`}
      >
        {children}
      </div>
    </div>
  );
}
