// 本人の 1 枚の一括印刷（/caseload/own-sheets、T62）の読み。担当一覧と同じ行（lib/list/view.ts の listView）の人を、
// 本人の 1 枚の頁（app/people/[id]/forms/own/page.tsx）と同じ物で組む: 壁（事業所）と同意の範囲（own が開けるか）を当て、
// buildOwnSheet・buildOwnSheetMedical（定型、Claude は呼ばない）、QR は qrState → currentQrToken → qrUrl。
// 範囲の外・同意で開けない人は飛ばして数える。
//
// 読みは人数に関わらず D1 の batch 1 回（本人・連絡先・同意・時計を IN でまとめ読み）。
// 1 人ずつ loadPersonDocument を並べると 1 人 3 回の往復になり、手元の D1 では 10 人で 6〜8 秒掛かっていた（docs/progress/t62.md）。
// 組む物は lib/person.ts の loadPersonRows と同じ形の行。ただし本人の 1 枚と裏の要約は経過と提供の記録を読まないので、ここでは読まない
// （読むようになったら lib/forms/t62.test.ts の「経過を読まない」が落ちる。1 人の頁の道と同じ紙になることもテストで比べる）。
// 事業所の壁でないとき（医療班・行政・本人・家族。頁の入口はケアマネの役だけなので普段は来ない）は 1 人の頁と同じ道で 1 人ずつ。
// 本人の 1 枚の文（lib/forms/own-sheet.ts）と紙面（components/forms/OwnSheet.tsx）は変えない。印刷したことは経過に残さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { personScope } from "../auth/scope.ts";
import { loadPersonDocument } from "../consent/documents.ts";
import { canOpenDocument, scopeOfRows } from "../consent/scope.ts";
import type { PersonReportedAge, PersonRow } from "../db/types.ts";
import type { PersonPageRows } from "../person.ts";
import { currentQrToken, loadQrRow, qrState, type QrRow, type QrStatus } from "../qr/store.ts";
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

const IDS = "SELECT value FROM json_each(?1)";
/** 渡した id のうち、その事業所の本人（事業所の壁。lib/auth/scope.ts の personInScope の office と同じ条件） */
const IN_OFFICE = `SELECT id FROM people WHERE id IN (${IDS}) AND office_id = ?2`;

type PersonJoin = Pick<
  PersonRow,
  | "id"
  | "office_id"
  | "care_manager_id"
  | "name"
  | "kana"
  | "birth_date"
  | "plan_status"
  | "ledger"
  | "origin"
  | "self_report_unreliable"
  | "created_at"
  | "updated_at"
  | "version"
> &
  PersonReportedAge &
  Required<QrRow> & { care_manager_name: string | null };

/**
 * 事業所の本人を何人でもまとめて読む（D1 の batch 1 回）。本人の 1 枚に要る行（本人・担当の名前・連絡先・同意・時計）と QR の行。
 * 範囲の外の id は返さない
 */
