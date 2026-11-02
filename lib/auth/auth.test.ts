import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, SEED_OFFICES, SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { judgeChoices } from "./choices.ts";
import {
  DEMO_CARE_MANAGER_ID,
  DEMO_FAMILY_CONTACT_ID,
  DEMO_JUDGE_ACCOUNT_ID,
  DEMO_OFFICE_ID,
  DEMO_SELF_PERSON_ID,
  isReservedLoginId,
  JUDGE_LOGIN_ID,
} from "./demo.ts";
import { allows, denied } from "./guard.ts";
import { hashPassword } from "./password.ts";
import { chooseJudgeRole, guestPrincipal, login, resolvePrincipal, type AuthEnv, type Principal } from "./principal.ts";
import {
  canViewPage,
  homePath,
  JUDGE_ROLES,
  NEEDS,
  PAGES,
  ROLES,
  type Need,
  type Page,
  type Role,
} from "./roles.ts";
import { caseloadScope, personInScope } from "./scope.ts";
import { SESSION_TTL_SEC, signSession, sessionTimes, passwordVersion } from "./session.ts";

// テストだけの値（本物のパスワード・鍵ではない）。回数を少なくして速くする
const SECRET = "test-secret-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;
const JUDGE_PW = "test-judge-pass-0001";
const CM_PW = "test-cm-pass-0001";
const PARTNER_PW = "test-partner-pass-0001";
const MEDICAL_PW = "test-medical-pass-0001";
const PARTNER_PERSON = "p-partner-1";

let judgeHash: string;
let cmHash: string;
let partnerHash: string;
let medicalHash: string;

beforeAll(async () => {
  [judgeHash, cmHash, partnerHash, medicalHash] = await Promise.all(
    [JUDGE_PW, CM_PW, PARTNER_PW, MEDICAL_PW].map((pw) => hashPassword(pw, { iterations: 1000 })),
  );
});

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

/** 種に、協力事業所のケアマネのログインと、協力事業所の本人 1 人（テストだけ）と、医療班のアカウントを足す */
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements({ passwordHashes: { [DEMO_CARE_MANAGER_ID]: cmHash } })) sqlite.exec(s);
  sqlite
    .prepare("UPDATE accounts SET login_id = 'partner1', password_hash = ? WHERE id = 'acct-partner-cm'")
    .run(partnerHash);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01')`,
    )
    .run(PARTNER_PERSON);
  sqlite
    .prepare(
      `INSERT INTO accounts (id, office_id, role, display_name, login_id, password_hash)
       VALUES ('acct-med-1', NULL, 'medical', '医療班 1', 'med1', ?)`,
    )
    .run(medicalHash);
  db = d1FromSqlite(sqlite);
});

async function loginOk(loginId: string, password: string) {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}

async function asJudge(role: (typeof JUDGE_ROLES)[number] | null): Promise<{ token: string; principal: Principal }> {
  const r = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
  if (role === null) return r;
  const c = await chooseJudgeRole(db, env(), SECRET, r.token, role, NOW);
  if (!c) throw new Error("役を選べない");
  return c;
}

