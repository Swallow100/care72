// T180: 新規事業所（T115 の試用事業所）の中で役を替える。
// - 役の一覧: 審査員のセッションに試用事業所（b）があれば「新規事業所」の下に、足したケアマネ・医療班・足した利用者ごとの本人と家族
// - 役を替える所: 相手の id がこのセッションの b の事業所の中かを、替えるときと毎回の要求で D1 に確かめる。ほかの審査員の試用事業所・デモ・本物の id は断る
// - 2 つの世界: 新規事業所の本人の安否・受入依頼・受け取り・その場で登録は新規事業所の中だけで届き合い、デモの 4 つの役はデモのまま
// - 毎朝 4 時の掃除: 新規事業所の医療班がその場で登録した所属なしの人も消え、ほかの行は変えない
// D1 は node:sqlite に migrations と種、協力事業所の本人 1 人とケアマネのログイン（T115 と同じ形）。

import type { D1Database } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleMenu } from "../../components/ui/RoleMenu.tsx";
import { currentChoice, roleChoicesFor } from "../auth/choices.ts";
import { choiceBlocks, choiceGroups } from "../auth/role-rows.ts";
import {
  DEMO_CARE_MANAGER_ID,
  DEMO_FAMILY_CONTACT_ID,
  DEMO_OFFICE_ID,
  DEMO_SECOND_CARE_MANAGER_ID,
  DEMO_SELF_PERSON_ID,
  LOGIN_CARE_MANAGER_ID,
  UNAFFILIATED_OFFICE_ID,
} from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { chooseRole, chooseSandbox, chooseSandboxRole, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { homePath, parseSandboxChoice, SANDBOX_CHOICE, sandboxChoiceValue, type SandboxTarget } from "../auth/roles.ts";
import { caseloadScope, personInScope } from "../auth/scope.ts";
import { decodeSession, sessionTimes, signSession } from "../auth/session.ts";
import { wallOfficeOf } from "../auth/wall.ts";
import { loadCaseload } from "../caseload.ts";
import { staffActor } from "../custody/actor.ts";
import { loadStaffBoard } from "../custody/board.ts";
import { acceptRequest, openRequests, sendRequest } from "../custody/requests.ts";
import { searchPeople } from "../custody/search.ts";
import { registerOnSite } from "../custody/store.ts";
import { listUnaffiliated, takeOver } from "../custody/takeover.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { clearSandboxes } from "../seed/sandbox.ts";
import type { SeedBucket } from "../seed/reset.ts";
import { saveSignal, signalScope } from "../signals/save.ts";
import { createPerson } from "./people.ts";
import { officeActor } from "./scope.ts";
import { addCareManager } from "./staff.ts";

// テストだけの値（本物のパスワード・鍵ではない）
const SECRET = "test-secret-t180-0123456789-0123456789-abc";
const NOW = 1_800_000_000;
const AT = "2026-11-07T01:00:00.000Z";
const TODAY = "2026-11-07";
const JUDGE_PW = "test-judge-pass-t180";
const CM_PW = "test-cm-pass-t180";
const OTHER_PW = "test-other-pass-t180";
const PARTNER_PERSON = "p-partner-1";
const FAST = { iterations: 1000 };
const LEDGER = '{"basic":{},"care":{},"medical":{"devices":[],"medications":[]},"evacuation":{"hazards":[]},"notes":[],"pending":[]}';

let judgeHash: string;
let cmHash: string;
let otherHash: string;
beforeAll(async () => {
  [judgeHash, cmHash, otherHash] = await Promise.all([JUDGE_PW, CM_PW, OTHER_PW].map((pw) => hashPassword(pw, FAST)));
});

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const x of seedStatements({ passwordHashes: { [LOGIN_CARE_MANAGER_ID]: cmHash } })) sqlite.exec(x);
  sqlite.prepare("UPDATE accounts SET login_id = 'partner1', password_hash = ? WHERE id = 'acct-partner-cm'").run(otherHash);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, ledger)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01', ?)`,
    )
    .run(PARTNER_PERSON, LEDGER);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const one = <T>(sql: string, ...args: (string | number | null)[]) => sqlite.prepare(sql).get(...args) as T;
