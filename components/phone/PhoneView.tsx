// 本人のスマホの災害モードの 1 画面（lib/signals/phone.ts の状態を描くだけ）。状態を持たない（テストで静的に描ける）。
// どの画面も大きな字で、ボタンは 2 つか 3 つ。戻るは無い。説明文は無い。言葉は lib/signals/phrases.ts の定型だけ。
// 本人の状態の判定（至急など）は出さない。赤の流れの最後に 119 の 1 行（一般の案内）。

import type { ReactNode } from "react";
import { EasyWords } from "@/components/forms/EasyText";
import { easy } from "@/lib/forms/easy-words";
import type { WhereNow } from "@/lib/db/types";
import type { PhoneState } from "@/lib/signals/phone";
import {
  emergencyWords,
  PHONE_PHRASES,
  RED_QUESTION_PHRASES,
  RED_QUESTIONS,
  WHERE_PHRASES,
} from "@/lib/signals/phrases";

export type PhoneActions = {
  green(): void;
  red(): void;
  where(w: WhereNow): void;
  answer(v: boolean): void;
  extend(): void;
  finish(): void;
  again(): void;
};

const Words = ({ m }: { m: string }) => <EasyWords words={easy(m)} />;

/** 画面の高さ（上の帯を除いた分）を埋める縦の並び */
function Fill({ children, step }: { children: ReactNode; step: string }) {
  return (
    <div className="phone-text flex min-h-[calc(100dvh-7rem)] flex-col gap-3 px-3 py-3" data-phone="disaster" data-step={step}>
      {children}
    </div>
  );
}

const BIG = "flex w-full flex-1 items-center justify-center rounded-xl px-4 py-6 text-center font-bold";

function Choice({ onClick, children, value }: { onClick: () => void; children: ReactNode; value: string }) {
  return (
    <button type="button" onClick={onClick} className={`${BIG} bg-panel text-[2.25rem] text-ink`} data-press data-choice={value}>
      <span>{children}</span>
    </button>
  );
}

function Question({ m }: { m: string }) {
  return (
    <h1 className="px-1 pt-2 text-center text-[2rem] font-bold" role="status">
      <Words m={m} />
    </h1>
  );
}

/** AI が きいています（録音を Claude が分けるので、聞いている間は出す） */
function AiListening() {
  return (
    <p className="text-center text-2xl font-bold" data-ai="listening" role="status">
      <span className="phone-ai">AI</span>
      <Words m={PHONE_PHRASES.aiListening} />
    </p>
  );
}

function Prompt() {
  return (
    <div className="rounded-xl bg-panel px-4 py-4 text-center text-[1.75rem] font-bold" data-prompt>
      <div>
        <Words m={PHONE_PHRASES.prompt1} />
      </div>
      <div>
        <Words m={PHONE_PHRASES.prompt2} />
      </div>
    </div>
  );
}

function Emergency() {
  return (
    <p className="rounded-xl bg-panel px-4 py-4 text-center text-2xl" data-emergency>
      <EasyWords words={emergencyWords()} />
    </p>
  );
}

export function PhoneView({ state, nowMs, on }: { state: PhoneState; nowMs: number; on: PhoneActions }) {
  switch (state.step) {
    case "top":
      return (
        <Fill step="top">
          <button
            type="button"
            onClick={on.green}
            className={`${BIG} phone-fill-ok text-[3rem]`}
            data-press="overlay"
            data-choice="green"
          >
            <span>
              <Words m={PHONE_PHRASES.safe} />
            </span>
          </button>
          <button
            type="button"
            onClick={on.red}
            className={`${BIG} phone-fill-urgent text-[3rem]`}
            data-press="overlay"
            data-choice="red"
          >
            <span>
              <Words m={PHONE_PHRASES.notSafe} />
            </span>
          </button>
        </Fill>
      );
    case "where":
      return (
        <Fill step="where">
          <Question m={PHONE_PHRASES.where} />
          {(["home", "shelter", "other"] as const).map((w) => (
            <Choice key={w} onClick={() => on.where(w)} value={w}>
              <Words m={WHERE_PHRASES[w]} />
            </Choice>
          ))}
        </Fill>
      );
    case "question": {
      const q = RED_QUESTION_PHRASES[RED_QUESTIONS[state.index]];
      return (
        <Fill step={`question-${state.index}`}>
          <Question m={q.q} />
          <Choice onClick={() => on.answer(true)} value="yes">
            <Words m={q.yes} />
          </Choice>
          <Choice onClick={() => on.answer(false)} value="no">
            <Words m={q.no} />
          </Choice>
        </Fill>
      );
    }
    case "prompt":
      return (
        <Fill step="prompt">
          <Prompt />
        </Fill>
      );
    case "recording": {
      // 数え始める前（nowMs がまだ古い）は録り始めた時から
      const left = Math.max(0, Math.ceil((state.until - Math.max(nowMs, state.startedAt)) / 1000));
      return (
        <Fill step="recording">
          <AiListening />
          <Prompt />
          <p className="text-center text-[2rem] font-bold tabular-nums" data-left={left}>
            <Words m={`${PHONE_PHRASES.left} ${left} ${PHONE_PHRASES.seconds}`} />
          </p>
          <Choice onClick={on.extend} value="more">
            <Words m={PHONE_PHRASES.more} />
          </Choice>
          <Choice onClick={on.finish} value="send">
            <Words m={PHONE_PHRASES.send} />
          </Choice>
        </Fill>
      );
    }
    case "sending":
      return (
        <Fill step="sending">
          <p className="flex flex-1 items-center justify-center text-center text-[2.25rem] font-bold" role="status">
            <Words m={PHONE_PHRASES.sending} />
          </p>
        </Fill>
      );
    case "done":
      return (
        <Fill step="done">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" role="status" data-delivery={state.delivery}>
            <p className="text-[2.5rem] font-bold">
              <Words m={state.delivery === "sent" ? PHONE_PHRASES.sent : PHONE_PHRASES.queued} />
            </p>
            {state.delivery === "queued" && (
              <p className="text-2xl text-muted">
                <Words m={PHONE_PHRASES.queuedSub} />
              </p>
            )}
          </div>
          {state.color === "red" && <Emergency />}
          <Choice onClick={on.again} value="again">
            <Words m={PHONE_PHRASES.again} />
          </Choice>
        </Fill>
      );
  }
}
