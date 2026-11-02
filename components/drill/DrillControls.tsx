"use client";

// 訓練の操作（docs/tasks/T17.md）: 進める（既定）・早送り（切替）・中断。1 回押すと 1 刻みだけ進む（1 要求で 1 刻み）。
// 早送りは、前の刻みの保存が終わってから次の刻みを呼ぶ（ブラウザから 1 刻みずつ）。最後の刻みか、中断・失敗で止まる。
// 進めたら画面を読み直す（router.refresh）。保存は刻みごとなので、閉じても次に開けば続きから。
// 断られたら理由を 1 行（競合 再読込・終了済など）。押したときは灰色だけ（data-press）。

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DRILL_LABELS } from "@/lib/drill/labels";

/** 早送りの 1 刻みの間（画面の色が変わるのを見られるように） */
const FAST_MS = 2500;

const BUTTON = "rounded-md px-3 py-1.5 text-sm font-bold";

export function DrillControls({ id, step, done }: { id: string; step: number; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fast, setFast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  /** 最後に送った刻み。画面がその次の刻みを読み直すまで、早送りは次を呼ばない */
  const sentRef = useRef<number | null>(null);

  const advance = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    sentRef.current = stepRef.current;
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(id)}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepRef.current }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string; status?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.label ?? String(res.status));
        router.refresh();
        return false;
      }
      router.refresh();
      return body.status === "running";
    } catch {
      setError(DRILL_LABELS.network);
      return false;
    } finally {
      setBusy(false);
    }
  }, [id, router]);

  // 早送り: 画面が次の刻みを読み直したら（step が変わったら）、間を置いて次を呼ぶ
  useEffect(() => {
    if (!fast || done || busy) return;
    if (sentRef.current !== null && step <= sentRef.current) return;
    const t = setTimeout(async () => {
      const more = await advance();
      if (!more) setFast(false);
    }, FAST_MS);
    return () => clearTimeout(t);
  }, [fast, done, busy, step, advance]);

  useEffect(() => {
    if (done) setFast(false);
  }, [done]);

  const abandon = async () => {
    setBusy(true);
    setError(null);
    setFast(false);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(id)}/abandon`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !body?.ok) setError(body?.label ?? String(res.status));
      setConfirm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (done) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-controls>
      <button
        type="button"
        onClick={() => void advance()}
        disabled={busy || fast}
        className={`${BUTTON} bg-accent text-on-accent disabled:opacity-60`}
        data-press="overlay"
        data-action="advance"
      >
        {DRILL_LABELS.advance}
      </button>
      <label className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm" data-press>
        <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className="size-4 accent-accent" data-action="fast" />
        {DRILL_LABELS.fastForward}
      </label>
      {confirm ? (
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => void abandon()} disabled={busy} className={`${BUTTON} text-danger`} data-press data-action="abandon-confirm">
            {DRILL_LABELS.confirmAbandon}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className={`${BUTTON} font-normal text-muted`} data-press>
            {DRILL_LABELS.cancel}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setFast(false);
            setConfirm(true);
          }}
          disabled={busy}
          className={`${BUTTON} font-normal text-muted`}
          data-press
          data-action="abandon"
        >
          {DRILL_LABELS.abandon}
        </button>
      )}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
