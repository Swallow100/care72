// 家族・支援者のスマホの災害モードの 1 画面（lib/signals/family-phone.ts の状態を描くだけ）。状態を持たない（テストで静的に描ける）。
// 上は「お母さん（山田 ハナ）は 無事ですか」と 3 つのボタン。面で塗るのは 無事です（緑）と 無事じゃない（赤）だけで、
// 分からない は面の色。無事じゃない を押したあとは 本人と同じ問いの表を 1 画面 1 問（主語は「お母さんは」。T49）、
// 問い・送っている間も 119 の 1 行（T48）。答えたあとは 送れたか・（赤なら 119 の 1 行）・これまでの こと（同意の範囲）・持って いく もの・
// ケアマネジャーの電話・最初から。言葉は lib/signals/phrases.ts の定型と台帳の値だけ。判定・助言の言葉は出さない。

import { EasyWords } from "@/components/forms/EasyText";
import { easy } from "@/lib/forms/easy-words";
import type { FamilyAnswer } from "@/lib/signals/body";
import type { FamilyScreen } from "@/lib/signals/family";
import type { FamilyState } from "@/lib/signals/family-phone";
import { FAMILY_PHRASES, PHONE_PHRASES } from "@/lib/signals/phrases";
import { SheetBlock } from "./PhoneSheet";
import { BIG, Choice, Emergency, Fill, QuestionBody } from "./PhoneView";

export type FamilyActions = {
  answer(color: FamilyAnswer): void;
  /** 問いの選択肢（T49） */
  choose(choice: string): void;
  skip(): void;
  again(): void;
};

const Words = ({ m }: { m: string }) => <EasyWords words={easy(m)} />;

function History({ items }: { items: NonNullable<FamilyScreen["history"]> }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg bg-panel px-4 py-3" data-block="history">
      <h2 className="text-lg font-bold text-muted">
        <Words m={FAMILY_PHRASES.history} />
      </h2>
      <ul className="mt-1 space-y-2">
        {items.map((h) => (
          <li key={h.id} className="text-xl" data-history={h.id}>
            <span className="mr-2 text-lg text-muted tabular-nums">{h.when}</span>
            <span>
              <EasyWords words={h.words} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ケアマネジャーの電話。番号が台帳に無いときは名前だけ（押してもかからない形にしない） */
function CareManager({ cm }: { cm: FamilyScreen["careManager"] }) {
  if (cm.number) {
    return (
      <a
        href={`tel:${cm.number}`}
        className={`${BIG} flex-col gap-1 bg-panel text-[2rem] text-ink`}
        data-press
        data-tel={cm.number}
        data-choice="call-cm"
      >
        <span>
          <Words m={FAMILY_PHRASES.callCm} />
        </span>
        <span className="text-xl font-normal">
          <EasyWords words={cm.words} />
          <span className="ml-2 tabular-nums">{cm.number}</span>
        </span>
      </a>
    );
  }
  return (
    <p className="rounded-lg bg-panel px-4 py-3 text-xl" data-block="care-manager">
      <EasyWords words={cm.words} />
    </p>
  );
}

export function FamilyView({ state, screen, on }: { state: FamilyState; screen: FamilyScreen; on: FamilyActions }) {
  switch (state.step) {
    case "top":
      return (
        <Fill step="top">
          <h1 className="px-1 pt-2 text-center text-[1.75rem] font-bold" role="status" data-question>
            <EasyWords words={screen.question} />
          </h1>
          <button
            type="button"
            onClick={() => on.answer("green")}
            className={`${BIG} phone-fill-ok text-[2.5rem]`}
            data-press="overlay"
            data-choice="green"
          >
            <span>
              <Words m={FAMILY_PHRASES.safe} />
            </span>
          </button>
          <button
            type="button"
            onClick={() => on.answer("red")}
            className={`${BIG} phone-fill-urgent text-[2.5rem]`}
            data-press="overlay"
            data-choice="red"
          >
            <span>
              <Words m={FAMILY_PHRASES.notSafe} />
            </span>
          </button>
          <button
            type="button"
            onClick={() => on.answer("unknown")}
            className={`${BIG} flex-col gap-1 bg-panel text-[2rem] text-ink`}
            data-press
            data-choice="unknown"
          >
            <span>
              <Words m={FAMILY_PHRASES.unknown} />
            </span>
            <span className="text-xl font-normal">
              （<Words m={FAMILY_PHRASES.unknownSub} />）
            </span>
          </button>
        </Fill>
      );
    case "question":
      return (
        <Fill step={`question-${state.id}`}>
          <QuestionBody
            id={state.id}
            family
            lead={
              <>
                <EasyWords words={screen.callName} />
                <Words m={FAMILY_PHRASES.wa} />{" "}
              </>
            }
            onChoice={on.choose}
            onSkip={on.skip}
          />
          <Emergency />
        </Fill>
      );
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
          <div className="py-4 text-center" role="status" data-delivery={state.delivery}>
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
          {screen.history && <History items={screen.history} />}
          {screen.carry && <SheetBlock block={screen.carry} />}
          <CareManager cm={screen.careManager} />
          <Choice onClick={on.again} value="again">
            <Words m={FAMILY_PHRASES.restart} />
          </Choice>
        </Fill>
      );
  }
}
