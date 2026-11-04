// T77（docs/progress/qa-20261104.md の高 3）: 最初に戻す・毎朝 4 時の戻しのあと、開いたままの本人・家族のスマホが
// ID・パスワードのログイン欄に落ちない。リンクのセッションは「無効」の頁、審査員の役は生きていれば役選択へ。
// D1 は node:sqlite に種の 10 人、R2 は偽物。lib/auth/server.ts の requirePage と同じ組み立て（resolvePageExit）で確かめる。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { PHONE_LINK_INVALID_PATH } from "../qr/phone-link.ts";
import { currentPhoneLinkToken, issuePhoneLink } from "../qr/phone-link-store.ts";
import { openPhoneLink } from "../qr/phone-open.ts";
import { DAILY_RESET_CRON, scheduledReset } from "../seed/cron.ts";
import { resetPost } from "../seed/http.ts";
import type { SeedBucket } from "../seed/reset.ts";
import { readCookie, SESSION_COOKIE } from "./cookie.ts";
import { JUDGE_LOGIN_ID } from "./demo.ts";
import { pageExit, phoneGoneExit, resolvePageExit } from "./phone-gate.ts";
import { chooseJudgeRole, login, resolvePrincipal, type Principal } from "./principal.ts";
import { LOGIN_PATH, PAGE_PATHS, PAGES, ROLE_SELECT_PATH, type JudgeRole, type Page } from "./roles.ts";
import { decodeSession, SESSION_TTL_SEC, signSession, verifySession } from "./session.ts";

const SECRET = "test-secret-for-phone-gate-0123456789abcdef";
const JUDGE_PW = "judge-password-for-tests-only";
const ENV = { JUDGE_PASSWORD: JUDGE_PW };
const T0 = Date.parse("2026-11-04T01:00:00.000Z");
const ISSUED_ISO = new Date(T0).toISOString();
const NOW = Math.floor(T0 / 1000) + 3600;
const ISSUER = { officeId: "office-demo", authorId: "acct-yamamoto" };

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const bucket: SeedBucket = {
  head: async () => null,
  list: async () => ({ objects: [], truncated: false }),
  delete: async () => null,
};

/**
 * p-01 のスマホ入口を開いた cookie の値（本人用は contactId null、家族用は c-01-1）。発行は 1 回目だけ（発行し直すと前のリンクは通らない）
 */
async function linkCookie(contactId: string | null): Promise<string> {
  const g = sqlite.prepare("SELECT phone_link_generation AS g FROM people WHERE id = 'p-01'").get() as { g: number };
  const row =
    g.g > 0
      ? { phone_link_generation: g.g, phone_link_issued_at: ISSUED_ISO, unlisted_at: null }
      : await issuePhoneLink(db, ISSUER, "p-01", ISSUED_ISO);
  if (!row) throw new Error("発行できない");
  const token = await currentPhoneLinkToken("p-01", contactId, row, SECRET);
  if (!token) throw new Error("トークンが無い");
  const res = await openPhoneLink(new Request("http://localhost:3072/s/x"), db, SECRET, token, NOW);
  const cookie = readCookie(res.headers.get("set-cookie"), SESSION_COOKIE);
  if (!cookie) throw new Error("cookie が無い");
  return cookie;
}

/** 審査員でログインして役を選んだ cookie */
async function judgeCookie(role: JudgeRole): Promise<string> {
  const r = await login(db, ENV, SECRET, { loginId: JUDGE_LOGIN_ID, password: JUDGE_PW }, NOW - 60);
  if (!r.ok) throw new Error("審査員で入れない");
  const c = await chooseJudgeRole(db, ENV, SECRET, r.token, role, NOW - 30);
  if (!c) throw new Error("役を選べない");
  return c.token;
}

const exitOf = (token: string | null, page: Page, now = NOW) => resolvePageExit(db, ENV, SECRET, token, now, page);

/** 毎朝 4 時の cron（worker.ts の scheduled と同じ入口） */
const dailyReset = () => scheduledReset({ DB: db, RECORDINGS: bucket }, DAILY_RESET_CRON, (NOW - 600) * 1000);

/** 事業所の画面の「最初に戻す」（審査員のケアマネの役が押す） */
async function officeReset() {
  const cm = await resolvePrincipal(db, ENV, SECRET, await judgeCookie("care_manager"), NOW);
  const form = new FormData();
  form.set("confirm", "1");
  const out = await resetPost(db, bucket, cm, form, new Date((NOW - 600) * 1000).toISOString());
  expect(out.status).toBe(303);
}

