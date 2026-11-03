// 自分のパスワードの変更（docs/tasks/T61.md）。アカウントのセッションだけ（審査員は皆で 1 つの env の値なので fixed）。
// ここは D1・env・署名の鍵を引数で受け取るだけ（テストで node:sqlite を渡す）。route は app/api/auth/password。
//
// - 今のパスワードを、ログインと同じ受け口（lib/auth/credential.ts）で確かめる。違えば wrong_password（時間はログインと同じだけかかる）
// - 今のパスワードの打ち間違いは総当たりの入口になるので、ログインと同じ回数の制限（lib/auth/lockout.ts）にアカウントの ID で数える。
//   送信元は見ず、同じ ID の失敗が 15 分に 10 回で 15 分止める（locked、429）。止めている間は確かめない。通れば ID の失敗を消す
// - 種のデモ事業所のアカウント（山本・審査員）は固定で断る。山本は env の確かめ方が表より先に効くので、表を変えても効かない。
//   ほかでも、確かめ方が表のハッシュでなければ（env の値）断る
// - 新しいパスワードは 8〜64 字（NFC）。今の物と同じは断る
// - 書くのは古いハッシュのときだけ（同時に 2 つ変えても片方だけ勝つ）。事業所の経過に「佐藤 パスワード変更」（平文は書かない）
// - 変えると指紋（pv）が変わり、ほかの端末のセッションは切れる。変えた端末は、新しいハッシュの指紋で署名した token を返し、
//   route が cookie を付け直す（ログインしたまま）。login() を通すと PBKDF2 が 3 回になるので、ログインと同じ形の token を
//   ここで作る（PBKDF2 は今の確かめと新しいハッシュの 2 回）
// 平文は表・経過・ログ・URL・応答に出さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { AuthorRole } from "../db/types.ts";
import { accountCredential, credentialVersion, verifyCredential } from "./credential.ts";
import { isFixedAccount } from "./demo.ts";
import { hashPassword, MAX_PASSWORD_LENGTH } from "./password.ts";
import { attemptKey, loginLock, recordLoginAttempt } from "./lockout.ts";
import type { AuthEnv, Principal } from "./principal.ts";
import { ROLE_LABELS } from "./roles.ts";
import { sessionTimes, signSession } from "./session.ts";

export const NEW_PASSWORD_MIN = 8;
export const NEW_PASSWORD_MAX = 64;

export const PASSWORD_CHANGE_ERRORS = [
  "login_required",
  "forbidden",
  "fixed",
  "invalid",
  "password",
  "wrong_password",
  "same",
  "locked",
  "conflict",
] as const;
export type PasswordChangeError = (typeof PASSWORD_CHANGE_ERRORS)[number];

/** 画面の言葉（2〜4 字の漢語） */
export const PASSWORD_CHANGE_ERROR_LABELS: Record<PasswordChangeError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  fixed: "固定",
  invalid: "入力不正",
  password: `新規 ${NEW_PASSWORD_MIN}〜${NEW_PASSWORD_MAX}字`,
  wrong_password: "現在 不一致",
  same: "同一 不可",
  locked: "回数超過 しばらく待機",
  conflict: "競合 再読込",
};

const STATUS: Record<PasswordChangeError, number> = {
  login_required: 401,
  forbidden: 403,
  fixed: 403,
  invalid: 400,
  password: 400,
  wrong_password: 400,
  same: 400,
  locked: 429,
  conflict: 409,
};

export type PasswordChangeResult =
  | { ok: true; token: string }
  | { ok: false; error: Exclude<PasswordChangeError, "locked"> }
  | { ok: false; error: "locked"; retryAfterSec: number; minutes: number };

/** 新しいパスワードの形。NFC にそろえ、8〜64 字。違えば null */
export function parseNewPassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.normalize("NFC");
  return v.length >= NEW_PASSWORD_MIN && v.length <= NEW_PASSWORD_MAX ? v : null;
}

type Row = { id: string; office_id: string | null; display_name: string; login_id: string | null; password_hash: string | null };

/** 経過の書き手の役（アカウントの役のうち、経過に書ける物） */
function authorRoleOf(p: Principal): Extract<AuthorRole, "care_manager" | "medical" | "government"> | null {
  return p.role === "care_manager" || p.role === "medical" || p.role === "government" ? p.role : null;
}

/**
 * 自分のパスワードを変える。now は秒（新しいセッションの時刻と経過の時刻）。opts.iterations はテストだけ（ハッシュの回数を減らす）
 */
