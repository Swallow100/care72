// アカウントの幅（docs/tasks/T61.md）: 名前の変更・管理者の付け外し・停止と再開・パスワードの再発行・自分のパスワードの変更。
// 種のデモ事業所のアカウント（山本・審査員）は固定で、どの操作もサーバーが断る。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。ハッシュの回数はテストだけ減らす。

import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_ACCOUNTS } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import {
  DEMO_CARE_MANAGER_ID,
  DEMO_JUDGE_ACCOUNT_ID,
  DEMO_SECOND_CARE_MANAGER_ID,
  DEMO_OFFICE_ID,
  FIXED_ACCOUNT_IDS,
  isFixedAccount,
  JUDGE_LOGIN_ID,
} from "../auth/demo.ts";
import { LOCK_FAILURES, LOCK_SEC } from "../auth/lockout.ts";
import { hashPassword } from "../auth/password.ts";
import { changeOwnPassword, passwordChangeRequest } from "../auth/password-change.ts";
import { chooseJudgeRole, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { OFFICE_TIMELINE_KINDS } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadOfficeLog } from "../disaster/db.ts";
import { OFFICE_TIMELINE_KIND_LABELS } from "../disaster/state.ts";
import { demoResetStatements } from "../seed/reset.ts";
import { addCareManagerRequest, careManagerActionRequest } from "./http.ts";
import { activeCareManagers, assignMany, assignPerson, createPerson, listCareManagers } from "./people.ts";
import { officeActor, type OfficeActor } from "./scope.ts";
import {
  addCareManager,
  renameCareManager,
  resetCareManagerPassword,
  setCareManagerAdmin,
  setCareManagerDisabled,
} from "./staff.ts";

const SECRET = "t61-test-secret-0123456789abcdef-0123";
const NOW = 1_793_700_000;
const AT = "2026-11-03T14:00:00.000Z";
const FAST = { iterations: 1000 };
const YAMAMOTO_PW = "t61-yamamoto-pass-01";
const JUDGE_PW = "t61-judge-pass-0001";

let yamamotoHash: string;
let judgeHash: string;
beforeAll(async () => {
  [yamamotoHash, judgeHash] = await Promise.all([YAMAMOTO_PW, JUDGE_PW].map((pw) => hashPassword(pw, FAST)));
});

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements({ passwordHashes: { [DEMO_CARE_MANAGER_ID]: yamamotoHash } })) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

// ---------- 道具 ----------

type Account = {
  id: string;
  display_name: string;
  login_id: string | null;
  is_office_admin: number;
  password_hash: string | null;
  disabled_at: string | null;
};
const account = (id: string) =>
  sqlite.prepare("SELECT id, display_name, login_id, is_office_admin, password_hash, disabled_at FROM accounts WHERE id = ?").get(id) as
    | Account
    | undefined;
const accounts = () => sqlite.prepare("SELECT * FROM accounts ORDER BY id").all();
const changeLog = () =>
  sqlite
    .prepare("SELECT author_id, author_role, body, payload FROM office_timeline_entries WHERE kind = 'care_manager_changed' ORDER BY rowid")
    .all() as Array<{ author_id: string | null; author_role: string; body: string; payload: string }>;

async function loginOk(loginId: string, password: string) {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}

async function asYamamoto() {
  return loginOk("yamamoto", YAMAMOTO_PW);
}

/** 山本（管理者）がデモ事業所にケアマネを足し、その人でログインする */
async function addAndLogin(loginId: string, displayName: string) {
  const y = await asYamamoto();
  const actor = officeActor(y.principal)!;
  const added = await addCareManager(db, actor, { displayName, loginId }, AT, FAST);
  if (!added.ok) throw new Error("足せない");
  const r = await loginOk(loginId, added.password);
  return { id: added.account.id, password: added.password, token: r.token, principal: r.principal };
}

const actorOf = (p: Principal): OfficeActor => {
  const a = officeActor(p);
  if (!a) throw new Error("事業所の役でない");
  return a;
};

/** 管理者の佐藤（山本が足して管理者にした） */
async function adminSato() {
  const sato = await addAndLogin("sato", "佐藤");
  const y = await asYamamoto();
  expect(await setCareManagerAdmin(db, actorOf(y.principal), sato.id, true, AT)).toEqual({ ok: true, changed: true });
  const r = await loginOk("sato", sato.password);
  return { ...sato, principal: r.principal, token: r.token };
}

// ---------- 固定 ----------

