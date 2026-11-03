// 本人のスマホの災害モードの 1 画面（lib/signals/phone.ts の状態を描くだけ）。状態を持たない（テストで静的に描ける）。
// どの画面も大きな字で、ボタンは 2 つか 3 つ。戻るは無い。説明文は無い。言葉は lib/signals/phrases.ts の定型だけ。
// 本人の状態の判定（至急など）は出さない。赤を押したあとのどの画面（問い・定型文・録音・送る・終わり）にも 119 の 1 行（一般の案内）を
// いちばん下に出す。状態（PhoneState）に録音の中身・分類（AI の出力）は無く、出す・出さないは赤の流れかどうかだけで決まる（T48）。
// Fill・Choice・Emergency・QuestionBody は家族・支援者のスマホ（FamilyView.tsx、T11）も使う。
// 赤のあとの問い（T49）は lib/signals/questions.ts の表から 1 画面 1 問。選択肢（わからない を含む）と「とばす」。
// 選択肢が 5 つ以上の問い（部位・部屋など）は 2 列に並べる。声の問い（20 秒押さないとき）は「AI が きいています」を上に出し、押してもよい。

import type { ReactNode } from "react";
import { EasyWords } from "@/components/forms/EasyText";
import { Loader72 } from "@/components/ui/Loader72";
import { easy } from "@/lib/forms/easy-words";
import type { WhereNow } from "@/lib/db/types";
import type { PhoneState } from "@/lib/signals/phone";
import { AI_NOTICE, emergencyWords, PHONE_PHRASES, WHERE_PHRASES } from "@/lib/signals/phrases";
import { questionOf, type QuestionId } from "@/lib/signals/questions";

export type PhoneActions = {
  green(): void;
  red(): void;
  where(w: WhereNow): void;
  answer(choice: string): void;
  skip(): void;
  extend(): void;
  finish(): void;
  again(): void;
};

const Words = ({ m }: { m: string }) => <EasyWords words={easy(m)} />;

/** 画面の高さ（上の帯を除いた分）を埋める縦の並び */
export function Fill({ children, step }: { children: ReactNode; step: string }) {
  return (
    <div className="phone-text flex min-h-[calc(100dvh-7rem)] flex-col gap-3 px-3 py-3" data-phone="disaster" data-step={step}>
      {children}
    </div>
  );
}

export const BIG = "flex w-full flex-1 items-center justify-center rounded-xl px-4 py-6 text-center font-bold";

export function Choice({ onClick, children, value }: { onClick: () => void; children: ReactNode; value: string }) {
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

/** 選択肢がこれより多い問いは 2 列に並べる */
const GRID_OVER = 4;

/**
 * 赤のあとの 1 問（T49）: 問い・選択肢・とばす。lead は家族の画面の主語（「お母さんは」。本人は無し）。
 * 問いと選択肢の言葉は lib/signals/questions.ts の表だけ
 */
export function QuestionBody({
  id,
  lead,
  family = false,
  onChoice,
  onSkip,
}: {
  id: QuestionId;
  lead?: ReactNode;
  family?: boolean;
  onChoice: (choice: string) => void;
  onSkip: () => void;
}) {
  const q = questionOf(id);
  const grid = q.choices.length > GRID_OVER;
  return (
    <>
      <h1 className="px-1 pt-2 text-center text-[2rem] font-bold" role="status" data-question-id={id}>
        {lead}
        <Words m={family ? (q.familyEasy ?? q.easy) : q.easy} />
      </h1>
      <div className={grid ? "grid flex-1 grid-cols-2 gap-3" : "flex flex-1 flex-col gap-3"}>
        {q.choices.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChoice(c.id)}
            className={`${BIG} bg-panel text-ink ${grid ? "py-4 text-[1.75rem]" : "text-[2.25rem]"}`}
            data-press
            data-choice={c.id}
          >
            <span>
              <Words m={c.easy} />
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="w-full rounded-xl bg-panel px-4 py-3 text-center text-2xl text-muted"
        data-press
        data-choice="skip"
      >
        <Words m={PHONE_PHRASES.skip} />
      </button>
    </>
  );
}

/** AI が きいています（録音を Claude が分けるので、聞いている間は出す）。AI の待ちの印の輪を添える（T44） */
function AiListening() {
  return (
    <p className="text-center text-2xl font-bold" data-ai="listening">
      <Loader72
        size={28}
        on="base"
        label={
          <>
            <span className="phone-ai">AI</span>
            <Words m={PHONE_PHRASES.aiListening} />
          </>
        }
      />
    </p>
  );
}

/** AI の告知（T48）。赤の流れの最初（1 問目）と、定型文（声の頭も同じ告知）を流している間に出す。飛ばす操作は無い */
function AiNotice() {
  return (
    <p className="text-center text-xl font-bold" data-notice="ai">
      <Words m={AI_NOTICE.lead} /> <span className="phone-ai">AI</span>
      <Words m={AI_NOTICE.rest} />
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

export function Emergency() {
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
    case "question":
      return (
        <Fill step={`question-${state.id}`}>
          {state.first && <AiNotice />}
          {state.voice !== null && <AiListening />}
          <QuestionBody id={state.id} onChoice={on.answer} onSkip={on.skip} />
          <Emergency />
        </Fill>
      );
    case "prompt":
      return (
        <Fill step="prompt">
          <AiNotice />
          <Prompt />
          <Emergency />
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
          <Emergency />
        </Fill>
      );
    }
    case "sending":
      return (
        <Fill step="sending">
          <p className="flex flex-1 items-center justify-center text-center text-[2.25rem] font-bold" role="status">
            <Words m={PHONE_PHRASES.sending} />
          </p>
          {state.color === "red" && <Emergency />}
        </Fill>
      );
    case "done":
      return (
        <Fill step="done">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" role="status" data-delivery={state.delivery} data-silent={state.silent ? "" : undefined}>
            <p className="text-[2.5rem] font-bold">
              <Words
                m={
                  state.delivery !== "sent"
                    ? PHONE_PHRASES.queued
                    : state.silent
                      ? PHONE_PHRASES.recordingSent
                      : PHONE_PHRASES.sent
                }
              />
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
