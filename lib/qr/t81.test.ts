// T81: スマホ入口のセッションは、リンクの版と作った時刻の両方で D1 と比べる（朝の見直し 11/4 の正しさ 中 3）。
// 毎朝 4 時の戻しで版が 0 に戻り、次に作ると版 1 になる。版だけで比べると、前の日の版 1 のセッションが生き返っていた。
// セッションにリンクを作った時刻（li）を持たせ、T81 の前に開いたセッション（li が無い）は iat で比べる。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { readCookie, SESSION_COOKIE } from "../auth/cookie.ts";
import { resolvePrincipal } from "../auth/principal.ts";
import { decodeSession, LINK_SESSION_PV, signSession } from "../auth/session.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { demoResetStatements } from "../seed/reset.ts";
import { openPhoneLink } from "./phone-open.ts";
import { PHONE_LINK_TTL_SEC } from "./phone-link.ts";
import { currentPhoneLinkToken, issuePhoneLink } from "./phone-link-store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const SECRET = "test-secret-for-phone-link-t81-0123456789";
const ISSUER = { officeId: "office-demo", authorId: "acct-yamamoto" };
/** 前の日（11/3 10:00 JST）に作り、次の日の 4 時に戻し、10:00 にまた作る */
const DAY1 = "2026-11-03T01:00:00.000Z";
const RESET = "2026-11-03T19:00:00.000Z";
const DAY2 = "2026-11-04T01:00:00.000Z";
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const NOW = sec(DAY2) + 3600;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

/** 山田 ハナのリンクを作る（作り直す）。本人用と家族用（娘）のトークン */
async function issue(nowIso: string): Promise<{ self: string; family: string }> {
  const row = await issuePhoneLink(db, ISSUER, "p-01", nowIso);
  if (!row) throw new Error("発行できない");
  return {
    self: (await currentPhoneLinkToken("p-01", null, row, SECRET))!,
    family: (await currentPhoneLinkToken("p-01", "c-01-1", row, SECRET))!,
  };
}

async function open(token: string, now: number): Promise<string> {
  const res = await openPhoneLink(new Request("http://localhost:3072/s/x"), db, SECRET, token, now);
  const set = res.headers.get("set-cookie");
  if (!set) throw new Error(`開けない ${res.headers.get("location")}`);
  return readCookie(set, SESSION_COOKIE)!;
}

const generation = () => (sqlite.prepare("SELECT phone_link_generation AS g FROM people WHERE id = 'p-01'").get() as { g: number }).g;

describe("スマホ入口のセッションの版と時刻", () => {
  it("開いたセッションはリンクを作った時刻（li）を持つ", async () => {
    const cookie = await open((await issue(DAY1)).self, sec(DAY1) + 60);
    const s = await decodeSession(cookie, SECRET);
    expect(s).toMatchObject({ k: "link", g: 1, li: sec(DAY1) });
  });

  it("戻しで版が 0 に戻り次の日に作り直して版 1 になっても、前の日のセッションは通らない。新しいセッションは通る（本人用・家族用）", async () => {
    const day1 = await issue(DAY1);
    const oldSelf = await open(day1.self, sec(DAY1) + 60);
    const oldFamily = await open(day1.family, sec(DAY1) + 60);
    expect((await resolvePrincipal(db, {}, SECRET, oldSelf, sec(DAY1) + 120))?.role).toBe("self");
    expect((await resolvePrincipal(db, {}, SECRET, oldFamily, sec(DAY1) + 120))?.role).toBe("family");

    for (const s of demoResetStatements(RESET)) sqlite.exec(s);
    expect(generation()).toBe(0);
    expect(await resolvePrincipal(db, {}, SECRET, oldSelf, NOW)).toBeNull();

    const fresh = await issue(DAY2);
    expect(generation()).toBe(1);
    // 版は同じ 1 だが、作った時刻が違う
    expect(await resolvePrincipal(db, {}, SECRET, oldSelf, NOW)).toBeNull();
    expect(await resolvePrincipal(db, {}, SECRET, oldFamily, NOW)).toBeNull();
    expect((await resolvePrincipal(db, {}, SECRET, await open(fresh.self, sec(DAY2) + 60), NOW))?.role).toBe("self");
    expect((await resolvePrincipal(db, {}, SECRET, await open(fresh.family, sec(DAY2) + 60), NOW))?.role).toBe("family");
  });

  it("T81 の前のセッション（li が無い）は iat で比べる: 作った時刻と同じなら通り、作り直したあとは版が同じでも通らない", async () => {
    await issue(DAY1);
    const legacy = await signSession(
      { v: 1, k: "link", p: "p-01", c: null, g: 1, pv: LINK_SESSION_PV, iat: sec(DAY1), exp: sec(DAY1) + PHONE_LINK_TTL_SEC },
      SECRET,
    );
    expect((await resolvePrincipal(db, {}, SECRET, legacy, sec(DAY1) + 60))?.role).toBe("self");
    for (const s of demoResetStatements(RESET)) sqlite.exec(s);
    await issue(DAY2);
    expect(generation()).toBe(1);
    expect(await resolvePrincipal(db, {}, SECRET, legacy, NOW)).toBeNull();
  });

  it("li が D1 の時刻と違うセッションは、版が合っていても通らない", async () => {
    await issue(DAY1);
    const forged = await signSession(
      { v: 1, k: "link", p: "p-01", c: null, g: 1, li: sec(DAY1) - 1, pv: LINK_SESSION_PV, iat: sec(DAY1), exp: sec(DAY1) + PHONE_LINK_TTL_SEC },
      SECRET,
    );
    expect(await resolvePrincipal(db, {}, SECRET, forged, sec(DAY1) + 60)).toBeNull();
  });
});