describe("デモの決まった ID と種", () => {
  it("デモ事業所・山本・山田 ハナ・山田の娘・審査員の行が種にある", () => {
    expect(SEED_OFFICES.find((o) => o.id === DEMO_OFFICE_ID)?.kind).toBe("demo");
    expect(SEED_ACCOUNTS.find((a) => a.id === DEMO_CARE_MANAGER_ID)).toMatchObject({
      office_id: DEMO_OFFICE_ID,
      role: "care_manager",
      display_name: "山本",
    });
    expect(SEED_ACCOUNTS.find((a) => a.id === DEMO_JUDGE_ACCOUNT_ID)).toMatchObject({
      office_id: DEMO_OFFICE_ID,
      role: "judge",
      login_id: null,
      password_hash: null,
    });
    const hana = SEED_PEOPLE.find((p) => p.person.id === DEMO_SELF_PERSON_ID)!;
    expect(hana.person).toMatchObject({ name: "山田 ハナ", office_id: DEMO_OFFICE_ID });
    expect(hana.contacts.find((c) => c.id === DEMO_FAMILY_CONTACT_ID)).toMatchObject({ kind: "family", relation: "娘" });
  });

  it("協力事業所はケアマネ 1 人（名前は空）だけで、利用者がいない", () => {
    const partner = SEED_OFFICES.find((o) => o.kind !== "demo")!;
    expect(partner).toMatchObject({ id: "office-partner", name: "協力事業所" });
    const accounts = SEED_ACCOUNTS.filter((a) => a.office_id === partner.id);
    expect(accounts).toEqual([expect.objectContaining({ role: "care_manager", display_name: "" })]);
    expect(SEED_PEOPLE.filter((p) => p.person.office_id === partner.id)).toEqual([]);
  });

  it("種にパスワードもハッシュも書かない。渡したハッシュだけが入る", () => {
    for (const a of SEED_ACCOUNTS) expect(a.password_hash).toBeNull();
    expect(seedStatements().join("\n")).not.toContain("pbkdf2");
    const withHash = seedStatements({ passwordHashes: { [DEMO_CARE_MANAGER_ID]: "pbkdf2-sha256:1:AA:BB" } }).join("\n");
    expect(withHash).toContain("pbkdf2-sha256:1:AA:BB");
    expect(() => seedStatements({ passwordHashes: { "acct-nobody": "x" } })).toThrow();
  });

  it("審査員の ID はアカウントの表に使わせない", () => {
    expect(isReservedLoginId(JUDGE_LOGIN_ID)).toBe(true);
    expect(isReservedLoginId(` ${JUDGE_LOGIN_ID.toUpperCase()} `)).toBe(true);
    expect(SEED_ACCOUNTS.some((a) => a.login_id !== null && isReservedLoginId(a.login_id))).toBe(false);
  });
});

describe("ログイン", () => {
  it("ケアマネは表のハッシュで入り、担当一覧へ", async () => {
    const r = await loginOk("yamamoto", CM_PW);
    expect(r.path).toBe("/");
    expect(r.principal).toMatchObject({
      role: "care_manager",
      admin: true,
      judge: false,
      accountId: DEMO_CARE_MANAGER_ID,
      displayName: "山本",
      office: { id: DEMO_OFFICE_ID, name: "デモ事業所", kind: "demo" },
      caseloadOf: DEMO_CARE_MANAGER_ID,
    });
  });

  it("審査員は env のハッシュで入り、役選択へ", async () => {
    const r = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
    expect(r.path).toBe("/login/role");
    expect(r.principal).toMatchObject({
      role: "unselected",
      judge: true,
      accountId: DEMO_JUDGE_ACCOUNT_ID,
      office: { id: DEMO_OFFICE_ID },
      caseloadOf: null,
    });
  });

  it("行政・医療班は受け持ちへ（事業所をまたぐので事業所は無い）", async () => {
    const r = await loginOk("med1", MEDICAL_PW);
    expect(r.path).toBe("/staff");
    expect(r.principal).toMatchObject({ role: "medical", office: null, caseloadOf: null });
  });

  it("違うパスワード・無い ID・ハッシュの無いアカウント・空は通さない", async () => {
    const fail = async (loginId: string, password: string, e: AuthEnv = env()) =>
      expect((await login(db, e, SECRET, { loginId, password }, NOW)).ok).toBe(false);
    await fail("yamamoto", JUDGE_PW);
    await fail("yamamoto", `${CM_PW} `);
    await fail(JUDGE_LOGIN_ID, CM_PW);
    await fail("nobody", CM_PW);
    await fail("", CM_PW);
    await fail("yamamoto", "");
    await fail("Yamamoto", CM_PW);
    // env に審査員のハッシュが無ければ審査員は入れない
    await fail(JUDGE_LOGIN_ID, JUDGE_PW, {});
    await fail(JUDGE_LOGIN_ID, JUDGE_PW, { JUDGE_PASSWORD_HASH: "  " });
    // ハッシュの無いアカウント（種のままの山本）
    sqlite.prepare("UPDATE accounts SET password_hash = NULL WHERE id = ?").run(DEMO_CARE_MANAGER_ID);
    await fail("yamamoto", CM_PW);
  });

  it("書き手の行（role が judge）はアカウントのログインに使えない", async () => {
    sqlite
      .prepare("UPDATE accounts SET login_id = 'judge-row', password_hash = ? WHERE id = ?")
      .run(cmHash, DEMO_JUDGE_ACCOUNT_ID);
    expect((await login(db, env(), SECRET, { loginId: "judge-row", password: CM_PW }, NOW)).ok).toBe(false);
  });

  it("ID の前後の空白は落とす", async () => {
    expect((await login(db, env(), SECRET, { loginId: " yamamoto ", password: CM_PW }, NOW)).ok).toBe(true);
  });
});