describe("固定のアカウント", () => {
  it("種のデモ事業所のアカウント（山本・西村・審査員）と同じ集合", () => {
    const seed = SEED_ACCOUNTS.filter((a) => a.office_id === DEMO_OFFICE_ID).map((a) => a.id);
    expect([...FIXED_ACCOUNT_IDS].sort()).toEqual([...seed].sort());
    expect([...FIXED_ACCOUNT_IDS].sort()).toEqual([DEMO_CARE_MANAGER_ID, DEMO_SECOND_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID].sort());
  });

  it("固定は山本と審査員だけ。協力事業所・足したケアマネ・空は固定でない", () => {
    expect(isFixedAccount(DEMO_CARE_MANAGER_ID)).toBe(true);
    expect(isFixedAccount(DEMO_JUDGE_ACCOUNT_ID)).toBe(true);
    expect(isFixedAccount("acct-partner-cm")).toBe(false);
    expect(isFixedAccount("acct-new")).toBe(false);
    expect(isFixedAccount(null)).toBe(false);
    expect(isFixedAccount(undefined)).toBe(false);
  });

  it("固定の 2 つへの改名・管理者・停止・再発行は、どの管理者からでも 403 fixed で、表が変わらない", async () => {
    const sato = await adminSato();
    const y = await asYamamoto();
    const before = accounts();
    const logBefore = changeLog().length;
    const bodies = [
      { action: "rename", displayName: "別名" },
      { action: "admin", admin: false },
      { action: "admin", admin: true },
      { action: "disable", disabled: true },
      { action: "disable", disabled: false },
      { action: "reset_password" },
    ];
    for (const who of [y.principal, sato.principal]) {
      for (const target of FIXED_ACCOUNT_IDS) {
        for (const body of bodies) {
          const r = await careManagerActionRequest(db, who, target, body, AT, FAST);
          expect(r.status, `${who.displayName} → ${target} ${JSON.stringify(body)}`).toBe(403);
          expect(r.body).toMatchObject({ ok: false, error: "fixed", label: "固定" });
        }
      }
    }
    expect(accounts()).toEqual(before);
    expect(changeLog()).toHaveLength(logBefore);
  });

  it("山本・審査員の自分のパスワードの変更は fixed。山本のパスワードも審査員の env も変わらない", async () => {
    const y = await asYamamoto();
    const before = accounts();
    expect(await changeOwnPassword(db, env(), SECRET, y.principal, { current: YAMAMOTO_PW, next: "new-pass-0001" }, NOW, FAST)).toEqual({
      ok: false,
      error: "fixed",
    });
    for (const role of [null, "care_manager", "medical", "self", "family"] as const) {
      const j = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
      const p = role === null ? j.principal : (await chooseJudgeRole(db, env(), SECRET, j.token, role, NOW))!.principal;
      expect(await changeOwnPassword(db, env(), SECRET, p, { current: JUDGE_PW, next: "new-pass-0001" }, NOW, FAST)).toEqual({
        ok: false,
        error: "fixed",
      });
      const http = await passwordChangeRequest(db, env(), SECRET, p, { current: JUDGE_PW, next: "new-pass-0001" }, NOW, FAST);
      expect(http.status).toBe(403);
      expect(http.token).toBeNull();
    }
    expect(accounts()).toEqual(before);
    expect((await login(db, env(), SECRET, { loginId: "yamamoto", password: YAMAMOTO_PW }, NOW)).ok).toBe(true);
  });

  it("山本のパスワードが env で決まるときも fixed（表を変えても効かない）", async () => {
    const y = await asYamamoto();
    const envWithCm = { ...env(), CAREMANAGER_DEMO_PASSWORD: "env-yamamoto-pass" };
    expect(
      await changeOwnPassword(db, envWithCm, SECRET, y.principal, { current: "env-yamamoto-pass", next: "new-pass-0001" }, NOW, FAST),
    ).toEqual({ ok: false, error: "fixed" });
  });

  it("審査員のケアマネの役はデモ事業所の管理者として、足したケアマネを足す・改名・管理者・停止・再発行できる。固定（山本・西村・審査員）は 403（T79）", async () => {
    const j = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
    const cm = (await chooseJudgeRole(db, env(), SECRET, j.token, "care_manager", NOW))!;
    expect(officeActor(cm.principal)).toMatchObject({ admin: true, placeEdit: false });

    const added = await addCareManagerRequest(db, cm.principal, { displayName: "鈴木", loginId: "suzuki" }, AT, FAST);
    expect(added).toMatchObject({ status: 200, body: { ok: true, account: { displayName: "鈴木", loginId: "suzuki" } } });
    const id = (added.body as { account: { id: string } }).account.id;
    expect(await careManagerActionRequest(db, cm.principal, id, { action: "rename", displayName: "鈴木 花子" }, AT)).toEqual({ status: 200, body: { ok: true, changed: true } });
    expect(await careManagerActionRequest(db, cm.principal, id, { action: "admin", admin: true }, AT)).toEqual({ status: 200, body: { ok: true, changed: true } });
    expect(await careManagerActionRequest(db, cm.principal, id, { action: "disable", disabled: true }, AT)).toEqual({ status: 200, body: { ok: true, changed: true } });
    expect((await careManagerActionRequest(db, cm.principal, id, { action: "reset_password" }, AT, FAST)).status).toBe(200);
    expect(account(id)).toMatchObject({ display_name: "鈴木 花子", is_office_admin: 1 });
    // 書き手は審査員のアカウント
    expect(changeLog().at(-1)).toMatchObject({ author_id: DEMO_JUDGE_ACCOUNT_ID, author_role: "care_manager" });

    for (const fixed of [DEMO_CARE_MANAGER_ID, DEMO_SECOND_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID]) {
      for (const body of [
        { action: "rename", displayName: "変更" },
        { action: "admin", admin: fixed !== DEMO_CARE_MANAGER_ID },
        { action: "disable", disabled: true },
        { action: "reset_password" },
      ]) {
        const r = await careManagerActionRequest(db, cm.principal, fixed, body, AT, FAST);
        expect(r.status, `${fixed} ${body.action}`).toBe(403);
      }
    }
    expect(account(DEMO_SECOND_CARE_MANAGER_ID)).toMatchObject({ display_name: "西村", is_office_admin: 0, disabled_at: null });
  });
});

