// 本人・家族のスマホの ID とパスワード（migrations/0037 の phone_accounts、T149）。D1 を引数で受ける（テストで node:sqlite を渡す）。
// Claude は呼ばない。
//
// 作る: スマホ入口のリンクで開いたセッション（Principal の phoneEntry が link）からだけ。リンクを持つ人が本人・家族その人だから。
//   審査員・役を替えた山本の本人・家族の役、ID で入ったセッション、ケアマネなどは作れない（forbidden）。
//   同意の決まり（lib/phone/consent.ts）に合わない人は作れない（consent）。
//   1 本人・1 連絡先に 1 つ。もうあれば ID とパスワードを作り直す（リンクを持つ人はもう本人として送れるので、作り直しで増える力は無い。
//   忘れた人がリンクから入り直して作り直せる）。
//   ID はケアマネの ID と同じ形（英小文字・数字・. _ -、3〜32 字。lib/office/forms.ts の LOGIN_ID_PATTERN）で、ケアマネの ID とも
//   ほかの本人・家族の ID とも重ならない。パスワードはケアマネと同じ決まり（lib/auth/password-rule.ts）と、2 回の入力の一致。
// 通る: 作った時のリンクの版と時刻が、本人の行の今の版と時刻と同じ間だけ（再発行・一覧から外すと通らない。リンクの期限の 180 日が
//   過ぎても、版が同じなら通る）。家族用は連絡先の行がその本人の物で答えられる種類（lib/qr/phone-link-store.ts の linkTarget と同じ）。
// 見られるのは、その本人（家族用はその連絡先として、その本人）だけ。役は本人スマホ・家族スマホのまま（lib/auth/principal.ts）。
// 平文は表・経過・ログ・URL・応答に出さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { isReservedLoginId } from "../auth/demo.ts";
import { hashPassword, MAX_PASSWORD_LENGTH } from "../auth/password.ts";
import { passwordRuleProblems, type PasswordRuleProblem } from "../auth/password-rule.ts";
import type { ConsentKind, ConsentStatus, PhoneAccountRow } from "../db/types.ts";
import { LOGIN_ID_PATTERN, normalizeLoginId } from "../office/forms.ts";
import { issuedSec, linkTarget, type LinkTarget } from "../qr/phone-link-store.ts";
import { phoneEntryAllowed } from "./consent.ts";

export const PHONE_ACCOUNT_ERRORS = [
  "login_required",
  "forbidden",
  "consent",
  "not_found",
  "login_id",
  "login_taken",
  "password",
  "mismatch",
] as const;
export type PhoneAccountError = (typeof PHONE_ACCOUNT_ERRORS)[number];

export const PHONE_ACCOUNT_STATUS: Record<PhoneAccountError, number> = {
  login_required: 401,
  forbidden: 403,
  consent: 409,
  not_found: 404,
  login_id: 400,
  login_taken: 409,
  password: 400,
  mismatch: 400,
};

export type PhoneAccountResult =
  | { ok: true; loginId: string; created: boolean }
  | { ok: false; error: PhoneAccountError; problems?: PasswordRuleProblem[] };

/** ID の形（ケアマネの ID と同じ決まり）。違えば null */
export function parsePhoneLoginId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 128) return null;
  const v = normalizeLoginId(raw);
  return LOGIN_ID_PATTERN.test(v) && !isReservedLoginId(v) ? v : null;
}

/** 本人用は連絡先なし（表は NULL、比べるときは空の字） */
const contactKey = (contactId: string | null) => contactId ?? "";

/** 本人・連絡先の ID の行（作った時の版のまま。今も通るかは phoneAccountTarget） */
export async function loadPhoneAccount(db: D1Database, personId: string, contactId: string | null): Promise<PhoneAccountRow | null> {
  return db
    .prepare("SELECT * FROM phone_accounts WHERE person_id = ?1 AND ifnull(contact_id, '') = ?2")
    .bind(personId, contactKey(contactId))
    .first<PhoneAccountRow>();
}

/** ログインの ID から（小文字にそろえて引く。iPhone は頭を大文字にしがち） */
export async function phoneAccountByLoginId(db: D1Database, loginIdRaw: string): Promise<PhoneAccountRow | null> {
  const loginId = normalizeLoginId(loginIdRaw);
  if (!LOGIN_ID_PATTERN.test(loginId)) return null;
  return db.prepare("SELECT * FROM phone_accounts WHERE login_id = ?1").bind(loginId).first<PhoneAccountRow>();
}

export async function phoneAccountById(db: D1Database, id: string): Promise<PhoneAccountRow | null> {
  return db.prepare("SELECT * FROM phone_accounts WHERE id = ?1").bind(id).first<PhoneAccountRow>();
}

