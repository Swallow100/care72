// T184: 医療班が受け入れたら、どの入口からでも依頼中の受入依頼を「受入」にして一覧から外す。QR の頁の受入の既定は依頼の行き先。
// D1 は node:sqlite に種の全部（seed/full.ts）と、審査員でない医療班・行政のアカウント（テストだけ）。パスワードはテストだけの値。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fullSeedStatements } from "../../seed/full.ts";
import { JUDGE_ACCOUNTS } from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { chooseRole, login, type Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { officeActor } from "../office/scope.ts";
import { staffActor } from "./actor.ts";
import { acceptRequest, latestRequestOf, openRequestShelter, openRequests, sendRequest } from "./requests.ts";
import { receive } from "./store.ts";

const SECRET = "test-secret-t184-0123456789-0123456789-abcdef";
const NOW_SEC = 1_800_000_000;
const SEED_NOW = "2026-11-06T00:00:00.000Z";
const AT = "2026-11-06T02:00:00.000Z";
const LATER = "2026-11-06T02:30:00.000Z";
const TODAY = "2026-11-06";
const HOSPITAL = "かわなぎ総合病院";
const SCHOOL = "かわなぎ小学校";
const JUDGE_PW = "test-judge-pass-t184";

let judgeHash: string;
let statements: string[];
beforeAll(async () => {
  judgeHash = await hashPassword(JUDGE_PW, { iterations: 1000 });
  statements = await fullSeedStatements({ now: SEED_NOW });
}, 60_000);

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const x of statements) sqlite.exec(x);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`).run();
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-gov-2', NULL, 'government', '行政 2')`).run();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

async function judgeCm(): Promise<Principal> {
  const r = await login(db, { JUDGE_PASSWORD_HASH: judgeHash }, SECRET, { loginId: JUDGE_ACCOUNTS[0].loginId, password: JUDGE_PW }, NOW_SEC);
  if (!r.ok) throw new Error("ログインできない");
  const c = await chooseRole(db, { JUDGE_PASSWORD_HASH: judgeHash }, SECRET, r.token, "care_manager", NOW_SEC);
  if (!c) throw new Error("役を選べない");
  return c.principal;
}
const plainStaff = (role: "medical" | "government"): Principal => ({
  role,
  judge: false,
  admin: false,
  accountId: role === "medical" ? "acct-med-2" : "acct-gov-2",
  displayName: role === "medical" ? "医療班 2" : "行政 2",
  office: null,
  caseloadOf: null,
  personId: null,
  contactId: null,
});
const med = () => staffActor(plainStaff("medical"))!;
const gov = () => staffActor(plainStaff("government"))!;

async function ask(personId: string, shelter: string): Promise<string> {
  const r = await sendRequest(db, officeActor(await judgeCm())!, { personId, shelter }, AT);
  if (!r.ok) throw new Error(r.error);
  return r.requestId;
}
const request = (id: string) =>
  sqlite.prepare("SELECT state, shelter, custody_id, replied_role FROM custody_requests WHERE id = ?").get(id) as {
    state: string;
    shelter: string;
    custody_id: string | null;
    replied_role: string | null;
  };

describe("T184 の 1: 受け入れたら依頼の行を消す", () => {
  for (const via of ["qr", "search", "shelter"] as const) {
    it(`医療班が ${via} から受け入れると、依頼中は「受入」になって一覧から消え、行き先は実際の避難所に`, async () => {
      const id = await ask("p-01", HOSPITAL);
      expect(await openRequests(db, med(), TODAY)).toHaveLength(1);
      const r = await receive(db, med(), { personId: "p-01", shelter: SCHOOL, via }, LATER);
      expect(r.ok).toBe(true);
      expect(await openRequests(db, med(), TODAY)).toEqual([]);
      expect(request(id)).toEqual({ state: "accepted", shelter: SCHOOL, custody_id: r.ok ? r.custodyId : null, replied_role: "medical" });
      // 事業所の側の本人のページの返事も「受入」
      expect((await latestRequestOf(db, "p-01"))?.state).toBe("accepted");
    });
  }

  it("行政は依頼の宛先でないので、行政が受け入れても医療班の依頼は残る", async () => {
    const id = await ask("p-01", HOSPITAL);
    expect((await receive(db, gov(), { personId: "p-01", shelter: SCHOOL, via: "qr" }, LATER)).ok).toBe(true);
    expect(request(id).state).toBe("open");
    expect(await openRequests(db, med(), TODAY)).toHaveLength(1);
  });

  it("依頼の「受入」からは今までどおり 1 回だけ（受け持ちは 1 つ、行き先は依頼のまま）", async () => {
    const id = await ask("p-01", HOSPITAL);
    const r = await acceptRequest(db, med(), id, LATER);
    expect(r.ok).toBe(true);
    expect((sqlite.prepare("SELECT count(*) AS n FROM custody WHERE person_id = 'p-01'").get() as { n: number }).n).toBe(1);
    expect(request(id)).toMatchObject({ state: "accepted", shelter: HOSPITAL });
  });

  it("ほかの人の依頼は消さない", async () => {
    const other = await ask("p-03", HOSPITAL);
    await receive(db, med(), { personId: "p-01", shelter: SCHOOL, via: "qr" }, LATER);
    expect(request(other).state).toBe("open");
  });
});

describe("T184 の 1: QR の頁の受入の既定は依頼の行き先", () => {
  it("医療班には依頼中の行き先、行政・依頼の無い人・受け入れたあとは null", async () => {
    await ask("p-01", HOSPITAL);
    expect(await openRequestShelter(db, med(), "p-01")).toBe(HOSPITAL);
    expect(await openRequestShelter(db, gov(), "p-01")).toBeNull();
    expect(await openRequestShelter(db, med(), "p-03")).toBeNull();
    await receive(db, med(), { personId: "p-01", shelter: SCHOOL, via: "qr" }, LATER);
    expect(await openRequestShelter(db, med(), "p-01")).toBeNull();
  });
});