export async function changeOwnPassword(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  principal: Principal | null,
  input: { current: string; next: string },
  now: number,
  opts: { iterations?: number } = {},
): Promise<PasswordChangeResult> {
  if (!principal) return { ok: false, error: "login_required" };
  if (principal.judge) return { ok: false, error: "fixed" };
  const accountId = principal.accountId;
  const role = authorRoleOf(principal);
  if (!accountId || !role) return { ok: false, error: "forbidden" };
  if (isFixedAccount(accountId)) return { ok: false, error: "fixed" };

  const a = await db
    .prepare("SELECT id, office_id, display_name, login_id, password_hash FROM accounts WHERE id = ?1 AND disabled_at IS NULL")
    .bind(accountId)
    .first<Row>();
  if (!a || !a.login_id) return { ok: false, error: "forbidden" };
  const c = accountCredential(env, a);
  // 確かめ方が表のハッシュでない（env の値が先に効く）なら、表を変えても効かない
  if (c && (c.kind !== "hash" || c.hash !== a.password_hash)) return { ok: false, error: "fixed" };

  const next = parseNewPassword(input.next);
  if (next === null) return { ok: false, error: "password" };
  // 回数の制限（アカウントの ID で数える。送信元は見ない）。止めている間は確かめない
  const key = attemptKey(a.login_id, null);
  const lock = await loginLock(db, key, now);
  if (lock.locked) return { ok: false, error: "locked", retryAfterSec: lock.retryAfterSec, minutes: lock.minutes };
  const right = input.current.length <= MAX_PASSWORD_LENGTH && (await verifyCredential(input.current, c)) && a.password_hash !== null;
  if (!right || !a.password_hash) {
    await recordLoginAttempt(db, key, false, now);
    const after = await loginLock(db, key, now);
    if (after.locked) return { ok: false, error: "locked", retryAfterSec: after.retryAfterSec, minutes: after.minutes };
    return { ok: false, error: "wrong_password" };
  }
  await recordLoginAttempt(db, key, true, now);
  if (input.current.normalize("NFC") === next) return { ok: false, error: "same" };

  const hash = await hashPassword(next, opts.iterations ? { iterations: opts.iterations } : {});
  const at = new Date(now * 1000).toISOString();
  const [updated] = await db.batch([
    db
      .prepare("UPDATE accounts SET password_hash = ?1 WHERE id = ?2 AND password_hash = ?3 AND disabled_at IS NULL")
      .bind(hash, a.id, a.password_hash),
    // 事業所の経過（事業所のあるアカウントだけ。書けたのは新しいハッシュになったときだけ）
    db
      .prepare(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ?1, a.office_id, a.id, ?2, 'care_manager_changed', ?3, ?4, ?5 FROM accounts a
          WHERE a.id = ?6 AND a.password_hash = ?7 AND a.office_id IS NOT NULL`,
      )
      .bind(
        crypto.randomUUID(),
        role,
        `${a.display_name.trim() || ROLE_LABELS[role]} パスワード変更`,
        JSON.stringify({ accountId: a.id, change: "password" }),
        at,
        a.id,
        hash,
      ),
  ]);
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };

  // 変えた端末はログインしたまま。ログイン（lib/auth/principal.ts の login）と同じ形の token を、新しいハッシュの指紋で作る
  const pv = await credentialVersion({ kind: "hash", hash }, secret);
  const token = await signSession({ v: 1, k: "account", a: a.id, pv, ...sessionTimes(now) }, secret);
  return { ok: true, token };
}

export type PasswordChangeOutcome = {
  status: number;
  body: Record<string, unknown>;
  token: string | null;
  /** 止めたとき（429）の Retry-After */
  retryAfterSec?: number;
};

/** route から。JSON { current, next }。token は cookie に付け直す物（応答の本文には入れない） */
export async function passwordChangeRequest(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  principal: Principal | null,
  raw: unknown,
  now: number,
  opts: { iterations?: number } = {},
): Promise<PasswordChangeOutcome> {
  const fail = (error: PasswordChangeError): PasswordChangeOutcome => ({
    status: STATUS[error],
    body: { ok: false, error, label: PASSWORD_CHANGE_ERROR_LABELS[error] },
    token: null,
  });
  if (!principal) return fail("login_required");
  if (typeof raw !== "object" || raw === null) return fail("invalid");
  const o = raw as Record<string, unknown>;
  if (typeof o.current !== "string" || typeof o.next !== "string") return fail("invalid");
  const r = await changeOwnPassword(db, env, secret, principal, { current: o.current, next: o.next }, now, opts);
  if (!r.ok) {
    const out = fail(r.error);
    return r.error === "locked" ? { ...out, body: { ...out.body, minutes: r.minutes }, retryAfterSec: r.retryAfterSec } : out;
  }
  return { status: 200, body: { ok: true }, token: r.token };
}
