// T144: 見本のケアマネ（山本）のログインは確認用の事業所へ。山本で変えた物が審査員の見るデモ事業所に効かないことと、
// 審査員のアカウント 3 つ（同じデモ事業所を共有し、訓練はアカウントごと）。
// D1 は node:sqlite に種の全部（seed/full.ts。デモ事業所と確認用の事業所の 10 人・災害モード・山田の赤・終わった訓練）。
// パスワードはテストだけの値（本物ではない）。

import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fullSeedStatements } from "../../seed/full.ts";
import {
  CHECK_CARE_MANAGER_ID,
  CHECK_OFFICE_ID,
  checkSeedId,
  DEMO_CARE_MANAGER_ID,
  DEMO_JUDGE_ACCOUNT_ID,
  DEMO_OFFICE_ID,
  FIXED_ACCOUNT_IDS,
  JUDGE_ACCOUNTS,
  LOGIN_CARE_MANAGER_ID,
} from "../auth/demo.ts";
import { accountCredential } from "../auth/credential.ts";
import { hashPassword } from "../auth/password.ts";
import { chooseRole, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { personInScope } from "../auth/scope.ts";
import { passwordVersion, sessionTimes, signSession } from "../auth/session.ts";
import { staffActor } from "../custody/actor.ts";
import { searchPeople } from "../custody/search.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { castScenario, eventKey, turnKey } from "../drill/cast.ts";
import { drillScope, runningDrillId, startDrill } from "../drill/db.ts";
import { scenarioOf } from "../drill/scenarios.ts";
import { saveIntake, type SaveRequest } from "../intake/save.ts";
import { loadPersonPage } from "../person.ts";
import { createLinkRequest } from "../survey/links.ts";
import { createSurveyShare, loadSurveyOverview, surveyOfficeOf } from "../survey/store.ts";
import { writeTimeline } from "../timeline/write.ts";
import { checkSeedPeople, demoSeedPeople } from "./check.ts";
import { DAILY_RESET_CRON, scheduledReset } from "./cron.ts";
import { CHECK_SEED_DRILL_ID, SEED_DRILL_ID } from "./drill.ts";
import { resetPost } from "./http.ts";
import type { SeedBucket } from "./reset.ts";

const SECRET = "test-secret-t144-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;
const SEED_NOW = "2026-11-06T00:00:00.000Z";
const AT = "2026-11-06T01:00:00.000Z";
const TODAY = "2026-11-06";
const JUDGE_PW = "test-judge-pass-t144";
const CM_PW = "test-cm-pass-t144";

let judgeHash: string;
let cmHash: string;
let statements: string[];

beforeAll(async () => {
  [judgeHash, cmHash] = await Promise.all([JUDGE_PW, CM_PW].map((pw) => hashPassword(pw, { iterations: 1000 })));
  statements = await fullSeedStatements({ now: SEED_NOW, passwordHashes: { [LOGIN_CARE_MANAGER_ID]: cmHash } });
}, 60_000);

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of statements) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

