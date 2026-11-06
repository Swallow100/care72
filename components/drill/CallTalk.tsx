"use client";

// 通話の画面の中身（docs/tasks/T155.md の 1・2）。着信（components/drill/IncomingCall）と外へ掛けた電話（components/drill/TalkBox）が同じ物を描く。
// - 会話: 相手の最初の言葉と往復の行（TalkLines。相手は左・自分は右、本人役の言葉は AI の印、声で入れた自分の言葉は「声」の印）
// - 返す欄: 文字の欄（打つか、マイクで話す。話した声は欄に文字で出て、送る前に直せる）と送信。問いの候補のボタンは補助で、押すとそのまま送る
// - マイクはブラウザの Web Speech（lib/speech/use-dictation.ts）。使えない端末ではボタンを出さず、許可が無い・断られた時は失敗の言葉を 1 つ出して文字だけで続ける
// - 送る・切るは呼ぶ側（onSend・onHangUp）。下書きと声の印は lib/drill/call-input.ts
// 色は安否の印だけ。押したときは灰色だけ（Button の data-press）。

import { PhoneXMarkIcon } from "@heroicons/react/20/solid";
import { useState, type ReactNode } from "react";
import { MicIcon, StopIcon } from "@/components/person/icons";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { SendIcon } from "@/components/ui/Icon";
import { draftOnSpeech, draftOnType, draftToSend, EMPTY_DRAFT, type CallDraft } from "@/lib/drill/call-input";
import { TALK_LABELS, TALK_MAX, TALK_TEXT_MAX, TALK_UI, type TalkAsk, type TalkLine } from "@/lib/drill/dialogue";
import type { DictationError } from "@/lib/speech/dictation";
import { useDictation } from "@/lib/speech/use-dictation";
import { TalkLines } from "./TalkLines";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export const MIC_ERROR_LABELS: Readonly<Record<DictationError, string>> = {
  mic: TALK_UI.micDenied,
  no_speech: TALK_UI.noSpeech,
  failed: TALK_UI.speechFailed,
};

export type CallSend = { ask: TalkAsk } | { text: string; voice?: true };

/** 往復の数（ケアマネの行の数）と残り */
export function callLeft(lines: ReadonlyArray<TalkLine>): number {
  return Math.max(0, TALK_MAX - lines.filter((l) => l.who === "cm").length);
}

/** 相手の最初の言葉（着信の言う事・外へ掛けた電話の最初の返事） */
export function FirstWords({ speaker, text, ai, lead }: { speaker: string; text: string; ai: boolean; lead?: ReactNode }) {
  return (
    <div data-call-first>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {lead}
        <span>{speaker}</span>
        {ai && <AiMark small />}
      </div>
      {/* text-base は使わない（地の色の名前と重なる。app/globals.css） */}
      <p className="mt-1 text-[1.125rem] leading-7">「{text}」</p>
    </div>
  );
}

/**
 * 返す欄（文字・マイク・問いの候補・送信・切る）。canReply が false なら切るだけ。
 * 下書きは送れたら空にする（onSend が true を返したとき）
 */
