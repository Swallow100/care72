// 手と出来事の細かなログ（docs/tasks/T110.md の 4）。1 回の訓練の手と出来事を、時刻の順に 1 本に並べる。
// 列は 打った時刻（起きた時刻）・終わった時刻・所要・種類・内容・本人・相手・結果・AI の判断の理由（短く）・所要を伸ばした決まり。
// 訓練記録の紙（components/drill/DrillPaper）と CSV（GET /api/drill/[id]/log）が同じ行を読む。
//
// - 手は drills.world と drill_events から作り直した手の記録（lib/drill/view.ts の DrillScreen の state.actions）。取り消した手は入らない
// - 出来事は刻み（区切り）の状況。訓練の途中は、ケアマネが知り得ない物（本人に起きたこと）を出さない（T105 の公表の線、lib/drill/timeline.ts）
// - AI の判断の理由: 自由対応は読み替えの理由（AI。氏名に戻した物でサーバーと訓練記録の中だけ）、AI が作った出来事は根拠や理由の 1 行
// - 色と連絡順（lib/triage）は読まない・書かない。Claude を呼ばない

import { FREE_LABELS } from "./action-catalog.ts";
import { FREE_WAY_LABELS } from "./action-terms.ts";
import { ACTION_STATUS_LABELS } from "./actions.ts";
import type { ActionRecord, DrillIncident, Tick } from "./engine.ts";
import { incidentLabel } from "./event-catalog.ts";
import { ACTION_LABELS, calleeText, EVENT_KIND_LABELS } from "./labels.ts";
import { incidentReach } from "./timeline.ts";
import { minuteText } from "./time-text.ts";
import { csvText, jstDateLabel } from "../forms/form9-csv.ts";

/** ログの言葉（2〜4 字） */
export const ACT_LOG_LABELS = {
  title: "手と出来事",
  at: "開始",
  end: "終了",
  minutes: "所要",
  kind: "種類",
  what: "内容",
  person: "本人",
  callee: "相手",
  result: "結果",
  reason: "AI理由",
  adds: "加算",
  action: "手",
  event: "出来事",
  whole: "全体",
  csv: "記録CSV",
} as const;

export type ActLogRow = {
  kind: "action" | "event";
  /** 手の番号（a1…）か、出来事の鍵（<刻み>-<番号>） */
  key: string;
  /** 打った時刻・起きた時刻（発災からの分） */
  at: number;
  /** 終わった時刻（発災からの分）。出来事は起きた時刻と同じ。返事待ちの手は null */
  end: number | null;
  /** 所要（分）。出来事は 0 */
  minutes: number;
  /** 手の名前（自由対応は「自由対応 扱い 薬手配」「自由対応 扱い 電話」、何も起きない文は「自由対応」と結果「変化なし」）か出来事の印 */
  what: string;
  /** 自由対応の文・出来事の文。手のメモ（T59）は「メモ …」で足す */
  detail: string;
  /** 本人（台帳の id）。全体の手・出来事は null */
  person: string | null;
  /** 相手の言い方（「家族 娘」「市役所」）。無ければ null */
  callee: string | null;
  /** 結果（返事の状態と文） */
  result: string;
  /** AI の判断の理由（短く）。無ければ null */
  reason: string | null;
  /** AI が作った物（読み替え・言い換え・本人役の言葉・監督と世界の出来事）か */
  ai: boolean;
  /** 所要を伸ばした決まり（「夜間」「浸水」） */
  adds: string[];
};

/** AI の判断の理由の長さ（字） */
const REASON_MAX = 60;

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

/** 手の名前（自由対応は何として扱ったか。表の手か、そのままの手のやり方。T129 で「読替」から「扱い」に） */
function actionWhat(a: ActionRecord): string {
  if (a.kind !== "free") return ACTION_LABELS[a.kind];
  if (a.as) return `${ACTION_LABELS.free} ${FREE_LABELS.as} ${ACTION_LABELS[a.as]}`;
  return a.way && !a.idle ? `${ACTION_LABELS.free} ${FREE_LABELS.as} ${FREE_WAY_LABELS[a.way]}` : ACTION_LABELS.free;
}

/** 手の内容（自由対応はケアマネの文。メモがあれば足す） */
function actionDetail(a: ActionRecord): string {
  const parts = [a.kind === "free" && a.text ? a.text : null, a.memo ? `メモ ${a.memo}` : null].filter((x): x is string => !!x);
  return parts.join("　");
}

