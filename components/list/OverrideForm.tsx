"use client";

// ケアマネの上書き（docs/tasks/T13.md「ケアマネの上書き（上げる・下げる・理由）」）。
// 4 つの色から直す先を選び、理由を書いて保存。上書きがあれば解除（表の色に戻す）。経過に「優先修正」が残る。
// 色と並びは保存のあとにサーバーがルールの表で当て直す（画面では決めない）。上書きしたときの表の色もサーバーが決める。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { COLOR_LABELS } from "@/lib/labels";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { OVERRIDE_PATH } from "@/lib/list/paths";
import type { Color } from "@/lib/triage/index";

const ORDER: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

/** 色の文字の色（状態の 4 色。文字にだけ置く） */
const TEXT: Record<Color, string> = {
  red: "text-state-urgent",
  yellow: "text-state-check",
  gray: "text-state-unknown",
  green: "text-state-ok",
};

export function OverrideForm({ personId, color, overridden }: { personId: string; color: Color; overridden: boolean }) {
  const router = useRouter();
  const [to, setTo] = useState<Color | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function send(target: Color | null) {
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch(OVERRIDE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: personId, to: target, reason }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { label?: string } | null;
        setFailed(j?.label ?? "保存失敗");
        return;
      }
      setTo(null);
      setReason("");
      router.refresh();
    } catch {
      setFailed("保存失敗");
    } finally {
      setBusy(false);
    }
  }

  const canSave = to !== null && reason.trim() !== "" && !busy;
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void send(to);
      }}
    >
      <div role="radiogroup" aria-label={DETAIL_LABELS.override} className="flex flex-wrap gap-1">
        {ORDER.filter((c) => c !== color).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={to === c}
            onClick={() => setTo(to === c ? null : c)}
            className={`rounded-md bg-panel px-2 py-1 text-sm font-bold ${TEXT[c]} ${to === c ? "ring-2 ring-inset ring-accent" : ""}`}
            data-press
            data-override-to={c}
          >
            {COLOR_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder={DETAIL_LABELS.reasonInput}
          aria-label={DETAIL_LABELS.reasonInput}
          className="min-w-0 flex-1 rounded-md bg-panel px-2 py-1 text-sm outline-accent"
          data-override-reason
        />
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-md bg-accent px-3 py-1 text-sm font-bold text-on-accent disabled:bg-panel disabled:text-muted"
          data-press="overlay"
        >
          {DETAIL_LABELS.save}
        </button>
        {overridden && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(null)}
            className="rounded-md bg-panel px-2 py-1 text-sm"
            data-press
            data-override-clear
          >
            {DETAIL_LABELS.clear}
          </button>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-sm font-bold text-danger">
          {failed}
        </p>
      )}
    </form>
  );
}
