// 初期パスワードのままの印（docs/tasks/T114.md の問い 1 の (b)、migration 0027）。
// 人が作ったパスワード（new-office.ts の管理者・ケアマネ追加・再発行・new-staff.ts の医療班と行政）のまま入った人に、
// ヘッダーの下の「初期パスワード」と「変更」（自分の変更の欄を開いた形で送る）。本人が変えると消え、再発行で戻る。
// 種の固定のアカウント（山本）・審査員・役を替えた山本・審査員が足したアカウントには出さない。変えるまでほかの画面へ行けない、にはしない。
// D1 は node:sqlite（lib/db/test-d1.ts）。ハッシュの回数はテストだけ減らす。

import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_PASSWORD_LABELS, InitialPasswordBand } from "../../components/InitialPasswordBand.tsx";
import { CareManagerRow } from "../../components/office/CareManagerRow.tsx";
import { StaffPassword } from "../../components/staff/StaffPassword.tsx";
import { seedStatements } from "../../seed/sql.ts";
import { newOfficeSql } from "../../tools/office/new-office.ts";
import { newStaffSql } from "../../tools/office/new-staff.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { addCareManager, resetCareManagerPassword } from "../office/staff.ts";
import { officeActor } from "../office/scope.ts";
import { CARE_MANAGERS_ANCHOR } from "../office/http-paths.ts";
import { DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID } from "./demo.ts";
import { hashPassword } from "./password.ts";
import { changeOwnPassword, initialPasswordHref, wantsOwnPassword } from "./password-change.ts";
import { chooseJudgeRole, chooseRole, login, resolvePrincipal, type Principal } from "./principal.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const SECRET = "t114-test-secret-0123456789abcdef-012";
const NOW = 1_793_800_000;
const AT = "2026-11-05T03:00:00.000Z";
const FAST = { iterations: 1000 };
const ADMIN_PW = "t114-admin-initial-01";
const YAMAMOTO_PW = "t114-yamamoto-pass-01";
const JUDGE_PW = "t114-judge-pass-00001";
const OFFICE = "office-t114";
const OFFICE_HREF = `/office?password=1#${CARE_MANAGERS_ANCHOR}`;

let adminHash: string;
let yamamotoHash: string;
let judgeHash: string;
beforeAll(async () => {
  [adminHash, yamamotoHash, judgeHash] = await Promise.all([ADMIN_PW, YAMAMOTO_PW, JUDGE_PW].map((pw) => hashPassword(pw, FAST)));
});

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements({ passwordHashes: { [DEMO_CARE_MANAGER_ID]: yamamotoHash } })) sqlite.exec(s);
  // new-office.ts の新しい事業所（本物の事業所の形。種の位置でない）と最初の管理者
  sqlite.exec(
    newOfficeSql({
      officeId: OFFICE,
      name: "架空居宅介護支援",
      city: "今治市",
      planForm: "matsuyama",
      loginId: "t114-admin",
      displayName: "佐藤",
      accountId: "acct-t114-admin",
      passwordHash: adminHash,
      at: AT,
    }),
  );
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const initialOf = (id: string) => (sqlite.prepare("SELECT password_initial AS v FROM accounts WHERE id = ?").get(id) as { v: number }).v;

async function loginAs(loginId: string, password: string): Promise<{ principal: Principal; token: string }> {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW);
  if (!r.ok) throw new Error(`入れない: ${loginId}`);
  return { principal: r.principal, token: r.token };
}

