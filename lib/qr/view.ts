// QR の頁（/q/<token>）の中身と、閲覧の記録。docs/tasks/T16.md。
//
// 決まり:
// - 出すのは医療要約（T07、lib/forms/medical-summary.ts）の範囲だけ。そこから氏名の全部（漢字等）と住所を除く。
//   本人を確かめるのは氏名カナと生年月日まで（要約の順）。除いた欄は値を作らない（型にも持たない）
// - 医療班提供の同意が「同意」の人だけ要約を出す。不同意は「同意なし」、未確認は「未確認」の言葉だけで、記録の日・人・備考も出さない
// - 壁（personInScope）は通さない。署名と版を確かめたトークン（lib/qr/store.ts の resolveQrToken）が壁の代わり
// - 開いたら経過に 1 行（lib/qr/timeline.ts の形）。ログインしていれば誰が、していなければ未ログイン。同意のない人を開いても残す

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { PersonBrief } from "../auth/scope.ts";
import type { AuthorRole, ConsentStatus } from "../db/types.ts";
import type { Cell } from "../forms/matsuyama.ts";
import {
  buildMedicalSummary,
  MEDICAL_BLOCKS,
  MEDICAL_FIELDS,
  type MedicalBlock,
  type MedicalId,
  type MedicalKey,
  type MedicalPending,
  type MedicationRow,
} from "../forms/medical-summary.ts";
import { AUTHOR_ROLE_LABELS, CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS } from "../labels.ts";
import { formatJst, loadPersonRows, type PersonPageRows } from "../person.ts";
import { QR_LABELS } from "./labels.ts";
import { QR_VIEW_SOURCE, qrViewOf, type QrViewPayload, type QrViewScope } from "./timeline.ts";

/** QR の頁に出さない欄（氏名の全部・住所） */
export const QR_HIDDEN_KEYS = ["patient.name", "patient.address"] as const satisfies readonly MedicalKey[];
type HiddenKey = (typeof QR_HIDDEN_KEYS)[number];
export type QrKey = Exclude<MedicalKey, HiddenKey>;

const isShown = (k: string): k is QrKey => !(QR_HIDDEN_KEYS as readonly string[]).includes(k);

/** 出す欄（要約の順） */
export const QR_FIELDS = MEDICAL_FIELDS.filter((f) => isShown(f.key)) as ReadonlyArray<
  Extract<(typeof MEDICAL_FIELDS)[number], { key: QrKey }>
>;

export type QrField = { key: QrKey; label: string; cell: Cell };
export type QrBlockView = { block: MedicalBlock; label: string; fields: QrField[] };

/** QR の頁の要約。氏名（漢字等）・住所の値は持たない */
export type QrSheet = {
  kana: string;
  /** 作った日（JST） */
  today: string;
  /** 台帳の更新の時刻（ISO） */
  ledgerAt: string;
  author: { office: string | null; careManager: string | null };
  consentRecordedAt: string | null;
  blocks: QrBlockView[];
  medications: MedicationRow[];
  medicalId: MedicalId;
  pending: MedicalPending[];
};

export type QrPage = { kind: "sheet"; sheet: QrSheet } | { kind: "refused" | "unconfirmed" };

export type QrPerson = { rows: PersonPageRows; officeName: string | null };

/** トークンの本人を読む（壁なし。呼ぶ前に resolveQrToken を通す） */
export async function loadQrPerson(db: D1Database, personId: string): Promise<QrPerson | null> {
  const brief = await db
    .prepare(
      `SELECT id, office_id, care_manager_id, name, kana, birth_date, plan_status, ledger
         FROM people WHERE id = ?1`,
    )
    .bind(personId)
    .first<PersonBrief>();
  if (!brief) return null;
  const [rows, office] = await Promise.all([
    loadPersonRows(db, brief),
    db.prepare("SELECT name FROM offices WHERE id = ?1").bind(brief.office_id).first<{ name: string }>(),
  ]);
  return rows ? { rows, officeName: office?.name ?? null } : null;
}

