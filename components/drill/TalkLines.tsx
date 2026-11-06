// 往復の吹き出しと頼み事の印（T93、T155 で声の印）。外へ掛けた電話（TalkBox）・着信（IncomingCall）・通話の画面（CallTalk）・経過・行の詳細が描く。
// サーバーでも描ける（状態を持たない）。

import { MicrophoneIcon } from "@heroicons/react/20/solid";
import { AiMark } from "@/components/person/parts";
import { ASK_LABELS, TALK_UI, type TalkLine } from "@/lib/drill/dialogue";
import type { AskKind } from "@/lib/drill/scenarios";

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
          <li key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-panel px-2.5 py-1.5 text-sm" data-talk-line="cm" data-talk-voice={l.voice ? "" : undefined}>
            <div className="flex items-center justify-end gap-1 text-xs text-muted">
              {l.voice && (
                <span className="inline-flex items-center gap-0.5" data-voice-mark>
                  <MicrophoneIcon aria-hidden className="size-3 shrink-0" />
                  {TALK_UI.voice}
                </span>
              )}
              <span>{TALK_UI.me}</span>
            </div>
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