export async function loadOfficeSheetRows(
  db: D1Database,
  officeId: string,
  ids: ReadonlyArray<string>,
): Promise<Map<string, { rows: PersonPageRows; qr: QrRow }>> {
  const json = JSON.stringify([...new Set(ids)]);
  const [people, contacts, consents, clocks] = await db.batch([
    db
      .prepare(
        `SELECT p.id, p.office_id, p.care_manager_id, p.name, p.kana, p.birth_date, p.plan_status, p.ledger,
                p.origin, p.self_report_unreliable, p.created_at, p.updated_at, p.version, p.reported_age,
                p.qr_generation, p.qr_issued_at, p.qr_ttl_days, a.display_name AS care_manager_name
           FROM people p LEFT JOIN accounts a ON a.id = p.care_manager_id
          WHERE p.id IN (${IDS}) AND p.office_id = ?2`,
      )
      .bind(json, officeId),
    db
      .prepare(
        `SELECT id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
                night_ok, has_car, has_smartphone, note, kana, address, mobile, sort
           FROM contacts WHERE person_id IN (${IN_OFFICE}) ORDER BY person_id, sort, id`,
      )
      .bind(json, officeId),
    db
      .prepare(
        `SELECT c.person_id, c.kind, c.status, c.scope, c.recorded_by, c.recorded_at, c.expires_at, c.note,
                a.display_name AS recorded_by_name, a.role AS recorded_by_role
           FROM consents c LEFT JOIN accounts a ON a.id = c.recorded_by
          WHERE c.person_id IN (${IN_OFFICE})`,
      )
      .bind(json, officeId),
    db.prepare(`SELECT * FROM clocks WHERE person_id IN (${IN_OFFICE}) ORDER BY person_id, sort, id`).bind(json, officeId),
  ]);
  const by = <T extends { person_id: string }>(list: ReadonlyArray<T>) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.person_id, [...(m.get(r.person_id) ?? []), r]);
    return m;
  };
  const contactsOf = by(contacts.results as unknown as Array<PersonPageRows["contacts"][number]>);
  const consentsOf = by(consents.results as unknown as Array<PersonPageRows["consents"][number]>);
  const clocksOf = by(clocks.results as unknown as Array<PersonPageRows["clocks"][number]>);
  const out = new Map<string, { rows: PersonPageRows; qr: QrRow }>();
  for (const p of people.results as unknown as PersonJoin[]) {
    out.set(p.id, {
      rows: {
        person: {
          id: p.id,
          office_id: p.office_id,
          care_manager_id: p.care_manager_id,
          name: p.name,
          kana: p.kana,
          birth_date: p.birth_date,
          plan_status: p.plan_status,
          ledger: p.ledger,
          origin: p.origin,
          self_report_unreliable: p.self_report_unreliable,
          created_at: p.created_at,
          updated_at: p.updated_at,
          version: p.version,
          // 申告の年齢はあるときだけ（loadPersonRows と同じ）
          ...(p.reported_age != null ? { reported_age: p.reported_age } : {}),
        },
        careManagerName: p.care_manager_name,
        contacts: contactsOf.get(p.id) ?? [],
        consents: consentsOf.get(p.id) ?? [],
        clocks: clocksOf.get(p.id) ?? [],
        // 本人の 1 枚と裏の要約は経過と提供の記録を読まない（上の注）
        timeline: [],
      },
      // QR の列は lib/qr/store.ts の loadQrRow と同じ（期限の日数 qr_ttl_days も。T64）
      qr: { qr_generation: p.qr_generation, qr_issued_at: p.qr_issued_at, qr_ttl_days: p.qr_ttl_days ?? null },
    });
  }
  return out;
}

/** 1 人分を組む（読んだあと。QR の署名だけ非同期） */
async function buildOne(rows: PersonPageRows, row: QrRow | null, o: OwnSheetsOptions): Promise<OwnSheetItem> {
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

/** 1 人の頁と同じ道で 1 人ずつ（事業所の壁でないとき）。範囲の外・同意で開けなければ null */
async function loadOne(db: D1Database, principal: Principal, id: string, o: OwnSheetsOptions): Promise<OwnSheetItem | null> {
  const [opened, row] = await Promise.all([loadPersonDocument(db, principal, id, "own"), loadQrRow(db, id)]);
  return opened ? buildOne(opened.rows, row, o) : null;
}

/** 渡した順に人数分を組む */
export async function loadOwnSheets(
  db: D1Database,
  principal: Principal,
  ids: ReadonlyArray<string>,
  o: OwnSheetsOptions,
): Promise<OwnSheetBatch> {
  const scope = personScope(principal);
  let all: Array<OwnSheetItem | null>;
  if (scope.kind === "office") {
    const read = ids.length > 0 ? await loadOfficeSheetRows(db, scope.officeId, ids) : new Map();
    all = await Promise.all(
      ids.map((id) => {
        const hit = read.get(id);
        // 同意の範囲（1 人の頁の loadPersonDocument と同じ判定）。ケアマネはいつも開ける
        if (!hit || !canOpenDocument(scopeOfRows(principal.role, hit.rows), "own")) return null;
        return buildOne(hit.rows, hit.qr, o);
      }),
    );
  } else {
    all = await Promise.all(ids.map((id) => loadOne(db, principal, id, o)));
  }
  const items = all.filter((x): x is OwnSheetItem => x !== null);
  return {
    items,
    skipped: all.length - items.length,
    unconfirmed: items.filter((x) => x.sheet.open.some((p) => p.kind === "decide")).map((x) => x.sheet.name),
  };
}