const count = (sql: string, ...args: (string | number | null)[]) => Number(one<{ n: number }>(sql, ...args).n);
const again = (token: string, at = NOW + 30) => resolvePrincipal(db, env(), SECRET, token, at);

async function loginOk(loginId: string, password: string) {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}

/** 審査員で入り、「新規事業所」を選ぶ */
async function judgeSandbox(loginId = "judge") {
  const t = (await loginOk(loginId, JUDGE_PW)).token;
  const r = await chooseSandbox(db, env(), SECRET, t, NOW + 10, AT);
  if (!r.ok) throw new Error(`試用事業所に入れない: ${r.error}`);
  return r;
}

function actorOf(p: Principal) {
  const a = officeActor(p);
  if (!a) throw new Error("事業所の操作ができない");
  return a;
}

/** 試用事業所に利用者を 1 人と、家族（娘）・機関（かかりつけ医）の連絡先。医療班への提供は同意 */
async function addPerson(p: Principal, name: string, kana: string) {
  const r = await createPerson(db, actorOf(p), { name, kana, birthDate: "1941-03-12", sex: "female", careManagerId: p.caseloadOf! }, AT);
  if (!r.ok) throw new Error(`利用者を足せない: ${r.error}`);
  const family = `c-${r.id}-fam`;
  const doctor = `c-${r.id}-doc`;
  sqlite.prepare("INSERT INTO contacts (id, person_id, kind, relation, name, sort) VALUES (?, ?, 'family', '娘', ?, 1)").run(family, r.id, `${name}の娘`);
  sqlite.prepare("INSERT INTO contacts (id, person_id, kind, relation, name, sort) VALUES (?, ?, 'home_doctor', NULL, '架空 医院', 2)").run(doctor, r.id);
  sqlite
    .prepare("INSERT OR REPLACE INTO consents (person_id, kind, status, recorded_at) VALUES (?, 'medical', 'granted', ?)")
    .run(r.id, AT);
  return { personId: r.id, family, doctor };
}

async function addCm(p: Principal, name: string, loginId: string) {
  const r = await addCareManager(db, actorOf(p), { displayName: name, loginId }, AT, FAST);
  if (!r.ok) throw new Error(`ケアマネを足せない: ${r.error}`);
  return r.account.id;
}

async function as(token: string | null, target: SandboxTarget, at = NOW + 20) {
  return chooseSandboxRole(db, env(), SECRET, token, target, at);
}

async function asOk(token: string, target: SandboxTarget, at = NOW + 20) {
  const r = await as(token, target, at);
  if (!r) throw new Error(`役を替えられない: ${JSON.stringify(target)}`);
  return r;
}

/** 試用事業所を災害モードに（安否を受けるため） */
async function startDisaster(p: Principal) {
  const s = disasterScope(p);
  if (!s) throw new Error("災害モードにできない");
  const r = await switchDisasterMode(db, s, { kind: "earthquake", version: 0, at: AT });
  if (!r.ok) throw new Error(`災害モードにできない: ${r.error}`);
}

const SIGNAL_AT = "2026-11-07T01:05:00.000Z";
function redSignal(id: string) {
  return {
    id,
    color: "red" as const,
    whereNow: null,
    answers: { injured: "yes" as const, atHome: "yes" as const, canMove: "no" as const, hasMedicine: "yes" as const },
    occurredAt: SIGNAL_AT,
    sentAt: SIGNAL_AT,
  };
}

