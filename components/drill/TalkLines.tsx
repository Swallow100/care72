// 往復の吹き出しと頼み事の印（T93、T155 で声の印）。外へ掛けた電話（TalkBox）・着信（IncomingCall）・通話の画面（CallTalk）・経過・行の詳細が描く。
// サーバーでも描ける（状態を持たない）。
// T166: 頼み事の印は、進行中の訓練で本人が分かる所（person を渡した所）では押せるボタン（components/drill/AskPick）。
// 読み返しだけの所（終わった訓練・再生・通話の窓の中）は渡さず、灰の文字のまま。

import { MicrophoneIcon } from "@heroicons/react/20/solid";
import { AiMark } from "@/components/person/parts";
import { ASK_LABELS, TALK_UI, type TalkLine } from "@/lib/drill/dialogue";
import type { AskKind } from "@/lib/drill/scenarios";
import type { ButtonKind } from "@/components/ui/Button";
import { AskPick } from "./AskPick";

/** 頼み事の印。person があれば押せるボタン（色の印にしない）、無ければ灰の文字 */
export function AskMarks({
  asks,
  label = true,
  person = null,
  kind = "plain",
}: {
  asks: ReadonlyArray<AskKind>;
  label?: boolean;
  /** 進行中の訓練の本人（押すと対応の欄へ）。読み返しだけの所は渡さない */
  person?: string | null;
  /** ボタンの地（面の中の上は plainIn） */
  kind?: ButtonKind;
}) {
  if (asks.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap gap-x-1.5 ${person ? "items-center gap-y-1" : "items-baseline"}`} data-asks>
      {label && <span className="text-xs text-muted">{TALK_UI.asks}</span>}
      {asks.map((k) =>
        person ? (
          <AskPick key={k} ask={k} person={person} kind={kind} />
        ) : (
          <span key={k} className="text-xs font-bold text-muted" data-ask-mark={k}>
            {ASK_LABELS[k]}
          </span>
        ),
      )}
    </span>
  );
}

/** 往復の吹き出し。speaker は電話に出た人の言い方（「本人」「家族 娘」） */
export function TalkLines({ lines, speaker, askPerson = null }: { lines: ReadonlyArray<TalkLine>; speaker: string; /** 頼み事の印を押せる本人（無ければ文字） */ askPerson?: string | null }) {
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
            {l.asks && l.asks.length > 0 && <AskMarks asks={l.asks} person={askPerson} />}
          </li>
        ),
      )}
    </ol>
  );
}
