// ログインの回数の制限（docs/tasks/T41.md）。失敗を D1 の login_attempts に数える。
// 同じ送信元（CF-Connecting-IP）で 15 分の内に 10 回、同じ ID で 15 分の内に 50 回失敗したら、その失敗から 15 分は止める（route は 429）。
// ID の数を多くするのは、審査員の ID（judge）が皆で 1 つだから（1 人の打ち間違いで全員を止めず、分散して当てに来る相手だけを止める）。
// 送信元が取れないときは、ID を 10 回で止める（送信元の数えの代わり）。
// 止めている間の試しは数えない（パスワードを確かめないので、止める時間も延びない）。
// 成功したらその ID とその送信元の失敗を消す。1 日より古い行は試すたびに消す。
// Cloudflare の rate limiting の規則は使わない（設定がリポジトリの外に出るため）。
// ここは D1 と時刻を引数で受け取るだけ（テストで node:sqlite を渡す）。パスワードは受け取らない。

import type { D1Database } from "@cloudflare/workers-types";
import { login, type AuthEnv } from "./principal.ts";

/** 数える幅（秒）。この幅の内に決めた回数だけ失敗したら止める */
export const LOCK_WINDOW_SEC = 15 * 60;
/** 同じ送信元で止める失敗の回数（送信元が取れないときは同じ ID でこの回数） */
export const LOCK_FAILURES = 10;
/** 同じ ID で止める失敗の回数（送信元が取れるとき） */
export const LOCK_ID_FAILURES = 50;
/** 止める長さ（秒）。いちばん新しい失敗から */
export const LOCK_SEC = 15 * 60;
/** 行を残す長さ（秒）。これより古い行は試すたびに消す */
export const KEEP_SEC = 24 * 60 * 60;
/** 送信元が分からないとき（手元の dev。CF-Connecting-IP が無い）。この値では送信元で数えない */
export const UNKNOWN_IP = "unknown";
/** 残す ID の長さ（ログインの欄の maxLength と同じ） */
const MAX_LOGIN_ID = 128;

/** 数える鍵。ID は前後の空白を落として 128 字まで、送信元は CF-Connecting-IP */
export type AttemptKey = { loginId: string; ip: string };

export function attemptKey(loginId: string, ip: string | null | undefined): AttemptKey {
  const addr = ip?.trim();
  return { loginId: loginId.trim().slice(0, MAX_LOGIN_ID), ip: addr ? addr.slice(0, 64) : UNKNOWN_IP };
}

/** 要求の見出しから送信元。Cloudflare が付ける CF-Connecting-IP だけを見る（X-Forwarded-For は送る側が書けるので見ない） */
export function requestIp(headers: Headers): string | null {
  return headers.get("cf-connecting-ip");
}

export type Lock = { locked: false } | { locked: true; retryAfterSec: number; minutes: number };

const RECENT_BY_ID = `SELECT at FROM login_attempts
 WHERE ok = 0 AND login_id = ?1 AND at > ?2 ORDER BY at DESC LIMIT ?3`;
const RECENT_BY_IP = `SELECT at FROM login_attempts
 WHERE ok = 0 AND ip = ?1 AND at > ?2 ORDER BY at DESC LIMIT ?3`;

/**
 * 新しい順の失敗の時刻（秒）から、止める残りの秒。止めていなければ 0。
 * 新しい limit 回が 15 分の内に収まり、いちばん新しい失敗から 15 分たっていなければ止める
 */
export function lockRemaining(recent: ReadonlyArray<number>, now: number, limit: number = LOCK_FAILURES): number {
  if (recent.length < limit) return 0;
  const newest = recent[0];
  const oldest = recent[limit - 1];
  if (newest - oldest >= LOCK_WINDOW_SEC) return 0;
  return Math.max(newest + LOCK_SEC - now, 0);
}

/**
 * 止めているか。送信元（10 回）と ID（送信元が取れれば 50 回、取れなければ 10 回）を見て、長い方の残り。
 * minutes は画面に出す残りの分（切り上げ）
 */
