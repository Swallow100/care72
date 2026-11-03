// 担当一覧の CSV（T62）。画面（app/page.tsx）と同じ loadCaseload と listView（lib/list/view.ts）の行を、その順で書く。
// 色・理由・連絡順はルールの表（lib/triage）の結果をそのまま写す（ここで作り直さない）。Claude は呼ばない。
// 形は様式 9 の CSV と同じ（lib/forms/form9-csv.ts の csvText: UTF-8 の BOM・CRLF・式の守り）。
// 上の 2 行は題「担当一覧」と、事業所名・担当・作成日・並び・絞込。1 行空けて見出し、その下に行。
// 列は表と同じ言葉（lib/list/labels.ts の COLUMN_LABELS、本人のページの上の段の HEAD_LABELS）。
//   平時:   連絡順（骨格の段。画面の平時の表の連絡順と同じ）・氏名・カナ・年齢・介護度・医療・ハザード・支援者・避難計画・未確認・地区
//   発災時: 連絡順（ルールの表の並びの番号。画面の発災時の表の連絡順と同じ値で、絞っても元の番号）・状態・理由・組（骨格の段 1〜8）、
//           そのあと平時の 氏名〜地区、末尾に 残り・最終連絡（DECISIONS 11/4 00:0x。2 つの番号が同じ名前に見えないよう、段は「組」）
// 断り方は様式 9 の CSV と同じ: ログインなし 401、役が違う 403、範囲の外 404。書き出したことは経過に残さない（T62 の決め）。

import type { D1Database } from "@cloudflare/workers-types";
import { denied } from "../auth/guard.ts";
import type { Principal } from "../auth/principal.ts";
import { caseloadScope } from "../auth/scope.ts";
import { loadCaseload, type Caseload, type CaseloadRow } from "../caseload.ts";
import { BLANK_LABELS, CARE_LEVEL_LABELS, COLOR_LABELS, HEAD_LABELS, PLAN_STATUS_LABELS } from "../labels.ts";
import { COLUMN_LABELS, DETAIL_LABELS, FILTER_LABELS } from "../list/labels.ts";
import { filterWords, listQueryOf, listView, sortWords, type ListViewResult } from "../list/view.ts";
import { CUSTODY_LABELS } from "../custody/labels.ts";
import { csvFileNames, csvText, jstDateLabel } from "./form9-csv.ts";
import { csvResponse } from "./csv-response.ts";

export const CASELOAD_CSV_TITLE = "担当一覧";
export const CASELOAD_CSV_NAMES = { ascii: "caseload", utf8: "担当一覧" } as const;

type Column = { header: string; cell: (r: CaseloadRow) => string };

const num = (n: number | null) => (n === null ? "" : String(n));

/** 医療の印（時計のいちばん短い残りつき「酸素 残り 4h」。画面の MedicalCell と同じ。時計の無い人は台帳の機器） */
export function medicalText(r: Pick<CaseloadRow, "markItems" | "devices">): string {
  if (r.markItems.length > 0) return r.markItems.map((m) => (m.remaining ? `${m.label} ${m.remaining}` : m.label)).join("・");
  return r.devices.join("・");
}

/** 発災時の「組」の列の見出し（骨格の段 1〜8。発災時の連絡順と別の値なので別の名前） */
export const GROUP_HEADER = "組";

/** 平時の連絡順（骨格の段） */
const NORMAL_ORDER: Column = { header: COLUMN_LABELS.tier, cell: (r) => String(r.tier) };

/** 氏名から地区まで（平時・発災時で同じ） */
const BODY_COLUMNS: ReadonlyArray<Column> = [
  { header: COLUMN_LABELS.kana, cell: (r) => r.name },
  { header: CUSTODY_LABELS.kana, cell: (r) => r.kana },
  { header: HEAD_LABELS.age, cell: (r) => num(r.age) },
  { header: HEAD_LABELS.careLevel, cell: (r) => (r.careLevel ? CARE_LEVEL_LABELS[r.careLevel] : "") },
  { header: COLUMN_LABELS.medical, cell: medicalText },
  { header: COLUMN_LABELS.hazard, cell: (r) => (r.hazards.length === 0 ? BLANK_LABELS.none : r.hazards.join("・")) },
  { header: COLUMN_LABELS.supporter, cell: (r) => String(r.supporters) },
  { header: COLUMN_LABELS.plan, cell: (r) => PLAN_STATUS_LABELS[r.plan] },
  { header: BLANK_LABELS.unconfirmed, cell: (r) => String(r.pending) },
  { header: FILTER_LABELS.area, cell: (r) => r.town ?? "" },
];

/** 発災時の先頭（連絡順・状態・理由・組） */
const DISASTER_HEAD: ReadonlyArray<Column> = [
  { header: COLUMN_LABELS.tier, cell: (r) => num(r.rank) },
  { header: COLUMN_LABELS.state, cell: (r) => (r.triage ? COLOR_LABELS[r.triage.color] : "") },
  { header: DETAIL_LABELS.reason, cell: (r) => r.triage?.reason ?? "" },
  { header: GROUP_HEADER, cell: (r) => String(r.tier) },
];

/** 発災時の末尾（残り・最終連絡） */
const DISASTER_TAIL: ReadonlyArray<Column> = [
  { header: COLUMN_LABELS.remain, cell: (r) => (r.remain ? `${r.remain.text} ${r.remain.label}` : "") },
  {
    header: COLUMN_LABELS.contact,
    cell: (r) => (r.lastContact ? `${r.lastContact.when} ${r.lastContact.source}` : DETAIL_LABELS.noContact),
  },
];

/** 平時・発災時の列 */
export function caseloadColumns(disaster: boolean): ReadonlyArray<Column> {
  return disaster ? [...DISASTER_HEAD, ...BODY_COLUMNS, ...DISASTER_TAIL] : [NORMAL_ORDER, ...BODY_COLUMNS];
}

/** CSV の文。view は画面と同じ listView の結果（rows がその順で書かれる） */
export function caseloadCsv(
  data: Pick<Caseload, "office" | "careManager" | "situation">,
  view: Pick<ListViewResult, "key" | "dir" | "filter" | "rows">,
  madeAt: string,
): string {
  const columns = caseloadColumns(data.situation !== null);
  return csvText([
    [CASELOAD_CSV_TITLE],
    [
      `事業所名：${data.office.name}`,
      `担当：${data.careManager.name}`,
      `作成：${jstDateLabel(madeAt)}`,
      sortWords(view),
      filterWords(view.filter),
    ],
    [],
    columns.map((c) => c.header),
    ...view.rows.map((r) => columns.map((c) => c.cell(r))),
  ]);
}

/**
 * GET /caseload/csv の中身（route は principal と env を渡すだけ）。URL の並びと絞込は担当一覧と同じ読み方。
 * ケアマネの役（審査員のケアマネの役を含む）だけ。範囲は自分の担当（lib/auth/scope.ts の caseloadScope）
 */
export async function caseloadCsvResponse(
  db: D1Database,
  principal: Principal | null,
  params: URLSearchParams,
  at: { today: string; now: string },
): Promise<Response> {
  const no = denied(principal, "read");
  if (no) return no;
  const scope = caseloadScope(principal!);
  if (!scope) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
  const data = await loadCaseload(db, scope, at.today, at.now);
  if (!data) return Response.json({ error: "not_found", label: "該当なし" }, { status: 404 });
  const view = listView(data, listQueryOf(params));
  return csvResponse(caseloadCsv(data, view, at.now), csvFileNames(at.now, CASELOAD_CSV_NAMES));
}