describe("cookie からの役", () => {
  it("cookie が無い・壊れている・切れているときはゲスト（デモ事業所を見るだけ）", async () => {
    const { token } = await loginOk("yamamoto", CM_PW);
    for (const t of [null, "", "garbage", `${token}x`]) {
      expect((await resolvePrincipal(db, env(), SECRET, t, NOW)).role).toBe("guest");
    }
    expect((await resolvePrincipal(db, env(), SECRET, token, NOW + SESSION_TTL_SEC)).role).toBe("guest");
    expect((await resolvePrincipal(db, env(), `${SECRET}x`, token, NOW)).role).toBe("guest");
    const guest = await resolvePrincipal(db, env(), SECRET, null, NOW);
    expect(guest).toMatchObject({
      role: "guest",
      judge: false,
      accountId: null,
      office: { id: DEMO_OFFICE_ID, kind: "demo" },
      caseloadOf: DEMO_CARE_MANAGER_ID,
    });
  });

  it("ログインの cookie で同じ役に戻る", async () => {
    const { token } = await loginOk("yamamoto", CM_PW);
    expect(await resolvePrincipal(db, env(), SECRET, token, NOW + 60)).toMatchObject({
      role: "care_manager",
      accountId: DEMO_CARE_MANAGER_ID,
    });
  });

  it("パスワードを変える・アカウントを消すと、前の cookie は使えない", async () => {
    const { token } = await loginOk("yamamoto", CM_PW);
    sqlite.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(partnerHash, DEMO_CARE_MANAGER_ID);
    expect((await resolvePrincipal(db, env(), SECRET, token, NOW)).role).toBe("guest");

    const partner = await loginOk("partner1", PARTNER_PW);
    sqlite.prepare("UPDATE accounts SET login_id = NULL, password_hash = NULL WHERE id = 'acct-partner-cm'").run();
    expect((await resolvePrincipal(db, env(), SECRET, partner.token, NOW)).role).toBe("guest");
  });

  it("審査員の cookie は、env の審査員のハッシュが変わる・無くなると使えない", async () => {
    const { token } = await asJudge("care_manager");
    expect((await resolvePrincipal(db, env(), SECRET, token, NOW)).role).toBe("care_manager");
    expect((await resolvePrincipal(db, { JUDGE_PASSWORD_HASH: cmHash }, SECRET, token, NOW)).role).toBe("guest");
    expect((await resolvePrincipal(db, {}, SECRET, token, NOW)).role).toBe("guest");
  });

  it("自分で作った中身の cookie（審査員の役を勝手に付ける）は、鍵を知らなければ作れない", async () => {
    const forged = await signSession(
      { v: 1, k: "judge", r: "care_manager", pv: await passwordVersion(judgeHash), ...sessionTimes(NOW) },
      "someone-else-secret-0123456789-0123456789",
    );
    expect((await resolvePrincipal(db, env(), SECRET, forged, NOW)).role).toBe("guest");
  });
});