describe("フォームの値", () => {
  it("新規事業所の中の役は sandbox:役:id。形が違えば受けない（新規事業所そのものは別の道）", () => {
    for (const t of [
      { role: "care_manager", id: "acct-sbx-1" },
      { role: "medical" },
      { role: "self", id: "p-1" },
      { role: "family", id: "c-1" },
    ] as SandboxTarget[]) {
      expect(parseSandboxChoice(sandboxChoiceValue(t))).toEqual(t);
    }
    for (const v of [SANDBOX_CHOICE, "self", "sandbox:", "sandbox:self", "sandbox:medical:x", "sandbox:government:x", "sandbox:self:a b", "sandbox:self:x:y", `sandbox:self:${"x".repeat(129)}`, 1, null]) {
      expect(parseSandboxChoice(v)).toBeNull();
    }
  });
});

describe("役を替える", () => {
  it("足したケアマネ: その人の担当一覧・書き手。管理者を選ぶと前と同じ形（印なし）。毎回の要求でも同じ", async () => {
    const s = await judgeSandbox();
    const admin = s.principal;
    const cmId = await addCm(admin, "架空 次郎", "sbxcm180");
    const r = await asOk(s.token, { role: "care_manager", id: cmId });
    expect(r.path).toBe(homePath("care_manager"));
    expect(r.principal).toMatchObject({ role: "care_manager", judge: true, sandbox: true, accountId: cmId, caseloadOf: cmId, displayName: "架空 次郎" });
    expect(r.principal.office?.id).toBe(admin.office!.id);
    expect(caseloadScope(r.principal)).toEqual({ officeId: admin.office!.id, careManagerId: cmId });
    expect(await again(r.token)).toEqual(r.principal);
    const payload = await decodeSession(r.token, SECRET);
    expect(payload).toMatchObject({ k: "judge", r: "sandbox", b: admin.accountId, sr: "care_manager", st: cmId });

    const back = await asOk(r.token, { role: "care_manager", id: admin.accountId! });
    expect(back.principal).toEqual(admin);
    const p2 = await decodeSession(back.token, SECRET);
    expect(p2).not.toHaveProperty("sr");
    expect(p2).not.toHaveProperty("st");
  });

  it("本人・家族・医療班: 新規事業所の人の画面。書き手は試用事業所の管理者、壁の中身は試用事業所", async () => {
    const s = await judgeSandbox();
    const { personId, family } = await addPerson(s.principal, "架空 花子", "カクウ ハナコ");
    const officeId = s.principal.office!.id;

    const self = await asOk(s.token, { role: "self", id: personId });
    expect(self.path).toBe(homePath("self"));
    expect(self.principal).toMatchObject({ role: "self", sandbox: true, judge: true, personId, contactId: null, displayName: "架空 花子", accountId: s.principal.accountId });
    expect(self.principal.office?.id).toBe(officeId);
    expect((await personInScope(db, self.principal, personId))?.id).toBe(personId);
    expect(await personInScope(db, self.principal, DEMO_SELF_PERSON_ID)).toBeNull();

    const fam = await asOk(s.token, { role: "family", id: family });
    expect(fam.path).toBe(homePath("family"));
    expect(fam.principal).toMatchObject({ role: "family", sandbox: true, personId, contactId: family, displayName: "架空 花子の娘" });

    const med = await asOk(s.token, { role: "medical" });
    expect(med.path).toBe(homePath("medical"));
    expect(med.principal).toMatchObject({ role: "medical", sandbox: true, judge: true, accountId: s.principal.accountId });
    expect(wallOfficeOf(med.principal)).toBe(officeId);
    expect(staffActor(med.principal)).toMatchObject({ walled: true, wallOffice: officeId });
    for (const r of [self, fam, med]) expect(await again(r.token)).toEqual(r.principal);
  });

  it("断る: ほかの審査員の新規事業所・デモ・本物の事業所の id、機関の連絡先、一覧から外した人、停止したケアマネ", async () => {
    const mine = await judgeSandbox();
    const theirs = await judgeSandbox("judge2");
    expect(mine.principal.office!.id).not.toBe(theirs.principal.office!.id);
    const their = await addPerson(theirs.principal, "架空 他人", "カクウ タニン");
    const theirCm = await addCm(theirs.principal, "架空 他所", "sbxother");
    const own = await addPerson(mine.principal, "架空 自分", "カクウ ジブン");
    const ownCm = await addCm(mine.principal, "架空 停止", "sbxstop");
    const hidden = await addPerson(mine.principal, "架空 外す", "カクウ ハズス");
    sqlite.prepare("UPDATE accounts SET disabled_at = ? WHERE id = ?").run(AT, ownCm);
    sqlite.prepare("UPDATE people SET unlisted_at = ? WHERE id = ?").run(AT, hidden.personId);

    const refused: SandboxTarget[] = [
      { role: "self", id: their.personId },
      { role: "family", id: their.family },
      { role: "care_manager", id: theirCm },
      { role: "care_manager", id: theirs.principal.accountId! },
      { role: "self", id: DEMO_SELF_PERSON_ID },
      { role: "family", id: DEMO_FAMILY_CONTACT_ID },
      { role: "care_manager", id: DEMO_CARE_MANAGER_ID },
      { role: "care_manager", id: DEMO_SECOND_CARE_MANAGER_ID },
      { role: "care_manager", id: LOGIN_CARE_MANAGER_ID },
      { role: "care_manager", id: "acct-judge" },
      { role: "self", id: PARTNER_PERSON },
      { role: "care_manager", id: "acct-partner-cm" },
      { role: "family", id: own.doctor },
      { role: "self", id: own.family },
      { role: "family", id: own.personId },
      { role: "self", id: hidden.personId },
      { role: "family", id: hidden.family },
      { role: "care_manager", id: ownCm },
      { role: "care_manager", id: own.personId },
    ];
    for (const t of refused) expect(await as(mine.token, t), JSON.stringify(t)).toBeNull();
  });

  it("新規事業所が無い・審査員でないセッションでは替えられない（山本・本物のケアマネ・作る前の審査員）", async () => {
    const t: SandboxTarget = { role: "medical" };
    expect(await as((await loginOk("judge", JUDGE_PW)).token, t)).toBeNull();
    expect(await as((await loginOk("yamamoto", CM_PW)).token, t)).toBeNull();
    expect(await as((await loginOk("partner1", OTHER_PW)).token, t)).toBeNull();
    expect(await as(null, t)).toBeNull();
    expect(await as("x.y", t)).toBeNull();
  });

  it("署名の中の st を偽っても、b の事業所の外なら役選択（unselected）に落ちる。sr と st の形が合わなくても同じ", async () => {
    const mine = await judgeSandbox();
    const theirs = await judgeSandbox("judge2");
    const their = await addPerson(theirs.principal, "架空 他人", "カクウ タニン");
    const base = (await decodeSession(mine.token, SECRET))!;
    if (base.k !== "judge") throw new Error("審査員のセッションでない");
    const forged = [
      { sr: "self", st: their.personId },
      { sr: "self", st: DEMO_SELF_PERSON_ID },
      { sr: "family", st: DEMO_FAMILY_CONTACT_ID },
      { sr: "care_manager", st: DEMO_CARE_MANAGER_ID },
      { sr: "self", st: PARTNER_PERSON },
      { sr: "self" },
      { sr: "medical", st: their.personId },
      { st: their.personId },
    ] as const;
    for (const f of forged) {
      const token = await signSession({ ...base, ...f, ...sessionTimes(NOW + 15) }, SECRET);
      const p = await again(token);
      expect(p?.role, JSON.stringify(f)).toBe("unselected");
      expect(p?.sandbox).toBeUndefined();
    }
  });

  it("相手を消した・外したら次の要求から役選択へ。デモの役に替えると印（sr・st）を外し、新規事業所に戻ると管理者", async () => {
    const s = await judgeSandbox();
    const { personId } = await addPerson(s.principal, "架空 花子", "カクウ ハナコ");
    const self = await asOk(s.token, { role: "self", id: personId });
    sqlite.prepare("UPDATE people SET unlisted_at = ? WHERE id = ?").run(AT, personId);
    expect((await again(self.token))?.role).toBe("unselected");
    sqlite.prepare("UPDATE people SET unlisted_at = NULL WHERE id = ?").run(personId);

    const demo = await chooseRole(db, env(), SECRET, self.token, "self", NOW + 40);
    expect(demo?.principal).toMatchObject({ role: "self", personId: DEMO_SELF_PERSON_ID, sandboxAdmin: s.principal.accountId });
    expect(demo?.principal.sandbox).toBeUndefined();
    const p = (await decodeSession(demo!.token, SECRET))!;
    expect(p).toMatchObject({ r: "self", b: s.principal.accountId });
    expect(p).not.toHaveProperty("sr");
    expect(p).not.toHaveProperty("st");

    const back = await chooseSandbox(db, env(), SECRET, self.token, NOW + 50, AT);
    expect(back.ok && back.principal).toEqual(s.principal);
  });
});

