// T81: アンケートの書き込みの守り（朝の見直し 11/4 の安全 中 6）。
// - 共有のリンクは 1 つの事業所で 1 日（JST）SURVEY_SHARES_PER_DAY 本まで。審査員の物（試し）と本物は別に数える。超えたら 429「本日上限」
// - 頁を開いた時刻の署名の印は 2 時間で切れる（stale「期限切れ 再読込」。15 秒の守り too_fast とは別の断り）

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { createLinkRequest } from "./links.ts";
import { jstDayStartIso, SURVEY_SHARES_PER_DAY } from "./share.ts";
import { createSurveyShare } from "./store.ts";
import { submitSurvey } from "./submit.ts";
import { SURVEY_LABELS, SURVEY_OFFICE_LABELS } from "./text.ts";
import { checkStamp, MIN_FILL_SEC, openStamp, STAMP_TTL_SEC } from "./token.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const SECRET = "test-secret-0123456789-0123456789-abcdef";
const ORIGIN = "http://localhost:3072";
/** 11/4 10:00 JST */
const T0 = new Date("2026-11-04T01:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };
const yamamoto = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const judgeCm = () => yamamoto({ judge: true, admin: false, accountId: "acct-judge" });
const partnerCm = () => yamamoto({ accountId: "acct-partner-cm", displayName: null, office: PARTNER, caseloadOf: "acct-partner-cm" });

const make = (p: Principal, now: Date) => createLinkRequest(db, p, { memo: "" }, now, ORIGIN);
const shares = (where = "1 = 1") => (sqlite.prepare(`SELECT count(*) AS n FROM survey_shares WHERE ${where}`).get() as { n: number }).n;

describe("共有のリンクの 1 日の本数", () => {
  it("JST の日の始まり（11/4 0:00 JST = 11/3 15:00 UTC）", () => {
    expect(jstDayStartIso(new Date("2026-11-04T01:00:00.000Z"))).toBe("2026-11-03T15:00:00.000Z");
    expect(jstDayStartIso(new Date("2026-11-03T14:59:59.999Z"))).toBe("2026-11-02T15:00:00.000Z");
    expect(jstDayStartIso(new Date("2026-11-03T15:00:00.000Z"))).toBe("2026-11-03T15:00:00.000Z");
  });

  it(`本物は 1 日 ${SURVEY_SHARES_PER_DAY} 本まで。超えたら 429「本日上限」で作らない。次の日（JST 0 時）にはまた作れる`, async () => {
    expect(SURVEY_SHARES_PER_DAY).toBe(5);
    for (let i = 0; i < SURVEY_SHARES_PER_DAY; i++) expect((await make(yamamoto(), at(i * MIN))).status, `${i}`).toBe(200);
    const over = await make(yamamoto(), at(10 * MIN));
    expect(over).toEqual({ status: 429, body: { ok: false, error: "limited", label: SURVEY_OFFICE_LABELS.limited } });
    expect(SURVEY_OFFICE_LABELS.limited).toBe("本日上限");
    expect(shares()).toBe(SURVEY_SHARES_PER_DAY);
    // 11/5 0:00 JST（11/4 15:00 UTC）からまた作れる
    expect((await make(yamamoto(), new Date("2026-11-04T14:59:59.000Z"))).status).toBe(429);
    expect((await make(yamamoto(), new Date("2026-11-04T15:00:00.000Z"))).status).toBe(200);
  });

  it("審査員の物と本物は別に数える（審査員が使い切っても山本は作れる。逆も）。事業所ごと", async () => {
    for (let i = 0; i < SURVEY_SHARES_PER_DAY; i++) expect((await make(judgeCm(), at(i * MIN))).status).toBe(200);
    expect((await make(judgeCm(), at(10 * MIN))).status).toBe(429);
    expect((await make(yamamoto(), at(11 * MIN))).status).toBe(200);
    expect((await make({ ...yamamoto(), judgeMade: true }, at(12 * MIN))).status).toBe(429);
    expect((await make(partnerCm(), at(13 * MIN))).status).toBe(200);
    expect(shares("created_role = 'judge'")).toBe(SURVEY_SHARES_PER_DAY);
    expect(shares("created_role = 'care_manager'")).toBe(2);
  });

  it("lib の入口も同じ数え（limited）", async () => {
    for (let i = 0; i < SURVEY_SHARES_PER_DAY; i++) {
      expect((await createSurveyShare(db, { officeId: "office-demo", memo: "", createdBy: "acct-yamamoto", createdRole: "care_manager" }, at(i))).ok).toBe(true);
    }
    expect(await createSurveyShare(db, { officeId: "office-demo", memo: "", createdBy: "acct-yamamoto", createdRole: "care_manager" }, at(9))).toEqual({
      ok: false,
      error: "limited",
    });
  });
});

describe("開いた時刻の印は 2 時間で切れる", () => {
  async function token(): Promise<string> {
    const r = await createSurveyShare(db, { officeId: "office-demo", memo: "", createdBy: "acct-yamamoto", createdRole: "care_manager" }, T0);
    if (!r.ok) throw new Error(r.error);
    return r.token;
  }
  const send = async (t: string, openedAt: Date, now: Date) =>
    submitSurvey(db, {
      token: t,
      contentType: "application/json",
      body: JSON.stringify({ opened: await openStamp(t, openedAt, SECRET), answers: { q1: "a" } }),
      ip: "203.0.113.7",
      now,
      secret: SECRET,
      turnstile: null,
    });

  it("ちょうど 2 時間は通り、1 ミリ秒でも過ぎたら stale（期限切れ 再読込）。15 秒未満は今までどおり too_fast", async () => {
    expect(STAMP_TTL_SEC).toBe(2 * 60 * 60);
    const t = await token();
    const stamp = await openStamp(t, T0, SECRET);
    expect(await checkStamp(stamp, t, at(STAMP_TTL_SEC * 1000), SECRET)).toEqual({ ok: true, openedAt: T0.getTime() });
    expect(await checkStamp(stamp, t, at(STAMP_TTL_SEC * 1000 + 1), SECRET)).toEqual({ ok: false, error: "stale" });
    expect(await checkStamp(stamp, t, at(MIN_FILL_SEC * 1000 - 1), SECRET)).toEqual({ ok: false, error: "too_fast" });
    expect(await checkStamp("x", t, at(MIN), SECRET)).toEqual({ ok: false, error: "too_fast" });

    const late = await send(t, T0, at(STAMP_TTL_SEC * 1000 + 1000));
    expect(late).toEqual({ status: 400, body: { ok: false, error: "stale", label: SURVEY_LABELS.stale } });
    expect(SURVEY_LABELS.stale).toBe("期限切れ 再読込");
    expect((sqlite.prepare("SELECT count(*) AS n FROM survey_responses").get() as { n: number }).n).toBe(0);
    // 開き直した印なら送れる
    const reopened = at(STAMP_TTL_SEC * 1000);
    expect((await send(t, reopened, at(STAMP_TTL_SEC * 1000 + 30 * 1000))).status).toBe(200);
  });
});
