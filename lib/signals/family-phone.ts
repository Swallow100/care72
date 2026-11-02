// 家族・支援者のスマホの災害モードの流れ（docs/tasks/T11.md）。画面（components/phone/FamilyView.tsx）はここの状態を描き、押した物を渡すだけ。
// 画面（DOM）に触らない。送る道は渡す（テストは偽物）。
//
//   上（お母さん（山田 ハナ）は 無事ですか: 無事です・無事じゃない・分からない）→ 送る → 答えたあと
//
// - 1 回押せば送る。本人の代わりに答えるので、緑の 1 問・赤の 4 問・20 秒の音声・録音は無い（家族はその場にいないことが多い）
// - 「分からない（連絡が つかない）」は未知の信号（色は未知のまま）
// - 戻るは無い。答えたあとは「最初から」で上へ（次の報告。複数の家族が答えても、いちばん新しい答えが効く）

import { newSignalId, type FamilyAnswer, type FamilySignalBody } from "./body.ts";
import type { Delivery } from "./outbox.ts";

export type FamilyState =
  | { step: "top" }
  | { step: "sending"; color: FamilyAnswer }
  | { step: "done"; color: FamilyAnswer; delivery: Delivery };

export type FamilyDeps = {
  now?: () => number;
  newId?: () => string;
  sendSignal(body: FamilySignalBody): Promise<Delivery>;
  onChange(state: FamilyState): void;
};

export type FamilyPhone = {
  readonly state: FamilyState;
  answer(color: FamilyAnswer): void;
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

  const set = (s: FamilyState) => {
    state = s;
    deps.onChange(s);
  };

  return {
    get state() {
      return state;
    },
    answer(color) {
      if (state.step !== "top") return;
      const mine = ++run;
      const at = new Date(now()).toISOString();
      set({ step: "sending", color });
      void deps
        .sendSignal({ id: newId(), color, occurredAt: at, sentAt: at })
        .catch((): Delivery => "queued")
        .then((delivery) => {
          if (mine === run) set({ step: "done", color, delivery });
        });
    },
    again() {
      if (state.step !== "done") return;
      run++;
      set({ step: "top" });
    },
    dispose() {
      run++;
    },
  };
}
