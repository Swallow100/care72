// T95: 見本のケアマネ（山本、種の固定のアカウント）でも、審査員と同じ役変更（ケアマネ・医療班・本人スマホ・家族スマホ）を出す。
// - 役を替えた山本は審査員と同じ壁（lib/auth/wall.ts）: 医療班の検索・受入・受け持ち・本人のページはデモの人だけ、本人・家族は山田 ハナ
// - ケアマネの役の山本は今までどおり（壁の外。山本が作った本物のアンケートが見える）
// - 審査員の流れ・毎朝 4 時の戻し・固定のアカウントの守りは変えない。ほかのケアマネ（固定でない）は役を替えられない
// D1 は node:sqlite に種の 10 人と、協力事業所の本人 1 人・ケアマネのログイン・医療班のアカウント・デモ事業所の 2 人目のログイン（テストだけ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { staffActor } from "../custody/actor.ts";
import { loadStaffBoard } from "../custody/board.ts";
import { searchPeople } from "../custody/search.ts";
import { receive } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { officeActor } from "../office/scope.ts";
import { linkReplacesLogin } from "../qr/phone-open.ts";
import { PHONE_LINK_INVALID_PATH } from "../qr/phone-link.ts";
import { resetCheckOffice, type SeedBucket } from "../seed/reset.ts";
import { createSurveyShare, loadSurveyOverview, surveyOfficeOf } from "../survey/store.ts";
import { CHECK_OFFICE_ID, CHECK_TARGETS, JUDGE_LOGIN_ID, LOGIN_CARE_MANAGER_ID, ROLE_SWITCH_ACCOUNT_IDS } from "./demo.ts";
import { hashPassword } from "./password.ts";
import { pageExit, phoneGoneExit } from "./phone-gate.ts";
import { chooseJudgeRole, chooseRole, login, resolvePrincipal, type Principal } from "./principal.ts";
import { caseloadScope, personInScope, personScope } from "./scope.ts";
import { decodeSession, passwordVersion, sessionTimes, signSession } from "./session.ts";
import type { JudgeRole } from "./roles.ts";
import { canChooseRole, isWalled } from "./wall.ts";

// T144: ログインの山本は確認用の事業所（審査員のデモ事業所と同じ種の写し）。役を替えた山本の本人・家族・壁もその事業所の中
const YAMAMOTO = LOGIN_CARE_MANAGER_ID;
const YAMAMOTO_OFFICE = CHECK_OFFICE_ID;

// テストだけの値（本物のパスワード・鍵ではない）。回数を少なくして速くする
const SECRET = "test-secret-t95-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;
const TODAY = "2026-11-04";
const AT = "2026-11-04T01:00:00.000Z";
const JUDGE_PW = "test-judge-pass-t95";
const CM_PW = "test-cm-pass-t95";
const OTHER_PW = "test-other-pass-t95";
const PARTNER_PERSON = "p-partner-1";
const SHELTER = "みどり小学校";

let judgeHash: string;
let cmHash: string;
let otherHash: string;