// ---------- 改名 ----------

describe("改名", () => {
  it("名前を変え、ID は変えない。経過に「佐藤 改名 → 佐藤 花子」と { accountId, change }", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    const r = await careManagerActionRequest(db, y.principal, sato.id, { action: "rename", displayName: "  佐藤　 花子 " }, AT);
    expect(r).toEqual({ status: 200, body: { ok: true, changed: true } });
    expect(account(sato.id)).toMatchObject({ display_name: "佐藤 花子", login_id: "sato" });
    expect(changeLog().at(-1)).toEqual({
      author_id: DEMO_CARE_MANAGER_ID,
      author_role: "care_manager",
      body: "佐藤 改名 → 佐藤 花子",
      payload: JSON.stringify({ accountId: sato.id, change: "rename" }),
    });
    // 同じ名前は何も書かない
    const n = changeLog().length;
    expect(await renameCareManager(db, actorOf(y.principal), sato.id, "佐藤 花子", AT)).toEqual({ ok: true, changed: false });
    expect(changeLog()).toHaveLength(n);
    // 変えた人のセッションはそのまま（パスワードは変わらない）
    expect((await resolvePrincipal(db, env(), SECRET, sato.token, NOW))?.displayName).toBe("佐藤 花子");
  });

  it("名前の決まりはケアマネ追加と同じ（空・21 字・制御文字は 400 display_name）", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    for (const displayName of ["", "   ", "あ".repeat(21), "佐藤\u0007花子", 3]) {
      const r = await careManagerActionRequest(db, y.principal, sato.id, { action: "rename", displayName }, AT);
      expect(r).toMatchObject({ status: 400, body: { error: "display_name", label: "名前 不正" } });
    }
    expect(account(sato.id)?.display_name).toBe("佐藤");
  });

  it("別の事業所・ケアマネでない・無い ID は 404。管理者でないケアマネは 403、ログインなしは 401", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    for (const id of ["acct-partner-cm", "acct-none", "bad id!"]) {
      const r = await careManagerActionRequest(db, y.principal, id, { action: "rename", displayName: "x" }, AT);
      expect(r.status, id).toBe(404);
    }
    expect(account("acct-partner-cm")?.display_name).toBe("");
    const tanaka = await addAndLogin("tanaka", "田中");
    expect((await careManagerActionRequest(db, tanaka.principal, sato.id, { action: "rename", displayName: "x" }, AT)).status).toBe(403);
    expect((await careManagerActionRequest(db, null, sato.id, { action: "rename", displayName: "x" }, AT)).status).toBe(401);
    for (const body of [null, "rename", { action: "drop" }, { action: "admin", admin: "yes" }, { action: "disable" }]) {
      expect((await careManagerActionRequest(db, y.principal, sato.id, body, AT)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

// ---------- 管理者 ----------

describe("管理者の付け外し", () => {
  it("付けると管理者の操作ができ、外すと戻る。経過に「佐藤 管理者」「佐藤 管理者解除」", async () => {
    const sato = await adminSato();
    expect(account(sato.id)?.is_office_admin).toBe(1);
    expect(officeActor(sato.principal)?.admin).toBe(true);
    const y = await asYamamoto();
    expect(await setCareManagerAdmin(db, actorOf(y.principal), sato.id, false, AT)).toEqual({ ok: true, changed: true });
    expect(account(sato.id)?.is_office_admin).toBe(0);
    expect((await resolvePrincipal(db, env(), SECRET, sato.token, NOW))?.admin).toBe(false);
    expect(changeLog().map((l) => l.body)).toEqual(["佐藤 管理者", "佐藤 管理者解除"]);
    expect(changeLog().map((l) => JSON.parse(l.payload).change)).toEqual(["admin", "admin_off"]);
  });

  it("自分の管理者は外せない（400 self）", async () => {
    const sato = await adminSato();
    const r = await careManagerActionRequest(db, sato.principal, sato.id, { action: "admin", admin: false }, AT);
    expect(r).toMatchObject({ status: 400, body: { error: "self" } });
    expect(account(sato.id)?.is_office_admin).toBe(1);
  });

  it("最後の使える管理者は外せない（409 last_admin。読んだあとにほかの管理者が外れた時も）", async () => {
    const sato = await adminSato();
    const tanaka = await addAndLogin("tanaka", "田中");
    const y = await asYamamoto();
    await setCareManagerAdmin(db, actorOf(y.principal), tanaka.id, true, AT);
    // 山本は固定で外せないので、手で外して「佐藤と田中だけが管理者」にする（停止した管理者は数えない）
    sqlite.prepare("UPDATE accounts SET is_office_admin = 0 WHERE id = ?").run(DEMO_CARE_MANAGER_ID);
    sqlite.prepare("UPDATE accounts SET disabled_at = ? WHERE id = ?").run(AT, tanaka.id);
    // 佐藤の画面は読んだときのまま（管理者）。田中は停止していて使える管理者でない
    const r = await careManagerActionRequest(db, sato.principal, tanaka.id, { action: "admin", admin: false }, AT);
    expect(r.status).toBe(200);
    // 田中（停止・管理者でない）が佐藤を外そうとしても、佐藤がただ 1 人の使える管理者
    const stale: OfficeActor = { ...actorOf(sato.principal), authorId: tanaka.id };
    expect(await setCareManagerAdmin(db, stale, sato.id, false, AT)).toEqual({ ok: false, error: "last_admin" });
    expect(await setCareManagerDisabled(db, stale, sato.id, true, AT)).toEqual({ ok: false, error: "last_admin" });
    expect(account(sato.id)).toMatchObject({ is_office_admin: 1, disabled_at: null });
  });

  it("同時に 2 人が互いを外しても 0 人にならない（書く文の条件でも確かめる）", async () => {
    const sato = await adminSato();
    const tanaka = await addAndLogin("tanaka", "田中");
    sqlite.prepare("UPDATE accounts SET is_office_admin = 0 WHERE id = ?").run(DEMO_CARE_MANAGER_ID);
    sqlite.prepare("UPDATE accounts SET is_office_admin = 1 WHERE id = ?").run(tanaka.id);
    const satoActor = actorOf((await loginOk("sato", sato.password)).principal);
    const tanakaActor = actorOf((await loginOk("tanaka", tanaka.password)).principal);
    const results = await Promise.all([
      setCareManagerAdmin(db, satoActor, tanaka.id, false, AT),
      setCareManagerAdmin(db, tanakaActor, sato.id, false, AT),
    ]);
    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
    const admins = sqlite.prepare("SELECT count(*) AS n FROM accounts WHERE office_id = ? AND is_office_admin = 1").get(DEMO_OFFICE_ID) as {
      n: number;
    };
    expect(admins.n).toBe(1);
  });
});

// ---------- 停止 ----------

describe("停止と再開", () => {
  it("停止した人はログインできず、今のセッションも次の要求で切れる。再開すると入れる", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    const r = await careManagerActionRequest(db, y.principal, sato.id, { action: "disable", disabled: true }, AT);
    expect(r).toEqual({ status: 200, body: { ok: true, changed: true } });
    expect(account(sato.id)?.disabled_at).toBe(AT);
    expect(await resolvePrincipal(db, env(), SECRET, sato.token, NOW)).toBeNull();
    expect(await login(db, env(), SECRET, { loginId: "sato", password: sato.password }, NOW)).toEqual({ ok: false });
    // 違うパスワードと同じ失敗
    expect(await login(db, env(), SECRET, { loginId: "sato", password: "wrong" }, NOW)).toEqual({ ok: false });

    expect(await setCareManagerDisabled(db, actorOf(y.principal), sato.id, false, AT)).toEqual({ ok: true, changed: true });
    expect(account(sato.id)?.disabled_at).toBeNull();
    expect((await login(db, env(), SECRET, { loginId: "sato", password: sato.password }, NOW)).ok).toBe(true);
    expect(await resolvePrincipal(db, env(), SECRET, sato.token, NOW)).not.toBeNull();
    expect(changeLog().map((l) => l.body)).toEqual(["佐藤 停止", "佐藤 再開"]);
  });

  it("一覧にいる担当の人がいる間は停止できない（409 has_people）。外した人だけなら停止できる", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    const actor = actorOf(y.principal);
    expect(await assignPerson(db, actor, { personId: "p-01", from: DEMO_CARE_MANAGER_ID, to: sato.id }, AT)).toEqual({ ok: true, changed: true });
    const r = await careManagerActionRequest(db, y.principal, sato.id, { action: "disable", disabled: true }, AT);
    expect(r).toMatchObject({ status: 409, body: { error: "has_people", label: "担当あり" } });
    expect(account(sato.id)?.disabled_at).toBeNull();
    sqlite.prepare("UPDATE people SET unlisted_at = ? WHERE id = 'p-01'").run(AT);
    expect(await setCareManagerDisabled(db, actor, sato.id, true, AT)).toEqual({ ok: true, changed: true });
  });

  it("自分は停止できない（400 self）", async () => {
    const sato = await adminSato();
    const r = await careManagerActionRequest(db, sato.principal, sato.id, { action: "disable", disabled: true }, AT);
    expect(r).toMatchObject({ status: 400, body: { error: "self" } });
    expect(account(sato.id)?.disabled_at).toBeNull();
  });

  it("停止した人は割当の候補に出ず、利用者追加・担当の割当・一括変更の移動先に選べない", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    const actor = actorOf(y.principal);
    await setCareManagerDisabled(db, actor, sato.id, true, AT);

    const list = await listCareManagers(db, DEMO_OFFICE_ID);
    expect(list.find((c) => c.id === sato.id)).toMatchObject({ name: "佐藤", disabled: true, people: 0 });
    expect(list.find((c) => c.id === DEMO_CARE_MANAGER_ID)).toMatchObject({ disabled: false });
    expect(activeCareManagers(list).map((c) => c.id)).toEqual([DEMO_CARE_MANAGER_ID, DEMO_SECOND_CARE_MANAGER_ID]);

    const people = () => sqlite.prepare("SELECT count(*) AS n FROM people").get() as { n: number };
    const n = people().n;
    expect(
      await createPerson(db, actor, { name: "架空 一郎", kana: "カクウ イチロウ", birthDate: "1941-04-01", sex: "male", careManagerId: sato.id }, AT),
    ).toEqual({ ok: false, error: "care_manager" });
    expect(people().n).toBe(n);
    expect(await assignPerson(db, actor, { personId: "p-01", from: DEMO_CARE_MANAGER_ID, to: sato.id }, AT)).toEqual({
      ok: false,
      error: "care_manager",
    });
    expect(await assignMany(db, actor, { items: [{ personId: "p-02", from: DEMO_CARE_MANAGER_ID }], to: sato.id }, AT)).toEqual({
      ok: false,
      error: "care_manager",
    });
    const owners = sqlite.prepare("SELECT DISTINCT care_manager_id AS id FROM people WHERE office_id = ?").all(DEMO_OFFICE_ID) as Array<{
      id: string;
    }>;
    expect(owners.map((o) => o.id)).toEqual([DEMO_CARE_MANAGER_ID]);
  });

  it("停止した人の外した担当を戻すと、担当の変更の経過は前の担当の名前のまま（未割当と書かない）", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    const actor = actorOf(y.principal);
    await assignPerson(db, actor, { personId: "p-01", from: DEMO_CARE_MANAGER_ID, to: sato.id }, AT);
    sqlite.prepare("UPDATE people SET unlisted_at = ? WHERE id = 'p-01'").run(AT);
    await setCareManagerDisabled(db, actor, sato.id, true, AT);
    sqlite.prepare("UPDATE people SET unlisted_at = NULL WHERE id = 'p-01'").run();
    expect(await assignPerson(db, actor, { personId: "p-01", from: sato.id, to: DEMO_CARE_MANAGER_ID }, AT)).toEqual({ ok: true, changed: true });
    const log = await loadOfficeLog(db, DEMO_OFFICE_ID);
    expect(log.find((l) => l.kind === "person_assigned" && l.body?.startsWith("担当 佐藤"))?.body).toBe("担当 佐藤 → 山本");
  });
});