describe("2 つの世界", () => {
  it("新規事業所の本人・家族の安否はそこのケアマネの一覧に出て、デモ（山本）の一覧には出ない", async () => {
    const s = await judgeSandbox();
    const { personId, family } = await addPerson(s.principal, "架空 花子", "カクウ ハナコ");
    await startDisaster(s.principal);
    const self = await asOk(s.token, { role: "self", id: personId });
    const scope = signalScope(self.principal);
    expect(scope).toMatchObject({ officeId: s.principal.office!.id, personId });
    const sent = await saveSignal(db, scope!, redSignal("11111111-1111-4111-8111-111111111111"), SIGNAL_AT);
    expect(sent.ok).toBe(true);
    const fam = await asOk(s.token, { role: "family", id: family });
    const famSent = await saveSignal(db, signalScope(fam.principal)!, { id: "22222222-2222-4222-8222-222222222222", color: "green", occurredAt: SIGNAL_AT, sentAt: SIGNAL_AT }, SIGNAL_AT);
    expect(famSent.ok).toBe(true);

    const mine = await loadCaseload(db, caseloadScope(s.principal)!, TODAY, SIGNAL_AT);
    const row = mine?.rows.find((r) => r.id === personId);
    expect(row?.lastContact).not.toBeNull();
    expect(row?.triage).not.toBeNull();
    expect(count("SELECT count(*) AS n FROM signals WHERE person_id = ?", personId)).toBe(2);

    const judgeToken = (await loginOk("judge", JUDGE_PW)).token;
    const demoCm = await chooseRole(db, env(), SECRET, judgeToken, "care_manager", NOW + 10);
    const demo = await loadCaseload(db, caseloadScope(demoCm!.principal)!, TODAY, SIGNAL_AT);
    expect(demo?.rows.some((r) => r.id === personId)).toBe(false);
    expect(await personInScope(db, demoCm!.principal, personId)).toBeNull();
    // デモの本人・家族の役の信号は、デモの山田 ハナのまま
    const demoSelf = await chooseRole(db, env(), SECRET, s.token, "self", NOW + 20);
    expect(signalScope(demoSelf!.principal)).toMatchObject({ officeId: DEMO_OFFICE_ID, personId: DEMO_SELF_PERSON_ID });
  });

  it("受入依頼: 新規事業所の依頼は新規事業所の医療班だけ、デモの依頼はデモの医療班だけ。受け取りもそれぞれの中", async () => {
    const s = await judgeSandbox();
    const { personId } = await addPerson(s.principal, "架空 花子", "カクウ ハナコ");
    const sent = await sendRequest(db, actorOf(s.principal), { personId, shelter: "架空 小学校" }, AT);
    expect(sent.ok).toBe(true);

    const judgeToken = (await loginOk("judge", JUDGE_PW)).token;
    const demoCm = (await chooseRole(db, env(), SECRET, judgeToken, "care_manager", NOW + 10))!.principal;
    sqlite.prepare("INSERT OR REPLACE INTO consents (person_id, kind, status, recorded_at) VALUES (?, 'medical', 'granted', ?)").run(DEMO_SELF_PERSON_ID, AT);
    const demoSent = await sendRequest(db, actorOf(demoCm), { personId: DEMO_SELF_PERSON_ID, shelter: "架空 中学校" }, AT);
    expect(demoSent.ok).toBe(true);

    const sbxMed = staffActor((await asOk(s.token, { role: "medical" })).principal)!;
    const demoMed = staffActor((await chooseRole(db, env(), SECRET, judgeToken, "medical", NOW + 20))!.principal)!;
    expect((await openRequests(db, sbxMed, TODAY)).map((r) => r.personId)).toEqual([personId]);
    expect((await openRequests(db, demoMed, TODAY)).map((r) => r.personId)).toEqual([DEMO_SELF_PERSON_ID]);

    // 相手の世界の依頼は受けられない
    expect((await acceptRequest(db, demoMed, (sent as { requestId: string }).requestId, AT)).ok).toBe(false);
    expect((await acceptRequest(db, sbxMed, (demoSent as { requestId: string }).requestId, AT)).ok).toBe(false);
    const ok = await acceptRequest(db, sbxMed, (sent as { requestId: string }).requestId, AT);
    expect(ok.ok).toBe(true);
    expect((await loadStaffBoard(db, sbxMed, TODAY, AT)).rows.map((r) => r.personId)).toEqual([personId]);
    expect((await loadStaffBoard(db, demoMed, TODAY, AT)).rows.map((r) => r.personId)).not.toContain(personId);
    const medPrincipal = (await asOk(s.token, { role: "medical" })).principal;
    expect((await personInScope(db, medPrincipal, personId))?.id).toBe(personId);
    // 検索もそれぞれの世界の人だけ
    expect((await searchPeople(db, demoMed, { text: "カクウ ハナコ", birth: null }, TODAY)).hits).toEqual([]);
    expect((await searchPeople(db, sbxMed, { text: "ヤマダ", birth: null }, TODAY)).hits).toEqual([]);
  });

  it("その場で登録: 新規事業所の医療班の登録は新規事業所のケアマネだけが引き受けられる。デモ・本物の事業所には出ない。掃除で消える", async () => {
    const s = await judgeSandbox();
    const sbxMed = staffActor((await asOk(s.token, { role: "medical" })).principal)!;
    const reg = await registerOnSite(
      db,
      sbxMed,
      { name: "架空 現地", kana: "カクウ ゲンチ", age: 80, birthDate: null, medications: [], devices: [], contact: null, shelter: "架空 小学校" },
      AT,
      { personId: "p-site-sbx" },
    );
    expect(reg.ok).toBe(true);
    expect(one<{ office_id: string }>("SELECT office_id FROM people WHERE id = 'p-site-sbx'").office_id).toBe(UNAFFILIATED_OFFICE_ID);
    expect((await loadStaffBoard(db, sbxMed, TODAY, AT)).rows.map((r) => r.personId)).toEqual(["p-site-sbx"]);

    const judgeToken = (await loginOk("judge", JUDGE_PW)).token;
    const demoCm = (await chooseRole(db, env(), SECRET, judgeToken, "care_manager", NOW + 10))!.principal;
    const demoMed = staffActor((await chooseRole(db, env(), SECRET, judgeToken, "medical", NOW + 20))!.principal)!;
    const partner = (await loginOk("partner1", OTHER_PW)).principal;
    expect((await listUnaffiliated(db, actorOf(demoCm), TODAY)).map((x) => x.id)).not.toContain("p-site-sbx");
    expect((await listUnaffiliated(db, actorOf(partner), TODAY)).map((x) => x.id)).not.toContain("p-site-sbx");
    expect((await takeOver(db, actorOf(partner), "p-site-sbx", AT)).ok).toBe(false);
    expect((await searchPeople(db, demoMed, { text: "カクウ ゲンチ", birth: null }, TODAY)).hits).toEqual([]);
    expect((await listUnaffiliated(db, actorOf(s.principal), TODAY)).map((x) => x.id)).toEqual(["p-site-sbx"]);

    // ほかの行（所属なしの本物・デモの登録を含む）は掃除で変わらない
    sqlite.prepare(`INSERT INTO people (id, office_id, name, kana, origin, ledger, created_at) VALUES ('p-site-real', ?, '架空 本物', 'ホンモノ', 'on_site', ?, ?)`).run(UNAFFILIATED_OFFICE_ID, LEDGER, AT);
    const before = sqlite.prepare("SELECT id, office_id FROM people WHERE office_id NOT LIKE 'office-sbx-%' AND id <> 'p-site-sbx' ORDER BY id").all();
    const bucket: SeedBucket = { list: async () => ({ objects: [], truncated: false }), delete: async () => {} } as unknown as SeedBucket;
    await clearSandboxes(db, bucket);
    expect(count("SELECT count(*) AS n FROM people WHERE id = 'p-site-sbx'")).toBe(0);
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = 'p-site-sbx'")).toBe(0);
    expect(sqlite.prepare("SELECT id, office_id FROM people ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("役の一覧", () => {
  it("新規事業所が無い時: デモの 4 つと「新規事業所」だけ。山本には新規事業所が出ない", async () => {
    const p = (await loginOk("judge", JUDGE_PW)).principal;
    const list = await roleChoicesFor(db, p);
    expect(list.map((c) => c.role)).toEqual(["care_manager", "medical", "self", "family", SANDBOX_CHOICE]);
    const yamamoto = (await loginOk("yamamoto", CM_PW)).principal;
    expect((await roleChoicesFor(db, yamamoto)).map((c) => c.role)).toEqual(["care_manager", "medical", "self", "family"]);
  });

  it("新規事業所がある時: その下に足したケアマネ・医療班・利用者ごとの本人と家族（機関の連絡先・外した人は出さない）。デモの役のときも並ぶ", async () => {
    const s = await judgeSandbox();
    const cmId = await addCm(s.principal, "架空 次郎", "sbxcm180");
    const a = await addPerson(s.principal, "架空 花子", "カクウ ハナコ");
    const hidden = await addPerson(s.principal, "架空 外す", "カクウ ハズス");
    sqlite.prepare("UPDATE people SET unlisted_at = ? WHERE id = ?").run(AT, hidden.personId);

    const list = await roleChoicesFor(db, s.principal);
    const values = list.map((c) => c.role);
    expect(values.slice(0, 5)).toEqual(["care_manager", "medical", "self", "family", SANDBOX_CHOICE]);
    expect(values.slice(5)).toEqual([
      sandboxChoiceValue({ role: "care_manager", id: cmId }),
      sandboxChoiceValue({ role: "medical" }),
      sandboxChoiceValue({ role: "self", id: a.personId }),
      sandboxChoiceValue({ role: "family", id: a.family }),
    ]);
    expect(list.find((c) => c.role === SANDBOX_CHOICE)?.sub).toBe(s.principal.office!.name);
    const fam = list.find((c) => c.role === sandboxChoiceValue({ role: "family", id: a.family }))!;
    expect(fam).toMatchObject({ label: "娘", row: "架空 花子" });
    expect(fam.name).toContain("架空 花子さんの娘");
    expect(list.find((c) => c.role === sandboxChoiceValue({ role: "self", id: a.personId }))).toMatchObject({ label: "本人", row: "架空 花子" });
    // 出した値はどれも替えられる
    for (const v of values.slice(5)) expect(await as(s.token, parseSandboxChoice(v)!), v).not.toBeNull();

    // デモの役（医療班）にしていても同じく並ぶ。今の項目はデモの医療班
    const demo = await chooseRole(db, env(), SECRET, s.token, "medical", NOW + 40);
    expect((await roleChoicesFor(db, demo!.principal)).map((c) => c.role)).toEqual(values);
    expect(currentChoice(demo!.principal)).toBe("medical");
  });

  it("今の項目: 新規事業所の中の役はその値（管理者は新規事業所）", async () => {
    const s = await judgeSandbox();
    const cmId = await addCm(s.principal, "架空 次郎", "sbxcm180");
    const a = await addPerson(s.principal, "架空 花子", "カクウ ハナコ");
    expect(currentChoice(s.principal)).toBe(SANDBOX_CHOICE);
    for (const t of [
      { role: "care_manager", id: cmId },
      { role: "medical" },
      { role: "self", id: a.personId },
      { role: "family", id: a.family },
    ] as SandboxTarget[]) {
      const r = await asOk(s.token, t);
      expect(currentChoice(r.principal)).toBe(sandboxChoiceValue(t));
    }
  });

  it("人が増えた時: 本人と家族は利用者ごとに 1 行（行の数は利用者の数）。上限を越えた分は数だけ", async () => {
    const s = await judgeSandbox();
    for (let i = 0; i < 25; i++) await addPerson(s.principal, `架空 ${i + 10}`, `カクウ ${String.fromCharCode(0x30a2 + i)}`);
    const list = await roleChoicesFor(db, s.principal);
    const rows = new Set(list.filter((c) => c.row && c.row !== "ケアマネ" && c.row !== "医療班").map((c) => c.row));
    expect(rows.size).toBe(20);
    expect(list.at(-1)).toMatchObject({ role: "", label: "ほか 5人" });
  });
});

describe("役変更の一覧の形", () => {
  const choices = [
    { role: "care_manager", label: "ケアマネジャー", sub: "山本" },
    { role: SANDBOX_CHOICE, label: "新規事業所", sub: "試用事業所" },
    { role: "sandbox:care_manager:acct-sbx-2", label: "架空 次郎", sub: null, row: "ケアマネ", name: "ケアマネ 架空 次郎" },
    { role: "sandbox:medical", label: "受入一覧", sub: null, row: "医療班", name: "医療班 受入一覧" },
    { role: "sandbox:self:p-1", label: "本人", sub: null, row: "架空 花子", name: "架空 花子 本人" },
    { role: "sandbox:family:c-1", label: "娘", sub: null, row: "架空 花子", name: "架空 花子さんの娘 架空 花子の娘" },
    { role: "", label: "ほか 3人", sub: null, note: true as const },
  ];

  it("利用者ごとに本人と家族を 1 行に。新規事業所の中の役は 1 つの面にまとめ、今の役は枠と太字", () => {
    const blocks = choiceBlocks(choices);
    expect(blocks.map((b) => (b.kind === "row" ? `${b.label}:${b.items.length}` : b.kind))).toEqual([
      "one",
      "one",
      "ケアマネ:1",
      "医療班:1",
      "架空 花子:2",
      "note",
    ]);
    expect(choiceGroups(choices).map((g) => g.nested)).toEqual([false, true]);
    const html = renderToStaticMarkup(createElement(RoleMenu, { label: "役変更", current: "sandbox:self:p-1", choices }));
    expect(html.match(/data-sandbox-roles/g)).toHaveLength(1);
    expect(html).toContain('aria-label="架空 花子さんの娘 架空 花子の娘"');
    expect(html).toMatch(/aria-current="true"[^>]*value="sandbox:self:p-1"|value="sandbox:self:p-1"[^>]*aria-current="true"/);
    expect(html).toContain("ほか 3人");
    // 役変更の読み上げの名前はデモの役と「新規事業所」だけ（中の役を全部並べない）
    expect(html).toContain('aria-label="役変更 ケアマネジャー・新規事業所"');
  });
});
