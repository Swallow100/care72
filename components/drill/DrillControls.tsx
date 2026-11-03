"use client";

// 訓練の操作（docs/tasks/T17.md）: 進める（既定）・早送り（切替）・中断。1 回押すと 1 刻みだけ進む（1 要求で 1 刻み）。
// 早送りは、前の刻みの保存が終わってから次の刻みを呼ぶ（ブラウザから 1 刻みずつ）。最後の刻みか、中断・失敗で止まる。
// 進めたら画面を読み直す（router.refresh）。保存は刻みごとなので、閉じても次に開けば続きから。
// 断られたら理由を 1 行（競合 再読込・終了済など）。押したときは灰色だけ（data-press）。

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loader72 } from "@/components/ui/Loader72";
import { DRILL_LABELS } from "@/lib/drill/labels";
import { appConfirm } from "@/lib/ui/dialog";
import { CONFIRM_LABELS, WAIT_LABELS } from "@/lib/ui/labels";
import { RINGING_EVENT } from "./IncomingCall";

/** 早送りの 1 刻みの間（画面の色が変わるのを見られるように） */
const FAST_MS = 2500;

export function DrillControls({ id, step, done }: { id: string; step: number; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** 1 刻みを進めている間（本人役・家族役が考える。AI の待ちの印を出す） */
  const [stepping, setStepping] = useState(false);
  const [fast, setFast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  /** 最後に送った刻み。画面がその次の刻みを読み直すまで、早送りは次を呼ばない */
  const sentRef = useRef<number | null>(null);

  const advance = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setStepping(true);
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
      setStepping(false);
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

  // 着信が鳴ったら早送りを止める（components/drill/IncomingCall。応答・拒否してから進める）
  useEffect(() => {
    const onRing = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail) setFast(false);
    };
    window.addEventListener(RINGING_EVENT, onRing);
    return () => window.removeEventListener(RINGING_EVENT, onRing);
  }, []);

  const abandon = async () => {
    setBusy(true);
    setError(null);
    setFast(false);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(id)}/abandon`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !body?.ok) setError(body?.label ?? String(res.status));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (done) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-controls>
      <Button kind="main" onClick={() => void advance()} disabled={busy || fast} data-action="advance" data-pending={busy && !fast ? "" : undefined}>
        {DRILL_LABELS.advance}
      </Button>
      <label className="flex h-8 items-center gap-1.5 rounded px-2 text-sm" data-press>
        <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className="size-4 accent-accent" data-action="fast" />
        {DRILL_LABELS.fastForward}
      </label>
      {/* 中断はアプリ内の確認の窓で決めてから（T44）。最初の焦点は取消 */}
      <Button
        kind="danger"
        onClick={async () => {
          setFast(false);
          if (await appConfirm(CONFIRM_LABELS.abandonBody, { title: CONFIRM_LABELS.abandonTitle, ok: CONFIRM_LABELS.abandonOk, danger: true, icon: "RemoveIcon" })) void abandon();
        }}
        disabled={busy}
        data-action="abandon"
      >
        {DRILL_LABELS.abandon}
      </Button>
      {stepping && <Loader72 label={WAIT_LABELS.think} size={18} on="base" className="text-sm text-muted" />}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