// ---------- 再発行 ----------

describe("パスワードの再発行", () => {
  it("新しい初期パスワードを 1 回だけ返し、前のパスワードとセッションは切れる。平文は表・経過に残らない", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    const r = await careManagerActionRequest(db, y.principal, sato.id, { action: "reset_password" }, AT, FAST);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, account: { id: sato.id, displayName: "佐藤" } });
    const password = r.body.password as string;
    expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(password).not.toBe(sato.password);

    expect(await resolvePrincipal(db, env(), SECRET, sato.token, NOW)).toBeNull();
    expect(await login(db, env(), SECRET, { loginId: "sato", password: sato.password }, NOW)).toEqual({ ok: false });
    expect((await login(db, env(), SECRET, { loginId: "sato", password }, NOW)).ok).toBe(true);

    expect(changeLog().at(-1)).toMatchObject({ body: "佐藤 再発行", payload: JSON.stringify({ accountId: sato.id, change: "reset_password" }) });
    const dump = JSON.stringify([accounts(), sqlite.prepare("SELECT * FROM office_timeline_entries").all()]);
    expect(dump).not.toContain(password);
  });

  it("自分の再発行は断る（400 self。自分は変更の欄から）", async () => {
    const sato = await adminSato();
    const before = account(sato.id)?.password_hash;
    const r = await careManagerActionRequest(db, sato.principal, sato.id, { action: "reset_password" }, AT, FAST);
    expect(r).toMatchObject({ status: 400, body: { error: "self" } });
    expect(account(sato.id)?.password_hash).toBe(before);
  });

  it("管理者でなければ 403", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const tanaka = await addAndLogin("tanaka", "田中");
    const r = await resetCareManagerPassword(db, actorOf(tanaka.principal), sato.id, AT, FAST);
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });
});