describe("初期パスワードの印（表と Principal）", () => {
  it("new-office.ts の管理者は初期パスワードのまま入ると印が付き、送り先は事業所の画面の自分の行（欄を開いて）", async () => {
    expect(initialOf("acct-t114-admin")).toBe(1);
    const { principal, token } = await loginAs("t114-admin", ADMIN_PW);
    expect(principal.initialPassword).toBe(true);
    expect(initialPasswordHref(principal)).toBe(OFFICE_HREF);
    // 次の要求（cookie から）でも同じ
    const again = await resolvePrincipal(db, env(), SECRET, token, NOW + 60);
    expect(again?.initialPassword).toBe(true);
  });

  it("本人が自分で変えると印が外れ、変えた端末のセッションでも出ない。再発行で戻る", async () => {
    const admin = (await loginAs("t114-admin", ADMIN_PW)).principal;
    const added = await addCareManager(db, officeActor(admin)!, { displayName: "鈴木", loginId: "t114-cm" }, AT, FAST);
    if (!added.ok) throw new Error("追加できない");
    expect(initialOf(added.account.id)).toBe(1);

    const cm = await loginAs("t114-cm", added.password);
    expect(initialPasswordHref(cm.principal)).toBe(OFFICE_HREF);
    const changed = await changeOwnPassword(db, env(), SECRET, cm.principal, { current: added.password, next: "t114-own-new-pass" }, NOW, FAST);
    if (!changed.ok) throw new Error(changed.error);
    expect(initialOf(added.account.id)).toBe(0);
    const after = await resolvePrincipal(db, env(), SECRET, changed.token, NOW + 1);
    expect(after?.initialPassword).toBeUndefined();
    expect(initialPasswordHref(after)).toBeNull();

    // 管理者が再発行すると、人が作ったパスワードに戻るので印も戻る
    const reset = await resetCareManagerPassword(db, officeActor(admin)!, added.account.id, AT, FAST);
    if (!reset.ok) throw new Error(reset.error);
    expect(initialOf(added.account.id)).toBe(1);
    expect((await loginAs("t114-cm", reset.password)).principal.initialPassword).toBe(true);
  });

  it("変更に失敗した（今のパスワード違い）ときは印を外さない", async () => {
    const admin = await loginAs("t114-admin", ADMIN_PW);
    const r = await changeOwnPassword(db, env(), SECRET, admin.principal, { current: "wrong-password-0", next: "t114-own-new-pass" }, NOW, FAST);
    expect(r.ok).toBe(false);
    expect(initialOf("acct-t114-admin")).toBe(1);
  });

  it("new-staff.ts の医療班・行政も同じ印で、送り先は受入一覧（欄を開いて）。再発行の SQL も印を戻す", async () => {
    const hash = await hashPassword("t114-staff-initial", FAST);
    sqlite.exec(
      newStaffSql({ action: "create", role: "medical", loginId: "t114-med", displayName: "第1救護所", out: null }, { accountId: "acct-t114-med", passwordHash: hash, at: AT }),
    );
    const med = await loginAs("t114-med", "t114-staff-initial");
    expect(med.principal.role).toBe("medical");
    expect(initialPasswordHref(med.principal)).toBe("/staff?password=1");
    const changed = await changeOwnPassword(db, env(), SECRET, med.principal, { current: "t114-staff-initial", next: "t114-staff-own-01" }, NOW, FAST);
    expect(changed.ok).toBe(true);
    expect(initialOf("acct-t114-med")).toBe(0);
    sqlite.exec(newStaffSql({ action: "reissue", loginId: "t114-med", out: null }, { accountId: "x", passwordHash: hash, at: AT }));
    expect(initialOf("acct-t114-med")).toBe(1);
  });

  it("審査員・山本（固定）・役を替えた山本・審査員が足したアカウントには出さない（表の値が 1 でも）", async () => {
    // 種のアカウントは表の既定で 1 のまま（印は Principal で外す）
    expect(initialOf(DEMO_CARE_MANAGER_ID)).toBe(1);
    const yamamoto = await loginAs("yamamoto", YAMAMOTO_PW);
    expect(yamamoto.principal.initialPassword).toBeUndefined();
    expect(initialPasswordHref(yamamoto.principal)).toBeNull();
    const switched = await chooseRole(db, env(), SECRET, yamamoto.token, "medical", NOW);
    expect(switched?.principal.switched).toBe(true);
    expect(initialPasswordHref(switched?.principal ?? null)).toBeNull();

    const judge = await login(db, env(), SECRET, { loginId: "judge", password: JUDGE_PW }, NOW);
    if (!judge.ok) throw new Error("審査員で入れない");
    const cmRole = await chooseJudgeRole(db, env(), SECRET, judge.token, "care_manager", NOW);
    expect(cmRole?.principal.judge).toBe(true);
    expect(initialPasswordHref(cmRole?.principal ?? null)).toBeNull();

    // 審査員（ケアマネの役）が足したケアマネ（judge_made）で入る: 壁の中なので印を出さない
    const added = await addCareManager(db, officeActor(cmRole!.principal)!, { displayName: "試し", loginId: "t114-judge-made" }, AT, FAST);
    if (!added.ok) throw new Error("審査員が足せない");
    expect(initialOf(added.account.id)).toBe(1);
    const made = await loginAs("t114-judge-made", added.password);
    expect(made.principal.judgeMade).toBe(true);
    expect(made.principal.office?.id).toBe(DEMO_OFFICE_ID);
    expect(made.principal.initialPassword).toBeUndefined();
    expect(initialPasswordHref(made.principal)).toBeNull();
  });

  it("送り先の純関数: 印が無い・ログインなし・本人と家族は null", () => {
    expect(initialPasswordHref(null)).toBeNull();
    const base = { judge: false, accountId: "acct-x", switched: false, judgeMade: false } as const;
    expect(initialPasswordHref({ ...base, role: "care_manager" })).toBeNull();
    expect(initialPasswordHref({ ...base, role: "care_manager", initialPassword: true })).toBe(OFFICE_HREF);
    expect(initialPasswordHref({ ...base, role: "government", initialPassword: true })).toBe("/staff?password=1");
    expect(initialPasswordHref({ ...base, role: "self", initialPassword: true })).toBeNull();
    expect(initialPasswordHref({ ...base, role: "family", initialPassword: true })).toBeNull();
    expect(initialPasswordHref({ ...base, role: "care_manager", initialPassword: true, accountId: DEMO_CARE_MANAGER_ID })).toBeNull();
    expect(wantsOwnPassword("1")).toBe(true);
    expect(wantsOwnPassword(["1", "0"])).toBe(true);
    expect(wantsOwnPassword(undefined)).toBe(false);
    expect(wantsOwnPassword("yes")).toBe(false);
  });
});

