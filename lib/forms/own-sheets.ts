// 本人の 1 枚の一括印刷（/caseload/own-sheets、T62）の読み。担当一覧と同じ行（lib/list/view.ts の listView）の人を、
// 1 人ずつ本人の 1 枚の頁（app/people/[id]/forms/own/page.tsx）と同じ道で組む: loadPersonDocument(…, "own") で壁と同意の範囲を通し、
// buildOwnSheet・buildOwnSheetMedical（定型、Claude は呼ばない）、QR は loadQrRow → qrState → currentQrToken → qrUrl。
// 範囲の外・同意で開けない人は飛ばして数える。人ごとの読みは Promise.all で並べる（1 人ずつ待たない。1 人 3 回の D1 の往復）。
// 本人の 1 枚の文（lib/forms/own-sheet.ts）と紙面（components/forms/OwnSheet.tsx）は変えない。印刷したことは経過に残さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { loadPersonDocument } from "../consent/documents.ts";
import { currentQrToken, loadQrRow, qrState, type QrStatus } from "../qr/store.ts";
import { qrUrl } from "../qr/url.ts";
import { buildOwnSheetMedical, type MedicalSummaryResult } from "./medical-summary.ts";
import { buildOwnSheet, type OwnSheet } from "./own-sheet.ts";

/** 1 人分（紙面の部品 OwnSheetPaper にそのまま渡す） */
export type OwnSheetItem = {
  personId: string;
  sheet: OwnSheet;
  medical: MedicalSummaryResult;
  /** components/forms/OwnSheet.tsx の OwnQr と同じ形 */
  qr: { status: QrStatus; url: string | null; expiresAt: string | null };
};

export type OwnSheetBatch = {
  /** 刷る人（渡した id の順） */
  items: OwnSheetItem[];
  /** 飛ばした人の数（範囲の外・同意で開けない） */
  skipped: number;
  /** 紙で「ケアマネジャーと 決めます」と出る所（未確認）のある人の氏名（帯だけ。紙には出さない） */
  unconfirmed: string[];
};

export type OwnSheetsOptions = {
  /** JST の日付 */
  today: string;
  officeName: string | null;
  /** QR の署名の鍵（sessionSecret(env)） */
  secret: string;
  /** QR の URL の頭（originFromHeaders）。分からなければ QR は刷らない（1 人の頁と同じ） */
  origin: string | null;
  /** 今（秒） */
  nowSec: number;
};

/** 1 人分。範囲の外・同意で開けなければ null */
async function loadOne(db: D1Database, principal: Principal, id: string, o: OwnSheetsOptions): Promise<OwnSheetItem | null> {
  // QR の行は壁の判定と並べて読む（範囲の外なら捨てる）
  const [opened, row] = await Promise.all([loadPersonDocument(db, principal, id, "own"), loadQrRow(db, id)]);
  if (!opened) return null;
  const { rows } = opened;
  const opts = { today: o.today, officeName: o.officeName };
  const qrRow = row ?? { qr_generation: 0, qr_issued_at: null };
  const now = qrState(qrRow, o.nowSec);
  const token = now.status === "active" ? await currentQrToken(rows.person.id, qrRow, o.secret) : null;
  return {
    personId: rows.person.id,
    sheet: buildOwnSheet(rows, opts),
    // 裏の要約は、支援者提供の同意が無ければ表と同じく支援者の名前・電話を出さない（1 人の頁と同じ）
    medical: buildOwnSheetMedical(rows, opts),
    qr: { status: now.status, url: token && o.origin ? qrUrl(o.origin, token) : null, expiresAt: now.expiresAt },
  };
}

/** 渡した順に人数分を組む */
export async function loadOwnSheets(
  db: D1Database,
  principal: Principal,
  ids: ReadonlyArray<string>,
  o: OwnSheetsOptions,
): Promise<OwnSheetBatch> {
  const all = await Promise.all(ids.map((id) => loadOne(db, principal, id, o)));
  const items = all.filter((x): x is OwnSheetItem => x !== null);
  return {
    items,
    skipped: all.length - items.length,
    unconfirmed: items.filter((x) => x.sheet.open.some((p) => p.kind === "decide")).map((x) => x.sheet.name),
  };
}
