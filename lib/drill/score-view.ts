// 採点の見せ方（T22）。訓練の画面の右の欄（components/drill/ScorePanel）と訓練記録の紙面（components/drill/DrillPaper）が
// 同じ行を出す。数字は lib/drill/score.ts が数えた物をそのまま並べるだけで、ここで数え直さない。D1 も Claude も読まない。
// 名前は台帳の id から引く（記録には名前が無い）。引けなければ id のまま。

import type { DrillScenario } from "../db/types.ts";
import { clockText, type TimeBase } from "./act-time.ts";
import { ACTION_LABELS, ACTION_UI, SCENARIO_LABELS } from "./labels.ts";
import {
  askWords,
  FORM9_PLAN_LABELS,
  MISS_LABELS,
  minuteText,
  orderText,
  reachedText,
  reportText,
  SCORE_LABELS,
  WASTE_LABELS,
} from "./score-labels.ts";
import { extrasCount, scoreNumbers, type DrillScore, type ScoreNumbers } from "./score.ts";

type Names = Readonly<Record<string, string>>;

export type ScoreKey = keyof ScoreNumbers;

/** 数字 1 つ（今回と前回） */
export type ScoreRow = { key: ScoreKey; label: string; /** 名前に小さく添える（空欄の「様式 9」） */ sub: string | null; now: string; prev: string | null };

export type ScoreView = {
  rows: ScoreRow[];
  /** 条件に達した人（最初に切れた時計） */
  reached: Array<{ person: string; name: string; text: string; outAt: string; tries: number }>;
  /** 仮想モードの結末（世界が決めた。AI の印）。固定の筋は null */
  ended: Array<{ person: string; name: string; text: string; reason: string | null; at: string }> | null;
  /** 順番が一致しなかった人と理由 */
  misses: Array<{ person: string; name: string; why: string; expected: string | null }>;
  /** 様式 9 の空欄のある人と欄 */
  blanks: Array<{ person: string; name: string; columns: string }>;
  /** 着信の数（「出た 3・出なかった 1・未応答 0」） */
  calls: string;
  /** 前回の訓練（「11/2 大雨想定」の元） */
  previous: { id: string; scenario: DrillScenario; startedAt: string } | null;
  /** 内訳に足す数（T94。空振り・重複・頼み事の未対応・通話の往復）。T94 より前に残した採点は 0 */
  extra: ScoreExtraView;
};

export type ScoreExtraView = {
  counts: { wasted: number; repeat: number; asksOpen: number; talks: number };
  /** 空振りの手（時刻・対応・対象・理由） */
  wasted: Array<{ action: string; person: string | null; name: string; act: string; why: string; at: string }>;
  /** 重複の手（前の同じ手からの分） */
  repeat: Array<{ action: string; person: string; name: string; act: string; gap: number; at: string }>;
  /** 頼み事の未対応のある人と種類 */
  asks: Array<{ person: string; name: string; kinds: string }>;
};

/** 内訳の 1 行（「空振り 2・重複 1・頼み事 未対応 1・通話 3 往復」） */
export function extraText(c: ScoreExtraView["counts"]): string {
  return [
    `${SCORE_LABELS.wasted} ${c.wasted}`,
    `${SCORE_LABELS.repeat} ${c.repeat}`,
    `${SCORE_LABELS.asks} ${SCORE_LABELS.asksOpen} ${c.asksOpen}`,
    `${SCORE_LABELS.talk} ${c.talks} ${SCORE_LABELS.talks}`,
  ].join("・");
}

/** 手を打った時刻（T128。訓練の中の時刻「14:05」。元が無ければ発災からの経過） */
function extraView(score: DrillScore, name: (p: string) => string, base: TimeBase | null): ScoreExtraView {
  return {
    counts: extrasCount(score),
    wasted: (score.wasted?.rows ?? []).map((r) => ({
      action: r.action,
      person: r.person,
      name: r.person ? name(r.person) : ACTION_UI.whole,
      act: ACTION_LABELS[r.kind] ?? r.kind,
      why: WASTE_LABELS[r.why] ?? r.why,
      at: clockText(base, r.atMinute),
    })),
    repeat: (score.repeat?.rows ?? []).map((r) => ({
      action: r.action,
      person: r.person,
      name: name(r.person),
      act: ACTION_LABELS[r.kind] ?? r.kind,
      gap: r.gap,
      at: clockText(base, r.atMinute),
    })),
    asks: (score.asks?.rows ?? []).map((r) => ({ person: r.person, name: name(r.person), kinds: askWords(r.kinds) })),
  };
}

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
    case "ended":
      return n.ended === undefined ? SCORE_LABELS.none : String(n.ended);
  }
}

export const SCORE_KEYS: ReadonlyArray<ScoreKey> = ["order", "report", "form9", "reached", "ended"];

/** base は手を打った時刻の元（T128。訓練の中の時刻で書く）。無ければ発災からの経過 */
export function scoreView(score: DrillScore, names: Names, previous: PreviousNumbers | null, base: TimeBase | null = null): ScoreView {
  const now = scoreNumbers(score);
  const name = (p: string) => names[p] ?? p;
  // 仮想モード（T53）だけ結末（AI 筋書）の行を足し、条件到達に「時計計算」と添えて別の数と分かるように
  const virtual = score.ended !== undefined;
  const sub = (key: ScoreKey) =>
    key === "form9" ? SCORE_LABELS.form9Doc : key === "reached" && virtual ? SCORE_LABELS.reachedBy : key === "ended" ? SCORE_LABELS.endedBy : null;
  return {
    rows: SCORE_KEYS.filter((key) => key !== "ended" || virtual).map((key) => ({
      key,
      label: SCORE_LABELS[key],
      sub: sub(key),
      now: numberText(key, now),
      prev: previous ? numberText(key, previous.numbers) : null,
    })),
    reached: score.reached.map((r) => ({ person: r.person, name: name(r.person), text: reachedText(r), outAt: minuteText(r.outMinute), tries: r.tries })),
    ended: score.ended
      ? score.ended.map((e) => ({ person: e.person, name: name(e.person), text: e.text, reason: e.reason, at: minuteText(Math.round(e.at * 60)) }))
      : null,
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
    extra: extraView(score, name, base),
  };
}

/** 前回の訓練の言い方（「前回 11/2 大雨想定」）。日付は呼ぶ側の形（画面は shortJst） */
export function previousText(p: ScoreView["previous"], date: (iso: string) => string): string {
  return p ? `${SCORE_LABELS.previous} ${date(p.startedAt)} ${SCENARIO_LABELS[p.scenario]}` : SCORE_LABELS.noPrevious;
}
