// T99: 医療班・行政のアカウント（作者の道具 tools/office/new-staff.ts で作る。T97）が、自分のパスワードを受入一覧（/staff）から変える。
// - 入口を出すのは医療班・行政のアカウントだけ（ownPasswordEntry が open）。審査員のログイン・種の固定のアカウント（役を替えた山本）は fixed
//   （「固定」の印だけで、サーバーも 403 fixed で断る）。ケアマネは事業所の画面の自分の行から（T61）なので出さない
// - 変える処理と回数の制限は T61 と同じ（lib/auth/password-change.ts の passwordChangeRequest。15 分に 10 回で止める）
// D1 は node:sqlite に種の 10 人と、医療班・行政のアカウント（道具が作るのと同じ形: 事業所なし・管理者でない）。ハッシュの回数はテストだけ減らす。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { DEMO_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID, DEMO_SECOND_CARE_MANAGER_ID, JUDGE_LOGIN_ID, LOGIN_CARE_MANAGER_ID } from "./demo.ts";
import { LOCK_FAILURES } from "./lockout.ts";
import { hashPassword } from "./password.ts";
import { ownLoginId, ownPasswordEntry, passwordChangeRequest, PASSWORD_CHANGE_ERROR_LABELS } from "./password-change.ts";
import { chooseJudgeRole, chooseRole, login, resolvePrincipal, type Principal } from "./principal.ts";
import { JUDGE_ROLES, ROLES } from "./roles.ts";

// テストだけの値（本物のパスワード・鍵ではない）
const SECRET = "test-secret-t99-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;
const FAST = { iterations: 1000 };
const JUDGE_PW = "test-judge-pass-t99";
const CM_PW = "test-cm-pass-t99";
const MED_PW = "test-med-pass-t99";
const GOV_PW = "test-gov-pass-t99";

let judgeHash: string;
let cmHash: string;
let medHash: string;
let govHash: string;
beforeAll(async () => {
  [judgeHash, cmHash, medHash, govHash] = await Promise.all([JUDGE_PW, CM_PW, MED_PW, GOV_PW].map((pw) => hashPassword(pw, FAST)));
});

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements({ passwordHashes: { [LOGIN_CARE_MANAGER_ID]: cmHash } })) sqlite.exec(s);
  // 作者の道具（T97）が作るのと同じ形: 事業所なし・管理者でない
  const add = sqlite.prepare(
    "INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash) VALUES (?, NULL, ?, 0, ?, ?, ?)",
  );
  add.run("acct-med-t99", "medical", "第1救護所", "kyugo1", medHash);
  add.run("acct-gov-t99", "government", "市 防災課", "shi01", govHash);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

async function loginOk(loginId: string, password: string) {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}

const hashOf = (id: string) => (sqlite.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(id) as { password_hash: string }).password_hash;

const base: Principal = {
  role: "medical",
  judge: false,
  admin: false,
  accountId: "acct-x",
  displayName: null,
  office: null,
  caseloadOf: null,
  personId: null,
  contactId: null,
};

describe("受入一覧の入口（ownPasswordEntry）", () => {
  it("医療班・行政のアカウントは open", () => {
    expect(ownPasswordEntry({ ...base, role: "medical" })).toBe("open");
    expect(ownPasswordEntry({ ...base, role: "government" })).toBe("open");
  });

  it("審査員のログインは、どの役でも医療班・行政なら fixed（ケアマネ・本人・家族の役は入口なし）", () => {
    for (const role of JUDGE_ROLES) {
      const e = ownPasswordEntry({ ...base, role, judge: true, accountId: DEMO_JUDGE_ACCOUNT_ID });
      expect(e, role).toBe(role === "medical" ? "fixed" : null);
    }
    expect(ownPasswordEntry({ ...base, role: "government", judge: true, accountId: DEMO_JUDGE_ACCOUNT_ID })).toBe("fixed");
  });

  it("種の固定のアカウント（役を替えた山本・西村・審査員の行）は fixed", () => {
    for (const id of [DEMO_CARE_MANAGER_ID, DEMO_SECOND_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID]) {
      const switched: Principal = { ...base, accountId: id, switched: true };
      expect(ownPasswordEntry(switched), id).toBe("fixed");
      expect(ownPasswordEntry({ ...base, role: "government", accountId: id }), id).toBe("fixed");
    }
  });

  it("ケアマネ（事業所の画面の自分の行から。T61）・本人・家族・役未選択・アカウントなし・ログインなしは入口なし", () => {
    for (const role of ROLES.filter((r) => r !== "medical" && r !== "government")) expect(ownPasswordEntry({ ...base, role }), role).toBeNull();
    expect(ownPasswordEntry({ ...base, accountId: null })).toBeNull();
    expect(ownPasswordEntry(null)).toBeNull();
  });

  it("ログインで作られる役の形でも同じ: 医療班・行政は open、審査員の医療班・役を替えた山本は fixed", async () => {
    expect(ownPasswordEntry((await loginOk("kyugo1", MED_PW)).principal)).toBe("open");
    expect(ownPasswordEntry((await loginOk("shi01", GOV_PW)).principal)).toBe("open");
    expect(ownPasswordEntry((await loginOk("yamamoto", CM_PW)).principal)).toBeNull();

    const judge = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
    const judgeMed = await chooseJudgeRole(db, env(), SECRET, judge.token, "medical", NOW + 1);
    expect(judgeMed?.principal.role).toBe("medical");
    expect(ownPasswordEntry(judgeMed!.principal)).toBe("fixed");

    const y = await loginOk("yamamoto", CM_PW);
    const yMed = await chooseRole(db, env(), SECRET, y.token, "medical", NOW + 1);
    // T144: ログインの山本は確認用の事業所のアカウント
    expect(yMed?.principal).toMatchObject({ role: "medical", switched: true, accountId: LOGIN_CARE_MANAGER_ID });
    expect(ownPasswordEntry(yMed!.principal)).toBe("fixed");
  });
});