beforeAll(async () => {
  [judgeHash, cmHash, otherHash] = await Promise.all([JUDGE_PW, CM_PW, OTHER_PW].map((pw) => hashPassword(pw, { iterations: 1000 })));
});

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements({ passwordHashes: { [LOGIN_CARE_MANAGER_ID]: cmHash } })) sqlite.exec(s);
  sqlite.prepare("UPDATE accounts SET login_id = 'partner1', password_hash = ? WHERE id = 'acct-partner-cm'").run(otherHash);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, ledger)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01',
               '{"basic":{},"care":{},"medical":{"devices":[],"medications":[]},"evacuation":{"hazards":[]},"notes":[],"pending":[]}')`,
    )
    .run(PARTNER_PERSON);
  sqlite
    .prepare(
      `INSERT INTO accounts (id, office_id, role, display_name, login_id, password_hash)
       VALUES ('acct-med-1', NULL, 'medical', '医療班 1', 'med1', ?)`,
    )
    .run(otherHash);
  // デモ事業所の固定でないケアマネ（事業所の画面で足した人と同じ形。毎朝の戻しで消える）
  sqlite
    .prepare(
      `INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash)
       VALUES ('acct-demo-cm-3', 'office-demo', 'care_manager', 1, '架空 三', 'democm3', ?)`,
    )
    .run(otherHash);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

async function loginOk(loginId: string, password: string) {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}

/** 山本で入り、役を選ぶ（null はケアマネの役のまま） */
async function asYamamoto(role: JudgeRole | null): Promise<{ token: string; principal: Principal; path: string }> {
  const r = await loginOk("yamamoto", CM_PW);
  if (role === null) return r;
  const c = await chooseRole(db, env(), SECRET, r.token, role, NOW + 10);
  if (!c) throw new Error("役を選べない");
  return c;
}

const again = (token: string, at = NOW + 20) => resolvePrincipal(db, env(), SECRET, token, at);
const nullBucket: SeedBucket = {
  head: async () => null,
  list: async () => ({ objects: [], truncated: false }),
  delete: async () => undefined,
};

describe("山本の役変更", () => {
  it("役を選べるのは山本だけ（固定の一覧のうち、ログインの ID がある見本のケアマネ）", () => {
    expect(ROLE_SWITCH_ACCOUNT_IDS).toEqual([YAMAMOTO]);
  });

  it("ケアマネの役の山本は今までどおり（管理者・自分の担当一覧・壁の外）で、役を選べる", async () => {
    const { principal } = await asYamamoto(null);
    expect(principal).toMatchObject({
      role: "care_manager",
      judge: false,
      admin: true,
      accountId: YAMAMOTO,
      displayName: "山本",
      caseloadOf: YAMAMOTO,
      office: { id: YAMAMOTO_OFFICE, kind: "demo" },
    });
    expect(principal.switched).toBeFalsy();
    expect(canChooseRole(principal)).toBe(true);
    expect(isWalled(principal)).toBe(false);
    expect(officeActor(principal)).toMatchObject({ admin: true, placeEdit: true, walled: false });
  });

  it("医療班・本人・家族の役で、それぞれの入口と中身（審査員と同じ見本の人。書き手は山本のまま）", async () => {
    const med = await asYamamoto("medical");
    expect(med.path).toBe("/staff");
    expect(med.principal).toMatchObject({
      role: "medical",
      judge: false,
      admin: false,
      switched: true,
      accountId: YAMAMOTO,
      displayName: "山本",
      office: { id: YAMAMOTO_OFFICE },
      caseloadOf: null,
      personId: null,
    });
    const self = await asYamamoto("self");
    expect(self.path).toBe("/me");
    expect(self.principal).toMatchObject({ role: "self", switched: true, personId: CHECK_TARGETS.selfPersonId, displayName: "山田 ハナ" });
    const fam = await asYamamoto("family");
    expect(fam.path).toBe("/family");
    expect(fam.principal).toMatchObject({
      role: "family",
      switched: true,
      personId: CHECK_TARGETS.selfPersonId,
      contactId: CHECK_TARGETS.familyContactId,
      displayName: "森 恵子",
    });
    for (const r of [med, self, fam]) {
      expect(r.principal.judge).toBe(false);
      expect(isWalled(r.principal)).toBe(true);
      expect(canChooseRole(r.principal)).toBe(true);
      // 次の要求でも同じ役（cookie に役が残る）
      expect(await again(r.token)).toEqual(r.principal);
      // 事業所の画面（担当一覧の役）には入れない
      expect(officeActor(r.principal)).toBeNull();
      expect(caseloadScope(r.principal)).toBeNull();
    }
    // 本人・家族は山田 ハナだけ
    expect(await personInScope(db, self.principal, CHECK_TARGETS.selfPersonId)).not.toBeNull();
    expect(await personInScope(db, self.principal, "chk-p-02")).toBeNull();
  });

  it("選び直せる（医療班 → 本人 → ケアマネ）。ケアマネに戻ると、ログインしたときと同じ形", async () => {
    const fresh = await asYamamoto(null);
    const med = await asYamamoto("medical");
    const self = await chooseRole(db, env(), SECRET, med.token, "self", NOW + 20);
    expect(self?.principal.role).toBe("self");
    const back = await chooseRole(db, env(), SECRET, self!.token, "care_manager", NOW + 30);
    expect(back?.path).toBe("/");
    expect(back?.principal).toEqual(fresh.principal);
    expect(await again(back!.token, NOW + 40)).toEqual(fresh.principal);
    // cookie にケアマネの役の印は残さない（前の形と同じ）
    const payload = await decodeSession(back!.token, SECRET);
    expect(payload).toMatchObject({ k: "account", a: YAMAMOTO });
    expect(payload && "r" in payload).toBe(false);
  });

  it("T95 の前の山本の cookie（役の無い形）は今までどおりケアマネの役", async () => {
    const { token, principal } = await asYamamoto(null);
    expect(await again(token)).toEqual(principal);
  });

  it("山本のパスワードが変わると、役を替えたセッションも切れる", async () => {
    const med = await asYamamoto("medical");
    sqlite.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(otherHash, YAMAMOTO);
    expect(await again(med.token)).toBeNull();
  });

  it("デモ事業所の kind が demo でなければ、山本は役を選べず、前に替えた役の cookie も使えない", async () => {
    const med = await asYamamoto("medical");
    const cm = await asYamamoto(null);
    sqlite.prepare("UPDATE offices SET kind = 'regular' WHERE id = ?").run(YAMAMOTO_OFFICE);
    expect(await again(med.token)).toBeNull();
    const plain = await again(cm.token);
    expect(plain?.role).toBe("care_manager");
    expect(canChooseRole(plain!)).toBe(false);
    expect(await chooseRole(db, env(), SECRET, cm.token, "medical", NOW + 30)).toBeNull();
  });
});

describe("替えた役の壁（審査員と同じ）", () => {
  it("医療班の山本は、ほかの事業所の人を探せず・受け入れられない（not_found）", async () => {
    const { principal } = await asYamamoto("medical");
    const actor = staffActor(principal)!;
    expect(actor).toMatchObject({ accountId: YAMAMOTO, role: "medical", name: "山本", judge: false, walled: true });
    expect(personScope(principal)).toEqual({ kind: "custody", holderId: YAMAMOTO, demoOnly: true, wallOffice: YAMAMOTO_OFFICE });
    expect((await searchPeople(db, actor, { text: "カクウ", birth: null }, TODAY)).hits).toEqual([]);
    expect(await receive(db, actor, { personId: PARTNER_PERSON, shelter: SHELTER, via: "search" }, AT)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(Number((sqlite.prepare("SELECT count(*) AS n FROM custody").get() as { n: number }).n)).toBe(0);
    // 見本の流れ（山田 ハナを探して受け入れ、本人のページを開ける）は審査員と同じ
    const hits = await searchPeople(db, actor, { text: "ヤマダ", birth: null }, TODAY);
    expect(hits.hits.map((h) => h.id)).toEqual([CHECK_TARGETS.selfPersonId]);
    expect((await receive(db, actor, { personId: CHECK_TARGETS.selfPersonId, shelter: SHELTER, via: "search" }, AT)).ok).toBe(true);
    expect(await personInScope(db, principal, CHECK_TARGETS.selfPersonId)).not.toBeNull();
  });

  it("ほかの事業所の人の受け持ちが山本の名で開いていても、受け持ちの一覧・本人のページに出ない", async () => {
    const { principal } = await asYamamoto("medical");
    sqlite
      .prepare(
        `INSERT INTO custody (id, person_id, holder_id, holder_role, shelter, via, received_at)
         VALUES ('cu-legacy', ?, ?, 'medical', ?, 'search', ?)`,
      )
      .run(PARTNER_PERSON, YAMAMOTO, SHELTER, AT);
    expect(await personInScope(db, principal, PARTNER_PERSON)).toBeNull();
    const board = await loadStaffBoard(db, staffActor(principal)!, TODAY, AT);
    expect(board.rows.map((r) => r.personId)).toEqual([]);
  });

  it("本人・家族の役の山本は、本人・家族のリンクを開くと今のログインを失う人（切替の 1 枚を出す）", async () => {
    for (const role of ["care_manager", "medical", "self", "family"] as const) {
      const { principal } = await asYamamoto(role === "care_manager" ? null : role);
      expect(linkReplacesLogin(principal), role).toBe(true);
    }
  });

  it("本人・家族の頁の送り先は審査員と同じ（役が違えば役選択、本人の行が読めなければ役選択）", async () => {
    const cm = await asYamamoto(null);
    const self = await asYamamoto("self");
    expect(pageExit("me", self.principal, null)).toBeNull();
    expect(pageExit("family", self.principal, null)).toBe("/login/role");
    expect(pageExit("me", cm.principal, null)).toBe("/login/role");
    expect(pageExit("staff", self.principal, null)).toBe("/me");
    expect(phoneGoneExit(self.principal)).toBe("/login/role");
    // 山本の本人・家族の役のセッションが切れた（期限・パスワードの変更）ときは、審査員と同じ「無効」の頁
    const lost = await decodeSession(self.token, SECRET);
    expect(pageExit("me", null, lost)).toBe(PHONE_LINK_INVALID_PATH);
    expect(pageExit("me", null, await decodeSession(cm.token, SECRET))).toBe("/login");
  });
});

describe("アンケート（山本の本物）", () => {
  it("ケアマネの役の山本からは見え、役を替えている間は見えず（壁の中・事業所の画面に入れない）、ケアマネに戻るとまた見える", async () => {
    const real = await createSurveyShare(
      db,
      { officeId: surveyOfficeOf(YAMAMOTO_OFFICE), memo: "包括配布", createdBy: YAMAMOTO, createdRole: "care_manager" },
      new Date(AT),
    );
    const trial = await createSurveyShare(
      db,
      { officeId: surveyOfficeOf(YAMAMOTO_OFFICE), memo: "試し", createdBy: "acct-judge", createdRole: "judge" },
      new Date(AT),
    );
    if (!real.ok || !trial.ok) throw new Error("リンクを作れない");
    const view = async (p: Principal) => {
      const a = officeActor(p);
      const viewer = { walled: a ? a.walled === true : isWalled(p), admin: p.admin, accountId: p.accountId };
      return (await loadSurveyOverview(db, surveyOfficeOf(YAMAMOTO_OFFICE), viewer, AT)).shares.map((s) => s.token).sort();
    };
    const cm = await asYamamoto(null);
    expect(await view(cm.principal)).toEqual([real.token, trial.token].sort());
    const med = await chooseRole(db, env(), SECRET, cm.token, "medical", NOW + 10);
    // 事業所の画面（アンケートの欄）はケアマネの役だけ。壁の中なので、見えても試しだけ
    expect(officeActor(med!.principal)).toBeNull();
    expect(await view(med!.principal)).toEqual([trial.token]);
    const back = await chooseRole(db, env(), SECRET, med!.token, "care_manager", NOW + 20);
    expect(await view(back!.principal)).toEqual([real.token, trial.token].sort());
  });
});

describe("ほかの人は変わらない", () => {
  it("ほかのケアマネ（固定でない。協力事業所・デモ事業所で足した人）と医療班は役を選べない", async () => {
    for (const [id, pw] of [
      ["partner1", OTHER_PW],
      ["democm3", OTHER_PW],
      ["med1", OTHER_PW],
    ] as const) {
      const { token, principal } = await loginOk(id, pw);
      expect(canChooseRole(principal), id).toBe(false);
      expect(isWalled(principal), id).toBe(false);
      for (const role of ["care_manager", "medical", "self", "family"] as const) {
        expect(await chooseRole(db, env(), SECRET, token, role, NOW + 10), `${id} ${role}`).toBeNull();
      }
    }
  });

  it("役の付いたアカウントの cookie は、山本でなければ通らない（作れるのは鍵を持つサーバーだけだが、作っても入れない）", async () => {
    const pv = await passwordVersion(otherHash);
    for (const a of ["acct-partner-cm", "acct-demo-cm-3"]) {
      // 役の無い同じ cookie は通る（pv は合っている）
      const plain = await signSession({ v: 1, k: "account", a, pv, ...sessionTimes(NOW) }, SECRET);
      expect((await again(plain))?.role, a).toBe("care_manager");
      const forged = await signSession({ v: 1, k: "account", a, r: "medical", pv, ...sessionTimes(NOW) }, SECRET);
      expect(await again(forged), a).toBeNull();
    }
  });

  it("審査員の役選択は今までどおり（chooseRole でも chooseJudgeRole でも同じ。審査員の印のまま）", async () => {
    const j = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
    expect(j.principal.role).toBe("unselected");
    expect(canChooseRole(j.principal)).toBe(true);
    for (const role of ["care_manager", "medical", "self", "family"] as const) {
      const a = await chooseRole(db, env(), SECRET, j.token, role, NOW + 10);
      const b = await chooseJudgeRole(db, env(), SECRET, j.token, role, NOW + 10);
      expect(a?.principal, role).toEqual(b?.principal);
      expect(a?.principal.judge).toBe(true);
      expect(a?.principal.switched).toBeFalsy();
      expect(isWalled(a!.principal)).toBe(true);
    }
    // chooseJudgeRole は審査員のセッションだけ（山本には今までどおり null）
    const cm = await asYamamoto(null);
    expect(await chooseJudgeRole(db, env(), SECRET, cm.token, "medical", NOW + 10)).toBeNull();
  });
});

describe("毎朝 4 時の戻し", () => {
  it("医療班の山本が受け入れた見本の人の受け持ちは戻しで消え、山本のアカウントと本物のアンケートは残る", async () => {
    const { principal } = await asYamamoto("medical");
    expect((await receive(db, staffActor(principal)!, { personId: CHECK_TARGETS.selfPersonId, shelter: SHELTER, via: "search" }, AT)).ok).toBe(true);
    const real = await createSurveyShare(
      db,
      { officeId: surveyOfficeOf(YAMAMOTO_OFFICE), memo: "包括配布", createdBy: YAMAMOTO, createdRole: "care_manager" },
      new Date(AT),
    );
    if (!real.ok) throw new Error("リンクを作れない");
    await resetCheckOffice(db, nullBucket, "2026-11-04T19:00:00.000Z");
    const n = (sql: string, ...args: string[]) => Number((sqlite.prepare(sql).get(...args) as { n: number }).n);
    expect(n("SELECT count(*) AS n FROM custody WHERE holder_id = ? AND released_at IS NULL", YAMAMOTO)).toBe(0);
    expect(n("SELECT count(*) AS n FROM accounts WHERE id = ?", YAMAMOTO)).toBe(1);
    expect(n("SELECT count(*) AS n FROM survey_shares WHERE token = ?", real.token)).toBe(1);
  });
});
