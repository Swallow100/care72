// T115: 審査員がまっさらの事業所（試用事業所）から始められる役。
// - 役の一覧の「新規事業所」で、そのセッションだけの空の事業所を作り、審査員がその管理者になる（1 セッション 1 件・全部で SANDBOX_LIMIT 件）
// - 事業所の壁: 試用事業所から本物の事業所・デモ事業所の人とアカウントに届かない。逆もない。そこで足したケアマネも同じ壁
// - 毎朝 4 時の掃除: 試用事業所を人・台帳・訓練・アンケート・R2 ごと消し、ほかの行は 1 行も変えない
// - 作り直しの守りは試用事業所を本物のデータに数えない（0027 の前の D1 でも止まらない）
// D1 は node:sqlite に migrations と種、協力事業所の本人 1 人・ケアマネのログイン・医療班のアカウント・所属なしの人 2 人（本物とデモの登録）。

import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedStatements, CLEAR_ORDER } from "../../seed/sql.ts";
import { roleChoicesFor, currentChoice } from "../auth/choices.ts";
import { DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID, DEMO_SELF_PERSON_ID, UNAFFILIATED_OFFICE_ID } from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { changeOwnPassword } from "../auth/password-change.ts";
import { chooseRole, chooseSandbox, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { JUDGE_LABEL, SANDBOX_CHOICE, SANDBOX_LABELS } from "../auth/roles.ts";
import { caseloadScope, personInScope } from "../auth/scope.ts";
import { decodeSession, signSession, sessionTimes } from "../auth/session.ts";
import { canChooseRole, isWalled } from "../auth/wall.ts";
import { beginCall, usageToday, type UsageStore } from "../claude/usage.ts";
import { staffActor } from "../custody/actor.ts";
import { searchPeople } from "../custody/search.ts";
import { listUnaffiliated, takeOver } from "../custody/takeover.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { OFFICE_PATH } from "../disaster/http.ts";
import { listDrills } from "../drill/db.ts";
import { defaultPlanForm } from "../forms/plan-form.ts";
import { DAILY_RESET_CRON, scheduledReset } from "../seed/cron.ts";
import type { SeedBucket } from "../seed/reset.ts";
import { clearSandboxes, SANDBOX_CLEAR, sandboxClearStatements, sandboxR2Prefixes } from "../seed/sandbox.ts";
import { createSurveyShare, loadSurveyOverview } from "../survey/store.ts";
import { newOfficeRows } from "./create.ts";
import { assignPerson, createPerson, listOfficePeople, setUnlisted } from "./people.ts";
import { savePlace } from "./place.ts";
import { createSandbox, loadSandboxAdmin, SANDBOX_CITY, SANDBOX_LIMIT, SANDBOX_PLAN_FORM, SANDBOX_START_PATH } from "./sandbox.ts";
import { isSandboxOfficeId, newSandboxIds, SANDBOX_AI_QUOTA } from "./sandbox-id.ts";
import { officeActor } from "./scope.ts";
import { canSeeSetup, setupItems } from "./setup.ts";
import { addCareManager, renameCareManager, resetCareManagerPassword, setCareManagerDisabled } from "./staff.ts";
import { COUNT_SQL, runGuard } from "../../tools/deploy/guard.ts";
import { parseNewOfficeArgs } from "../../tools/office/new-office.ts";

// テストだけの値（本物のパスワード・鍵ではない）
const SECRET = "test-secret-t115-0123456789-0123456789-abc";
const NOW = 1_800_000_000;
const AT = "2026-11-05T01:00:00.000Z";
const TODAY = "2026-11-05";
const JUDGE_PW = "test-judge-pass-t115";
const CM_PW = "test-cm-pass-t115";
const OTHER_PW = "test-other-pass-t115";
const PARTNER_PERSON = "p-partner-1";
const REAL_SITE_PERSON = "p-site-real";
const DEMO_SITE_PERSON = "p-site-demo";
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

/** 種と、本物の事業所の行（協力事業所の本人・ケアマネのログイン・医療班・所属なしの人） */
function fixtures(s: DatabaseSync) {
  // 前の形の D1（0027 の前）には、あとの migration で足した表（0033 の紙の手入れ、T135）が無い。無い表を消す文は流さない
  const has = (t: string) => s.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) !== undefined;
  for (const x of seedStatements({ passwordHashes: { [DEMO_CARE_MANAGER_ID]: cmHash } })) {
    const del = /^DELETE FROM (\w+);$/.exec(x);
    if (del && !has(del[1])) continue;
    s.exec(x);
  }
  s.prepare("UPDATE accounts SET login_id = 'partner1', password_hash = ? WHERE id = 'acct-partner-cm'").run(otherHash);
  s.prepare(
    `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, ledger)
     VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01', ?)`,
  ).run(PARTNER_PERSON, LEDGER);
  s.prepare(
    `INSERT INTO accounts (id, office_id, role, display_name, login_id, password_hash)
     VALUES ('acct-med-1', NULL, 'medical', '医療班 1', 'med1', ?)`,
  ).run(otherHash);
  // 所属なしの人: 本物の医療班が登録した人と、審査員（医療班の役）が登録した人
  for (const [id, holder, kana] of [
    [REAL_SITE_PERSON, "acct-med-1", "ホンモノ ジロウ"],
    [DEMO_SITE_PERSON, "acct-judge", "デモ サブロウ"],
  ] as const) {
    s.prepare(
      `INSERT INTO people (id, office_id, name, kana, origin, ledger, created_at) VALUES (?, ?, ?, ?, 'on_site', ?, ?)`,
    ).run(id, UNAFFILIATED_OFFICE_ID, `架空 ${kana}`, kana, LEDGER, AT);
    s.prepare(
      `INSERT INTO custody (id, person_id, holder_id, holder_role, shelter, via, received_at)
       VALUES (?, ?, ?, 'medical', 'みどり小学校', 'on_site', ?)`,
    ).run(`cu-${id}`, id, holder, AT);
  }
}

