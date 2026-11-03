// 家族・支援者のスマホの災害モードの流れ（docs/tasks/T11.md）。画面（components/phone/FamilyView.tsx）はここの状態を描き、押した物を渡すだけ。
// 画面（DOM）に触らない。送る道は渡す（テストは偽物）。
//
//   上（お母さん（山田 ハナ）は 無事ですか: 無事です・無事じゃない・分からない）→ 送る → 答えたあと
//                                              └ 無事じゃない → 送る → 本人と同じ問いの表（主語は本人。T49）→ 答えたあと
//
// - 1 回押せば送る。本人の代わりに答えるので、緑の 1 問・20 秒の音声・録音は無い（家族はその場にいないことが多い・押せる前提）
// - 無事じゃない のあとは 1 画面 1 問（lib/signals/questions.ts。本人だけの問い〔連絡手段・頼みごと〕は聞かない）。
//   押すたびに、それまでの答えの全部を同じ信号に送る（後勝ち）。どの問いもとばせる
// - けが・動けない・出られない・水・火やガス・機器の停止の答え（T69b）は、残りの問いを聞かずに送れたかへ（録音は無い）。
//   けが ある のあとに 動けるか がまだ無ければ「動けますか」の 1 問だけ聞いてから（表が読む 2 問を落とさない）
// - 「分からない（連絡が つかない）」は未知の信号（色は未知のまま）
// - 戻るは無い。答えたあとは「最初から」で上へ（次の報告。複数の家族が答えても、いちばん新しい答えが効く）

import { newSignalId, type FamilyAnswer, type FamilySignalBody } from "./body.ts";
import type { AnswersItem, Delivery } from "./outbox.ts";
import { worseDelivery } from "./phone.ts";
import {
  choiceOf,
  firstQuestion,
  nextQuestion,
  rushesToRecording,
  rushNext,
  type Answers,
  type Asker,
  type QuestionId,
} from "./questions.ts";

export type FamilyState =
  | { step: "top" }
  /** 無事じゃない のあとの問い（T49） */
  | { step: "question"; id: QuestionId; answers: Answers }
  | { step: "sending"; color: FamilyAnswer }
  | { step: "done"; color: FamilyAnswer; delivery: Delivery };

export type FamilyDeps = {
  now?: () => number;
  newId?: () => string;
  sendSignal(body: FamilySignalBody): Promise<Delivery>;
  /** 聞き取りの答え（T49） */
  sendAnswers(item: AnswersItem): Promise<Delivery>;
  /** 台帳に機器がある（機器の問いを聞く） */
  hasDevice?: boolean;
  /** 台帳の避難先の数（T69b。0 なら「どこの 避難所ですか」を聞かない） */
  shelters?: number;
  onChange(state: FamilyState): void;
};

export type FamilyPhone = {
  readonly state: FamilyState;
  answer(color: FamilyAnswer): void;
  /** 問いの選択肢を押した */
  choose(choice: string): void;
  /** 問いをとばす */
  skip(): void;
  /** 答えたあと上へ */
  again(): void;
  /** 画面を閉じた（送っている途中の結果を当てない） */
  dispose(): void;
};

export function createFamilyPhone(deps: FamilyDeps): FamilyPhone {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => newSignalId());
  let state: FamilyState = { step: "top" };
  /** 流れの番号。閉じた・最初からのあとに、前の送信の結果を当てない */
  let run = 0;
  const asker: Asker = { who: "family", hasDevice: deps.hasDevice ?? false, shelters: deps.shelters ?? 0 };
  let signal: { id: string; delivery: Promise<Delivery> } | null = null;
  let answers: Answers = {};
  let lastAnswers: Promise<Delivery> | null = null;
  /** 残りの問いを飛ばす答えを押した（T69b） */
  let rushing = false;

  /** 答えた（choice が null ならとばした）あとの次の問い */
  const nextAfter = (id: QuestionId, choice: string | null): QuestionId | null => {
    if (rushesToRecording(id, choice)) rushing = true;
    return rushing ? rushNext(id, answers, asker) : nextQuestion(id, choice, asker);
  };

  const set = (s: FamilyState) => {
    state = s;
    deps.onChange(s);
  };

  /** 次の問いへ。null なら送れたかを待って答えたあとへ */
  function step(next: QuestionId | null) {
    if (next !== null) {
      set({ step: "question", id: next, answers });
      return;
    }
    const mine = run;
    set({ step: "sending", color: "red" });
    void Promise.all([signal?.delivery ?? Promise.resolve<Delivery>("sent"), lastAnswers ?? Promise.resolve<Delivery>("sent")]).then(
      ([a, b]) => {
        if (mine === run) set({ step: "done", color: "red", delivery: worseDelivery(a, b) });
      },
    );
  }

  return {
    get state() {
      return state;
    },
    answer(color) {
      if (state.step !== "top") return;
      const mine = ++run;
      const at = new Date(now()).toISOString();
      const id = newId();
      const delivery = deps.sendSignal({ id, color, occurredAt: at, sentAt: at }).catch((): Delivery => "queued");
      const first = color === "red" ? firstQuestion(asker) : null;
      if (first !== null) {
        signal = { id, delivery };
        answers = {};
        lastAnswers = null;
        rushing = false;
        set({ step: "question", id: first, answers });
        return;
      }
      set({ step: "sending", color });
      void delivery.then((d) => {
        if (mine === run) set({ step: "done", color, delivery: d });
      });
    },
    choose(choice) {
      if (state.step !== "question" || !signal) return;
      const q = state.id;
      if (!choiceOf(q, choice)) return;
      answers = { ...answers, [q]: { choice, via: "press" as const } };
      lastAnswers = deps.sendAnswers({ signalId: signal.id, answers: { ...answers } }).catch((): Delivery => "queued");
      step(nextAfter(q, choice));
    },
    skip() {
      if (state.step !== "question") return;
      step(nextAfter(state.id, null));
    },
    again() {
      if (state.step !== "done") return;
      run++;
      signal = null;
      set({ step: "top" });
    },
    dispose() {
      run++;
    },
  };
}