function fakeBucket(): SeedBucket {
  const keys = new Set<string>();
  return {
    head: async (k) => (keys.has(k) ? {} : null),
    list: async ({ prefix }) => ({ objects: [...keys].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    delete: async (ks) => {
      for (const k of ks) keys.delete(k);
    },
  };
}

async function loginAs(loginId: string, password: string): Promise<{ token: string; principal: Principal }> {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return { token: r.token, principal: r.principal };
}

async function role(token: string, r: "care_manager" | "medical" | "self" | "family"): Promise<{ token: string; principal: Principal }> {
  const c = await chooseRole(db, env(), SECRET, token, r, NOW);
  if (!c) throw new Error(`役を選べない: ${r}`);
  return { token: c.token, principal: c.principal };
}

/** 審査員（ID は 1〜3 の順。テストの中だけで ID を使う）のケアマネの役 */
async function judgeCm(n: 1 | 2 | 3): Promise<Principal> {
  const j = await loginAs(JUDGE_ACCOUNTS[n - 1].loginId, JUDGE_PW);
  return (await role(j.token, "care_manager")).principal;
}

const yamamoto = async () => loginAs("yamamoto", CM_PW);

/** 事業所の中身（審査員・山本が見る物）。訓練の信号の id は乱数なので数だけ */
function snapshot(officeId: string) {
  const all = (sql: string) => sqlite.prepare(sql).all(officeId);
  const inOffice = "JOIN people p ON p.id = x.person_id WHERE p.office_id = ?";
  return {
    people: all("SELECT id, care_manager_id, ledger, version, plan_status FROM people WHERE office_id = ? ORDER BY id"),
    contacts: all(`SELECT x.* FROM contacts x ${inOffice} ORDER BY x.id`),
    consents: all(`SELECT x.* FROM consents x ${inOffice} ORDER BY x.person_id, x.kind`),
    clocks: all(`SELECT x.* FROM clocks x ${inOffice} ORDER BY x.id`),
    timeline: all(`SELECT x.id, x.author_id, x.kind, x.body FROM timeline_entries x ${inOffice} ORDER BY x.id`),
    signals: all(`SELECT x.id, x.color, x.recording_key FROM signals x ${inOffice} AND x.drill_id IS NULL ORDER BY x.id`),
    drillSignals: all(`SELECT count(*) AS n FROM signals x ${inOffice} AND x.drill_id IS NOT NULL`),
    custody: all(`SELECT x.id FROM custody x ${inOffice} ORDER BY x.id`),
    drills: all("SELECT id, status, started_by, scenario FROM drills WHERE office_id = ? ORDER BY id"),
    disaster: all("SELECT kind, outage_towns, alert_level, started_by FROM disaster_state WHERE office_id = ?"),
    officeTimeline: all("SELECT id, kind, body FROM office_timeline_entries WHERE office_id = ? ORDER BY id"),
    accounts: all("SELECT id, display_name, login_id, is_office_admin FROM accounts WHERE office_id = ? ORDER BY id"),
  };
}

const editReq = (personId: string, changes: SaveRequest["changes"]): SaveRequest =>
  ({ personId, version: 1, ai: null, edit: true, changes }) as SaveRequest;

describe("T144 確認用の事業所の種", () => {
  it("確認用の事業所に 10 人の写し（id は chk- の頭）。台帳・連絡先・時計・同意はデモ事業所の 10 人と同じ中身", () => {
    const demo = snapshot(DEMO_OFFICE_ID);
    const check = snapshot(CHECK_OFFICE_ID);
    expect(demo.people).toHaveLength(10);
    expect(check.people).toHaveLength(10);
    const back = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll('"chk-', '"').replaceAll(CHECK_OFFICE_ID, DEMO_OFFICE_ID));
    expect(back(check.people)).toEqual(demo.people);
    expect(back(check.contacts)).toEqual(demo.contacts);
    expect(back(check.clocks)).toEqual(demo.clocks);
    expect(back(check.consents)).toEqual(demo.consents);
    expect((check.people as Array<{ id: string; care_manager_id: string }>).every((p) => p.id.startsWith("chk-p-") && p.care_manager_id === CHECK_CARE_MANAGER_ID)).toBe(true);
    // SeedPerson の形の写しも同じ（配役の確かめに使う）
    expect(checkSeedPeople().map((p) => p.person.id)).toEqual(demoSeedPeople().map((p) => checkSeedId(p.person.id)));
  });

  it("確認用の事業所にも災害モード・山田の赤（同じ種の録音の鍵）・終わった訓練。経過の id は重ならない", () => {
    const demo = snapshot(DEMO_OFFICE_ID);
    const check = snapshot(CHECK_OFFICE_ID);
    expect(check.disaster).toHaveLength(1);
    expect((check.disaster[0] as { started_by: string }).started_by).toBe(CHECK_CARE_MANAGER_ID);
    expect(check.signals).toHaveLength(1);
    expect((check.signals[0] as { color: string }).color).toBe("red");
    expect((check.signals[0] as { recording_key: unknown }).recording_key).toEqual((demo.signals[0] as { recording_key: unknown }).recording_key);
    expect(check.timeline.length).toBe(demo.timeline.length);
    expect(check.officeTimeline.length).toBe(demo.officeTimeline.length);
    expect(check.drills).toEqual([{ id: CHECK_SEED_DRILL_ID, status: "finished", started_by: CHECK_CARE_MANAGER_ID, scenario: "heavy_rain" }]);
    expect(demo.drills).toEqual([{ id: SEED_DRILL_ID, status: "finished", started_by: DEMO_CARE_MANAGER_ID, scenario: "heavy_rain" }]);
  });

  it("確認用の種の訓練は、想定の表の行がデモ事業所と同じ人（の写し）に当たる", () => {
    const events = (id: string) =>
      sqlite.prepare("SELECT step, kind, person_id FROM drill_events WHERE drill_id = ? ORDER BY seq").all(id) as Array<{
        step: number;
        kind: string;
        person_id: string | null;
      }>;
    const demo = events(SEED_DRILL_ID);
    const check = events(CHECK_SEED_DRILL_ID);
    expect(demo.length).toBeGreaterThan(0);
    expect(check.map((e) => ({ ...e, person_id: e.person_id?.replace(/^chk-/, "") ?? null }))).toEqual(demo);
  });

  it("配役: 確認用の 10 人では、どの想定でも行の人をその写しに当てる（落ちる行が無い）", () => {
    const people = checkSeedPeople();
    const ids = people.map((p) => p.person.id);
    const facts = new Map(ids.map((id) => [id, { devices: [], clocks: [], hazards: [], household: null, canPress: true }] as const));
    for (const name of ["heavy_rain", "earthquake", "virtual"] as const) {
      const s = scenarioOf(name);
      const cast = castScenario(s, ids, facts, checkSeedId);
      const want: Record<string, string> = {};
      for (const t of s.ticks) {
        t.events.forEach((e, i) => {
          if (e.person) want[eventKey(t.hour, i)] = checkSeedId(e.person);
        });
        t.turns.forEach((x, i) => (want[turnKey(t.hour, i)] = checkSeedId(x.person)));
      }
      expect(cast).toEqual(want);
    }
  });
});

describe("T144 ログイン", () => {
  it("山本のログインは確認用の事業所（管理者・担当一覧は確認用の山本）。パスワードの読み方は env のハッシュ → env の平文 → 種のハッシュ", async () => {
    const { principal } = await yamamoto();
    expect(principal).toMatchObject({ role: "care_manager", accountId: CHECK_CARE_MANAGER_ID, caseloadOf: CHECK_CARE_MANAGER_ID, admin: true, judge: false });
    expect(principal.office).toEqual({ id: CHECK_OFFICE_ID, name: "デモ事業所（確認用）", kind: "demo" });
    // env が先（ハッシュ、平文）。種のハッシュは env が無いとき
    const row = { id: LOGIN_CARE_MANAGER_ID, password_hash: cmHash };
    expect(accountCredential({ CAREMANAGER_DEMO_PASSWORD_HASH: judgeHash }, row)).toEqual({ kind: "hash", hash: judgeHash });
    expect(accountCredential({ CAREMANAGER_DEMO_PASSWORD: "plain-t144" }, row)).toEqual({ kind: "plain", password: "plain-t144" });
    expect(accountCredential({}, row)).toEqual({ kind: "hash", hash: cmHash });
    const plain = await login(db, { CAREMANAGER_DEMO_PASSWORD: "plain-t144-pass" }, SECRET, { loginId: "yamamoto", password: "plain-t144-pass" }, NOW);
    expect(plain.ok && plain.principal.office?.id).toBe(CHECK_OFFICE_ID);
  });

  it("審査員の担当一覧の持ち主（acct-yamamoto）にはログインの ID が無く、前のセッションも通らない", async () => {
    expect(sqlite.prepare("SELECT login_id FROM accounts WHERE id = ?").get(DEMO_CARE_MANAGER_ID)).toEqual({ login_id: null });
    // T144 の前に山本で入ったセッション（acct-yamamoto、ハッシュは同じ）
    sqlite.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(cmHash, DEMO_CARE_MANAGER_ID);
    const old = await signSession({ v: 1, k: "account", a: DEMO_CARE_MANAGER_ID, pv: await passwordVersion(cmHash), ...sessionTimes(NOW) }, SECRET);
    expect(await resolvePrincipal(db, env(), SECRET, old, NOW)).toBeNull();
    const oldEnv = await signSession({ v: 1, k: "account", a: DEMO_CARE_MANAGER_ID, pv: await passwordVersion(judgeHash), ...sessionTimes(NOW) }, SECRET);
    expect(await resolvePrincipal(db, { ...env(), CAREMANAGER_DEMO_PASSWORD_HASH: judgeHash }, SECRET, oldEnv, NOW)).toBeNull();
  });

  it("審査員 3 つ: 同じパスワードで入り、どれもデモ事業所・山本の担当一覧。書き手は別々で名前は審査員 1〜3", async () => {
    const seen: string[] = [];
    for (const n of [1, 2, 3] as const) {
      const p = await judgeCm(n);
      expect(p).toMatchObject({ judge: true, role: "care_manager", caseloadOf: DEMO_CARE_MANAGER_ID, office: { id: DEMO_OFFICE_ID } });
      seen.push(p.accountId!);
      // 役変更の本人・家族は 3 つとも山田 ハナと山田の娘
      const j = await loginAs(JUDGE_ACCOUNTS[n - 1].loginId, JUDGE_PW);
      expect((await role(j.token, "self")).principal).toMatchObject({ personId: "p-01", office: { id: DEMO_OFFICE_ID } });
      expect((await role(j.token, "family")).principal).toMatchObject({ personId: "p-01", contactId: "c-01-1" });
    }
    expect(seen).toEqual(JUDGE_ACCOUNTS.map((j) => j.accountId));
    expect(new Set(seen).size).toBe(3);
    const names = sqlite.prepare(`SELECT display_name FROM accounts WHERE id IN (${seen.map(() => "?").join(", ")}) ORDER BY id`).all(...seen);
    expect(names).toEqual([{ display_name: "審査員 1" }, { display_name: "審査員 2" }, { display_name: "審査員 3" }]);
    for (const id of seen) expect(FIXED_ACCOUNT_IDS).toContain(id);
    // 違うパスワード・アカウントの表の ID としては入れない
    expect((await login(db, env(), SECRET, { loginId: JUDGE_ACCOUNTS[1].loginId, password: "wrong" }, NOW)).ok).toBe(false);
  });

  it("前の審査員の cookie（a の無い形）は審査員 1", async () => {
    const pv = await passwordVersion(judgeHash);
    const old = await signSession({ v: 1, k: "judge", r: "care_manager", pv, ...sessionTimes(NOW) }, SECRET);
    expect(await resolvePrincipal(db, env(), SECRET, old, NOW)).toMatchObject({ accountId: DEMO_JUDGE_ACCOUNT_ID, judge: true });
    const forged = await signSession({ v: 1, k: "judge", r: "care_manager", pv, a: CHECK_CARE_MANAGER_ID, ...sessionTimes(NOW) }, SECRET);
    expect(await resolvePrincipal(db, env(), SECRET, forged, NOW)).toBeNull();
  });

  it("役を替えた山本の本人・家族は確認用の事業所の写し（chk-p-01・chk-c-01-1）、医療班の検索も確認用の人だけ", async () => {
    const y = await yamamoto();
    expect((await role(y.token, "self")).principal).toMatchObject({ personId: "chk-p-01", office: { id: CHECK_OFFICE_ID }, switched: true });
    expect((await role(y.token, "family")).principal).toMatchObject({ personId: "chk-p-01", contactId: "chk-c-01-1" });
    const med = (await role(y.token, "medical")).principal;
    const hits = await searchPeople(db, staffActor(med)!, { text: "ヤマダ", birth: null }, TODAY);
    const ids = JSON.stringify(hits);
    expect(ids).toContain("chk-p-01");
    expect(ids).not.toContain('"p-01"');
    // 審査員の医療班は逆
    const j = await loginAs(JUDGE_ACCOUNTS[0].loginId, JUDGE_PW);
    const jm = (await role(j.token, "medical")).principal;
    const jhits = JSON.stringify(await searchPeople(db, staffActor(jm)!, { text: "ヤマダ", birth: null }, TODAY));
    expect(jhits).toContain('"p-01"');
    expect(jhits).not.toContain("chk-p-01");
  });
});

describe("T144 山本の変更は審査員に効かない・審査員の変更は山本に効かない", () => {
  it("山本で台帳を直す・同意を変える・経過を書く・訓練を始めても、審査員のデモ事業所は種のまま", async () => {
    const before = snapshot(DEMO_OFFICE_ID);
    const y = (await yamamoto()).principal;
    const saved = await saveIntake(
      db,
      y,
      editReq("chk-p-01", [
        { t: "note", value: "確認用の書き込み" },
        { t: "consent", kind: "plan_share", status: "refused" },
      ] as SaveRequest["changes"]),
      new Date(AT),
    );
    expect(saved).toMatchObject({ ok: true });
    expect(await writeTimeline(db, y, { personId: "chk-p-02", kind: "safety_check", body: "確認用の経過" }, AT)).toMatchObject({ ok: true });
    expect(await startDrill(db, drillScope(y)!, "heavy_rain", AT)).toMatchObject({ ok: true });
    // 審査員の事業所の人は山本から見えない（書けない）
    expect(await personInScope(db, y, "p-01")).toBeNull();
    expect(await writeTimeline(db, y, { personId: "p-01", kind: "safety_check", body: "x" }, AT)).toMatchObject({ ok: false, error: "not_found" });

    expect(snapshot(DEMO_OFFICE_ID)).toEqual(before);
    // 審査員の開く本人のページにも出ない
    const judge = await judgeCm(1);
    const page = await loadPersonPage(db, judge, "p-01");
    expect(JSON.stringify(page)).not.toContain("確認用の書き込み");
    expect(await personInScope(db, judge, "chk-p-01")).toBeNull();
    // 山本の側には効いている
    const check = snapshot(CHECK_OFFICE_ID);
    expect(JSON.stringify(check.people)).toContain("確認用の書き込み");
    expect(check.drills).toHaveLength(2);
  });

  it("審査員の変更は確認用の事業所に効かない。審査員の「最初に戻す」はデモ事業所だけ、山本の「最初に戻す」は確認用だけ", async () => {
    const checkBefore = snapshot(CHECK_OFFICE_ID);
    const judge = await judgeCm(1);
    expect(await writeTimeline(db, judge, { personId: "p-01", kind: "safety_check", body: "審査員の経過" }, AT)).toMatchObject({ ok: true });
    expect(await saveIntake(db, judge, editReq("p-02", [{ t: "note", value: "審査員の書き込み" }] as SaveRequest["changes"]), new Date(AT))).toMatchObject({ ok: true });
    expect(await personInScope(db, judge, "chk-p-01")).toBeNull();
    expect(snapshot(CHECK_OFFICE_ID)).toEqual(checkBefore);

    // 山本が確認用で書いた後に、審査員が最初に戻す → 確認用はそのまま
    const y = (await yamamoto()).principal;
    expect(await writeTimeline(db, y, { personId: "chk-p-03", kind: "safety_check", body: "山本の経過" }, AT)).toMatchObject({ ok: true });
    const checkWithYamamoto = snapshot(CHECK_OFFICE_ID);
    const form = new Map([["confirm", "1"]]);
    expect(await resetPost(db, fakeBucket(), judge, { get: (k: string) => form.get(k) ?? null } as never, SEED_NOW)).toMatchObject({ status: 303 });
    expect(snapshot(CHECK_OFFICE_ID)).toEqual(checkWithYamamoto);
    expect(JSON.stringify(snapshot(DEMO_OFFICE_ID).timeline)).not.toContain("審査員の経過");

    // 山本が最初に戻す → デモ事業所はそのまま（審査員がまた書いた物が残る）
    expect(await writeTimeline(db, judge, { personId: "p-01", kind: "safety_check", body: "審査員の経過 2" }, AT)).toMatchObject({ ok: true });
    const demoWithJudge = snapshot(DEMO_OFFICE_ID);
    expect(await resetPost(db, fakeBucket(), y, { get: (k: string) => form.get(k) ?? null } as never, SEED_NOW)).toMatchObject({ status: 303 });
    expect(snapshot(DEMO_OFFICE_ID)).toEqual(demoWithJudge);
    expect(JSON.stringify(snapshot(CHECK_OFFICE_ID).timeline)).not.toContain("山本の経過");
  });

  it("毎朝 4 時の戻しで両方が種に戻る", async () => {
    const demoSeed = snapshot(DEMO_OFFICE_ID);
    const checkSeed = snapshot(CHECK_OFFICE_ID);
    const y = (await yamamoto()).principal;
    const judge = await judgeCm(2);
    await saveIntake(db, y, editReq("chk-p-01", [{ t: "consent", kind: "registry", status: "refused" }] as SaveRequest["changes"]), new Date(AT));
    await writeTimeline(db, judge, { personId: "p-04", kind: "safety_check", body: "審査員 2 の経過" }, AT);
    await startDrill(db, drillScope(judge)!, "earthquake", AT);
    await startDrill(db, drillScope(y)!, "earthquake", AT);
    expect(snapshot(DEMO_OFFICE_ID)).not.toEqual(demoSeed);
    expect(snapshot(CHECK_OFFICE_ID)).not.toEqual(checkSeed);
    const r = await scheduledReset({ DB: db, RECORDINGS: fakeBucket() }, DAILY_RESET_CRON, Date.parse(SEED_NOW));
    expect(r?.check).toBeTruthy();
    expect(snapshot(DEMO_OFFICE_ID)).toEqual(demoSeed);
    expect(snapshot(CHECK_OFFICE_ID)).toEqual(checkSeed);
  });
});

describe("T144 審査員 3 つ", () => {
  it("審査員 1 の変更が審査員 2・3 に見える（書き手は審査員 1）", async () => {
    const j1 = await judgeCm(1);
    expect(await writeTimeline(db, j1, { personId: "p-05", kind: "safety_check", body: "審査員 1 の確認" }, AT)).toMatchObject({ ok: true });
    for (const n of [2, 3] as const) {
      const page = await loadPersonPage(db, await judgeCm(n), "p-05");
      const row = page!.timeline.find((t) => t.body === "審査員 1 の確認");
      expect(row).toMatchObject({ author_id: DEMO_JUDGE_ACCOUNT_ID, author_name: "審査員 1" });
    }
  });

  it("審査員 1 と 2 は同時に別の訓練を進められる（同じ審査員の 2 つ目は断る）", async () => {
    const j1 = await judgeCm(1);
    const j2 = await judgeCm(2);
    const a = await startDrill(db, drillScope(j1)!, "heavy_rain", AT);
    const b = await startDrill(db, drillScope(j2)!, "earthquake", AT);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(await startDrill(db, drillScope(j1)!, "earthquake", AT)).toEqual({ ok: false, error: "running" });
    expect(await runningDrillId(db, DEMO_OFFICE_ID, { scope: drillScope(j1)! })).toBe(a.ok ? a.id : null);
    expect(await runningDrillId(db, DEMO_OFFICE_ID, { scope: drillScope(j2)! })).toBe(b.ok ? b.id : null);
    // 審査員 3 も持てる。山本（確認用）は別の事業所なので数えが混ざらない
    expect(await startDrill(db, drillScope(await judgeCm(3))!, "heavy_rain", AT)).toMatchObject({ ok: true });
    expect(await startDrill(db, drillScope((await yamamoto()).principal)!, "heavy_rain", AT)).toMatchObject({ ok: true });
  });
});

describe("T144 本物のアンケート", () => {
  it("山本が前にデモ事業所で作った本物の答えは、確認用の山本が見られ、審査員には見えず、毎朝の戻しで消えない", async () => {
    const made = await createSurveyShare(db, { officeId: DEMO_OFFICE_ID, memo: "本物", createdBy: DEMO_CARE_MANAGER_ID, createdRole: "care_manager" }, new Date(AT));
    if (!made.ok) throw new Error("リンクを作れない");
    sqlite.prepare("INSERT INTO survey_responses (token, q1, source_hash, submitted_at) VALUES (?, 'a', 'h-real', ?)").run(made.token, AT);
    const judge = await judgeCm(1);
    // 審査員の試し
    const tried = await createLinkRequest(db, judge, { memo: "試し" }, new Date(AT), "https://example.test");
    expect(tried.status).toBe(200);

    const y = (await yamamoto()).principal;
    expect(surveyOfficeOf(y.office!.id)).toBe(DEMO_OFFICE_ID);
    const mine = await loadSurveyOverview(db, surveyOfficeOf(y.office!.id), { walled: false, admin: y.admin, accountId: y.accountId }, AT);
    expect(mine.answers.filter((a) => !a.judge)).toHaveLength(1);
    expect(mine.shares.map((s) => s.memo)).toContain("本物");

    const theirs = await loadSurveyOverview(db, surveyOfficeOf(judge.office!.id), { walled: true, admin: judge.admin, accountId: judge.accountId }, AT);
    expect(theirs.answers.every((a) => a.judge)).toBe(true);
    expect(theirs.shares.map((s) => s.memo)).not.toContain("本物");

    // 確認用の山本が作るリンクも本物（デモ事業所の行、care_manager）
    expect((await createLinkRequest(db, y, { memo: "山本の新しい" }, new Date(AT), "https://example.test")).status).toBe(200);
    expect(sqlite.prepare("SELECT office_id, created_role, created_by FROM survey_shares WHERE memo = '山本の新しい'").get()).toEqual({
      office_id: DEMO_OFFICE_ID,
      created_role: "care_manager",
      created_by: CHECK_CARE_MANAGER_ID,
    });

    await scheduledReset({ DB: db, RECORDINGS: fakeBucket() }, DAILY_RESET_CRON, Date.parse(SEED_NOW));
    const memos = (sqlite.prepare("SELECT memo FROM survey_shares ORDER BY memo").all() as Array<{ memo: string }>).map((r) => r.memo);
    expect(memos).toEqual(["山本の新しい", "本物"]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM survey_responses WHERE source_hash = 'h-real'").get()).toEqual({ n: 1 });
  });
});

describe("T144 migration 0035（本番の行の入れ替え）", () => {
  function upTo(last: string): DatabaseSync {
    const s = new DatabaseSync(":memory:");
    s.exec("PRAGMA foreign_keys = ON;");
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql") && n < last).sort()) s.exec(readFileSync(new URL(name, dir), "utf8"));
    return s;
  }
  const m0035 = () => readFileSync(new URL("../../migrations/0035_check_office_judges.sql", import.meta.url), "utf8");

  it("前の形（山本がデモ事業所でログイン）から: 確認用の事業所・ログインの付け替え・種のハッシュの写し・審査員 2・3。何度流しても同じ", () => {
    const s = upTo("0035");
    s.exec(`INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市');
            INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash)
              VALUES ('acct-yamamoto', 'office-demo', 'care_manager', 1, '山本', 'yamamoto', 'hash-of-seed'),
                     ('acct-judge', 'office-demo', 'judge', 0, '審査員', NULL, NULL);`);
    s.exec(m0035());
    s.exec(m0035());
    expect(s.prepare("SELECT id, kind, name FROM offices WHERE id = 'office-demo-check'").get()).toEqual({
      id: CHECK_OFFICE_ID,
      kind: "demo",
      name: "デモ事業所（確認用）",
    });
    expect(s.prepare("SELECT id, login_id, password_hash, office_id, is_office_admin FROM accounts ORDER BY id").all()).toEqual([
      { id: "acct-judge", login_id: null, password_hash: null, office_id: DEMO_OFFICE_ID, is_office_admin: 0 },
      { id: "acct-judge-2", login_id: null, password_hash: null, office_id: DEMO_OFFICE_ID, is_office_admin: 0 },
      { id: "acct-judge-3", login_id: null, password_hash: null, office_id: DEMO_OFFICE_ID, is_office_admin: 0 },
      { id: DEMO_CARE_MANAGER_ID, login_id: null, password_hash: "hash-of-seed", office_id: DEMO_OFFICE_ID, is_office_admin: 1 },
      { id: "chk-acct-nishimura", login_id: null, password_hash: null, office_id: CHECK_OFFICE_ID, is_office_admin: 0 },
      { id: CHECK_CARE_MANAGER_ID, login_id: "yamamoto", password_hash: "hash-of-seed", office_id: CHECK_OFFICE_ID, is_office_admin: 1 },
    ]);
    expect(s.prepare("SELECT display_name FROM accounts WHERE id = 'acct-judge'").get()).toEqual({ display_name: "審査員 1" });
    s.close();
  });

  it("作ったばかりの D1（デモ事業所の行が無い）では何もしない", () => {
    const s = migratedSqlite();
    expect(s.prepare("SELECT count(*) AS n FROM offices").get()).toEqual({ n: 0 });
    expect(s.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual({ n: 0 });
    s.close();
  });
});