describe("隠した欄の ID（ownLoginId）", () => {
  it("アカウントの login_id。無い・停止した人は null", async () => {
    expect(await ownLoginId(db, "acct-med-t99")).toBe("kyugo1");
    expect(await ownLoginId(db, "acct-gov-t99")).toBe("shi01");
    expect(await ownLoginId(db, "acct-none")).toBeNull();
    sqlite.prepare("UPDATE accounts SET disabled_at = '2026-11-04T00:00:00.000Z' WHERE id = 'acct-gov-t99'").run();
    expect(await ownLoginId(db, "acct-gov-t99")).toBeNull();
  });
});

describe("変える処理（T61 と同じ passwordChangeRequest）", () => {
  it("行政のアカウントも変えられる。前のパスワードは通らず、新しいので入れる。この端末の token はそのまま使える", async () => {
    const g = await loginOk("shi01", GOV_PW);
    const r = await passwordChangeRequest(db, env(), SECRET, g.principal, { current: GOV_PW, next: "Gov-next-pass-01" }, NOW + 5, FAST);
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(r.token).toBeTypeOf("string");
    expect((await resolvePrincipal(db, env(), SECRET, r.token!, NOW + 6))?.accountId).toBe("acct-gov-t99");
    expect(await resolvePrincipal(db, env(), SECRET, g.token, NOW + 6)).toBeNull();
    expect((await login(db, env(), SECRET, { loginId: "shi01", password: GOV_PW }, NOW + 7)).ok).toBe(false);
    expect((await login(db, env(), SECRET, { loginId: "shi01", password: "Gov-next-pass-01" }, NOW + 7)).ok).toBe(true);
  });

  it("医療班の今のパスワードの打ち間違いは、ログインと同じ回数（15 分に 10 回）で止まり、止めている間は正しくても変えない", async () => {
    const m = await loginOk("kyugo1", MED_PW);
    const before = hashOf("acct-med-t99");
    for (let i = 1; i < LOCK_FAILURES; i++) {
      const r = await passwordChangeRequest(db, env(), SECRET, m.principal, { current: `wrong-${i}`, next: "Med-next-pass-01" }, NOW + i, FAST);
      expect(r.status, `${i}`).toBe(400);
      expect(r.body).toEqual({ ok: false, error: "wrong_password", label: PASSWORD_CHANGE_ERROR_LABELS.wrong_password });
    }
    const last = await passwordChangeRequest(db, env(), SECRET, m.principal, { current: "wrong-last", next: "Med-next-pass-01" }, NOW + 20, FAST);
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ ok: false, error: "locked", label: "回数超過 しばらく待機" });
    expect(last.retryAfterSec).toBeGreaterThan(0);
    const right = await passwordChangeRequest(db, env(), SECRET, m.principal, { current: MED_PW, next: "Med-next-pass-01" }, NOW + 30, FAST);
    expect(right.status).toBe(429);
    expect(hashOf("acct-med-t99")).toBe(before);
  });

  it("審査員の医療班・役を替えた山本は 403 fixed（「固定」）で、表は変わらない", async () => {
    const judge = await loginOk(JUDGE_LOGIN_ID, JUDGE_PW);
    const judgeMed = (await chooseJudgeRole(db, env(), SECRET, judge.token, "medical", NOW + 1))!;
    const y = await loginOk("yamamoto", CM_PW);
    const yMed = (await chooseRole(db, env(), SECRET, y.token, "medical", NOW + 1))!;
    const before = [hashOf(DEMO_CARE_MANAGER_ID), hashOf(DEMO_JUDGE_ACCOUNT_ID)];
    for (const [p, current] of [
      [judgeMed.principal, JUDGE_PW],
      [yMed.principal, CM_PW],
    ] as const) {
      const r = await passwordChangeRequest(db, env(), SECRET, p, { current, next: "Fixed-next-pass-1" }, NOW + 2, FAST);
      expect(r).toMatchObject({ status: 403, body: { ok: false, error: "fixed", label: "固定" }, token: null });
    }
    expect([hashOf(DEMO_CARE_MANAGER_ID), hashOf(DEMO_JUDGE_ACCOUNT_ID)]).toEqual(before);
  });
});
