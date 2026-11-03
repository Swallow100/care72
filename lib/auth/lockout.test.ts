// ログインの回数の制限（docs/tasks/T41.md）のテスト。種の入った node:sqlite で本物の login を通す。
// 送信元 10 回・ID 50 回（送信元が無ければ ID 10 回）で止まる・15 分で戻る・成功で消える・別の ID は止まらない・古い行は消える・パスワードを残さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { JUDGE_LOGIN_ID } from "./demo.ts";
import {
  attemptKey,
  guardedLogin,
  KEEP_SEC,
  LOCK_FAILURES,
  LOCK_ID_FAILURES,
  LOCK_SEC,
  lockRemaining,
  loginLock,
  requestIp,
  UNKNOWN_IP,
  waitMinutes,
  wantsPage,
} from "./lockout.ts";

// テストだけの値（本物のパスワード・鍵ではない）
const SECRET = "test-secret-0123456789-0123456789-abcdef";
const JUDGE_PW = "test-judge-pass-0001";
const CM_PW = "test-cm-pass-0001";
const NOW = 1_800_000_000;
const env = { JUDGE_PASSWORD: JUDGE_PW, CAREMANAGER_DEMO_PASSWORD: CM_PW };

const IP_A = "203.0.113.10";
const IP_B = "203.0.113.20";

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const attempt = (loginId: string, password: string, ip: string | null, now: number) =>
  guardedLogin(db, env, SECRET, { loginId, password, ip }, now);

/** 1 秒おきに n 回失敗する。最後の時刻を返す */
async function fail(n: number, loginId: string, ip: string | null, from: number): Promise<number> {
  let t = from;
  for (let i = 0; i < n; i++) {
    t = from + i;
    await attempt(loginId, "wrong-pass", ip, t);
  }
  return t;
}

const rows = () =>
  sqlite.prepare("SELECT login_id, ip, at, ok FROM login_attempts ORDER BY id").all() as Array<{
    login_id: string;
    ip: string;
    at: number;
    ok: number;
  }>;

describe("10 回で止まる", () => {
  it("9 回の失敗では止まらず、10 回目の失敗でその場で止まる（残り 15 分）。止まったら正しいパスワードでも入れない", async () => {
    const last9 = await fail(LOCK_FAILURES - 1, JUDGE_LOGIN_ID, IP_A, NOW);
    expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, last9 + 1)).toEqual({
      kind: "locked",
      retryAfterSec: LOCK_SEC,
      minutes: 15,
    });
    const r = await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, last9 + 60);
    expect(r).toEqual({ kind: "locked", retryAfterSec: LOCK_SEC - 59, minutes: 15 });
  });

  it("9 回目までは失敗の返事（failed）", async () => {
    for (let i = 0; i < LOCK_FAILURES - 1; i++) {
      expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, NOW + i)).toEqual({ kind: "failed" });
    }
  });

  it("止まっている間の試しは数えない（止める時間が延びない）", async () => {
    const last = await fail(LOCK_FAILURES, JUDGE_LOGIN_ID, IP_A, NOW);
    const before = rows().length;
    await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, last + 100);
    await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, last + 200);
    expect(rows()).toHaveLength(before);
    expect(await loginLock(db, attemptKey(JUDGE_LOGIN_ID, IP_A), last + 200)).toEqual({
      locked: true,
      retryAfterSec: LOCK_SEC - 200,
      minutes: Math.ceil((LOCK_SEC - 200) / 60),
    });
  });

  it("無い ID の失敗も数える（ID が有るかを分からせない）", async () => {
    const last = await fail(LOCK_FAILURES, "nobody", IP_A, NOW);
    expect((await attempt("nobody", "x", IP_A, last + 1)).kind).toBe("locked");
  });
});

