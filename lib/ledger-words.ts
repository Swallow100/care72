// 台帳の時計と連絡先の画面の言葉（docs/tasks/T132.md）。担当一覧の行の詳細（lib/list/detail.ts）・訓練の左の表の行の詳細
// （同じ詳細の中身）・本人のページ（lib/person.ts の時計の欄と上の時計）が、ここの 1 か所から作る。
// 時計の 1 行は「物の名前 → きっかけから長さ → 残り」: 「酸素 内蔵電池 停電から 2 時間（残り 30 分）」
// 「ワーファリン 手元の量 未確認（発災から数える）」。区分（機器・物品・薬・状態）は行に混ぜず、見出しで束ねる（groupByKind）。
// 出典・確認日は名前を付けて並べ、長さの未確認（何の値かを前に置く）と取り違えない。
// 残りの計算はルールの表（lib/triage の clockRemaining）のまま。ここで決め直さない。色（clockTone）は呼ぶ側が付ける。
// Claude に渡す文（lib/drill/persona.ts・world-oneshot.ts）は画面の言葉でないので、ここを読まない。

import type { ClockKind, ClockRow } from "./db/types.ts";
import {
  CHECK_STATUS_LABELS,
  CLOCK_KIND_LABELS,
  CLOCK_KIND_ORDER,
  CLOCK_SOURCE_LABELS,
  CLOCK_START_LABELS,
  CLOCK_TEXT_LABELS as W,
  CLOCK_UNIT_LABELS,
  DEPENDS_ON_LABELS,
  NIGHT_LABELS,
} from "./labels.ts";
import { clockRemaining, formatHours, type Situation, type TriageClock } from "./triage/index.ts";

/** 言葉にする時計（台帳の時計の行。出典・確認日は無ければ未確認） */
export type ClockTextInput = TriageClock & Partial<Pick<ClockRow, "source" | "source_note" | "confirmed_at">>;

export type ClockText = {
  kind: ClockKind;
  /** 区分の見出し（機器・物品・薬・状態） */
  group: string;
  /** 物の名前（台帳の時計の名前のまま。「酸素 内蔵電池」「ワーファリン」） */
  name: string;
  /**
   * きっかけから長さ（「停電から 2 時間」。走らない時計は長さだけ）。長さが未確認なら何の値かと未確認（「手元の量 未確認」）。
   * 走らない時計で値も無ければ null
   */
  span: string | null;
  /** span を分けた物: きっかけ（「停電から」。走らない時計は null）と長さ（「2 時間」。未確認は null）。長さだけに色を付ける所が使う */
  from: string | null;
  length: string | null;
  /** 長さが未確認 */
  missing: boolean;
  /** 長さが未確認の走る時計の、何の値か（「手元の量」「持つ時間」）。ほかは null。未確認の印を別に添える所（本人のページ）が使う */
  what: string | null;
  /** 長さが未確認の走る時計の数え始め（「発災から数える」） */
  counts: string | null;
  /** 今の残り（災害モードで走っている時計だけ）。「残り 30 分」「超過 1 時間」 */
  left: { text: string; hours: number; over: boolean } | null;
  /** 災害モードでまだ走っていない時計（停電の前）の「未開始」。ほかは null */
  waiting: string | null;
  /** 「出典 説明書」「出典 家族 娘から」「出典 未確認」 */
  source: string;
  sourceMissing: boolean;
  /** 「確認日 2026-11-01」「確認日 未確認」（値を確かめた日。頼り先の確認とは別） */
  confirmed: string;
  confirmedMissing: boolean;
  /** 外の物に頼る時計の頼り先と確認（「透析先 未確認」）。頼らない時計は null */
  depends: { text: string; on: string; check: string; unchecked: boolean } | null;
  /** 1 行の文（「酸素 内蔵電池 停電から 2 時間（残り 30 分）」）。画面は部品ごとに色を付けて描く */
  line: string;
};

/** 日本の日付（YYYY-MM-DD）。読めない値はそのまま */
function jstDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 長さの言葉（「2 時間」）。値が無ければ null */
export function clockLength(k: Pick<ClockRow, "value" | "unit">): string | null {
  return k.value != null && k.unit != null ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : null;
}

/** 残りの言葉（「残り 30 分」「超過 1 時間」）。ルールの表の残り（時間、超えたら負） */
export function leftText(remaining: number, over: boolean): string {
  return over ? `${W.over} ${formatHours(-remaining)}` : `${W.left} ${formatHours(remaining)}`;
}

/**
 * 時計 1 つの言葉。s（発災時の今・発災・停電）を渡すと、走っている時計に今の残り、まだ走っていない時計に「未開始」を付ける。
 * 平時（s なし）は長さだけ
 */
export function clockText(k: ClockTextInput, s: Situation | null = null): ClockText {
  const runs = k.starts_on !== "none";
  const length = clockLength(k);
  const start = CLOCK_START_LABELS[k.starts_on];
  const missing = length === null;
  const what = length === null && runs ? W.missing[k.kind] : null;
  const from = runs ? `${start}${W.from}` : null;
  const span = length !== null ? (from ? `${from} ${length}` : length) : what !== null ? `${what} ${W.unconfirmed}` : null;
  const counts = missing && runs ? `${start}${W.counts}` : null;
  const r = s && runs ? clockRemaining(k, s) : null;
  const left = r?.running ? { text: leftText(r.remaining, r.over), hours: r.remaining, over: r.over } : null;
  const waiting = r && !r.running ? W.waiting : null;
  const note = k.source_note?.trim();
  const source = `${W.source} ${k.source ? CLOCK_SOURCE_LABELS[k.source] : W.unconfirmed}${note ? ` ${note}` : ""}`;
  const confirmed = `${W.confirmed} ${k.confirmed_at ? jstDay(k.confirmed_at) : W.unconfirmed}`;
  const depends =
    k.depends_on && k.depends_check
      ? {
          on: DEPENDS_ON_LABELS[k.depends_on],
          check: CHECK_STATUS_LABELS[k.depends_check],
          text: `${DEPENDS_ON_LABELS[k.depends_on]} ${CHECK_STATUS_LABELS[k.depends_check]}`,
          unchecked: k.depends_check === "unconfirmed",
        }
      : null;
  const tail = [counts, left?.text, waiting].filter((x): x is string => x !== null && x !== undefined).map((x) => `（${x}）`);
  return {
    kind: k.kind,
    group: CLOCK_KIND_LABELS[k.kind],
    name: k.label,
    span,
    from: length !== null ? from : null,
    length,
    missing,
    what,
    counts,
    left,
    waiting,
    source,
    sourceMissing: !k.source,
    confirmed,
    confirmedMissing: !k.confirmed_at,
    depends,
    line: `${[k.label, span].filter((x) => x).join(" ")}${tail.join("")}`,
  };
}

/** 時計を区分ごとに束ねる（機器 → 物品 → 薬 → 状態。区分の中は渡した順）。空の区分は出さない */
export function groupByKind<T extends { kind: ClockKind }>(items: ReadonlyArray<T>): Array<{ kind: ClockKind; label: string; items: T[] }> {
  return CLOCK_KIND_ORDER.map((kind) => ({ kind, label: CLOCK_KIND_LABELS[kind], items: items.filter((x) => x.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );
}

/** 連絡先の夜間の印（「夜間 来訪可」「夜間 来訪不可」「夜間 来訪 未確認」） */
export function nightText(nightOk: 0 | 1 | null | undefined): string {
  return nightOk === 1 ? NIGHT_LABELS.ok : nightOk === 0 ? NIGHT_LABELS.no : NIGHT_LABELS.unknown;
}