describe("本人・家族のリンクのセッション: 戻したあとは「無効」の頁（ログイン欄に落とさない）", () => {
  it("毎朝 4 時の戻し（cron）: 本人用の /me・家族用の /family が「無効」の頁へ。戻す前は開ける", async () => {
    const self = await linkCookie(null);
    const family = await linkCookie("c-01-1");
    expect(await exitOf(self, "me")).toBeNull();
    expect(await exitOf(family, "family")).toBeNull();

    expect(await dailyReset()).not.toBeNull();
    expect(await resolvePrincipal(db, ENV, SECRET, self, NOW)).toBeNull();
    expect(await exitOf(self, "me")).toBe(PHONE_LINK_INVALID_PATH);
    expect(await exitOf(family, "family")).toBe(PHONE_LINK_INVALID_PATH);
    expect(await exitOf(self, "me")).not.toBe(LOGIN_PATH);
  });

  it("最初に戻す（/office/reset）も同じ", async () => {
    const self = await linkCookie(null);
    const family = await linkCookie("c-01-1");
    await officeReset();
    expect(await exitOf(self, "me")).toBe(PHONE_LINK_INVALID_PATH);
    expect(await exitOf(family, "family")).toBe(PHONE_LINK_INVALID_PATH);
  });

  it("期限切れ（180 日）・再発行した前のリンクのセッションも「無効」の頁", async () => {
    const self = await linkCookie(null);
    const p = await verifySession(self, SECRET, NOW);
    expect(p?.k).toBe("link");
    expect(await exitOf(self, "me", p!.exp)).toBe(PHONE_LINK_INVALID_PATH);
    await issuePhoneLink(db, ISSUER, "p-01", ISSUED_ISO);
    expect(await exitOf(self, "me")).toBe(PHONE_LINK_INVALID_PATH);
  });

  it("担当一覧などほかの画面は今までどおり（通らないリンクの cookie はログイン欄、通るリンクは本人の頁へ）", async () => {
    const self = await linkCookie(null);
    expect(await exitOf(self, "caseload")).toBe(PAGE_PATHS.me);
    expect(await exitOf(self, "family")).toBe(PAGE_PATHS.me);
    await dailyReset();
    for (const page of PAGES.filter((x) => x !== "me" && x !== "family")) expect(await exitOf(self, page), page).toBe(LOGIN_PATH);
  });
});

describe("審査員の本人・家族の役", () => {
  it("戻しても審査員の本人・家族の役はそのまま開ける（ログインと役は D1 の人の行に依らない）", async () => {
    const self = await judgeCookie("self");
    const family = await judgeCookie("family");
    await dailyReset();
    expect(await exitOf(self, "me")).toBeNull();
    expect(await exitOf(family, "family")).toBeNull();
  });

  it("ログインが生きていて役が替わった（別のタブでケアマネにして最初に戻した）本人スマホのタブは役選択へ", async () => {
    const r = await login(db, ENV, SECRET, { loginId: JUDGE_LOGIN_ID, password: JUDGE_PW }, NOW - 60);
    if (!r.ok) throw new Error("入れない");
    const cm = await chooseJudgeRole(db, ENV, SECRET, r.token, "care_manager", NOW - 30);
    await officeReset();
    for (const page of ["me", "family"] as const) expect(await exitOf(cm!.token, page), page).toBe(ROLE_SELECT_PATH);
    // ほかの画面の役違いは今までどおり役の入口
    const med = await judgeCookie("medical");
    expect(await exitOf(med, "caseload")).toBe(PAGE_PATHS.staff);
  });

  it("審査員の本人・家族の役のセッションが切れた（7 日・パスワードの変更）ら「無効」の頁。ケアマネの役で切れたらログイン欄", async () => {
    const self = await judgeCookie("self");
    const late = NOW - 30 + SESSION_TTL_SEC;
    expect(await exitOf(self, "me", late)).toBe(PHONE_LINK_INVALID_PATH);
    expect(await resolvePageExit(db, { JUDGE_PASSWORD: "changed-password-xxxxxxxx" }, SECRET, self, NOW, "me")).toBe(
      PHONE_LINK_INVALID_PATH,
    );
    const cm = await judgeCookie("care_manager");
    expect(await exitOf(cm, "me", late)).toBe(LOGIN_PATH);
  });
});

describe("ほかの cookie は今までどおりログイン欄", () => {
  it("cookie なし・読めない cookie・ほかの鍵で署名した物はログイン欄", async () => {
    expect(await exitOf(null, "me")).toBe(LOGIN_PATH);
    expect(await exitOf("garbage", "family")).toBe(LOGIN_PATH);
    const self = await linkCookie(null);
    const p = (await decodeSession(self, SECRET))!;
    const other = await signSession(p, "another-secret-0123456789-abcdefghijk");
    expect(await exitOf(other, "me")).toBe(LOGIN_PATH);
    expect(await decodeSession(`${self}x`, SECRET)).toBeNull();
  });

  it("decodeSession は期限を見ないが、verifySession は今までどおり期限で落とす", async () => {
    const self = await linkCookie(null);
    const p = (await verifySession(self, SECRET, NOW))!;
    expect(await verifySession(self, SECRET, p.exp)).toBeNull();
    expect(await decodeSession(self, SECRET)).toEqual(p);
  });
});

describe("送り先の決め方（pageExit・phoneGoneExit）", () => {
  const base: Principal = {
    role: "self",
    judge: false,
    admin: false,
    accountId: null,
    displayName: null,
    office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
    caseloadOf: null,
    personId: "p-01",
    contactId: null,
  };
  it("本人・家族の頁で本人の行が読めないとき: 審査員は役選択、リンクは「無効」の頁（404 にしない）", () => {
    expect(phoneGoneExit(base)).toBe(PHONE_LINK_INVALID_PATH);
    expect(phoneGoneExit({ ...base, judge: true, accountId: "acct-judge" })).toBe(ROLE_SELECT_PATH);
  });
  it("開ける役なら null。ケアマネのアカウントが /me を開けば今までどおり担当一覧", () => {
    expect(pageExit("me", base, null)).toBeNull();
    expect(pageExit("me", { ...base, role: "care_manager" }, null)).toBe(PAGE_PATHS.caseload);
  });
});