/** 今も通る ID か: リンクで開ける形（linkTarget）と同じで、版と時刻が作った時と同じ。通らなければ null */
export async function phoneAccountTarget(db: D1Database, row: PhoneAccountRow): Promise<LinkTarget | null> {
  const t = await linkTarget(db, { personId: row.person_id, contactId: row.contact_id, generation: row.link_generation });
  if (!t || !t.issuedAt || issuedSec(t.issuedAt) !== issuedSec(row.link_issued_at)) return null;
  return t;
}

/** 本人・家族の画面に出す ID（今も通る物だけ）。無ければ null */
export async function livePhoneLoginId(db: D1Database, personId: string, contactId: string | null): Promise<string | null> {
  const row = await loadPhoneAccount(db, personId, contactId);
  if (!row) return null;
  return (await phoneAccountTarget(db, row)) ? row.login_id : null;
}

/** 本人のページのスマホの面: 本人・連絡先ごとの今も通る ID の有無（本人用の鍵は "self"） */
export async function livePhoneAccountKeys(db: D1Database, personId: string): Promise<Set<string>> {
  const r = await db
    .prepare(
      `SELECT a.* FROM phone_accounts a JOIN people p ON p.id = a.person_id
        WHERE a.person_id = ?1 AND a.link_generation = p.phone_link_generation AND a.link_issued_at = p.phone_link_issued_at`,
    )
    .bind(personId)
    .all<PhoneAccountRow>();
  const out = new Set<string>();
  for (const row of r.results ?? []) if (await phoneAccountTarget(db, row)) out.add(row.contact_id ?? "self");
  return out;
}

type Input = { loginId: unknown; password: unknown; password2: unknown };

/**
 * ID とパスワードを作る（作り直す）。p はリンクで開いた本人・家族のセッション。at は ISO。opts.iterations はテストだけ
 */
export async function savePhoneAccount(
  db: D1Database,
  p: Principal | null,
  input: Input,
  at: string,
  opts: { iterations?: number } = {},
): Promise<PhoneAccountResult> {
  if (!p) return { ok: false, error: "login_required" };
  if ((p.role !== "self" && p.role !== "family") || p.phoneEntry !== "link" || !p.personId) return { ok: false, error: "forbidden" };
  const personId = p.personId;
  const contactId = p.role === "family" ? p.contactId : null;
  if (p.role === "family" && !contactId) return { ok: false, error: "forbidden" };

  const person = await db
    .prepare("SELECT phone_link_generation, phone_link_issued_at FROM people WHERE id = ?1 AND unlisted_at IS NULL")
    .bind(personId)
    .first<{ phone_link_generation: number; phone_link_issued_at: string | null }>();
  if (!person || person.phone_link_generation < 1 || !person.phone_link_issued_at) return { ok: false, error: "not_found" };
  const consents = await db
    .prepare("SELECT kind, status FROM consents WHERE person_id = ?1")
    .bind(personId)
    .all<{ kind: ConsentKind; status: ConsentStatus }>();
  if (!phoneEntryAllowed(consents.results ?? [])) return { ok: false, error: "consent" };

  const loginId = parsePhoneLoginId(input.loginId);
  if (!loginId) return { ok: false, error: "login_id" };
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length > MAX_PASSWORD_LENGTH) return { ok: false, error: "password", problems: ["length"] };
  const problems = passwordRuleProblems(password);
  if (problems.length > 0) return { ok: false, error: "password", problems };
  if (typeof input.password2 !== "string" || input.password2.normalize("NFC") !== password.normalize("NFC")) {
    return { ok: false, error: "mismatch" };
  }

  // ケアマネの ID・ほかの本人と家族の ID と重ならない（自分の行の今の ID はそのまま使える）
  const taken = await db
    .prepare(
      `SELECT 1 AS hit FROM accounts WHERE login_id = ?1
       UNION ALL
       SELECT 1 FROM phone_accounts WHERE login_id = ?1 AND NOT (person_id = ?2 AND ifnull(contact_id, '') = ?3)`,
    )
    .bind(loginId, personId, contactKey(contactId))
    .first<{ hit: number }>();
  if (taken) return { ok: false, error: "login_taken" };

  const hash = await hashPassword(password.normalize("NFC"), opts.iterations ? { iterations: opts.iterations } : {});
  const existing = await loadPhoneAccount(db, personId, contactId);
  try {
    if (existing) {
      await db
        .prepare(
          `UPDATE phone_accounts SET login_id = ?1, password_hash = ?2, link_generation = ?3, link_issued_at = ?4, updated_at = ?5
            WHERE id = ?6`,
        )
        .bind(loginId, hash, person.phone_link_generation, person.phone_link_issued_at, at, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO phone_accounts (id, person_id, contact_id, login_id, password_hash, link_generation, link_issued_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
        )
        .bind(crypto.randomUUID(), personId, contactId, loginId, hash, person.phone_link_generation, person.phone_link_issued_at, at)
        .run();
    }
  } catch {
    // 同時に同じ ID を取られた（login_id の UNIQUE）
    return { ok: false, error: "login_taken" };
  }
  return { ok: true, loginId, created: !existing };
}