export function CallReply({
  asks,
  lines,
  canReply,
  busy,
  onSend,
  onHangUp,
  extra,
  mark,
}: {
  /** 問いの候補（着信は CALL_IN_ASKS、外へ掛けた電話は CALL_OUT_ASKS） */
  asks: ReadonlyArray<TalkAsk>;
  lines: ReadonlyArray<TalkLine>;
  canReply: boolean;
  busy: boolean;
  onSend: (body: CallSend) => Promise<boolean>;
  onHangUp: () => void;
  /** 切るの左に置くボタン（声の再生） */
  extra?: ReactNode;
  /** 部品の印の頭（テストと評価の台が読む。外へ掛けた電話は talk、着信は incoming） */
  mark: "talk" | "incoming";
}) {
  const tag = (name: string, value: string | number = "") => ({ [`data-${mark}-${name}`]: value });
  const [draft, setDraft] = useState<CallDraft>(EMPTY_DRAFT);
  const speech = useDictation({
    maxLength: TALK_TEXT_MAX,
    onText: (t) => setDraft((d) => draftOnSpeech(d, t)),
    onDone: (t) => setDraft((d) => draftOnSpeech(d, t)),
  });
  const listening = speech.state !== "idle";
  const left = callLeft(lines);
  const ready = draftToSend(draft);

  const send = async (body: CallSend) => {
    if (listening) speech.abort();
    const ok = await onSend(body);
    if (ok && "text" in body) setDraft(EMPTY_DRAFT);
  };

  return (
    <div className="space-y-2" data-call-reply>
      {canReply && (
        <>
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) void send(ready);
            }}
          >
            <textarea
              value={draft.text}
              onChange={(e) => {
                setDraft((d) => draftOnType(d, e.target.value));
                if (listening) speech.edit(e.target.value);
              }}
              onKeyDown={(e) => {
                // Ctrl・⌘ と Enter で送る（Enter だけは変換の確定と重なるので送らない）
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready && !busy) {
                  e.preventDefault();
                  void send(ready);
                }
              }}
              rows={2}
              maxLength={TALK_TEXT_MAX}
              aria-label={TALK_UI.free}
              placeholder={TALK_UI.free}
              disabled={busy}
              className={`block w-full resize-none rounded bg-panel2 px-2.5 py-1.5 text-sm leading-6 text-ink outline-none ${FOCUS}`}
              data-call-text
              {...tag("text")}
              data-call-voiced={draft.voiced ? "" : undefined}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {speech.supported && (
                <Button
                  size="sm"
                  kind={listening ? "main" : "plain"}
                  icon={listening ? StopIcon : MicIcon}
                  aria-pressed={listening}
                  className={FOCUS}
                  disabled={busy || speech.state === "stopping"}
                  onClick={() => (listening ? speech.stop() : speech.start(draft.text))}
                  data-call-mic={listening ? "listening" : "idle"}
                >
                  {listening ? TALK_UI.speakStop : TALK_UI.speak}
                </Button>
              )}
              {listening && (
                <span className="text-xs font-bold" data-call-listening>
                  {TALK_UI.listening}
                </span>
              )}
              {!listening && speech.error && (
                <span className="text-xs font-bold text-danger" data-call-mic-error={speech.error}>
                  {MIC_ERROR_LABELS[speech.error]}
                </span>
              )}
              {draft.voiced && draft.text.trim() !== "" && (
                <span className="text-xs text-muted" data-call-draft-voice>
                  {TALK_UI.voice}
                </span>
              )}
              <span className="ml-auto text-xs text-muted tabular-nums" data-call-left={left} {...tag("left", left)}>
                {TALK_UI.left} {left}
              </span>
              <Button kind="main" size="sm" icon={SendIcon} type="submit" className={FOCUS} disabled={busy || !ready} data-call-send {...tag("send")}>
                {busy ? TALK_UI.sending : TALK_UI.send}
              </Button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={TALK_UI.talk}>
            {asks.map((k) => (
              <Button key={k} kind="plainIn" size="sm" className={FOCUS} disabled={busy} onClick={() => void send({ ask: k })} data-call-ask={k} {...tag("ask", k)}>
                {TALK_LABELS[k]}
              </Button>
            ))}
          </div>
        </>
      )}
      <div className="flex gap-2 pt-1">
        {extra}
        <Button kind="danger" size="lg" icon={PhoneXMarkIcon} onClick={onHangUp} disabled={busy} className="flex-1" data-call-hangup {...(mark === "incoming" ? { "data-incoming-action": "hangup" } : tag("end"))}>
          {TALK_UI.hangUp}
        </Button>
      </div>
    </div>
  );
}

/** 会話の並び（最初の言葉と往復）。面の中に置く */
export function CallLines({
  speaker,
  first,
  lines,
}: {
  speaker: string;
  first: { text: string; ai: boolean; lead?: ReactNode } | null;
  lines: ReadonlyArray<TalkLine>;
}) {
  return (
    <div className="rounded-md bg-panel2 px-3 py-2.5" data-call-lines>
      {first && <FirstWords speaker={speaker} text={first.text} ai={first.ai} lead={first.lead} />}
      <TalkLines lines={lines} speaker={speaker} />
    </div>
  );
}