describe("審査員の役選択", () => {
  it("4 つの役で、それぞれの入口と中身", async () => {
    const cm = await asJudge("care_manager");
    expect(cm.principal).toMatchObject({
      role: "care_manager",
      judge: true,
      admin: false,
      accountId: DEMO_JUDGE_ACCOUNT_ID,
      displayName: "山本",
      caseloadOf: DEMO_CARE_MANAGER_ID,
      office: { id: DEMO_OFFICE_ID },
    });
    const med = await asJudge("medical");
    expect(med.principal).toMatchObject({ role: "medical", judge: true, caseloadOf: null, personId: null });
    const self = await asJudge("self");
    expect(self.principal).toMatchObject({ role: "self", personId: DEMO_SELF_PERSON_ID, displayName: "山田 ハナ" });
    const fam = await asJudge("family");
    expect(fam.principal).toMatchObject({
      role: "family",
      personId: DEMO_SELF_PERSON_ID,
      contactId: DEMO_FAMILY_CONTACT_ID,
      displayName: "森 恵子",
    });
    expect([cm, med, self, fam].map((r) => homePath(r.principal.role))).toEqual(["/", "/staff", "/me", "/family"]);
  });

  it("選び直せる（ケアマネ → 医療班 → 本人）。cookie に残るのは最後の役", async () => {
    const first = await asJudge("care_manager");
    const second = await chooseJudgeRole(db, env(), SECRET, first.token, "medical", NOW + 10);
    expect(second?.path).toBe("/staff");
    const third = await chooseJudgeRole(db, env(), SECRET, second!.token, "self", NOW + 20);
    expect(third?.path).toBe("/me");
    expect((await resolvePrincipal(db, env(), SECRET, third!.token, NOW + 30)).role).toBe("self");
    // 選び直すと 7 日はそこから
    expect((await resolvePrincipal(db, env(), SECRET, third!.token, NOW + SESSION_TTL_SEC + 10)).role).toBe("self");
  });

  it("審査員でなければ役を選べない", async () => {
    const { token } = await loginOk("yamamoto", CM_PW);
    expect(await chooseJudgeRole(db, env(), SECRET, token, "care_manager", NOW)).toBeNull();
    expect(await chooseJudgeRole(db, env(), SECRET, null, "care_manager", NOW)).toBeNull();
    const judge = await asJudge(null);
    expect(await chooseJudgeRole(db, {}, SECRET, judge.token, "care_manager", NOW)).toBeNull();
  });

  it("役選択の画面の 4 つ（名前は種から）", async () => {
    expect(await judgeChoices(db)).toEqual([
      { role: "care_manager", label: "ケアマネ", sub: "山本" },
      { role: "medical", label: "医療班", sub: "受け持ち" },
      { role: "self", label: "本人スマホ", sub: "山田 ハナ" },
      { role: "family", label: "家族スマホ", sub: "娘 森 恵子" },
    ]);
  });
});

describe("役ごとの到達", () => {
  const PAGE_TABLE: Record<Role, Page[]> = {
    guest: ["caseload", "person", "drill", "me"],
    care_manager: ["caseload", "person", "drill"],
    government: ["person", "staff"],
    medical: ["person", "staff"],
    self: ["me"],
    family: ["family"],
    unselected: [],
  };
  const NEED_TABLE: Record<Role, Need[]> = {
    guest: ["read"],
    care_manager: ["read", "save", "ai"],
    government: ["read", "save", "ai"],
    medical: ["read", "save", "ai"],
    self: ["read", "save", "recording"],
    family: ["read", "save", "recording"],
    unselected: [],
  };

  it("開ける画面の表", () => {
    for (const role of ROLES) {
      expect(PAGES.filter((page) => canViewPage(role, page)), role).toEqual(PAGE_TABLE[role]);
    }
  });

  it("入口の画面は、その役が開ける画面", () => {
    const pathOf: Record<string, Page> = { "/": "caseload", "/staff": "staff", "/me": "me", "/family": "family" };
    for (const role of ROLES) {
      const path = homePath(role);
      if (role === "unselected") expect(path).toBe("/login/role");
      else expect(canViewPage(role, pathOf[path]), role).toBe(true);
    }
  });

  it("できることの表。ゲストは読むだけ", () => {
    const fake = (role: Role) => ({ role }) as Principal;
    for (const role of ROLES) {
      expect(NEEDS.filter((n) => allows(fake(role), n)), role).toEqual(NEED_TABLE[role]);
    }
  });

  it("API はゲストの保存・Claude・録音を 401、役を選ぶ前の審査員を 403 で断る", async () => {
    const guest = await guestPrincipal(db);
    expect(denied(guest, "read")).toBeNull();
    for (const need of ["save", "ai", "recording"] as const) {
      const r = denied(guest, need)!;
      expect(r.status, need).toBe(401);
      expect(await r.json()).toMatchObject({ error: "login_required" });
    }
    const unselected = (await asJudge(null)).principal;
    expect(denied(unselected, "read")?.status).toBe(403);
    expect(denied(unselected, "ai")?.status).toBe(403);
    // 審査員のログインは Claude を呼ぶ所を開ける鍵（ケアマネの役で）
    const judgeCm = (await asJudge("care_manager")).principal;
    expect(denied(judgeCm, "ai")).toBeNull();
    expect(denied(judgeCm, "save")).toBeNull();
    expect(denied(judgeCm, "recording")?.status).toBe(403);
    const self = (await asJudge("self")).principal;
    expect(denied(self, "recording")).toBeNull();
    expect(denied(self, "ai")?.status).toBe(403);
  });
});