describe("15 分で戻る", () => {
  it("いちばん新しい失敗から 15 分の 1 秒前は止まり（残り 1 分）、15 分で入れる", async () => {
    const last = await fail(LOCK_FAILURES, JUDGE_LOGIN_ID, IP_A, NOW);
    expect(await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, last + LOCK_SEC - 1)).toEqual({
      kind: "locked",
      retryAfterSec: 1,
      minutes: 1,
    });
    expect((await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, last + LOCK_SEC)).kind).toBe("ok");
  });

  it("戻ったあとも、また 10 回失敗するまで止まらない（1 回ずつ止まり直さない）", async () => {
    const last = await fail(LOCK_FAILURES, JUDGE_LOGIN_ID, IP_A, NOW);
    const back = last + LOCK_SEC;
    for (let i = 0; i < LOCK_FAILURES - 1; i++) {
      expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, back + i)).toEqual({ kind: "failed" });
    }
    expect((await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, back + LOCK_FAILURES)).kind).toBe("locked");
  });

  it("15 分を越えて散らばった 10 回の失敗では止まらない", async () => {
    for (let i = 0; i < LOCK_FAILURES; i++) {
      expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, NOW + i * 120)).toEqual({ kind: "failed" });
    }
  });
});

describe("成功で消える", () => {
  it("9 回失敗してから正しいパスワードで入ると、その ID と送信元の失敗が消え、また 9 回失敗しても止まらない", async () => {
    const last = await fail(LOCK_FAILURES - 1, JUDGE_LOGIN_ID, IP_A, NOW);
    const ok = await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, last + 1);
    expect(ok.kind).toBe("ok");
    expect(rows()).toEqual([{ login_id: JUDGE_LOGIN_ID, ip: IP_A, at: last + 1, ok: 1 }]);
    for (let i = 0; i < LOCK_FAILURES - 1; i++) {
      expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", IP_A, last + 2 + i)).toEqual({ kind: "failed" });
    }
  });

  it("山本（アカウントの表）の成功でも消える", async () => {
    const last = await fail(LOCK_FAILURES - 1, "yamamoto", IP_A, NOW);
    expect((await attempt("yamamoto", CM_PW, IP_A, last + 1)).kind).toBe("ok");
    expect(rows().filter((r) => r.ok === 0)).toEqual([]);
  });
});

describe("ID と送信元", () => {
  it("止まった ID と別の ID は、別の送信元からなら止まらない", async () => {
    await fail(LOCK_FAILURES, JUDGE_LOGIN_ID, IP_A, NOW);
    expect((await attempt("yamamoto", CM_PW, IP_B, NOW + 20)).kind).toBe("ok");
  });

  it("同じ送信元からは、ID を変えて 10 回失敗しても止まる", async () => {
    for (let i = 0; i < LOCK_FAILURES; i++) await attempt(`guess-${i}`, "wrong-pass", IP_A, NOW + i);
    expect((await attempt("yamamoto", CM_PW, IP_A, NOW + 20)).kind).toBe("locked");
    expect((await attempt("yamamoto", CM_PW, IP_B, NOW + 20)).kind).toBe("ok");
  });

  it("審査員の 1 人が 10 回打ち間違えても、止まるのはその送信元だけ（ほかの審査員は同じ ID で入れる）", async () => {
    const last = await fail(LOCK_FAILURES, JUDGE_LOGIN_ID, IP_A, NOW);
    expect((await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, last + 1)).kind).toBe("locked");
    expect((await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_B, last + 1)).kind).toBe("ok");
  });

  it("同じ ID は、送信元を変えて 49 回失敗しても止まらず、50 回で止まる（分散して当てに来る相手）", async () => {
    const ip = (i: number) => `198.51.${100 + Math.floor(i / 9)}.${i % 9}`;
    for (let i = 0; i < LOCK_ID_FAILURES - 1; i++) {
      expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", ip(i), NOW + i)).toEqual({ kind: "failed" });
    }
    expect(await attempt(JUDGE_LOGIN_ID, "wrong-pass", ip(LOCK_ID_FAILURES - 1), NOW + 60)).toEqual({
      kind: "locked",
      retryAfterSec: LOCK_SEC,
      minutes: 15,
    });
    expect((await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_B, NOW + 61)).kind).toBe("locked");
    expect((await attempt("yamamoto", CM_PW, IP_B, NOW + 61)).kind).toBe("ok");
  });

  it("送信元が分からない（CF-Connecting-IP が無い）ときは送信元で数えず、ID を 10 回で止める", async () => {
    for (let i = 0; i < LOCK_FAILURES; i++) await attempt(`guess-${i}`, "wrong-pass", null, NOW + i);
    expect((await attempt("yamamoto", CM_PW, null, NOW + 20)).kind).toBe("ok");
    expect(rows().every((r) => r.ip === UNKNOWN_IP)).toBe(true);
    const last = await fail(LOCK_FAILURES, JUDGE_LOGIN_ID, null, NOW + 30);
    expect((await attempt(JUDGE_LOGIN_ID, JUDGE_PW, null, last + 1)).kind).toBe("locked");
  });

  it("ID は前後の空白を落として数える", async () => {
    for (let i = 0; i < LOCK_FAILURES; i++) await attempt(i % 2 ? ` ${JUDGE_LOGIN_ID} ` : JUDGE_LOGIN_ID, "x", null, NOW + i);
    expect((await attempt(JUDGE_LOGIN_ID, JUDGE_PW, null, NOW + 20)).kind).toBe("locked");
  });
});