export async function loginLock(db: D1Database, key: AttemptKey, now: number): Promise<Lock> {
  const since = now - LOCK_WINDOW_SEC - LOCK_SEC;
  const known = key.ip !== UNKNOWN_IP;
  const checks: Array<{ sql: string; value: string; limit: number }> = [
    { sql: RECENT_BY_ID, value: key.loginId, limit: known ? LOCK_ID_FAILURES : LOCK_FAILURES },
  ];
  if (known) checks.push({ sql: RECENT_BY_IP, value: key.ip, limit: LOCK_FAILURES });
  const results = await db.batch<{ at: number }>(checks.map((c) => db.prepare(c.sql).bind(c.value, since, c.limit)));
  const remaining = Math.max(
    0,
    ...results.map((r, i) =>
      lockRemaining(
        (r.results ?? []).map((row) => Number(row.at)),
        now,
        checks[i].limit,
      ),
    ),
  );
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfterSec: remaining, minutes: Math.ceil(remaining / 60) };
}

/**
 * 試した結果を残す（1 つの batch）。古い行を消し、1 行足す。成功ならその ID とその送信元の失敗を消してから足す。
 * 止めている間は呼ばない（route が loginLock を先に見る）
 */
export async function recordLoginAttempt(db: D1Database, key: AttemptKey, ok: boolean, now: number): Promise<void> {
  const stmts = [db.prepare("DELETE FROM login_attempts WHERE at < ?1").bind(now - KEEP_SEC)];
  if (ok) {
    stmts.push(db.prepare("DELETE FROM login_attempts WHERE ok = 0 AND login_id = ?1").bind(key.loginId));
    if (key.ip !== UNKNOWN_IP) stmts.push(db.prepare("DELETE FROM login_attempts WHERE ok = 0 AND ip = ?1").bind(key.ip));
  }
  stmts.push(
    db
      .prepare("INSERT INTO login_attempts (login_id, ip, at, ok) VALUES (?1, ?2, ?3, ?4)")
      .bind(key.loginId, key.ip, now, ok ? 1 : 0),
  );
  await db.batch(stmts);
}

export type GuardedLogin =
  | { kind: "ok"; token: string; path: string }
  | { kind: "failed" }
  | { kind: "locked"; retryAfterSec: number; minutes: number };

/**
 * 回数の制限つきのログイン（route はこれを呼ぶ）。止めていればパスワードを確かめずに locked。
 * 確かめたら結果を残し、10 回目の失敗ならその場で locked（次に押してから知るのでなく）
 */
export async function guardedLogin(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  input: { loginId: string; password: string; ip: string | null },
  now: number,
): Promise<GuardedLogin> {
  const key = attemptKey(input.loginId, input.ip);
  const lock = await loginLock(db, key, now);
  if (lock.locked) return { kind: "locked", retryAfterSec: lock.retryAfterSec, minutes: lock.minutes };
  const r = await login(db, env, secret, { loginId: input.loginId, password: input.password }, now);
  await recordLoginAttempt(db, key, r.ok, now);
  if (r.ok) return { kind: "ok", token: r.token, path: r.path };
  const after = await loginLock(db, key, now);
  if (after.locked) return { kind: "locked", retryAfterSec: after.retryAfterSec, minutes: after.minutes };
  return { kind: "failed" };
}

/** 止めたときの返し方。フォームの POST（画面の移動）は /login?e=locked&m=<残りの分> へ 303、ほか（fetch・curl）は 429 と Retry-After */
export function wantsPage(headers: Headers): boolean {
  if (headers.get("sec-fetch-mode") === "navigate") return true;
  return (headers.get("accept") ?? "").includes("text/html");
}

/** 画面の残りの分（/login?e=locked&m=）。1〜15 の整数でなければ null */
export function waitMinutes(raw: string | undefined): number | null {
  if (!raw || !/^[0-9]{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= Math.ceil(LOCK_SEC / 60) ? n : null;
}