// ---------- 自分のパスワード ----------

describe("自分のパスワードの変更", () => {
  const NEXT = "sato-new-pass-01";

  it("変えると新しい token が返り（この端末はログインしたまま）、前の token は切れる。経過に「佐藤 パスワード変更」", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const other = await loginOk("sato", sato.password); // ほかの端末
    const r = await changeOwnPassword(db, env(), SECRET, sato.principal, { current: sato.password, next: NEXT }, NOW, FAST);
    if (!r.ok) throw new Error(r.error);
    expect((await resolvePrincipal(db, env(), SECRET, r.token, NOW))?.accountId).toBe(sato.id);
    expect(await resolvePrincipal(db, env(), SECRET, sato.token, NOW)).toBeNull();
    expect(await resolvePrincipal(db, env(), SECRET, other.token, NOW)).toBeNull();
    expect((await login(db, env(), SECRET, { loginId: "sato", password: NEXT }, NOW)).ok).toBe(true);
    expect(await login(db, env(), SECRET, { loginId: "sato", password: sato.password }, NOW)).toEqual({ ok: false });
    expect(changeLog().at(-1)).toEqual({
      author_id: sato.id,
      author_role: "care_manager",
      body: "佐藤 パスワード変更",
      payload: JSON.stringify({ accountId: sato.id, change: "password" }),
    });
    const dump = JSON.stringify([accounts(), sqlite.prepare("SELECT * FROM office_timeline_entries").all()]);
    expect(dump).not.toContain(NEXT);
    expect(dump).not.toContain(sato.password);
  });

  it("route の形: 本文に token を入れず、token は cookie のために別に返す", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const r = await passwordChangeRequest(db, env(), SECRET, sato.principal, { current: sato.password, next: NEXT }, NOW, FAST);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(typeof r.token).toBe("string");
    expect(await passwordChangeRequest(db, env(), SECRET, null, { current: "a", next: NEXT }, NOW)).toMatchObject({ status: 401, token: null });
    for (const raw of [null, "x", { current: 1, next: NEXT }, { current: "a" }]) {
      expect((await passwordChangeRequest(db, env(), SECRET, sato.principal, raw, NOW)).status, JSON.stringify(raw)).toBe(400);
    }
  });

  it("今のパスワードが違えば wrong_password、同じなら same、8〜64 字でなければ password。表は変わらない", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const before = account(sato.id)?.password_hash;
    const call = (current: string, next: string) => changeOwnPassword(db, env(), SECRET, sato.principal, { current, next }, NOW, FAST);
    expect(await call("wrong-pass", NEXT)).toEqual({ ok: false, error: "wrong_password" });
    expect(await call(sato.password, sato.password)).toEqual({ ok: false, error: "same" });
    expect(await call(sato.password, "short")).toEqual({ ok: false, error: "password" });
    expect(await call(sato.password, "x".repeat(65))).toEqual({ ok: false, error: "password" });
    expect(account(sato.id)?.password_hash).toBe(before);
    const http = await passwordChangeRequest(db, env(), SECRET, sato.principal, { current: "wrong-pass", next: NEXT }, NOW, FAST);
    expect(http).toMatchObject({ status: 400, body: { error: "wrong_password", label: "現在 不一致" }, token: null });
    expect(await resolvePrincipal(db, env(), SECRET, sato.token, NOW)).not.toBeNull();
  });

  it("今のパスワードの打ち間違いはログインと同じ回数の制限にアカウントの ID で数え、10 回で止める。止めている間は正しくても変えない", async () => {
    expect(LOCK_FAILURES).toBe(10);
    const sato = await addAndLogin("sato", "佐藤");
    const before = account(sato.id)?.password_hash;
    const call = (current: string, at: number) => changeOwnPassword(db, env(), SECRET, sato.principal, { current, next: NEXT }, at, FAST);
    const failures = () => (sqlite.prepare("SELECT count(*) AS n FROM login_attempts WHERE login_id = 'sato' AND ok = 0").get() as { n: number }).n;
    for (let i = 1; i < LOCK_FAILURES; i++) expect(await call("wrong-pass", NOW + i)).toEqual({ ok: false, error: "wrong_password" });
    expect(await call("wrong-pass", NOW + LOCK_FAILURES)).toMatchObject({ ok: false, error: "locked" });
    // 止めている間は正しい今のパスワードでも確かめずに断り、失敗も数えない
    expect(await call(sato.password, NOW + LOCK_FAILURES + 1)).toMatchObject({ ok: false, error: "locked" });
    expect(account(sato.id)?.password_hash).toBe(before);
    expect(failures()).toBe(LOCK_FAILURES);
    // route の形: 429 と Retry-After の秒、待つ分
    const http = await passwordChangeRequest(db, env(), SECRET, sato.principal, { current: sato.password, next: NEXT }, NOW + LOCK_FAILURES + 2, FAST);
    expect(http).toMatchObject({ status: 429, body: { ok: false, error: "locked", label: "回数超過 しばらく待機", minutes: 15 }, token: null });
    expect(http.retryAfterSec).toBeGreaterThan(0);
    // 15 分たてば通り、通ったら ID の失敗を消す
    expect((await call(sato.password, NOW + LOCK_FAILURES + LOCK_SEC + 1)).ok).toBe(true);
    expect(failures()).toBe(0);
  });

  it("ほかの人の打ち間違いは数えない（アカウントごと）", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const tanaka = await addAndLogin("tanaka", "田中");
    for (let i = 1; i <= LOCK_FAILURES; i++) {
      await changeOwnPassword(db, env(), SECRET, tanaka.principal, { current: "wrong-pass", next: NEXT }, NOW + i, FAST);
    }
    const r = await changeOwnPassword(db, env(), SECRET, sato.principal, { current: sato.password, next: NEXT }, NOW + LOCK_FAILURES + 1, FAST);
    expect(r.ok).toBe(true);
  });

  it("1 回の変更で PBKDF2 は 2 回（今の確かめと新しいハッシュ。login() を通さない）", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const spy = vi.spyOn(crypto.subtle, "deriveBits");
    try {
      const r = await changeOwnPassword(db, env(), SECRET, sato.principal, { current: sato.password, next: NEXT }, NOW, FAST);
      expect(r.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
      if (r.ok) expect((await resolvePrincipal(db, env(), SECRET, r.token, NOW + 1))?.accountId).toBe(sato.id);
    } finally {
      spy.mockRestore();
    }
  });

  it("同時に 2 つ変えても片方だけ（古いハッシュで比べる）", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    const results = await Promise.all([
      changeOwnPassword(db, env(), SECRET, sato.principal, { current: sato.password, next: "first-pass-0001" }, NOW, FAST),
      changeOwnPassword(db, env(), SECRET, sato.principal, { current: sato.password, next: "second-pass-0001" }, NOW, FAST),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "conflict" }]);
    expect(changeLog().filter((l) => l.body === "佐藤 パスワード変更")).toHaveLength(1);
  });

  it("事業所の無いアカウント（医療班）も変えられる。事業所の経過には書かない", async () => {
    const hash = await hashPassword("med-pass-000001", FAST);
    sqlite
      .prepare("INSERT INTO accounts (id, office_id, role, display_name, login_id, password_hash) VALUES ('acct-med-1', NULL, 'medical', '医療班 1', 'med1', ?)")
      .run(hash);
    const m = await loginOk("med1", "med-pass-000001");
    const r = await changeOwnPassword(db, env(), SECRET, m.principal, { current: "med-pass-000001", next: "med-pass-000002" }, NOW, FAST);
    expect(r.ok).toBe(true);
    expect(changeLog()).toHaveLength(0);
  });
});