/** 結果の言葉（状態と文。文が状態と同じなら状態だけ） */
function actionResult(a: ActionRecord): string {
  const r = a.result;
  if (!r) return "";
  const label = ACTION_STATUS_LABELS[r.status];
  const text = r.text && r.text !== label ? r.text : "";
  const because = r.because ? `（${r.because}）` : "";
  return [label, text].filter(Boolean).join(" ") + because;
}

/** 出来事の印と AI の理由（監督・世界の出来事は理由か根拠の id） */
function incidentRow(e: DrillIncident, key: string): ActLogRow {
  const at = Math.round(e.at * 60);
  const label = incidentLabel(e) ?? EVENT_KIND_LABELS[e.change.kind];
  const reason = e.ai ? [e.reason ?? null, e.basis ? `根拠 ${e.basis}` : null].filter(Boolean).join("　") || null : null;
  return {
    kind: "event",
    key,
    at,
    end: at,
    minutes: 0,
    what: label,
    detail: e.text,
    person: e.person ?? null,
    callee: null,
    result: "",
    reason: reason ? cut(reason, REASON_MAX) : null,
    ai: e.ai,
    adds: [],
  };
}

/**
 * 手と出来事のログ（時刻の順。同じ時刻は出来事が先）。finished が false（訓練の途中）なら、ケアマネが知り得ない出来事を出さない
 * （T105 の公表の線。AI 停止の印は上の帯なので出さない）
 */
export function buildActLog(
  input: { actions: ReadonlyArray<ActionRecord>; ticks: ReadonlyArray<Pick<Tick, "step" | "incidents">> },
  opts: { finished: boolean },
): ActLogRow[] {
  const rows: Array<ActLogRow & { order: number }> = [];
  for (const t of input.ticks) {
    t.incidents.forEach((e, i) => {
      if (e.change.kind === "ai_stop") return;
      const reach = incidentReach(e);
      if (reach === "none") return;
      if (!opts.finished && reach !== "public") return;
      rows.push({ ...incidentRow(e, `${t.step}-${i}`), order: 0 });
    });
  }
  for (const a of input.actions) {
    const ai = a.result?.ai === true || a.result?.speechAi === true || (a.kind === "free" && a.judge?.called === true);
    rows.push({
      kind: "action",
      key: a.id,
      at: a.atMinute,
      end: a.result ? Math.max(a.endMinute, a.result.atMinute) : null,
      minutes: a.minutes,
      what: actionWhat(a),
      detail: actionDetail(a),
      person: a.person,
      callee: calleeText(a),
      result: actionResult(a),
      reason: a.kind === "free" && a.reason ? cut(a.reason, REASON_MAX) : null,
      ai,
      adds: [...(a.adds ?? [])],
      order: 1,
    });
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => x.r.at - y.r.at || x.r.order - y.r.order || x.i - y.i)
    .map(({ r: { order: _order, ...row } }) => row);
}

// ---------- CSV ----------

export const ACT_LOG_CSV_NAMES = { ascii: "drill-log", utf8: "訓練の手と出来事" } as const;

/**
 * ログの CSV（UTF-8 の BOM・CRLF・式の守り。様式 9 の CSV と同じ書き方 lib/forms/form9-csv.ts の csvText）。
 * 上の 2 行は題と事業所・想定・作成日。1 行空けて見出し、その下に行。時刻は発災からの経過（「3 時間 40 分」）、所要は分の数
 */
export function actLogCsv(
  rows: ReadonlyArray<ActLogRow>,
  meta: { names: Readonly<Record<string, string>>; officeName: string; scenario: string; madeAt: string },
): string {
  const L = ACT_LOG_LABELS;
  const name = (p: string | null) => (p ? (meta.names[p] ?? p) : L.whole);
  return csvText([
    [L.title],
    [`事業所名：${meta.officeName}`, `想定：${meta.scenario}`, `作成：${jstDateLabel(meta.madeAt)}`],
    [],
    [L.at, L.end, L.minutes, L.kind, L.what, L.person, L.callee, L.result, L.reason, "AI", L.adds],
    ...rows.map((r) => [
      minuteText(r.at),
      r.end === null ? "" : minuteText(r.end),
      String(r.minutes),
      r.kind === "action" ? L.action : L.event,
      [r.what, r.detail].filter(Boolean).join(" "),
      name(r.person),
      r.callee ?? "",
      r.result,
      r.reason ?? "",
      r.ai ? "AI" : "",
      r.adds.join("・"),
    ]),
  ]);
}