describe("migration 0027 の前からある行", () => {
  /** 0026 までを流した DB（0027 の前の形） */
  function before0027(): DatabaseSync {
    const d = new DatabaseSync(":memory:");
    d.exec("PRAGMA foreign_keys = ON;");
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql") && n < "0027").sort()) d.exec(readFileSync(new URL(name, dir), "utf8"));
    return d;
  }

  it("事業所の行は、本人の変更が最後の再発行より後なら 0、無ければ 1。事業所の無い医療班・行政は分からないので 0", () => {
    const d = before0027();
    d.exec(`INSERT INTO offices (id, name, kind, city, plan_form) VALUES ('o1', '架空', 'regular', '松山市', 'matsuyama')`);
    const acct = (id: string, office: string | null, role = "care_manager") =>
      d.exec(`INSERT INTO accounts (id, office_id, role, display_name, login_id, password_hash) VALUES ('${id}', ${office ? `'${office}'` : "NULL"}, '${role}', '${id}', '${id}', 'h')`);
    const log = (account: string, change: string, at: string) =>
      d.exec(
        `INSERT INTO office_timeline_entries (id, office_id, author_role, kind, body, payload, occurred_at)
         VALUES ('${account}-${change}-${at}', 'o1', 'care_manager', 'care_manager_changed', 'x', json_object('accountId', '${account}', 'change', '${change}'), '${at}')`,
      );
    acct("never", "o1"); // 追加のあと変えていない
    acct("changed", "o1");
    log("changed", "password", "2026-11-04T10:00:00Z");
    acct("reissued", "o1"); // 変えたあとに再発行された
    log("reissued", "password", "2026-11-04T10:00:00Z");
    log("reissued", "reset_password", "2026-11-04T11:00:00Z");
    acct("again", "o1"); // 再発行のあとにまた変えた
    log("again", "reset_password", "2026-11-04T11:00:00Z");
    log("again", "password", "2026-11-04T12:00:00Z");
    acct("staff", null, "medical");

    d.exec(readFileSync(new URL("../../migrations/0027_account_password_initial.sql", import.meta.url), "utf8"));
    const rows = Object.fromEntries(
      (d.prepare("SELECT id, password_initial FROM accounts ORDER BY id").all() as { id: string; password_initial: number }[]).map((r) => [r.id, r.password_initial]),
    );
    expect(rows).toEqual({ again: 0, changed: 0, never: 1, reissued: 1, staff: 0 });
    // 新しい行は既定で 1
    d.exec(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('fresh', 'o1', 'care_manager', 'fresh')`);
    expect((d.prepare("SELECT password_initial AS v FROM accounts WHERE id = 'fresh'").get() as { v: number }).v).toBe(1);
    expect(() => d.exec(`UPDATE accounts SET password_initial = 2 WHERE id = 'fresh'`)).toThrow(/CHECK/);
    d.close();
  });
});

describe("ヘッダーの下の印と、開いて出す変更の欄", () => {
  it("印は黄の塗り「初期パスワード」と「変更」（送り先へのリンク、アイコンと文字）。黄の文字・説明文は無い", () => {
    const html = renderToStaticMarkup(createElement(InitialPasswordBand, { href: OFFICE_HREF }));
    expect(html).toMatch(/data-tone="check"[^>]*>初期パスワード</);
    expect(html).toContain(`href="/office?password=1#${CARE_MANAGERS_ANCHOR}"`);
    expect(html).toMatch(/<a[^>]*data-initial-password-change[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?変更/);
    expect(html).not.toContain("text-state-check");
    expect(INITIAL_PASSWORD_LABELS.change.length).toBeLessThanOrEqual(4);
  });

  it("事業所の画面の自分の行: 開いて出すと変更の欄（現在・新規・確認）。固定の行・ほかの人の行には効かない", () => {
    const item = { id: "acct-t114-admin", name: "佐藤", loginId: "t114-admin", admin: true, people: 0, disabled: false };
    const row = (p: { self: boolean; openPassword: boolean; id?: string }) =>
      renderToStaticMarkup(createElement("ul", null, createElement(CareManagerRow, { item: { ...item, id: p.id ?? item.id }, self: p.self, manage: true, openPassword: p.openPassword })));
    expect(row({ self: true, openPassword: true })).toContain('data-cm-form="password"');
    expect(row({ self: true, openPassword: false })).not.toContain('data-cm-form="password"');
    expect(row({ self: false, openPassword: true })).not.toContain('data-cm-form="password"');
    expect(row({ self: true, openPassword: true, id: DEMO_CARE_MANAGER_ID })).not.toContain('data-cm-form="password"');
  });

  it("受入一覧の見出しの行: 開いて出すと欄。入口が固定なら開かない", () => {
    const open = renderToStaticMarkup(createElement(StaffPassword, { entry: "open", loginId: "t114-med", initialOpen: true }));
    expect(open).toContain('data-own-password="form"');
    expect(renderToStaticMarkup(createElement(StaffPassword, { entry: "open", loginId: "t114-med" }))).not.toContain('data-own-password="form"');
    expect(renderToStaticMarkup(createElement(StaffPassword, { entry: "fixed", loginId: null, initialOpen: true }))).not.toContain('data-own-password="form"');
  });

  it("ヘッダーは右の並び（事業所名 → 役 → 役変更 → ログアウト）の外の 2 段目に置く", () => {
    const src = readFileSync(new URL("../../components/AppHeader.tsx", import.meta.url), "utf8");
    const who = src.slice(src.indexOf("function Who"));
    expect(who).not.toContain("InitialPasswordBand");
    expect(src).toMatch(/\{initialHref && <InitialPasswordBand href=\{initialHref\} \/>\}/);
  });
});