describe("事業所の壁", () => {
  it("ゲスト・デモのケアマネ・審査員は、協力事業所の本人を読めない（在っても null = 404）", async () => {
    const who = [
      await guestPrincipal(db),
      (await loginOk("yamamoto", CM_PW)).principal,
      (await asJudge("care_manager")).principal,
    ];
    for (const p of who) {
      expect(await personInScope(db, p, PARTNER_PERSON), p.role).toBeNull();
      expect(await personInScope(db, p, "p-nothing"), p.role).toBeNull();
      expect((await personInScope(db, p, "p-05"))?.name, p.role).toBe("伊藤 フミ");
    }
  });

  it("協力事業所のケアマネはデモ事業所の本人を読めず、自分の事業所の本人だけ", async () => {
    const partner = (await loginOk("partner1", PARTNER_PW)).principal;
    expect(partner.office).toMatchObject({ id: "office-partner", kind: "regular" });
    for (const id of SEED_PEOPLE.map((p) => p.person.id)) expect(await personInScope(db, partner, id), id).toBeNull();
    expect((await personInScope(db, partner, PARTNER_PERSON))?.name).toBe("架空 太郎");
  });

  it("本人・家族のスマホは自分の本人だけ。医療班は受け持ちができるまで誰も読めない", async () => {
    for (const role of ["self", "family"] as const) {
      const p = (await asJudge(role)).principal;
      expect((await personInScope(db, p, DEMO_SELF_PERSON_ID))?.name, role).toBe("山田 ハナ");
      expect(await personInScope(db, p, "p-02"), role).toBeNull();
    }
    const med = [(await asJudge("medical")).principal, (await loginOk("med1", MEDICAL_PW)).principal];
    for (const p of med) {
      expect(await personInScope(db, p, DEMO_SELF_PERSON_ID)).toBeNull();
      expect(await personInScope(db, p, PARTNER_PERSON)).toBeNull();
    }
    expect(await personInScope(db, (await asJudge(null)).principal, DEMO_SELF_PERSON_ID)).toBeNull();
  });

  it("担当一覧も事業所とケアマネで絞る", async () => {
    const today = "2026-11-02";
    const guest = await guestPrincipal(db);
    const demo = await loadCaseload(db, caseloadScope(guest)!, today);
    expect(demo?.rows).toHaveLength(10);
    expect(demo?.rows.map((r) => r.id)).not.toContain(PARTNER_PERSON);

    const partner = (await loginOk("partner1", PARTNER_PW)).principal;
    const mine = await loadCaseload(db, caseloadScope(partner)!, today);
    expect(mine?.office.name).toBe("協力事業所");
    expect(mine?.rows.map((r) => r.id)).toEqual([PARTNER_PERSON]);

    // 違う事業所のケアマネの id を渡しても読めない
    expect(await loadCaseload(db, { officeId: "office-partner", careManagerId: DEMO_CARE_MANAGER_ID }, today)).toBeNull();
    expect(await loadCaseload(db, { officeId: DEMO_OFFICE_ID, careManagerId: "acct-partner-cm" }, today)).toBeNull();

    // 担当一覧を開けない役には範囲が無い
    expect(caseloadScope((await asJudge("medical")).principal)).toBeNull();
    expect(caseloadScope((await asJudge(null)).principal)).toBeNull();
    expect(caseloadScope((await asJudge("care_manager")).principal)).toEqual({
      officeId: DEMO_OFFICE_ID,
      careManagerId: DEMO_CARE_MANAGER_ID,
    });
  });

  it("デモ事業所の kind が demo でなければ、ゲストに何も見せない", async () => {
    sqlite.prepare("UPDATE offices SET kind = 'regular' WHERE id = ?").run(DEMO_OFFICE_ID);
    const guest = await guestPrincipal(db);
    expect(guest.office).toBeNull();
    expect(caseloadScope(guest)).toBeNull();
    expect(await personInScope(db, guest, DEMO_SELF_PERSON_ID)).toBeNull();
    expect((await login(db, env(), SECRET, { loginId: JUDGE_LOGIN_ID, password: JUDGE_PW }, NOW)).ok).toBe(false);
  });
});