describe("残す物と消す物", () => {
  it("1 日より古い行は次に試したときに消える", async () => {
    await fail(3, JUDGE_LOGIN_ID, IP_A, NOW);
    await attempt("yamamoto", "wrong-pass", IP_B, NOW + KEEP_SEC + 10);
    expect(rows()).toEqual([{ login_id: "yamamoto", ip: IP_B, at: NOW + KEEP_SEC + 10, ok: 0 }]);
  });

  it("表にパスワードの列が無く、打ったパスワードはどの行にも残らない", async () => {
    await attempt(JUDGE_LOGIN_ID, "secret-typed-pass", IP_A, NOW);
    await attempt(JUDGE_LOGIN_ID, JUDGE_PW, IP_A, NOW + 1);
    const cols = (sqlite.prepare("PRAGMA table_info(login_attempts)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "login_id", "ip", "at", "ok"]);
    const dump = JSON.stringify(sqlite.prepare("SELECT * FROM login_attempts").all());
    expect(dump).not.toContain("secret-typed-pass");
    expect(dump).not.toContain(JUDGE_PW);
  });

  it("ID は 128 字まで、送信元は 64 字まで", () => {
    expect(attemptKey("a".repeat(300), "b".repeat(100))).toEqual({ loginId: "a".repeat(128), ip: "b".repeat(64) });
    expect(attemptKey("  judge ", "  ")).toEqual({ loginId: "judge", ip: UNKNOWN_IP });
  });
});

describe("小さな部品", () => {
  it("lockRemaining: 新しい 10 回が 15 分の内で、いちばん新しい失敗から 15 分たっていなければ残りの秒", () => {
    const ten = (gap: number) => Array.from({ length: LOCK_FAILURES }, (_, i) => 1000 - i * gap);
    expect(lockRemaining(ten(1).slice(0, 9), 1000)).toBe(0);
    expect(lockRemaining(ten(1), 1000)).toBe(LOCK_SEC);
    expect(lockRemaining(ten(1), 1000 + LOCK_SEC)).toBe(0);
    expect(lockRemaining(ten(100), 1000)).toBe(0);
    expect(lockRemaining(ten(99), 1000)).toBe(LOCK_SEC);
    const fifty = Array.from({ length: LOCK_ID_FAILURES }, (_, i) => 1000 - i);
    expect(lockRemaining(fifty.slice(0, LOCK_ID_FAILURES - 1), 1000, LOCK_ID_FAILURES)).toBe(0);
    expect(lockRemaining(fifty, 1000, LOCK_ID_FAILURES)).toBe(LOCK_SEC);
  });

  it("requestIp は CF-Connecting-IP だけ（X-Forwarded-For は見ない）", () => {
    expect(requestIp(new Headers({ "cf-connecting-ip": IP_A, "x-forwarded-for": IP_B }))).toBe(IP_A);
    expect(requestIp(new Headers({ "x-forwarded-for": IP_B }))).toBeNull();
  });

  it("wantsPage: 画面の移動（フォームの POST）は待ちの画面へ、fetch・curl は 429", () => {
    expect(wantsPage(new Headers({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(wantsPage(new Headers({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(wantsPage(new Headers({ "sec-fetch-mode": "cors", accept: "application/json" }))).toBe(false);
    expect(wantsPage(new Headers())).toBe(false);
  });

  it("waitMinutes: 1〜15 の整数だけ", () => {
    expect(waitMinutes("1")).toBe(1);
    expect(waitMinutes("15")).toBe(15);
    for (const v of [undefined, "", "0", "16", "-1", "1.5", "abc", "999"]) expect(waitMinutes(v)).toBeNull();
  });
});
