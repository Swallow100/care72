// 採点の見せ方（T22）。訓練の画面の右の欄（components/drill/ScorePanel）と訓練記録の紙面（components/drill/DrillPaper）が
// 同じ行を出す。数字は lib/drill/score.ts が数えた物をそのまま並べるだけで、ここで数え直さない。D1 も Claude も読まない。
// 名前は台帳の id から引く（記録には名前が無い）。引けなければ id のまま。

import type { DrillScenario } from "../db/types.ts";
import { SCENARIO_LABELS } from "./labels.ts";
import { FORM9_PLAN_LABELS, MISS_LABELS, minuteText, orderText, reachedText, reportText, SCORE_LABELS } from "./score-labels.ts";
import { scoreNumbers, type DrillScore, type ScoreNumbers } from "./score.ts";

type Names = Readonly<Record<string, string>>;

export type ScoreKey = keyof ScoreNumbers;

/** 数字 1 つ（今回と前回） */
export type ScoreRow = { key: ScoreKey; label: string; /** 名前に小さく添える（空欄の「様式 9」） */ sub: string | null; now: string; prev: string | null };

export type ScoreView = {
  rows: ScoreRow[];
  /** 条件に達した人（最初に切れた時計） */
  reached: Array<{ person: string; name: string; text: string; outAt: string; tries: number }>;
  /** 順番が一致しなかった人と理由 */
  misses: Array<{ person: string; name: string; why: string; expected: string | null }>;
  /** 様式 9 の空欄のある人と欄 */
  blanks: Array<{ person: string; name: string; columns: string }>;
  /** 着信の数（「応答 3・拒否 1・未応答 0」） */
  calls: string;
  /** 前回の訓練（「11/2 大雨の想定」の元） */
  previous: { id: string; scenario: DrillScenario; startedAt: string } | null;
};

export type PreviousNumbers = { id: string; scenario: DrillScenario; startedAt: string; numbers: ScoreNumbers };

/** 数字の言い方（「7/10」「2 時間 5 分」「未報告」「3」「1」） */
export function numberText(key: ScoreKey, n: ScoreNumbers): string {
  switch (key) {
    case "order":
      return orderText(n.order);
    case "report":
      return reportText(n.report);
    case "form9":
      return String(n.form9);
    case "reached":
      return String(n.reached);
  }
}

export const SCORE_KEYS: ReadonlyArray<ScoreKey> = ["order", "report", "form9", "reached"];

export function scoreView(score: DrillScore, names: Names, previous: PreviousNumbers | null): ScoreView {
  const now = scoreNumbers(score);
  const name = (p: string) => names[p] ?? p;
  return {
    rows: SCORE_KEYS.map((key) => ({
      key,
      label: SCORE_LABELS[key],
      sub: key === "form9" ? SCORE_LABELS.form9Doc : null,
      now: numberText(key, now),
      prev: previous ? numberText(key, previous.numbers) : null,
    })),
    reached: score.reached.map((r) => ({ person: r.person, name: name(r.person), text: reachedText(r), outAt: minuteText(r.outMinute), tries: r.tries })),
    misses: score.order.misses.map((m) => ({
      person: m.person,
      name: name(m.person),
      why: m.why.map((w) => MISS_LABELS[w]).join("・"),
      expected: m.why.includes("late") && m.expected ? name(m.expected) : null,
    })),
    blanks: score.form9.rows.map((r) => ({ person: r.person, name: name(r.person), columns: r.columns.map((c) => FORM9_PLAN_LABELS[c]).join("・") })),
    calls: [
      `${SCORE_LABELS.answered} ${score.calls.answered}`,
      `${SCORE_LABELS.declined} ${score.calls.declined}`,
      `${SCORE_LABELS.open} ${score.calls.open}`,
    ].join("・"),
    previous: previous ? { id: previous.id, scenario: previous.scenario, startedAt: previous.startedAt } : null,
  };
}

/** 前回の訓練の言い方（「前回 11/2 大雨の想定」）。日付は呼ぶ側の形（画面は shortJst） */
export function previousText(p: ScoreView["previous"], date: (iso: string) => string): string {
  return p ? `${SCORE_LABELS.previous} ${date(p.startedAt)} ${SCENARIO_LABELS[p.scenario]}` : SCORE_LABELS.noPrevious;
}
