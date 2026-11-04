"use client";

// 訓練の操作（docs/tasks/T17.md）: 進める（既定）・早送り（切替）・中断。1 回押すと 1 刻みだけ進む（1 要求で 1 刻み）。
// 早送りは、前の刻みの保存が終わってから次の刻みを呼ぶ（ブラウザから 1 刻みずつ）。最後の刻みか、中断・失敗で止まる。
// 進めたら画面を読み直す（router.refresh）。保存は刻みごとなので、閉じても次に開けば続きから。
// 断られたら理由を 1 行（競合 再読込・終了済など）。押したときは灰色だけ（data-press）。
// 早送りの間（T59）は早送りの横で 1・2.5・5 秒から選ぶ（端末の中だけ。保存しない。既定 2.5 秒）。
// 連続の時計の訓練（T90）は「進める」の代わりに 30 分・1 時間・3 時間・次まで（主の操作は次まで）。早送りは「次まで」を間を置いて繰り返す。
// 横に 1 訓練の AI の残り回数（lib/drill/clock.ts。上限に達したら「AI 停止 訓練上限」の帯）。10 分版は今の「進める」のまま。

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CHOICE_INPUT } from "@/components/ui/choice";
import { Loader72 } from "@/components/ui/Loader72";
import { Select } from "@/components/ui/Select";
import { CLOCK_LABELS, CLOCK_STEP_LABELS, CLOCK_STEPS, type ClockStep } from "@/lib/drill/clock";
import { DRILL_LABELS, T59_LABELS } from "@/lib/drill/labels";
import { DEFAULT_FAST_MS, FAST_INTERVALS, intervalLabel, parseInterval } from "@/lib/drill/speed";
import { appConfirm } from "@/lib/ui/dialog";
import { CONFIRM_LABELS, WAIT_LABELS } from "@/lib/ui/labels";
import { RINGING_EVENT } from "./IncomingCall";

/** 早送りの間を選ぶ欄 */
const SELECT =
  "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 進め方（連続の時計の訓練）。無ければ刻みの道（1 刻み） */
type Move = { minutes: ClockStep } | { next: true } | null;

export function DrillControls({
  id,
  step,
  done,
  clock = false,
  left = null,
}: {
  id: string;
  step: number;
  done: boolean;
  /** 連続の時計の訓練（T90） */
  clock?: boolean;
  /** 1 訓練の AI の残り回数（連続の時計の訓練だけ） */
  left?: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** 1 刻みを進めている間（本人役・家族役が考える。AI の待ちの印を出す） */
  const [stepping, setStepping] = useState(false);
  const [fast, setFast] = useState(false);
  /** 早送りの 1 刻みの間（画面の色が変わるのを見られるように。T59 で選べる） */
  const [interval, setInterval_] = useState(DEFAULT_FAST_MS);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;
  /** 最後に送った刻み。画面がその次の刻みを読み直すまで、早送りは次を呼ばない */
  const sentRef = useRef<number | null>(null);

  /** 押した進め方（待ちの間の灰色を残すボタン） */
  const [moving, setMoving] = useState<string | null>(null);

  const advance = useCallback(async (move: Move = null): Promise<boolean> => {
    setBusy(true);
    setStepping(true);
    setError(null);
    setMoving(move ? ("next" in move ? "next" : String(move.minutes)) : null);
    sentRef.current = stepRef.current;
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(id)}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepRef.current, ...(move ?? {}) }),
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
      setMoving(null);
    }
  }, [id, router]);

  // 早送り: 画面が次の刻みを読み直したら（step が変わったら）、間を置いて次を呼ぶ
  useEffect(() => {
    if (!fast || done || busy) return;
    if (sentRef.current !== null && step <= sentRef.current) return;
    const t = setTimeout(async () => {
      // 連続の時計の訓練は「次まで」を繰り返す
      const more = await advance(clock ? { next: true } : null);
      if (!more) setFast(false);
    }, interval);
    return () => clearTimeout(t);
  }, [fast, done, busy, step, advance, interval, clock]);

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
    <div className="flex flex-wrap items-center gap-2" data-controls={clock ? "clock" : ""}>
      {clock ? (
        <>
          {CLOCK_STEPS.map((m) => (
            <Button
              key={m}
              kind="plain"
              onClick={() => void advance({ minutes: m })}
              disabled={busy || fast}
              data-action="advance"
              data-minutes={m}
              data-pending={busy && !fast && moving === String(m) ? "" : undefined}
            >
              {CLOCK_STEP_LABELS[m]}
            </Button>
          ))}
          <Button
            kind="main"
            onClick={() => void advance({ next: true })}
            disabled={busy || fast}
            data-action="advance"
            data-next=""
            data-pending={busy && !fast && moving === "next" ? "" : undefined}
          >
            {CLOCK_LABELS.next}
          </Button>
        </>
      ) : (
        <Button kind="main" onClick={() => void advance()} disabled={busy || fast} data-action="advance" data-pending={busy && !fast ? "" : undefined}>
          {DRILL_LABELS.advance}
        </Button>
      )}
      <label className="flex h-8 items-center gap-1.5 rounded px-2 text-sm" data-press>
        <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className={CHOICE_INPUT} data-action="fast" />
        {DRILL_LABELS.fastForward}
      </label>
      <Select
        value={String(interval)}
        onChange={(e) => setInterval_(parseInterval(e.target.value))}
        className={SELECT}
        aria-label={`${DRILL_LABELS.fastForward} ${T59_LABELS.interval}`}
        data-action="fast-interval"
      >
        {FAST_INTERVALS.map((ms) => (
          <option key={ms} value={String(ms)}>
            {intervalLabel(ms, T59_LABELS.seconds)}
          </option>
        ))}
      </Select>
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
      {clock && left !== null && (
        <span className="text-xs text-muted tabular-nums" data-ai-left={left}>
          {CLOCK_LABELS.left} <span className="font-bold text-ink">{left}</span>
        </span>
      )}
      {stepping && <Loader72 label={WAIT_LABELS.think} size={18} on="base" className="text-sm text-muted" />}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