beforeEach(() => {
  sqlite = migratedSqlite();
  fixtures(sqlite);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

async function loginOk(loginId: string, password: string, at = NOW) {
  const r = await login(db, env(), SECRET, { loginId, password }, at);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}

/** 審査員で入り、「新規事業所」を選ぶ */
async function judgeSandbox(token?: string) {
  const t = token ?? (await loginOk("judge", JUDGE_PW)).token;
  const r = await chooseSandbox(db, env(), SECRET, t, NOW + 10, AT);
  if (!r.ok) throw new Error(`試用事業所に入れない: ${r.error}`);
  return r;
}

const again = (token: string, at = NOW + 20) => resolvePrincipal(db, env(), SECRET, token, at);
const one = <T>(sql: string, ...args: (string | number | null)[]) => sqlite.prepare(sql).get(...args) as T;
const count = (sql: string, ...args: (string | number | null)[]) => Number(one<{ n: number }>(sql, ...args).n);

function actorOf(p: Principal) {
  const a = officeActor(p);
  if (!a) throw new Error("事業所の操作ができない");
  return a;
}

/** 試用事業所に利用者を 1 人（管理者の担当） */
async function addPerson(p: Principal, name = "架空 一郎") {
  const r = await createPerson(db, actorOf(p), { name, kana: "カクウ イチロウ", birthDate: "1941-03-12", sex: "male", careManagerId: p.caseloadOf! }, AT);
  if (!r.ok) throw new Error(`利用者を足せない: ${r.error}`);
  return r.id;
}

describe("作る", () => {
  it("新規事業所: 空の事業所と、ログインできない管理者を作り、審査員がその管理者になる。送り先は事業所の画面", async () => {
    const r = await judgeSandbox();
    expect(r.created).toBe(true);
    expect(r.path).toBe(SANDBOX_START_PATH);
    expect(SANDBOX_START_PATH).toBe(OFFICE_PATH);
    const p = r.principal;
    expect(p).toMatchObject({
      role: "care_manager",
      judge: true,
      sandbox: true,
      admin: true,
      displayName: JUDGE_LABEL,
      office: { name: SANDBOX_LABELS.officeName, kind: "regular" },
    });
    expect(p.accountId).toBe(p.caseloadOf);
    expect(isSandboxOfficeId(p.office!.id)).toBe(true);

    const office = one<Record<string, unknown>>("SELECT * FROM offices WHERE id = ?", p.office!.id);
    expect(office).toMatchObject({ kind: "regular", city: SANDBOX_CITY, plan_form: SANDBOX_PLAN_FORM, center_lat: null, center_lng: null, judge_sandbox: 1 });
    expect(defaultPlanForm(SANDBOX_CITY)).toBe(SANDBOX_PLAN_FORM);
    const admin = one<Record<string, unknown>>("SELECT * FROM accounts WHERE id = ?", p.accountId);
    expect(admin).toMatchObject({
      office_id: p.office!.id,
      role: "care_manager",
      is_office_admin: 1,
      login_id: null,
      password_hash: null,
      judge_made: 1,
      disabled_at: null,
    });

    // セッションの中: 役の印 sandbox と、管理者の id
    const s = await decodeSession(r.token, SECRET);
    expect(s).toMatchObject({ k: "judge", r: "sandbox", b: p.accountId });
    // 次の要求でも同じ
    expect(await again(r.token)).toEqual(p);
  });

  it("壁の中のまま、管理者の操作（ケアマネ追加・地域）と準備の欄（T98）を持つ。パスワードの変更は断る", async () => {
    const { principal: p, token } = await judgeSandbox();
    expect(isWalled(p)).toBe(true);
    expect(canChooseRole(p)).toBe(true);
    expect(actorOf(p)).toMatchObject({ admin: true, placeEdit: true, walled: true, officeId: p.office!.id, defaultCareManagerId: p.accountId });
    expect(caseloadScope(p)).toEqual({ officeId: p.office!.id, careManagerId: p.accountId });
    expect(canSeeSetup(p)).toBe(true);
    const cms = [{ disabled: false }];
    expect(setupItems({ center: null, careManagers: cms, people: [], careManagerLater: false }).map((i) => i.kind)).toEqual([
      "place",
      "care_manager",
      "people",
    ]);
    const pw = await changeOwnPassword(db, env(), SECRET, await again(token), { current: "x", next: "abcdefgh123" }, NOW + 30, FAST);
    expect(pw).toMatchObject({ ok: false, error: "fixed" });
  });

  it("1 セッション 1 件: 選び直しても、ほかの役へ替えて戻っても同じ事業所。ほかの審査員のセッションは別の事業所", async () => {
    const first = await judgeSandbox();
    const second = await judgeSandbox(first.token);
    expect(second.created).toBe(false);
    expect(second.principal.office!.id).toBe(first.principal.office!.id);

    const demo = await chooseRole(db, env(), SECRET, second.token, "care_manager", NOW + 30);
    expect(demo?.principal).toMatchObject({ office: { id: DEMO_OFFICE_ID }, caseloadOf: DEMO_CARE_MANAGER_ID });
    expect(demo?.principal.sandbox).toBeFalsy();
    const self = await chooseRole(db, env(), SECRET, demo!.token, "self", NOW + 31);
    expect(self?.principal).toMatchObject({ role: "self", personId: DEMO_SELF_PERSON_ID });
    const back = await judgeSandbox(self!.token);
    expect(back.created).toBe(false);
    expect(back.principal.office!.id).toBe(first.principal.office!.id);

    const other = await judgeSandbox();
    expect(other.created).toBe(true);
    expect(other.principal.office!.id).not.toBe(first.principal.office!.id);
    expect(count("SELECT count(*) AS n FROM offices WHERE judge_sandbox = 1")).toBe(2);
  });

  it(`上限: 生きている試用事業所が ${SANDBOX_LIMIT} 件なら作らない（limit）。数えと INSERT は 1 文`, async () => {
    for (let i = 0; i < SANDBOX_LIMIT; i++) expect((await createSandbox(db, AT)).ok).toBe(true);
    const before = count("SELECT count(*) AS n FROM offices");
    const r = await chooseSandbox(db, env(), SECRET, (await loginOk("judge", JUDGE_PW)).token, NOW + 10, AT);
    expect(r).toEqual({ ok: false, error: "limit" });
    expect(count("SELECT count(*) AS n FROM offices")).toBe(before);
    expect(count("SELECT count(*) AS n FROM accounts WHERE id LIKE 'acct-sbx-%'")).toBe(SANDBOX_LIMIT);
    // 上限 1 で 2 つ目
    sqlite.exec("DELETE FROM accounts WHERE office_id IN (SELECT id FROM offices WHERE judge_sandbox = 1); DELETE FROM offices WHERE judge_sandbox = 1;");
    expect((await createSandbox(db, AT, newSandboxIds(), 1)).ok).toBe(true);
    expect(await createSandbox(db, AT, newSandboxIds(), 1)).toEqual({ ok: false, error: "limit" });
  });

  it("審査員のセッションでなければ作れない（山本・本物のケアマネ・医療班・ログインなし）", async () => {
    for (const [id, pw] of [
      ["yamamoto", CM_PW],
      ["partner1", OTHER_PW],
      ["med1", OTHER_PW],
    ] as const) {
      const t = (await loginOk(id, pw)).token;
      expect(await chooseSandbox(db, env(), SECRET, t, NOW + 10, AT), id).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await chooseSandbox(db, env(), SECRET, null, NOW + 10, AT)).toEqual({ ok: false, error: "forbidden" });
    expect(count("SELECT count(*) AS n FROM offices WHERE judge_sandbox = 1")).toBe(0);
  });

  it("役の一覧: 審査員だけに「新規事業所」。試用事業所の中では今の項目が新規事業所", async () => {
    const judge = (await loginOk("judge", JUDGE_PW)).principal;
    const list = await roleChoicesFor(db, judge);
    expect(list.map((c) => c.role)).toEqual(["care_manager", "medical", "self", "family", SANDBOX_CHOICE]);
    expect(list.at(-1)).toEqual({ role: SANDBOX_CHOICE, label: SANDBOX_LABELS.choice, sub: null });
    const yamamoto = (await loginOk("yamamoto", CM_PW)).principal;
    expect((await roleChoicesFor(db, yamamoto)).map((c) => c.role)).not.toContain(SANDBOX_CHOICE);
    const { principal } = await judgeSandbox();
    expect(currentChoice(principal)).toBe(SANDBOX_CHOICE);
    expect((await roleChoicesFor(db, principal)).at(-1)?.sub).toBe(SANDBOX_LABELS.officeName);
    expect(currentChoice(yamamoto)).toBe("care_manager");
  });

  it("新しい事業所の行の形は作者の道具と同じ所から。道具は試用事業所の id の頭を断る", () => {
    const base = { officeId: "office-x1", name: "架空", city: "今治市", planForm: "cao", accountId: "acct-x", displayName: "佐藤", loginId: "sato", passwordHash: "h", at: AT };
    const real = newOfficeRows(base);
    expect(real.office).not.toHaveProperty("judge_sandbox");
    expect(real.admin).not.toHaveProperty("judge_made");
    const sb = newOfficeRows({ ...base, sandbox: true });
    expect(sb.office.judge_sandbox).toBe(1);
    expect(sb.admin.judge_made).toBe(1);
    const args = ["--name", "架空", "--city", "今治市", "--login-id", "sato", "--display-name", "佐藤"];
    expect(parseNewOfficeArgs([...args, "--id", "office-sbx-abc"])).toMatchObject({ ok: false });
    expect(parseNewOfficeArgs([...args, "--id", "office-abc"])).toMatchObject({ ok: true });
  });
});

describe("セッションの b を偽っても、本物の事業所・デモ事業所・ほかの審査員の事業所に入れない", () => {
  async function forged(b: string) {
    const t = (await loginOk("judge", JUDGE_PW)).token;
    const s = await decodeSession(t, SECRET);
    if (!s || s.k !== "judge") throw new Error("審査員のセッションでない");
    return signSession({ ...s, r: "sandbox", b, ...sessionTimes(NOW + 5) }, SECRET);
  }

  it("b が本物のケアマネ・山本・審査員・医療班・試用事業所で足したケアマネなら役選択（unselected）に落ちる", async () => {
    const { principal: sb } = await judgeSandbox();
    const added = await addCareManager(db, actorOf(sb), { displayName: "架空 二", loginId: "sbx2" }, AT, FAST);
    if (!added.ok) throw new Error("足せない");
    for (const b of ["acct-partner-cm", DEMO_CARE_MANAGER_ID, "acct-judge", "acct-med-1", added.account.id, "acct-sbx-none"]) {
      const p = await again(await forged(b));
      expect(p, b).toMatchObject({ role: "unselected", judge: true, office: { id: DEMO_OFFICE_ID } });
      expect(p?.sandbox, b).toBeFalsy();
    }
    // 偽の b で「新規事業所」を選ぶと、偽の事業所でなく新しい試用事業所
    const r = await chooseSandbox(db, env(), SECRET, await forged("acct-partner-cm"), NOW + 10, AT);
    expect(r.ok && r.created && r.principal.office!.id !== "office-partner").toBe(true);
  });

  it("署名の外で b を書き換えた cookie は通らない。山本のセッションに sandbox の印は付けられない", async () => {
    const a = await judgeSandbox();
    const b = await judgeSandbox();
    const [body, sig] = a.token.split(".");
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    const swapped = `${Buffer.from(JSON.stringify({ ...json, b: b.principal.accountId })).toString("base64url")}.${sig}`;
    expect(await again(swapped)).toBeNull();

    const y = await decodeSession((await loginOk("yamamoto", CM_PW)).token, SECRET);
    const withSandbox = await signSession({ ...(y as object), r: "sandbox" } as never, SECRET);
    expect(await again(withSandbox)).toBeNull();
  });
});

describe("事業所の壁: 試用事業所から本物の事業所・デモ事業所に届かない（逆も）", () => {
  it("本人のページ・一覧・担当・外す・訓練: 試用事業所の中だけ", async () => {
    const { principal: p } = await judgeSandbox();
    for (const id of [PARTNER_PERSON, DEMO_SELF_PERSON_ID, REAL_SITE_PERSON, DEMO_SITE_PERSON]) {
      expect(await personInScope(db, p, id), id).toBeNull();
    }
    expect(await listOfficePeople(db, p.office!.id, TODAY)).toEqual([]);
    expect(await listDrills(db, p.office!.id)).toEqual([]);
    const a = actorOf(p);
    expect(await assignPerson(db, a, { personId: PARTNER_PERSON, from: "acct-partner-cm", to: p.accountId! }, AT)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await setUnlisted(db, a, { personId: DEMO_SELF_PERSON_ID, unlisted: true }, AT)).toEqual({ ok: false, error: "not_found" });
    // 担当にほかの事業所のケアマネは選べない
    for (const cm of ["acct-partner-cm", DEMO_CARE_MANAGER_ID]) {
      const r = await createPerson(db, a, { name: "架空", kana: "カクウ", birthDate: "1940-01-01", sex: "female", careManagerId: cm }, AT);
      expect(r, cm).toEqual({ ok: false, error: "care_manager" });
    }
    // 自分の事業所の人は開ける
    const own = await addPerson(p);
    expect(await personInScope(db, p, own)).toMatchObject({ id: own, office_id: p.office!.id, care_manager_id: p.accountId });
    expect(one<{ office_id: string }>("SELECT office_id FROM people WHERE id = ?", PARTNER_PERSON).office_id).toBe("office-partner");
  });

  it("ケアマネの管理: ほかの事業所のアカウントは無いのと同じ・固定は断る。足したケアマネは印つきで同じ壁", async () => {
    const { principal: p } = await judgeSandbox();
    const a = actorOf(p);
    expect(await renameCareManager(db, a, "acct-partner-cm", "乗っ取り", AT)).toEqual({ ok: false, error: "not_found" });
    expect(await setCareManagerDisabled(db, a, "acct-partner-cm", true, AT)).toEqual({ ok: false, error: "not_found" });
    expect(await resetCareManagerPassword(db, a, "acct-partner-cm", AT, FAST)).toEqual({ ok: false, error: "not_found" });
    expect(await resetCareManagerPassword(db, a, DEMO_CARE_MANAGER_ID, AT, FAST)).toEqual({ ok: false, error: "fixed" });
    // 自分（管理者の行）の停止・再発行は断る
    expect(await setCareManagerDisabled(db, a, p.accountId!, true, AT)).toEqual({ ok: false, error: "self" });
    expect(one<{ display_name: string }>("SELECT display_name FROM accounts WHERE id = 'acct-partner-cm'").display_name).not.toBe("乗っ取り");

    const added = await addCareManager(db, a, { displayName: "架空 二", loginId: "sbxcm2" }, AT, FAST);
    if (!added.ok) throw new Error("足せない");
    expect(one<Record<string, unknown>>("SELECT office_id, judge_made, is_office_admin FROM accounts WHERE id = ?", added.account.id)).toEqual({
      office_id: p.office!.id,
      judge_made: 1,
      is_office_admin: 0,
    });
    // 足したケアマネで入る: 試用事業所の中だけ、壁の中、役は替えられない、地域は書けない
    const cm = (await loginOk("sbxcm2", added.password)).principal;
    expect(cm).toMatchObject({ role: "care_manager", judge: false, judgeMade: true, office: { id: p.office!.id }, caseloadOf: added.account.id });
    expect(isWalled(cm)).toBe(true);
    expect(canChooseRole(cm)).toBe(false);
    expect(actorOf(cm).placeEdit).toBe(false);
    for (const id of [PARTNER_PERSON, DEMO_SELF_PERSON_ID]) expect(await personInScope(db, cm, id), id).toBeNull();
    expect(await chooseSandbox(db, env(), SECRET, (await loginOk("sbxcm2", added.password)).token, NOW + 10, AT)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("地域の保存は試用事業所の行だけ。デモ・協力事業所の中心は動かない", async () => {
    const { principal: p } = await judgeSandbox();
    const before = sqlite.prepare("SELECT id, city, center_lat, center_lng FROM offices WHERE judge_sandbox = 0 ORDER BY id").all();
    expect(await savePlace(db, p, { city: "今治市", center: { lat: 34.06, lng: 133.0 } })).toEqual({ ok: true });
    expect(one<Record<string, unknown>>("SELECT city, center_lat, center_lng FROM offices WHERE id = ?", p.office!.id)).toEqual({
      city: "今治市",
      center_lat: 34.06,
      center_lng: 133.0,
    });
    expect(sqlite.prepare("SELECT id, city, center_lat, center_lng FROM offices WHERE judge_sandbox = 0 ORDER BY id").all()).toEqual(before);
    // デモ事業所の審査員（ケアマネの役）は今までどおり書けない
    const demo = await chooseRole(db, env(), SECRET, (await loginOk("judge", JUDGE_PW)).token, "care_manager", NOW + 10);
    expect(actorOf(demo!.principal).placeEdit).toBe(false);
  });

  it("所属なしの引受: 本物の医療班が登録した人は出さず、引き受けられない（デモの登録だけ）", async () => {
    const { principal: p } = await judgeSandbox();
    const list = await listUnaffiliated(db, actorOf(p), TODAY);
    expect(list.map((x) => x.id)).toEqual([DEMO_SITE_PERSON]);
    expect((await takeOver(db, actorOf(p), REAL_SITE_PERSON, AT)).ok).toBe(false);
    expect(one<{ office_id: string }>("SELECT office_id FROM people WHERE id = ?", REAL_SITE_PERSON).office_id).toBe(UNAFFILIATED_OFFICE_ID);
  });

  it("アンケート: 試用事業所で作るリンクは試し（壁の中）。本物のアンケートは見えない", async () => {
    const { principal: p } = await judgeSandbox();
    const real = await createSurveyShare(db, { officeId: "office-partner", memo: "本物", createdBy: "acct-partner-cm", createdRole: "care_manager" }, new Date(AT));
    expect(real.ok).toBe(true);
    const mine = await createSurveyShare(db, { officeId: p.office!.id, memo: "試し", createdBy: p.accountId, createdRole: "judge" }, new Date(AT));
    expect(mine.ok).toBe(true);
    const o = await loadSurveyOverview(db, p.office!.id, { walled: true, admin: true, accountId: p.accountId }, AT);
    expect(JSON.stringify(o)).not.toContain("本物");
  });

  it("逆向き: 本物のケアマネ・デモの審査員（ケアマネ・医療班）から試用事業所の人に届かない", async () => {
    const { principal: p } = await judgeSandbox();
    const own = await addPerson(p, "架空 試用");
    const partner = (await loginOk("partner1", OTHER_PW)).principal;
    expect(await personInScope(db, partner, own)).toBeNull();
    const yamamoto = (await loginOk("yamamoto", CM_PW)).principal;
    expect(await personInScope(db, yamamoto, own)).toBeNull();
    const judgeToken = (await loginOk("judge", JUDGE_PW)).token;
    const cm = await chooseRole(db, env(), SECRET, judgeToken, "care_manager", NOW + 10);
    expect(await personInScope(db, cm!.principal, own)).toBeNull();
    const med = await chooseRole(db, env(), SECRET, judgeToken, "medical", NOW + 11);
    const found = await searchPeople(db, staffActor(med!.principal)!, { text: "カクウ イチロウ", birth: null }, TODAY);
    expect(found.hits).toEqual([]);
    // 本物の医療班の検索には出るが、受け持つまで本人のページは開けない（試用事業所でも本物の事業所と同じ）
    const realMed = (await loginOk("med1", OTHER_PW)).principal;
    expect(await personInScope(db, realMed, own)).toBeNull();
  });
});

describe("AI の 1 日の上限はデモ事業所と同じ数え", () => {
  function fakeUsage() {
    const rows: Array<{ officeId: string; day: string }> = [];
    const store: UsageStore = {
      reserve: async (c, limit) => {
        if (rows.filter((r) => r.officeId === c.officeId && r.day === c.day).length >= limit) return false;
        rows.push({ officeId: c.officeId, day: c.day });
        return true;
      },
      finish: async () => undefined,
      countDay: async (officeId, day) => rows.filter((r) => r.officeId === officeId && r.day === day).length,
    };
    return { store, rows };
  }

  it("試用事業所の呼び出しはデモ事業所の行で数え、上限もデモ事業所の値（AI_DAILY_LIMIT）", async () => {
    const { principal: p } = await judgeSandbox();
    const { store, rows } = fakeUsage();
    const now = () => new Date(AT);
    const ctx = { env: { AI_DAILY_LIMIT: "2" }, usage: store, office: { id: p.office!.id, kind: p.office!.kind }, now };
    await beginCall(ctx as never, "ledger_input", "m");
    await beginCall({ ...ctx, office: { id: DEMO_OFFICE_ID, kind: "demo" } } as never, "ledger_input", "m");
    expect(rows.map((r) => r.officeId)).toEqual([DEMO_OFFICE_ID, DEMO_OFFICE_ID]);
    await expect(beginCall(ctx as never, "ledger_input", "m")).rejects.toThrow();
    expect(await usageToday(ctx as never)).toMatchObject({ used: 2, limit: 2 });
    expect(SANDBOX_AI_QUOTA).toEqual({ id: DEMO_OFFICE_ID, kind: "demo" });
    // 本物の事業所は自分の数え（200）
    const real = { ...ctx, office: { id: "office-partner", kind: "regular" as const } };
    expect(await usageToday(real as never)).toMatchObject({ used: 0, limit: 200 });
  });
});

describe("毎朝 4 時の掃除", () => {
  /** 表ごとの全部の行（rowid の順）。掃除の前後で比べる */
  function dump(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const t of CLEAR_ORDER) out[t] = sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
    return out;
  }

  /** 試用事業所に、人・台帳に付く行・訓練・アンケート・様式の対応表・災害モード・ai_calls を入れる */
  async function fill(p: Principal) {
    const office = p.office!.id;
    const person = await addPerson(p);
    const add = await addCareManager(db, actorOf(p), { displayName: "架空 三", loginId: `cm${office.slice(-6)}` }, AT, FAST);
    if (!add.ok) throw new Error("足せない");
    const drill = `d-${office}`;
    sqlite.exec(`
      INSERT INTO contacts (id, person_id, kind, relation, name, sort) VALUES ('c-${office}', '${person}', 'family', '娘', '架空 花子', 0);
      INSERT INTO clocks (id, person_id, kind, category, label, starts_on) VALUES ('k-${office}', '${person}', 'medication', 'insulin', 'インスリン', 'disaster');
      INSERT INTO drills (id, office_id, scenario, status, started_at, started_by) VALUES ('${drill}', '${office}', 'short', 'finished', '${AT}', '${p.accountId}');
      INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, actor, kind, person_id) VALUES ('e-${office}', '${drill}', 1, 0, 0, 'persona', 'red_button', '${person}');
      INSERT INTO signals (id, person_id, color, source, occurred_at, drill_id) VALUES ('s-d-${office}', '${person}', 'red', 'agent', '${AT}', '${drill}');
      INSERT INTO signals (id, person_id, color, source, occurred_at, recording_key) VALUES ('s-${office}', '${person}', 'red', 'self', '${AT}', 'recordings/${office}/${person}/x.webm');
      INSERT INTO disaster_state (office_id, kind, started_at, updated_at, updated_by) VALUES ('${office}', 'heavy_rain', '${AT}', '${AT}', '${p.accountId}');
      INSERT INTO form_mappings (id, office_id, title, source_kind, mapping, status, created_at, updated_at, created_by)
        VALUES ('m-${office}', '${office}', '架空の様式', 'manual', '{}', 'draft', '${AT}', '${AT}', '${p.accountId}');
      INSERT INTO form9_rank_edits (id, office_id, person_id, mode, auto_rank, reason, set_at)
        VALUES ('f9-${office}', '${office}', '${person}', 'disaster', 1, '架空', '${AT}');
      INSERT INTO ai_calls (id, office_id, purpose, model, day, status, started_at) VALUES ('ai-${office}', '${office}', 'ledger_input', 'm', '${TODAY}', 'ok', '${AT}');
    `);
    const share = await createSurveyShare(db, { officeId: office, memo: "試し", createdBy: p.accountId, createdRole: "judge" }, new Date(AT));
    if (!share.ok) throw new Error("リンクを作れない");
    sqlite.exec(`INSERT INTO survey_links (token, office_id, memo, created_by, created_role, created_at, expires_at)
      VALUES ('lk-${office}-0123456789abcdef0123456789abcdef', '${office}', '試し', '${p.accountId}', 'judge', '${AT}', '2026-11-30T00:00:00.000Z');`);
    return { person, drill };
  }

  /** 偽の R2（鍵だけ。2 件ずつ返して続きも読む） */
  function fakeBucket(keys: string[]) {
    const objects = new Set(keys);
    const bucket: SeedBucket = {
      head: async (k) => (objects.has(k) ? {} : null),
      list: async ({ prefix, cursor }) => {
        const all = [...objects].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
        const page = all.slice(0, 2);
        const truncated = all.length > 2;
        return { objects: page.map((key) => ({ key })), truncated, ...(truncated ? { cursor: page[page.length - 1] } : {}) };
      },
      delete: async (ks) => {
        for (const k of ks) objects.delete(k);
      },
    };
    return { bucket, objects };
  }

  it("消す表の一覧は CLEAR_ORDER の全部。office_id・person_id・drill_id を持つ表は全部消す側", () => {
    expect(Object.keys(SANDBOX_CLEAR).sort()).toEqual([...CLEAR_ORDER].sort());
    for (const t of CLEAR_ORDER) {
      const cols = (sqlite.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as Array<{ name: string }>).map((c) => c.name);
      if (cols.some((c) => c === "office_id" || c === "person_id" || c === "drill_id")) expect(SANDBOX_CLEAR[t], t).not.toBeNull();
    }
    for (const s of sandboxClearStatements()) expect(s).toMatch(/^DELETE FROM \w+ WHERE /);
  });

  it("試用事業所を全部消し、ほかの行は 1 行も変えない。外部キーも壊れない。R2 は 3 つの頭だけ消す", async () => {
    const base = dump();
    const a = await judgeSandbox();
    const b = await judgeSandbox();
    const fa = await fill(a.principal);
    await fill(b.principal);
    const oa = a.principal.office!.id;
    const keep = [
      "recordings/office-demo/seed.webm",
      "recordings/office-partner/p/x.webm",
      "forms/office-demo/originals/matsuyama/1.png",
      "forms/office-partner/m/1.jpg",
      "drill/d-demo/s.wav",
      "voice/m/v/prompt-1.wav",
      "recordings/office-sbx/x.webm",
    ];
    const gone = [
      `recordings/${oa}/${fa.person}/x.webm`,
      `recordings/${oa}/${fa.person}/y.webm`,
      `forms/${oa}/originals/matsuyama/1.png`,
      `forms/${oa}/originals/matsuyama/manifest.json`,
      `forms/${oa}/m-${oa}/1.jpg`,
      `drill/${fa.drill}/sig.wav`,
    ];
    const { bucket, objects } = fakeBucket([...keep, ...gone]);
    expect(dump()).not.toEqual(base);

    const r = await clearSandboxes(db, bucket);
    expect(r).toEqual({ offices: 2, drills: 2, removedObjects: gone.length });
    expect(dump()).toEqual(base);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect([...objects].sort()).toEqual([...keep].sort());

    // 審査員のセッションは役選択に落ち、選び直すと新しい試用事業所
    expect(await again(a.token)).toMatchObject({ role: "unselected", judge: true });
    const next = await judgeSandbox(a.token);
    expect(next.created).toBe(true);
    // もう一度流しても同じ（何も無ければ何もしない）
    sqlite.exec(`DELETE FROM accounts WHERE office_id IN (SELECT id FROM offices WHERE judge_sandbox = 1); DELETE FROM offices WHERE judge_sandbox = 1;`);
    expect(await clearSandboxes(db, bucket)).toEqual({ offices: 0, drills: 0, removedObjects: 0 });
  });

  it("試用事業所で足したケアマネのセッションも、掃除のあとは通らない", async () => {
    const { principal: p } = await judgeSandbox();
    const added = await addCareManager(db, actorOf(p), { displayName: "架空 二", loginId: "sbxcm9" }, AT, FAST);
    if (!added.ok) throw new Error("足せない");
    const t = (await loginOk("sbxcm9", added.password)).token;
    expect(await again(t)).not.toBeNull();
    await clearSandboxes(db, fakeBucket([]).bucket);
    expect(await again(t)).toBeNull();
    expect(await loadSandboxAdmin(db, p.accountId!)).toBeNull();
  });

  it("R2 で落ちたら D1 は消さない（次の朝にもう一度）", async () => {
    const { principal: p } = await judgeSandbox();
    await fill(p);
    const before = dump();
    const { bucket } = fakeBucket([`recordings/${p.office!.id}/x.webm`]);
    const broken: SeedBucket = { ...bucket, delete: async () => Promise.reject(new Error("R2 落ちた")) };
    await expect(clearSandboxes(db, broken)).rejects.toThrow("R2 落ちた");
    expect(dump()).toEqual(before);
  });

  it("R2 の頭は試用事業所の id の物だけ作る（印の付いた別の id・空の id は飛ばす）", () => {
    expect(sandboxR2Prefixes({ offices: ["office-sbx-abc", "office-partner", ""], drills: ["d-1", ""] })).toEqual([
      "recordings/office-sbx-abc/",
      "forms/office-sbx-abc/",
      "drill/d-1/",
    ]);
  });

  it("毎朝 4 時の cron がデモ事業所を戻し、試用事業所も消す", async () => {
    const { principal: p } = await judgeSandbox();
    await addPerson(p);
    const result = await scheduledReset({ DB: db, RECORDINGS: fakeBucket([]).bucket }, DAILY_RESET_CRON, Date.parse("2026-11-05T19:00:00.000Z"));
    expect(result?.sandboxes).toMatchObject({ offices: 1 });
    expect(count("SELECT count(*) AS n FROM offices WHERE judge_sandbox = 1")).toBe(0);
    expect(count("SELECT count(*) AS n FROM people WHERE id = ?", PARTNER_PERSON)).toBe(1);
    expect(count("SELECT count(*) AS n FROM people WHERE office_id = 'office-demo'")).toBe(10);
  });
});

describe("作り直しの守り（tools/deploy/guard.ts）", () => {
  const wrangler = (s: DatabaseSync) => (sql: string) => JSON.stringify([{ results: s.prepare(sql).all(), success: true }]);

  it("試用事業所とその人・アカウント・訓練は本物のデータに数えない。あれば数を 1 行", async () => {
    const { principal: p } = await judgeSandbox();
    await addPerson(p);
    await addCareManager(db, actorOf(p), { displayName: "架空 二", loginId: "sbxcm3" }, AT, FAST);
    sqlite.exec(`INSERT INTO drills (id, office_id, scenario, status, started_at) VALUES ('d-sbx', '${p.office!.id}', 'short', 'finished', '${AT}')`);
    // 本物の行（協力事業所の本人・医療班・所属なしの 2 人）はもとからあるので、試用事業所のぶんだけ増えないことを見る
    const d = await runGuard(wrangler(sqlite), {});
    expect(d.lines).toContain("  試用事業所（数えない。消える） 1");
    expect(d.lines).toContain("  事業所（種の外） 0");
    expect(d.lines).toContain("  訓練（デモ事業所の外） 0");
    expect(d.lines).toContain("  アカウント（種の外） 1"); // 医療班の 1 人だけ
    expect(d.lines).toContain(`  利用者（デモ事業所の外） 3`); // 協力事業所 1・所属なし 2
  });

  it("0027 の前の D1（列が無い）でも数えられ、前と同じ数え方", async () => {
    const old = new DatabaseSync(":memory:");
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql") && n < "0027").sort()) old.exec(readFileSync(new URL(name, dir), "utf8"));
    fixtures(old);
    const seen: string[] = [];
    const d = await runGuard((sql) => {
      seen.push(sql);
      return wrangler(old)(sql);
    }, {});
    expect(d.lines[0]).toBe("本物データあり 停止");
    expect(d.lines.join("\n")).not.toContain("試用事業所");
    expect(seen[1]).toContain(COUNT_SQL.people);
    expect(seen[1]).not.toContain("judge_sandbox");
    old.close();
  });
});