/** 医療要約から QR の頁の中身を作る。同意が無ければ言葉だけ */
export function buildQrPage(rows: PersonPageRows, opts: { today: string; officeName: string | null }): QrPage {
  const r = buildMedicalSummary(rows, opts);
  if (r.kind !== "sheet") return { kind: r.kind };
  const s = r.sheet;
  const blocks: QrBlockView[] = [];
  for (const f of QR_FIELDS) {
    const last = blocks[blocks.length - 1];
    const field: QrField = { key: f.key, label: f.label, cell: s.cells[f.key] };
    if (last?.block === f.block) last.fields.push(field);
    else blocks.push({ block: f.block, label: MEDICAL_BLOCKS[f.block], fields: [field] });
  }
  return {
    kind: "sheet",
    sheet: {
      kana: rows.person.kana,
      today: s.today,
      ledgerAt: s.ledgerAt,
      author: s.author,
      consentRecordedAt: s.consent.recordedAt,
      blocks,
      medications: s.medications,
      medicalId: s.medicalId,
      pending: s.pending.filter((p) => p.key === null || isShown(p.key)),
    },
  };
}

/** 出した欄の key（記録の範囲）。表示なしは空 */
export function shownFields(page: QrPage): QrKey[] {
  return page.kind === "sheet" ? page.sheet.blocks.flatMap((b) => b.fields.map((f) => f.key)) : [];
}

const AUTHOR_ROLES: Record<Principal["role"], AuthorRole> = {
  care_manager: "care_manager",
  government: "government",
  medical: "medical",
  self: "self",
  family: "family",
  unselected: "system",
};

/** 経過の本文（範囲と、表示なしなら同意） */
export function qrViewBody(scope: QrViewScope, consent: ConsentStatus): string {
  if (scope === "medical_summary") return `${QR_LABELS.scope} ${QR_LABELS.scopeSummary}`;
  return `${QR_LABELS.scope} ${QR_LABELS.scopeNone} ${CONSENT_KIND_LABELS.medical} ${CONSENT_STATUS_LABELS[consent]}`;
}

/** 閲覧を経過に残す（相手・範囲・時刻）。作った行の payload を返す */
export async function recordQrView(
  db: D1Database,
  args: { personId: string; generation: number; principal: Principal | null; page: QrPage; consent: ConsentStatus; nowIso: string },
): Promise<QrViewPayload> {
  const { principal: p, page } = args;
  const scope: QrViewScope = page.kind === "sheet" ? "medical_summary" : "none";
  const payload: QrViewPayload = {
    source: QR_VIEW_SOURCE,
    generation: args.generation,
    recipient: p ? { role: p.role, accountId: p.accountId, name: p.displayName, judge: p.judge } : null,
    scope,
    consent: args.consent,
    fields: shownFields(page),
  };
  await db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 'note', ?5, ?6, NULL, ?7, ?7)`,
    )
    .bind(
      `tl-qr-${crypto.randomUUID()}`,
      args.personId,
      p?.accountId ?? null,
      p ? AUTHOR_ROLES[p.role] : "system",
      qrViewBody(scope, args.consent),
      JSON.stringify(payload),
      args.nowIso,
    )
    .run();
  return payload;
}

/** 医療班提供の同意（本人の行から）。行が無ければ未確認 */
export function medicalConsentOf(rows: PersonPageRows): ConsentStatus {
  return rows.consents.find((c) => c.kind === "medical")?.status ?? "unconfirmed";
}

/** 閲覧記録の 1 行（本人のページの QR の画面に出す。第三者提供の記録: 相手・範囲・時刻） */
export type QrViewLogItem = {
  id: string;
  /** JST の YYYY-MM-DD HH:MM */
  when: string;
  /** 相手（役と名前。ログインなしは未ログイン） */
  who: string;
  /** 範囲（要約・表示なし） */
  scope: string;
  generation: number;
};

/** 経過から QR の閲覧だけを、新しい順に */
export function qrViewLog(rows: PersonPageRows): QrViewLogItem[] {
  const out: Array<QrViewLogItem & { at: string }> = [];
  for (const t of rows.timeline) {
    const p = qrViewOf(t);
    if (!p) continue;
    const role = t.author_id || p.recipient ? AUTHOR_ROLE_LABELS[t.author_role] : QR_LABELS.anonymous;
    out.push({
      id: t.id,
      at: t.occurred_at,
      when: formatJst(t.occurred_at),
      who: [role, t.author_name].filter(Boolean).join(" "),
      scope: p.scope === "medical_summary" ? QR_LABELS.scopeSummary : QR_LABELS.scopeNone,
      generation: p.generation,
    });
  }
  return out
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1))
    .map(({ at: _at, ...item }) => item);
}
