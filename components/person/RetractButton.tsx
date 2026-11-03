"use client";

// 経過の撤回（docs/tasks/T63.md）。撤回できる行（lib/person.ts の retractable。誰が押せるかはサーバーが決める）の右に小さく「撤回」。
// 押すと行の下に 理由（40 字、任意）と「撤回」（赤の文字）・「戻る」が開く（確認の窓は理由を受けないので行の中に）。
// 送ったら本人のページを読み直す（router.refresh。書き足しの欄 TimelineComposer と同じ）。理由は Claude に渡さない。
// 経過の行（components/person/Timeline.tsx の li）は折り返す横並び。誰が（who）とボタンを 1 つの塊にして右に寄せ（狭い幅でボタンだけが
// 左に落ちないように）、開いた欄は li の直の子にして order-last と basis-full で本文の下の 1 段に入れる。

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BackIcon, RemoveIcon } from "@/components/ui/Icon";
import { RETRACT_FAILED, RETRACT_LABELS } from "@/lib/timeline/labels";
import { RETRACT_API, RETRACT_NOTE_MAX } from "@/lib/timeline/paths";
import { TIMELINE_INPUT_SHAPE } from "./TimelineComposer";

/** 誰が（書き手の役と名前）の言葉。撤回のボタンと同じ塊で右に置く */
const WHO = "text-xs text-muted";

export function RetractButton({ id, who }: { id: string; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  /** 戻るで閉じたら「撤回」のボタンへ焦点を返す（初めの描画では動かさない） */
  const returnFocus = useRef(false);

  // 開いたら理由の欄へ（任意なので、そのまま「撤回」も押せる）。閉じたら開いたボタンへ
  useEffect(() => {
    if (open) input.current?.focus();
    else if (returnFocus.current) opener.current?.focus();
    returnFocus.current = false;
  }, [open]);

  function close() {
    returnFocus.current = true;
    setOpen(false);
    setNote("");
    setError(null);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(RETRACT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        label?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.label ?? RETRACT_FAILED);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError(RETRACT_FAILED);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="ml-auto flex items-baseline gap-x-2">
        <span className={WHO}>{who}</span>
        {/* 高さ 28px のボタンを行の余白（py-1）に収め、行の高さを広げすぎない */}
        <Button
          size="sm"
          kind="danger"
          icon={RemoveIcon}
          className="-my-1"
          ref={opener}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          data-retract-open={id}
        >
          {RETRACT_LABELS.open}
        </Button>
      </span>
    );
  }

  return (
    <>
      <span className={`ml-auto ${WHO}`}>{who}</span>
      <form
        onSubmit={send}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        aria-label={RETRACT_LABELS.open}
        className="order-last mt-1 flex basis-full flex-wrap items-center gap-1.5"
        data-form="retract"
        data-retract={id}
      >
        <input
          ref={input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={RETRACT_NOTE_MAX}
          placeholder={RETRACT_LABELS.note}
          aria-label={RETRACT_LABELS.note}
          className={`${TIMELINE_INPUT_SHAPE} min-w-32 flex-1 bg-panel`}
        />
        <Button type="submit" size="sm" kind="danger" icon={RemoveIcon} disabled={busy}>
          {busy ? RETRACT_LABELS.sending : RETRACT_LABELS.confirm}
        </Button>
        <Button size="sm" kind="quiet" icon={BackIcon} onClick={close}>
          {RETRACT_LABELS.cancel}
        </Button>
        {error && (
          <p role="alert" className="basis-full text-xs font-bold text-danger">
            {error}
          </p>
        )}
      </form>
    </>
  );
}