// ---------- 事業所の経過 ----------

describe("事業所の経過", () => {
  it("種類 care_manager_changed は「ケアマネ変更」。経過の行は「ケアマネ変更 佐藤 停止 山本 …」", async () => {
    expect(OFFICE_TIMELINE_KINDS).toContain("care_manager_changed");
    expect(OFFICE_TIMELINE_KIND_LABELS.care_manager_changed).toBe("ケアマネ変更");
    const sato = await addAndLogin("sato", "佐藤");
    const y = await asYamamoto();
    await setCareManagerDisabled(db, actorOf(y.principal), sato.id, true, AT);
    const log = await loadOfficeLog(db, DEMO_OFFICE_ID);
    expect(log.find((l) => l.kind === "care_manager_changed")).toMatchObject({ label: "ケアマネ変更", body: "佐藤 停止", who: "山本" });
  });
});

// ---------- 種の戻し ----------

describe("種の戻し", () => {
  it("種のアカウントの停止の印を戻し（固定は断るので二重の守り）、足したケアマネは消す", async () => {
    const sato = await addAndLogin("sato", "佐藤");
    sqlite.prepare("UPDATE accounts SET disabled_at = ?, display_name = '別' WHERE id IN (?, ?)").run(AT, DEMO_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID);
    for (const s of demoResetStatements(AT)) sqlite.exec(s);
    expect(account(DEMO_CARE_MANAGER_ID)).toMatchObject({ display_name: "山本", disabled_at: null, password_hash: yamamotoHash });
    expect(account(DEMO_JUDGE_ACCOUNT_ID)).toMatchObject({ display_name: "審査員", disabled_at: null });
    expect(account(sato.id)).toBeUndefined();
    expect((await login(db, env(), SECRET, { loginId: "yamamoto", password: YAMAMOTO_PW }, NOW)).ok).toBe(true);
  });
});

