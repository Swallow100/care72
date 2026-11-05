// 自分のパスワードの変更（docs/tasks/T61.md）。アカウントのセッションだけ（審査員は皆で 1 つの env の値なので fixed）。
// ここは D1・env・署名の鍵を引数で受け取るだけ（テストで node:sqlite を渡す）。route は app/api/auth/password。
//
// - 今のパスワードを、ログインと同じ受け口（lib/auth/credential.ts）で確かめる。違えば wrong_password（時間はログインと同じだけかかる）
// - 今のパスワードの打ち間違いは総当たりの入口になるので、ログインと同じ回数の制限（lib/auth/lockout.ts）にアカウントの ID で数える。
//   送信元は見ず、同じ ID の失敗が 15 分に 10 回で 15 分止める（locked、429）。止めている間は確かめない。通れば ID の失敗を消す
// - 種のデモ事業所のアカウント（山本・審査員）は固定で断る。山本は env の確かめ方が表より先に効くので、表を変えても効かない。
//   ほかでも、確かめ方が表のハッシュでなければ（env の値）断る
// - 新しいパスワードは lib/auth/password-rule.ts の決まり（10〜64 字・大文字・小文字・記号。T148 でケアマネ追加・再設定と 1 か所に）。今の物と同じは断る
// - 書くのは古いハッシュのときだけ（同時に 2 つ変えても片方だけ勝つ）。事業所の経過に「佐藤 パスワード変更」（平文は書かない）
// - 変えると指紋（pv）が変わり、ほかの端末のセッションは切れる。変えた端末は、新しいハッシュの指紋で署名した token を返し、
//   route が cookie を付け直す（ログインしたまま）。login() を通すと PBKDF2 が 3 回になるので、ログインと同じ形の token を
//   ここで作る（PBKDF2 は今の確かめと新しいハッシュの 2 回）
// 平文は表・経過・ログ・URL・応答に出さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { AuthorRole } from "../db/types.ts";
import { STAFF_PATH } from "../custody/paths.ts";
import { CARE_MANAGERS_ANCHOR } from "../office/http-paths.ts";
import { accountCredential, credentialVersion, verifyCredential } from "./credential.ts";
import { isFixedAccount } from "./demo.ts";
import { hashPassword, MAX_PASSWORD_LENGTH } from "./password.ts";
import { checkPassword, PASSWORD_MAX, PASSWORD_MIN, PASSWORD_RULE_LABELS, passwordProblemLabel, passwordProblems } from "./password-rule.ts";
import { attemptKey, loginLock, recordLoginAttempt } from "./lockout.ts";
import type { AuthEnv, Principal } from "./principal.ts";
import { ROLE_LABELS } from "./roles.ts";
import { sessionTimes, signSession } from "./session.ts";

/** 新しいパスワードの長さ（決まりは lib/auth/password-rule.ts の 1 か所。欄の minLength・maxLength とテストがここから読む） */
export const NEW_PASSWORD_MIN = PASSWORD_MIN;
export const NEW_PASSWORD_MAX = PASSWORD_MAX;

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
  // 足りない物は応答で添える（passwordChangeRequest。「条件不足 大文字 記号」）
  password: PASSWORD_RULE_LABELS.short,
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

/** 新しいパスワードの形（lib/auth/password-rule.ts の決まり）。NFC にそろえた値、違えば null */
export function parseNewPassword(raw: unknown): string | null {
  const c = checkPassword(raw);
  return c.ok ? c.value : null;
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
    // 本人が変えたので初期パスワードの印を外す（T114）
    db
      .prepare("UPDATE accounts SET password_hash = ?1, password_initial = 0 WHERE id = ?2 AND password_hash = ?3 AND disabled_at IS NULL")
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

/**
 * 受入一覧（/staff）の見出しの行の「パスワード変更」（T99）。医療班・行政のアカウント（作者の道具 tools/office/new-staff.ts で作る。T97）は open。
 * 審査員のログインと種の固定のアカウント（役を替えた山本など）は fixed（「固定」の印だけ。changeOwnPassword も同じ所で断る）。
 * ケアマネは事業所の画面の自分の行から（T61）、本人・家族はアカウントが無いので null
 */
export function ownPasswordEntry(p: Pick<Principal, "role" | "judge" | "accountId"> | null): "open" | "fixed" | null {
  if (!p || (p.role !== "medical" && p.role !== "government")) return null;
  if (p.judge || isFixedAccount(p.accountId)) return "fixed";
  return p.accountId ? "open" : null;
}

/** 変更の欄を開いた形で送る印（/office?password=1・/staff?password=1。T114） */
export const OWN_PASSWORD_OPEN_PARAM = "password";
/** 事業所の画面（lib/disaster/http.ts の OFFICE_PATH と同じ。あちらは D1 の処理を読むのでここでは読まない） */
const OFFICE_PATH = "/office";

/** URL の印（?password=1）があるか */
export function wantsOwnPassword(v: string | string[] | undefined): boolean {
  return (Array.isArray(v) ? v[0] : v) === "1";
}

/**
 * 初期パスワードのまま入った人の、ヘッダーの下の印「初期パスワード」と「変更」の送り先（T114 の問い 1 の (b)）。
 * ケアマネは事業所の画面の自分の行（ケアマネの区分、欄を開いて）、医療班・行政は受入一覧の見出しの行（欄を開いて）。
 * 印が無い・審査員・役を替えた山本・審査員が足したアカウント・固定のアカウント・本人と家族は null（出さない）。
 * 変えるまでほかの画面へ行けない、にはしない（審査員・種のアカウントは元から対象の外）
 */
export function initialPasswordHref(
  p: Pick<Principal, "role" | "judge" | "accountId" | "initialPassword" | "switched" | "judgeMade"> | null,
): string | null {
  if (!p || p.initialPassword !== true || p.judge || p.switched || p.judgeMade || !p.accountId || isFixedAccount(p.accountId)) return null;
  const open = `?${OWN_PASSWORD_OPEN_PARAM}=1`;
  if (p.role === "care_manager") return `${OFFICE_PATH}${open}#${CARE_MANAGERS_ANCHOR}`;
  if (p.role === "medical" || p.role === "government") return `${STAFF_PATH}${open}`;
  return null;
}

/** 欄の隠した ID（パスワードの管理の道具が新しいパスワードを ID と組にできるように）。無い・停止した人は null */
export async function ownLoginId(db: D1Database, accountId: string): Promise<string | null> {
  const r = await db.prepare("SELECT login_id FROM accounts WHERE id = ?1 AND disabled_at IS NULL").bind(accountId).first<{ login_id: string | null }>();
  return r?.login_id ?? null;
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
    // 決まりに合わないときは足りない物を添える（「条件不足 大文字 記号」）
    if (r.error === "password") return { ...out, body: { ...out.body, label: passwordProblemLabel(passwordProblems(o.next)) } };
    return r.error === "locked" ? { ...out, body: { ...out.body, minutes: r.minutes }, retryAfterSec: r.retryAfterSec } : out;
  }
  return { status: 200, body: { ok: true }, token: r.token };
}
