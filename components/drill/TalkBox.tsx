"use client";

// 通話の往復（docs/tasks/T93.md の 4）。対応の欄の最新の結果（LatestResult）の、電話に出た人の最初の言葉の下に置く。
// - 往復の吹き出し（TalkLines）: ケアマネの言葉は右、電話に出た人の言葉は左。本人役（Haiku）の言葉は AI の印、頼み事は灰の文字の印
// - 続けられる電話（出て言葉があり、3 往復に届かず、切っていない）だけ、決まった問いのボタン 7 つ・自由の 1 文の欄（60 字まで）・「切る」
//   押すと POST /api/drill/<id>/talk（読んだ刻みと手の数を送る。違えば競合）。終わったら画面を読み直す。断られたら理由を 1 行
// - 3 往復で問いが消える。声（Gemini TTS）は付けない（文字だけ）
// 吹き出しは面の地（枠線なし）。押したときは灰色だけ（Button の data-press）。

import { PhoneXMarkIcon } from "@heroicons/react/20/solid";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { SendIcon } from "@/components/ui/Icon";
import { ASK_LABELS, canTalk, TALK_ASKS, TALK_LABELS, TALK_MAX, TALK_TEXT_MAX, TALK_UI, talkRounds, type TalkAsk, type TalkLine } from "@/lib/drill/dialogue";
import type { ActionRecord } from "@/lib/drill/engine";
import { DRILL_LABELS } from "@/lib/drill/labels";
import type { AskKind } from "@/lib/drill/scenarios";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 頼み事の印（灰の文字。色の印にしない） */
export function AskMarks({ asks, label = true }: { asks: ReadonlyArray<AskKind>; label?: boolean }) {
  if (asks.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-asks>
      {label && <span className="text-xs text-muted">{TALK_UI.asks}</span>}
      {asks.map((k) => (
        <span key={k} className="text-xs font-bold text-muted" data-ask-mark={k}>
          {ASK_LABELS[k]}
        </span>
      ))}
    </span>
  );
}

/** 往復の吹き出し。speaker は電話に出た人の言い方（「本人」「家族 娘」） */
export function TalkLines({ lines, speaker }: { lines: ReadonlyArray<TalkLine>; speaker: string }) {
  if (lines.length === 0) return null;
  return (
    <ol className="mt-1.5 space-y-1.5" data-talk-lines>
      {lines.map((l, i) =>
        l.who === "cm" ? (
          <li key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-panel px-2.5 py-1.5 text-sm" data-talk-line="cm">
            <div className="text-xs text-muted">{TALK_UI.me}</div>
            <p className="break-words">「{l.text}」</p>
          </li>
        ) : (
          <li key={i} className="relative ml-3 w-fit max-w-[85%] rounded-lg bg-panel px-2.5 py-1.5 text-sm" data-talk-line="them" data-speech-ai={l.ai ? "" : undefined}>
            <span aria-hidden="true" className="absolute -left-1 top-2.5 size-2 rotate-45 bg-panel" />
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span>{speaker}</span>
              {l.ai && <AiMark small />}
            </div>
            <p className="break-words">「{l.text}」</p>
            {l.asks && l.asks.length > 0 && <AskMarks asks={l.asks} />}
          </li>
        ),
      )}
    </ol>
  );
}

/**
 * 往復の欄（最新の電話の手だけ）。step・actions は画面で読んだ今の刻みと手の数（競合の門）。
 * 続けられない電話は吹き出しだけ
 */
export function TalkBox({
  drillId,
  step,
  actions,
  action,
  speaker,
}: {
  drillId: string;
  step: number;
  actions: number;
  action: ActionRecord;
  speaker: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const r = action.result;
  const lines = r?.talk ?? [];
  const open = !closed && canTalk(r);
  const left = TALK_MAX - talkRounds(r);

  const send = async (body: { ask: TalkAsk } | { text: string } | { end: true }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, actions, action: action.id, ...body }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !json?.ok) setError(json?.label ?? String(res.status));
      else {
        if ("text" in body) setText("");
        if ("end" in body) setClosed(true);
      }
      router.refresh();
    } catch {
      setError(DRILL_LABELS.network);
    } finally {
      setBusy(false);
    }
  };

  const trimmed = text.trim();
  return (
    <div className="mt-1" data-talk-box={action.id}>
      <TalkLines lines={lines} speaker={speaker} />
      {open && (
        <div className="mt-2 space-y-1.5" data-talk-controls>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={TALK_UI.talk}>
            {TALK_ASKS.map((k) => (
              <Button
                key={k}
                kind="plainIn"
                size="sm"
                className={FOCUS}
                disabled={busy}
                onClick={() => void send({ ask: k })}
                data-talk-ask={k}
              >
                {TALK_LABELS[k]}
              </Button>
            ))}
            <span className="ml-auto text-xs text-muted tabular-nums" data-talk-left={left}>
              {TALK_UI.left} {left}
            </span>
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed) void send({ text: trimmed });
            }}
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={TALK_TEXT_MAX}
              aria-label={TALK_UI.free}
              placeholder={TALK_UI.free}
              disabled={busy}
              className={`h-8 min-w-0 flex-1 rounded bg-panel px-2 text-sm text-ink outline-none ${FOCUS}`}
              data-talk-text
            />
            <Button kind="main" size="sm" icon={SendIcon} type="submit" className={FOCUS} disabled={busy || trimmed === ""} data-talk-send>
              {busy ? TALK_UI.sending : TALK_UI.send}
            </Button>
            <Button kind="danger" size="sm" icon={PhoneXMarkIcon} className={FOCUS} disabled={busy} onClick={() => void send({ end: true })} data-talk-end>
              {TALK_UI.hangUp}
            </Button>
          </form>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