// ---------- migration 0012 ----------

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
const migrationNames = () => readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const MIGRATION_0012 = "0012_account_disabled.sql";

function sqliteUpTo(pred: (n: string) => boolean): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON;");
  for (const n of migrationNames().filter(pred)) d.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
  return d;
}

describe("migration 0012（accounts.disabled_at と、事業所の経過の種類）", () => {
  it("番号は 0012 で 1 つだけ", () => {
    expect(migrationNames().filter((n) => n.startsWith("0012_"))).toEqual([MIGRATION_0012]);
  });

  it("accounts.disabled_at（NULL が既定）と、索引 office_timeline_office_time を持つ", () => {
    const d = migratedSqlite();
    const cols = d.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string; dflt_value: unknown; notnull: number }>;
    expect(cols.find((c) => c.name === "disabled_at")).toMatchObject({ dflt_value: null, notnull: 0 });
    const idx = d.prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = 'office_timeline_office_time'").get();
    expect(idx).toEqual({ tbl_name: "office_timeline_entries" });
    expect(d.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_old'").all()).toEqual([]);
    d.close();
  });

  it("CHECK は今までの種類と care_manager_changed を通し、知らない種類を断る", () => {
    const d = migratedSqlite();
    d.prepare("INSERT INTO offices (id, name, kind, city) VALUES ('o-1', '事業所', 'regular', '松山市')").run();
    const put = (kind: string) =>
      d
        .prepare("INSERT INTO office_timeline_entries (id, office_id, author_role, kind, occurred_at) VALUES (?, 'o-1', 'care_manager', ?, ?)")
        .run(`t-${kind}`, kind, AT);
    for (const kind of OFFICE_TIMELINE_KINDS) expect(() => put(kind), kind).not.toThrow();
    expect(() => put("account_deleted")).toThrow(/CHECK/);
    d.close();
  });

  it("今ある事業所の経過の行を全部写す（列・作った時刻もそのまま）。外部キーは効いたまま", () => {
    // 種は今の事業所の列（0017 の地図の中心、T68）を書くので、0017 は先に当てる（offices に列を足すだけで 0012 の表に触れない）。
    // 種は気象庁の写しの表（0020、T72）も空にするので 0020 も先に（新しい表を作るだけで 0012 の表に触れない）。
    // 種は同意の AI 提供（0024、T74）を書くので 0024 も先に（consents を建て直すだけで 0012 の表に触れない）。
    // 種は書類の見直しの表（0032、T136）と紙の手入れの表（0033、T135）も空にするので 0032・0033 も先に（新しい表を作るだけで 0012 の表に触れない）
    const early = (n: string) => n.startsWith("0017_") || n.startsWith("0020_") || n.startsWith("0024_") || n.startsWith("0032_") || n.startsWith("0033_");
    const d = sqliteUpTo((n) => n < MIGRATION_0012 || early(n));
    for (const s of seedStatements()) d.exec(s);
    d.prepare(
      `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, occurred_at)
       VALUES ('ot-w', 'office-demo', NULL, 'system', 'disaster_on', ?)`,
    ).run(AT);
    d.prepare(
      `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at, created_at)
       VALUES ('ot-x', 'office-demo', 'acct-yamamoto', 'care_manager', 'care_manager_added', '佐藤', '{"accountId":"a"}', ?, '2026-11-03T00:00:00.000Z')`,
    ).run(AT);
    const before = d.prepare("SELECT * FROM office_timeline_entries ORDER BY id").all();
    expect(before.length).toBeGreaterThan(1);
    d.exec(readFileSync(new URL(MIGRATION_0012, MIGRATIONS), "utf8"));
    for (const n of migrationNames().filter((n) => n > MIGRATION_0012 && !early(n))) d.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    expect(d.prepare("SELECT * FROM office_timeline_entries ORDER BY id").all()).toEqual(before);
    expect(d.prepare("SELECT disabled_at FROM accounts WHERE id = 'acct-yamamoto'").get()).toEqual({ disabled_at: null });
    expect(() =>
      d
        .prepare("INSERT INTO office_timeline_entries (id, office_id, author_role, kind, occurred_at) VALUES ('ot-bad', 'office-none', 'care_manager', 'disaster_on', ?)")
        .run(AT),
    ).toThrow(/FOREIGN KEY/);
    d.close();
  });

  it("種（山本の災害モードの行など）は新しい表に入る", () => {
    const d = migratedSqlite();
    expect(() => {
      for (const s of seedStatements()) d.exec(s);
      for (const s of demoResetStatements(AT)) d.exec(s);
    }).not.toThrow();
    const n = d.prepare("SELECT count(*) AS n FROM office_timeline_entries WHERE office_id = ?").get(DEMO_OFFICE_ID) as { n: number };
    expect(n.n).toBeGreaterThan(0);
    d.close();
  });
});
