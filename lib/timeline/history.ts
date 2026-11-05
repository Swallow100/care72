// 本人のページの経過を 2 つに分ける（T143）。
//
// - 経過（人が書き足す記録）: 安否・電話・迎え・安否確認・診察・配薬・搬送・到着・受入・退所・順番変更・記録（自由文）・録音の分類と
//   その直し・QR の閲覧・提供。発災時に医療班・行政・ケアマネが同じページに書く、連絡・安否・医療の記録と、その人に何が起きたか
// - 変更履歴（台帳を直した跡）: 入れる欄の保存（入力・AI の読み取りを確かめた保存・手で直した・外した・値を確かめた）、同意、
//   台帳作成、事業所の操作（利用者追加・担当変更・一覧除外・一覧復帰・引受）、時計の頼り先の確認、本人の報告の印、スマホ入口の発行
//
// 分けるのは画面だけ。lib/person.ts の timelineItems は今どおり全部を古い順に返し（kind・body・並びは変えない）、変更履歴の行に
// history（分かる 1 行と、欄ごとの前と後）を足す。台帳（D1）の本文は変えず、ここで 1 行に言い換える（前からある行も同じ言い方になる）。
// 撤回（T63）できる行はどれも経過の側（人が書いた行だけ）。

import {
  CONSENT_KINDS,
  INTAKE_SOURCE,
  type ConsentKind,
  type ConsentStatus,
  type IntakeDiff,
  type IntakePayload,
  type TimelineEntryRow,
  type TimelineKind,
} from "../db/types.ts";
import { readTimelineHead, type ReadMeta } from "../intake/read-form.ts";
import { TIMELINE_SOURCES, type TimelineSource } from "../intake/timeline-sources.ts";
import { CONSENT_KIND_LABELS } from "../labels.ts";
import { OFFICE_SOURCE } from "../office/timeline.ts";

/** 変更履歴に入る経過の種類（台帳の欄・同意・印を変えた行） */
const HISTORY_KINDS: ReadonlySet<TimelineKind> = new Set(["consent", "clock_check", "self_report_mark"]);

/** スマホ入口の発行・再発行の行の出どころ（lib/qr/phone-link-store.ts の PHONE_LINK_SOURCE。重い import を避けて字で持つ。テストで同じか確かめる） */
export const PHONE_LINK_HISTORY_SOURCE = "phone_link";

/** 変更履歴に入る記録（kind note）の出どころ: 入れる欄の保存・事業所の操作・スマホ入口 */
const HISTORY_NOTE_SOURCES: ReadonlySet<string> = new Set([INTAKE_SOURCE, OFFICE_SOURCE, PHONE_LINK_HISTORY_SOURCE]);

function sourceOf(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as { source?: unknown };
    return typeof p.source === "string" ? p.source : null;
  } catch {
    return null;
  }
}

/** 経過の表の 1 行が変更履歴（台帳を直した跡）か。違えば経過（人が書き足す記録） */
export function isHistoryRow(row: Pick<TimelineEntryRow, "kind" | "payload">): boolean {
  if (HISTORY_KINDS.has(row.kind)) return true;
  if (row.kind !== "note") return false;
  const s = sourceOf(row.payload);
  return s !== null && HISTORY_NOTE_SOURCES.has(s);
}

/** 写真・PDF の読み取りの言い方の頭（「写真から」「PDF の 2 頁目から」） */
function readFrom(read: ReadMeta): string {
  if (read.source === "photo") return "写真から ";
  const name = { pdf: "PDF", excel: "Excel", word: "Word" }[read.source];
  return `${name} の ${read.page} 頁目から `;
}

/** 欄の名前の並び（「既往・アレルギー ほか 3」）の「ほか N」を「ほか N 欄」に */
function namesText(names: string): string {
  return names.trim().replace(/ ほか (\d+)$/, " ほか $1 欄");
}

const PHRASES: Record<TimelineSource, (names: string) => string> = {
  ai: (n) => (n ? `AI が読んだ${n}を確かめて保存` : "AI が読んだ物を確かめて保存"),
  manual: (n) => (n ? `${n}を手で入力` : "手で入力"),
  edit: (n) => (n ? `${n}を手で修正` : "手で修正"),
  removed: (n) => (n ? `${n}を外した` : "外した"),
  seen: (n) => (n ? `${n}の値を確かめた` : "値を確かめた"),
};

