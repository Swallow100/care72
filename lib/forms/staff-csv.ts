// 受け持ちの CSV（T62）。医療班・行政の受け持ちの表（/staff）と同じ loadStaffBoard の行を、そのまま書く。
// 理由と医療の列は同意の範囲の濾し（lib/custody/board.ts の medicalShown）が入ったあとの物で、ここで読み直さない
// （医療班への提供に同意の無い人は理由・医療・薬・機器・残りが空のまま）。色と連絡順はルールの表の結果のまま。Claude は呼ばない。
// 画面の絞込（避難所・状態・氏名）は氏名を URL に載せない作り（画面の中だけ）なので、CSV は全員を表の順（連絡順）で。
// 列: 連絡順・状態・理由・氏名・カナ・年齢・医療・薬・機器・残り・避難所・経路・受入時刻・事業所。
// 断り方は様式 9 の CSV と同じ: ログインなし 401、役が違う 403。範囲は自分のアカウントが受け入れた人（lib/custody/actor.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import { denied } from "../auth/guard.ts";
import type { Principal } from "../auth/principal.ts";
import { JUDGE_LABEL } from "../auth/roles.ts";
import { staffActor, type StaffActor } from "../custody/actor.ts";
import { loadStaffBoard, type StaffBoard, type StaffRow } from "../custody/board.ts";
import { CUSTODY_LABELS, CUSTODY_VIA_LABELS } from "../custody/labels.ts";
import { COLOR_LABELS } from "../labels.ts";
import { COLUMN_LABELS, DETAIL_LABELS } from "../list/labels.ts";
import { csvFileNames, csvText, jstDateLabel } from "./form9-csv.ts";
import { csvResponse } from "./csv-response.ts";

export const STAFF_CSV_TITLE = CUSTODY_LABELS.page;
export const STAFF_CSV_NAMES = { ascii: "staff", utf8: "受け持ち" } as const;

type Column = { header: string; cell: (r: StaffRow) => string };

/** 列（画面の受け持ちの表の言葉） */
export const STAFF_COLUMNS: ReadonlyArray<Column> = [
  { header: COLUMN_LABELS.tier, cell: (r) => String(r.rank) },
  { header: CUSTODY_LABELS.state, cell: (r) => COLOR_LABELS[r.color] },
  { header: DETAIL_LABELS.reason, cell: (r) => r.reason },
  { header: CUSTODY_LABELS.name, cell: (r) => r.name },
  { header: CUSTODY_LABELS.kana, cell: (r) => r.kana },
  {
    header: CUSTODY_LABELS.age,
    cell: (r) => (r.age === null ? "" : r.ageReported ? `${r.age}（${CUSTODY_LABELS.reportedAge}）` : String(r.age)),
  },
  { header: CUSTODY_LABELS.medical, cell: (r) => r.markItems.map((m) => (m.remaining ? `${m.label} ${m.remaining}` : m.label)).join("・") },
  { header: CUSTODY_LABELS.medications, cell: (r) => r.medications.join("・") },
  { header: CUSTODY_LABELS.devices, cell: (r) => r.devices.join("・") },
  { header: CUSTODY_LABELS.remain, cell: (r) => (r.remain ? `${r.remain.text} ${r.remain.label}` : "") },
  { header: CUSTODY_LABELS.shelter, cell: (r) => r.shelter },
  { header: "経路", cell: (r) => CUSTODY_VIA_LABELS[r.via] },
  { header: "受入時刻", cell: (r) => r.receivedWhen },
  { header: CUSTODY_LABELS.office, cell: (r) => r.office },
];

/** CSV の文。行は loadStaffBoard の順（連絡順）のまま */
export function staffCsv(board: Pick<StaffBoard, "rows">, actor: Pick<StaffActor, "name" | "judge">, madeAt: string): string {
  return csvText([
    [STAFF_CSV_TITLE],
    [
      `${CUSTODY_LABELS.by}：${actor.name ?? (actor.judge ? JUDGE_LABEL : "")}`,
      `作成：${jstDateLabel(madeAt)}`,
      `並び：${COLUMN_LABELS.tier}`,
      `${board.rows.length} ${CUSTODY_LABELS.people}`,
    ],
    [],
    STAFF_COLUMNS.map((c) => c.header),
    ...board.rows.map((r) => STAFF_COLUMNS.map((c) => c.cell(r))),
  ]);
}

/** GET /staff/csv の中身（route は principal と env を渡すだけ）。医療班・行政（審査員の医療班の役も）だけ */
export async function staffCsvResponse(
  db: D1Database,
  principal: Principal | null,
  at: { today: string; now: string },
): Promise<Response> {
  const no = denied(principal, "read");
  if (no) return no;
  const actor = staffActor(principal);
  if (!actor) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
  const board = await loadStaffBoard(db, actor, at.today, at.now);
  return csvResponse(staffCsv(board, actor, at.now), csvFileNames(at.now, STAFF_CSV_NAMES));
}
