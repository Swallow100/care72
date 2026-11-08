"use client";

// 訓練の操作（docs/tasks/T17.md）: 進める（既定）・早送り（切替）・中断。1 回押すと 1 刻みだけ進む（1 要求で 1 刻み）。
// 早送りは、前の刻みの保存が終わってから次の刻みを呼ぶ（ブラウザから 1 刻みずつ）。最後の刻みか、中断・失敗で止まる。
// 進めたら画面を読み直す（router.refresh）。保存は刻みごとなので、閉じても次に開けば続きから。
// 断られたら理由を 1 行（競合 再読込・終了済など）。押したときは灰色だけ（data-press）。
// 連続の時計の訓練（T90）は「進める」の代わりに「次まで」。横に 1 訓練の AI の残り回数（lib/drill/clock.ts。上限に達したら「AI 停止 訓練上限」の帯）。
// T128: 時間を進めるのは「次まで」だけにした（前は 30 分・1 時間・3 時間と、手に使った時間を閉じる「手の分」も並べていた）。
// 「次まで」は前の区切りから進めるので、手に使った時間も閉じる（lib/drill/t128.test.ts で確かめた）。API の口（minutes・acts）は
// テストと評価の台が使うので残す。早送りは「自動進行」の名で残し、「次まで」（刻みの道は「進める」）を決まった間（2.5 秒）でくり返す。
// 間の選択（T59 の 1・2.5・5 秒）は外した。中断は今のまま。
// T162: 押してから読み直した画面が届くまで「次まで」に送信中の印（前は要求の終わりで外れ、読み直しの前に押し直された）。
// 進めたら横に「進行 6 分」（前の経過からどれだけ進んだか。経過が 0 時間のままに読まれた）
// T166: 進めたら「0 時間 → 1 時間」も添える（押しても変わらないと読まれた）。自動進行はチェックの欄でなく押せるボタン（入り切りの switch、
// 名前は「自動進行」のまま）。入っている間は枠と止める印、横に何をくり返すか。読み上げと台は aria-checked で読む

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { PauseIcon, PlayIcon } from "@/components/ui/Icon";
import { Loader72 } from "@/components/ui/Loader72";
import { CLOCK_LABELS, movedText } from "@/lib/drill/clock";
import { DRILL_LABELS, T59_LABELS } from "@/lib/drill/labels";
import { DEFAULT_FAST_MS, intervalLabel } from "@/lib/drill/speed";
import { minuteText } from "@/lib/drill/time-text";
import { appConfirm } from "@/lib/ui/dialog";
import { CONFIRM_LABELS, WAIT_LABELS } from "@/lib/ui/labels";
import { RINGING_EVENT } from "./IncomingCall";

/** 進め方（連続の時計の訓練は次まで）。無ければ刻みの道（1 刻み） */
type Move = { next: true } | null;

export function DrillControls({
  id,
  step,
  done,
  clock = false,
  left = null,
  minute,
}: {
  id: string;
  step: number;
  done: boolean;
  /** 連続の時計の訓練（T90） */
  clock?: boolean;
  /** 1 訓練の AI の残り回数（連続の時計の訓練だけ） */
  left?: number | null;
  /** 今の経過（発災からの分。進めた分を出す） */
  minute?: number;
}) {
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

  /** 押した進め方（待ちの間の灰色を残すボタン） */
  const [moving, setMoving] = useState<string | null>(null);
  /** 進めたあとの画面の読み直し（届くまで送信中の印を残す） */
  const [refreshing, startRefresh] = useTransition();
  /** 押す前の経過（分）と、読み直したあとに進んだ分 */
  const fromRef = useRef<number | null>(null);
  const [moved, setMoved] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (minute === undefined || fromRef.current === null || refreshing) return;
    if (minute !== fromRef.current) {
      setMoved({ from: fromRef.current, to: minute });
      fromRef.current = null;
    }
  }, [minute, refreshing]);

  const advance = useCallback(async (move: Move = null): Promise<boolean> => {
    setBusy(true);
    setStepping(true);
    setError(null);
    setMoving(move ? "next" : null);
    sentRef.current = stepRef.current;
    if (minute !== undefined) fromRef.current = minute;
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
      startRefresh(() => router.refresh());
      return body.status === "running";
    } catch {
      setError(DRILL_LABELS.network);
      return false;
    } finally {
      setBusy(false);
      setStepping(false);
      setMoving(null);
    }
  }, [id, router, minute]);

  // 早送り: 画面が次の刻みを読み直したら（step が変わったら）、間を置いて次を呼ぶ
  useEffect(() => {
    if (!fast || done || busy) return;
    if (sentRef.current !== null && step <= sentRef.current) return;
    const t = setTimeout(async () => {
      // 連続の時計の訓練は「次まで」を繰り返す
      const more = await advance(clock ? { next: true } : null);
      if (!more) setFast(false);
    }, DEFAULT_FAST_MS);
    return () => clearTimeout(t);
  }, [fast, done, busy, step, advance, clock]);

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
  const autoText = `${clock ? CLOCK_LABELS.next : DRILL_LABELS.advance} ${intervalLabel(DEFAULT_FAST_MS, T59_LABELS.seconds)}${DRILL_LABELS.autoEvery}`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-controls={clock ? "clock" : ""}>
      {/* 幅の変わる字（AI の残り・進んだ時間・読込・失敗・自動進行の説明）はボタンの前に置く。上の帯は右寄せなので、後ろに置くと
          進めるたびにボタンが左へずれ、同じ所を押し直すと「中断」に当たった（11/8 の通し点検） */}
      {clock && left !== null && (
        <span className="text-xs text-muted tabular-nums" data-ai-left={left}>
          {CLOCK_LABELS.left} <span className="font-bold text-ink">{left}</span>
        </span>
      )}
      {moved !== null && !stepping && !refreshing && (
        <span role="status" className="text-sm tabular-nums" data-moved={moved.to - moved.from}>
          <span className="text-muted">{CLOCK_LABELS.moved}</span> <span className="font-bold">{movedText(moved.to - moved.from)}</span>{" "}
          <span className="text-muted" data-moved-span>
            {minuteText(moved.from)} → {minuteText(moved.to)}
          </span>
        </span>
      )}
      {(stepping || refreshing) && <Loader72 label={WAIT_LABELS.think} size={18} on="base" className="text-sm text-muted" />}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
      {fast && (
        <span className="text-xs text-muted tabular-nums" data-fast-note>
          {autoText}
        </span>
      )}
      {clock ? (
        <Button
          kind="main"
          onClick={() => void advance({ next: true })}
          disabled={busy || refreshing || fast}
          data-action="advance"
          data-next=""
          data-pending={(busy && moving === "next") || refreshing ? (fast ? undefined : "") : undefined}
        >
          {CLOCK_LABELS.next}
        </Button>
      ) : (
        <Button kind="main" onClick={() => void advance()} disabled={busy || refreshing || fast} data-action="advance" data-pending={(busy || refreshing) && !fast ? "" : undefined}>
          {DRILL_LABELS.advance}
        </Button>
      )}
      {/* 自動進行（前の早送り）: 次まで（刻みの道は進める）を決まった間でくり返す。title に何をくり返すかと間 */}
      <Button
        kind="plain"
        role="switch"
        aria-checked={fast}
        icon={fast ? PauseIcon : PlayIcon}
        onClick={() => setFast((v) => !v)}
        title={autoText}
        className={fast ? "outline-2 -outline-offset-2 outline-accent" : ""}
        data-action="fast"
      >
        {DRILL_LABELS.fastForward}
      </Button>
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
    </div>
  );
}