const SOURCE_KEYS = Object.keys(TIMELINE_SOURCES) as TimelineSource[];

/**
 * 入れる欄の保存の本文（「手入力: 既往」「写真を読んだ（隠した所 3 か所）。AI の分け方、人が確認: 既往」）を分かる 1 行に:
 * 「既往を手で入力」「写真から AI が読んだ既往を確かめて保存（隠した所 3 か所）」。頭の分からない本文はそのまま
 */
export function intakeLine(body: string | null, payload: Pick<IntakePayload, "read"> | null): string {
  if (!body) return "";
  let rest = body;
  let read: ReadMeta | null = null;
  if (payload?.read) {
    const head = readTimelineHead(payload.read);
    if (rest.startsWith(head)) {
      rest = rest.slice(head.length).replace(/^。/, "");
      read = payload.read;
    }
  }
  const parts = rest
    .split("。")
    .filter((p) => p.trim() !== "")
    .map((part) => {
      const k = SOURCE_KEYS.find((s) => part.startsWith(`${TIMELINE_SOURCES[s]}:`));
      if (!k) return part;
      const line = PHRASES[k](namesText(part.slice(TIMELINE_SOURCES[k].length + 1)));
      return k === "ai" && read ? `${readFrom(read)}${line}（隠した所 ${read.redacted} か所）` : line;
    });
  return parts.join("。");
}

/**
 * 同意の行（同じ時刻・同じ人の記録）を 1 行に: 「同意 5 つ（名簿登録・計画共有・…）」。不同意があれば分けて
 * 「同意 4 つ（…）、不同意 1 つ（支援者提供）」。並びは同意の種類の順
 */
export function consentLine(items: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>): string {
  const ordered = CONSENT_KINDS.flatMap((k) => items.filter((c) => c.kind === k));
  const group = (status: ConsentStatus, word: string) => {
    const ks = ordered.filter((c) => c.status === status).map((c) => CONSENT_KIND_LABELS[c.kind]);
    return ks.length > 0 ? `${word} ${ks.length} つ（${ks.join("・")}）` : null;
  };
  return [group("granted", "同意"), group("refused", "不同意"), group("unconfirmed", "未確認")].filter((x) => x).join("、");
}

/** 変更履歴の行に足す物（lib/person.ts の TimelineItem.history） */
export type HistoryOf = {
  /** 分かる 1 行（「既往を手で入力」「同意 5 つ（…）」「台帳作成」） */
  line: string;
  /** 欄ごとの前と後（入れる欄の保存で T143 から残した物。前の行と、ほかの種類は null） */
  diff: IntakeDiff[] | null;
};

/** 経過の表の変更履歴の行の 1 行。kind と body は画面の言葉（TIMELINE_KIND_LABELS・事業所の操作の言葉に直した後） */
export function historyLine(row: Pick<TimelineEntryRow, "kind" | "payload" | "body">, kindLabel: string): HistoryOf {
  const s = sourceOf(row.payload);
  if (row.kind === "note" && s === INTAKE_SOURCE) {
    let p: Partial<IntakePayload> | null = null;
    try {
      p = row.payload ? (JSON.parse(row.payload) as Partial<IntakePayload>) : null;
    } catch {
      p = null;
    }
    const diff = Array.isArray(p?.diff) ? p.diff : null;
    return {
      line: intakeLine(row.body, p?.read ? { read: p.read } : null) || kindLabel,
      diff: diff && diff.length > 0 ? diff : null,
    };
  }
  const body = row.body?.trim() ?? "";
  // 本文だけで分かる物（本人の報告の印・スマホ入口）は本文、ほかは種類と本文（「担当変更 担当 山本 → 佐藤」「時計確認 酸素 透析先 確認済」）
  if (row.kind === "self_report_mark" || (row.kind === "note" && s === PHONE_LINK_HISTORY_SOURCE))
    return { line: body || kindLabel, diff: null };
  return { line: [kindLabel, body].filter((x) => x).join(" "), diff: null };
}
