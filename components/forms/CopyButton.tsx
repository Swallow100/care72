"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";

// 文をクリップボードに写すボタン（components/ui の Button、無色・コピーのアイコン）。
// 写せないとき（権限が無い・古いブラウザ）は、同じ文の要素（targetId）の中身を選んで手で写せるようにする（欄でも、文の箱でも）
export function CopyButton({ text, targetId }: { text: string; targetId?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      const el = targetId ? document.getElementById(targetId) : null;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.focus();
        el.select();
      } else if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setState("failed");
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button icon={CopyIcon} onClick={() => void copy()}>
        コピー
      </Button>
      <span role="status" className="text-sm">
        {state === "done" && <StateText tone="ok">コピー済</StateText>}
        {state === "failed" && <StateText tone="check">選択済</StateText>}
      </span>
    </span>
  );
}
