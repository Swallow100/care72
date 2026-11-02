"use client";

import { useState } from "react";

// 文をクリップボードに写すボタン。写せないとき（権限が無い・古いブラウザ）は、同じ文の欄（targetId）を選んで手で写せるようにする
export function CopyButton({ text, targetId }: { text: string; targetId?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      const el = targetId ? document.getElementById(targetId) : null;
      if (el instanceof HTMLTextAreaElement) {
        el.focus();
        el.select();
      }
      setState("failed");
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-on-accent"
        data-press="overlay"
      >
        コピー
      </button>
      <span role="status" className="text-sm">
        {state === "done" && <span className="font-bold text-state-ok">コピー済</span>}
        {state === "failed" && <span className="font-bold text-state-check">選択済</span>}
      </span>
    </span>
  );
}
