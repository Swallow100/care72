// 電話の記録（docs/tasks/T13.md「電話は tel: のリンクで、押した事実を経過に残す」）。
// 担当一覧の行の詳細の電話のボタンを押すと「電話 家族 娘」、続けて「不通」を押すと「電話 家族 娘 不通」が
// 本人の経過に残る（kind called）。電話をかけるのはケアマネ本人（自動の電話はしない）。名前と番号は経過の文に書かない。
// 相手は台帳の連絡先の行から決め、画面から送られた名前は読まない。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import type { ContactKind, ContactRow } from "../db/types.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import { shortJst } from "../disaster/state.ts";

export const CALL_SOURCE = "call";

/** dialed は電話のボタンを押した、no_answer はつながらなかった（不通） */
export const CALL_RESULTS = ["dialed", "no_answer"] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

export const CALL_RESULT_LABELS: Record<CallResult, string> = { dialed: "発信", no_answer: "不通" };

export function isCallResult(v: unknown): v is CallResult {
  return typeof v === "string" && (CALL_RESULTS as readonly string[]).includes(v);
}

export type CallPayload = { source: typeof CALL_SOURCE; contactId: string; contactKind: ContactKind; result: CallResult };

export function parseCallPayload(text: string | null): CallPayload | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<CallPayload>;
    if (v.source !== CALL_SOURCE || typeof v.contactId !== "string" || !isCallResult(v.result)) return null;
    if (typeof v.contactKind !== "string" || !(v.contactKind in CONTACT_KIND_LABELS)) return null;
    return { source: CALL_SOURCE, contactId: v.contactId, contactKind: v.contactKind, result: v.result };
  } catch {
    return null;
  }
}

type CallTarget = Pick<ContactRow, "kind" | "relation">;

/**
 * 相手の言い方「本人」「家族 娘」「支援者 隣人」。名前と番号は経過の文に書かない（文は要約や訓練で読み返すことがあり、
 * 名前を自由文に残さない。誰かは payload の contactId から連絡先の行を引く）
 */
export function callTargetText(c: CallTarget): string {
  const relation = c.kind === "self" ? null : c.relation?.trim() || null;
  return [CONTACT_KIND_LABELS[c.kind], relation].filter((s) => s).join(" ");
}

/** 経過の 1 行の本文（種類の「電話」は経過の画面が前に付ける）。「本人」「家族 娘 不通」 */
export function callLogBody(c: CallTarget, result: CallResult): string {
  const t = callTargetText(c);
  return result === "no_answer" ? `${t} ${CALL_RESULT_LABELS.no_answer}` : t;
}

export type CallInput = { personId: string; contactId: string; result: CallResult };

export type CallError = "forbidden" | "not_found" | "invalid";

export type CallSaveResult = { ok: true } | { ok: false; error: CallError };

/** 電話の記録を書く。ケアマネの役だけ、事業所の中の本人の、番号のある連絡先だけ */
export async function saveCall(db: D1Database, p: Principal | null, input: CallInput, now: string): Promise<CallSaveResult> {
  if (!p || p.role !== "care_manager" || !roleAllows(p.role, "save")) return { ok: false, error: "forbidden" };
  const person = await personInScope(db, p, input.personId);
  if (!person) return { ok: false, error: "not_found" };
  const contact = await db
    .prepare("SELECT id, kind, relation, phone FROM contacts WHERE id = ?1 AND person_id = ?2")
    .bind(input.contactId, person.id)
    .first<Pick<ContactRow, "id" | "kind" | "relation" | "phone">>();
  if (!contact) return { ok: false, error: "not_found" };
  if (!contact.phone?.trim()) return { ok: false, error: "invalid" };

  const payload: CallPayload = { source: CALL_SOURCE, contactId: contact.id, contactKind: contact.kind, result: input.result };
  await db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
       VALUES (?1, ?2, ?3, 'care_manager', 'called', ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), person.id, p.accountId, callLogBody(contact, input.result), JSON.stringify(payload), now)
    .run();
  return { ok: true };
}

/** 行の詳細に出す電話の記録 1 行 */
export type CallLog = {
  at: string;
  /** 日本の短い時刻「11/4 10:42」 */
  when: string;
  body: string;
  result: CallResult | null;
  contactId: string | null;
  who: string | null;
};

export type CallEntryRow = {
  person_id: string;
  body: string | null;
  payload: string | null;
  occurred_at: string;
  author_name: string | null;
};

/** 経過の called の行（時刻の順）を本人の行の詳細の形に。新しい順 */
export function callLogsOf(rows: ReadonlyArray<CallEntryRow>): CallLog[] {
  return rows
    .map((r) => {
      const p = parseCallPayload(r.payload);
      return {
        at: r.occurred_at,
        when: shortJst(r.occurred_at),
        body: r.body ?? "",
        result: p?.result ?? null,
        contactId: p?.contactId ?? null,
        who: r.author_name,
      };
    })
    .reverse();
}
