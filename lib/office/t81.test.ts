// T81: 審査員が足したアカウントの印と壁（朝の見直し 11/4 の安全 高 2・低の login_id）。
// - 審査員（ケアマネの役）が足した・再発行したケアマネには印（accounts.judge_made、migration 0025）。そのアカウントで入っても審査員と同じ壁
//   （本物のアンケートは見えない・作るリンクは審査員の物・所属なしの引受はデモの登録だけ・事業所の地域は書けない）
// - 審査員（壁の中）が変えられるのは印の付いたアカウントだけ（本物のアカウントを再発行して、その人として入れないように）
// - 本物のアンケート（審査員でない人が作ったリンクと答え）は、作った本人と壁の外の管理者だけが見る
// - 毎朝 4 時の戻しで、審査員が足したアカウントと、その人が作ったリンク・答えは消える
// - ケアマネ追加の ID の重なり: 同じ事業所は「ID 使用中」、ほかの事業所は別の言い方（ID 不可）。login_id の一意は保つ
// - 0025 は前からある審査員の追加・再発行を事業所の経過から拾って印を付ける

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { isWalled } from "../auth/wall.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { demoResetStatements } from "../seed/reset.ts";
import { createLinkRequest } from "../survey/links.ts";
import { createSurveyShare, loadSurveyOverview } from "../survey/store.ts";
import { submitSurvey } from "../survey/submit.ts";
import { MIN_FILL_SEC, openStamp } from "../survey/token.ts";
import { addCareManagerRequest, careManagerActionRequest } from "./http.ts";
import { OFFICE_ERROR_LABELS } from "./labels.ts";
import { listCareManagers } from "./people.ts";
import { officeActor } from "./scope.ts";
import { addCareManager } from "./staff.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const AT = "2026-11-04T01:00:00.000Z";
const T0 = new Date(AT);
const SECRET = "test-secret-0123456789-0123456789-abcdef";
const NOW_SEC = Math.floor(Date.parse(AT) / 1000) + 60;
const FAST = { iterations: 1000 };
const ORIGIN = "http://localhost:3072";

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
const judgeCm = (): Principal => yamamoto({ judge: true, admin: false, accountId: "acct-judge" });
const partnerCm = (): Principal => yamamoto({ accountId: "acct-partner-cm", displayName: null, office: PARTNER, caseloadOf: "acct-partner-cm" });

const count = (sql: string, ...args: (string | number | null)[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;
const judgeMadeOf = (id: string) => (sqlite.prepare("SELECT judge_made AS j FROM accounts WHERE id = ?").get(id) as { j: number }).j;

/** ケアマネを足して、その人でログインした Principal（セッションを読み直した物） */
async function addAndLogin(by: Principal, loginId: string, name = "架空 一") {
  const out = await addCareManagerRequest(db, by, { displayName: name, loginId }, AT, FAST);
  expect(out.status).toBe(200);
  const { account, password } = out.body as { account: { id: string }; password: string };
  const l = await login(db, {}, SECRET, { loginId, password }, NOW_SEC);
  if (!l.ok) throw new Error("ログインできない");
  const principal = (await resolvePrincipal(db, {}, SECRET, l.token, NOW_SEC))!;
  return { id: account.id, password, principal };
}

/** 共有のリンクを作る（作れなければ投げる） */
async function share(createdBy: string, createdRole: "care_manager" | "judge", officeId = "office-demo"): Promise<string> {
  const r = await createSurveyShare(db, { officeId, memo: "", createdBy, createdRole }, T0);
  if (!r.ok) throw new Error(r.error);
  return r.token;
}

/** 答えを 1 件送る（開いてから 30 秒） */
async function answer(token: string, comment: string) {
  const r = await submitSurvey(db, {
    token,
    contentType: "application/json",
    body: JSON.stringify({ opened: await openStamp(token, T0, SECRET), answers: { q1: "a", comment } }),
    ip: "203.0.113.9",
    now: new Date(T0.getTime() + (MIN_FILL_SEC + 30) * 1000),
    secret: SECRET,
    turnstile: null,
  });
  expect(r.status).toBe(200);
}

/** 事業所の画面と同じ見る人（app/office/page.tsx） */
const viewerOf = (p: Principal) => ({ walled: isWalled(p), admin: p.admin, accountId: p.accountId });

describe("審査員が足したアカウントの印（高 2）", () => {
  it("審査員が足すと印 1、山本・協力事業所が足すと 0。印の人で入ると judge は付かず judgeMade、壁の中", async () => {
    const byJudge = await addAndLogin(judgeCm(), "judge-made-1");
    const byYamamoto = await addAndLogin(yamamoto(), "sato");
    const r = await addCareManager(db, officeActor(partnerCm())!, { displayName: "協力 二", loginId: "partner2" }, AT, FAST);
    expect(r.ok).toBe(true);
    expect(judgeMadeOf(byJudge.id)).toBe(1);
    expect(judgeMadeOf(byYamamoto.id)).toBe(0);
    expect(judgeMadeOf(r.ok ? r.account.id : "")).toBe(0);

    expect(byJudge.principal).toMatchObject({ role: "care_manager", judge: false, judgeMade: true, office: { id: "office-demo" } });
    expect(isWalled(byJudge.principal)).toBe(true);
    expect(byYamamoto.principal).toMatchObject({ judge: false, judgeMade: false });
    expect(isWalled(byYamamoto.principal)).toBe(false);
    // 印の人を審査員が管理者にしても、事業所の地域は書けない。足す人にも印が付く
    expect((await careManagerActionRequest(db, judgeCm(), byJudge.id, { action: "admin", admin: true }, AT)).status).toBe(200);
    const admin = (await resolvePrincipal(db, {}, SECRET, (await login(db, {}, SECRET, { loginId: "judge-made-1", password: byJudge.password }, NOW_SEC) as { token: string }).token, NOW_SEC))!;
    expect(officeActor(admin)).toMatchObject({ admin: true, placeEdit: false, walled: true });
    const second = await addAndLogin(admin, "judge-made-2");
    expect(judgeMadeOf(second.id)).toBe(1);
  });

  it("審査員（と印の人）は、審査員でない人が足したアカウントを変えられない（固定と同じ断り）。印の付いた人は変えられる", async () => {
    const real = await addAndLogin(yamamoto(), "sato");
    const made = await addAndLogin(judgeCm(), "judge-made-1");
    for (const action of [
      { action: "reset_password" },
      { action: "rename", displayName: "佐藤 二" },
      { action: "admin", admin: true },
      { action: "disable", disabled: true },
    ]) {
      const out = await careManagerActionRequest(db, judgeCm(), real.id, action, AT, FAST);
      expect(out, JSON.stringify(action)).toMatchObject({ status: 403, body: { error: "fixed", label: OFFICE_ERROR_LABELS.fixed } });
    }
    // 本物のアカウントのパスワード・名前は変わらない（再発行の平文も返らない）
    const l = await login(db, {}, SECRET, { loginId: "sato", password: real.password }, NOW_SEC);
    expect(l.ok).toBe(true);
    expect(count("SELECT count(*) AS n FROM office_timeline_entries WHERE kind = 'care_manager_changed'")).toBe(0);
    // 印の付いた人は審査員が再発行できる。山本（壁の外）は本物も変えられる
    const reset = await careManagerActionRequest(db, judgeCm(), made.id, { action: "reset_password" }, AT, FAST);
    expect(reset.status).toBe(200);
    expect((await careManagerActionRequest(db, yamamoto(), real.id, { action: "rename", displayName: "佐藤 二" }, AT)).status).toBe(200);
    // 一覧: 印の人だけ judgeMade
    const list = await listCareManagers(db, "office-demo");
    expect(list.find((c) => c.id === made.id)?.judgeMade).toBe(true);
    expect(list.find((c) => c.id === real.id)?.judgeMade).toBe(false);
  });
});

describe("本物のアンケートは作った本人と壁の外の管理者だけ（高 2）", () => {
  it("審査員が足したアカウントで入っても本物のリンク・答えは見えない。作るリンクは審査員の物", async () => {
    const real = await share("acct-yamamoto", "care_manager");
    await answer(real, "本物の自由記述");
    const made = await addAndLogin(judgeCm(), "judge-made-1");

    const view = await loadSurveyOverview(db, "office-demo", viewerOf(made.principal), AT);
    expect(view.shares).toEqual([]);
    expect(view.answers).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("本物の自由記述");

    const out = await createLinkRequest(db, made.principal, { memo: "試し" }, T0, ORIGIN);
    expect(out.status).toBe(200);
    expect(sqlite.prepare("SELECT created_by, created_role FROM survey_shares WHERE created_by = ?").get(made.id)).toEqual({
      created_by: made.id,
      created_role: "judge",
    });
    const after = await loadSurveyOverview(db, "office-demo", viewerOf(made.principal), AT);
    expect(after.shares.map((s) => s.judge)).toEqual([true]);
    // 審査員本人も同じ（審査員の物だけ）
    const judgeView = await loadSurveyOverview(db, "office-demo", viewerOf(judgeCm()), AT);
    expect(judgeView.shares.map((s) => s.judge)).toEqual([true]);
    expect(JSON.stringify(judgeView)).not.toContain("本物の自由記述");
  });

  it("T81 の前に印の人が care_manager で作ったリンクも審査員の物として扱い、本物の管理者の画面では試しの印", async () => {
    const made = await addAndLogin(judgeCm(), "judge-made-1");
    const old = await share(made.id, "care_manager");
    await answer(old, "印の人の試し");
    const forMade = await loadSurveyOverview(db, "office-demo", viewerOf(made.principal), AT);
    expect(forMade.shares.map((s) => [s.token, s.judge])).toEqual([[old, true]]);
    const forAdmin = await loadSurveyOverview(db, "office-demo", viewerOf(yamamoto()), AT);
    expect(forAdmin.answers.map((a) => [a.id, a.judge])).toEqual([["T001", true]]);
  });

  it("管理者でない本物のケアマネは自分が作った本物だけ。番号は事業所の全部で数える（見る人で変わらない）", async () => {
    const sato = await addAndLogin(yamamoto(), "sato", "佐藤");
    const mine = await share(sato.id, "care_manager");
    const others = await share("acct-yamamoto", "care_manager");
    const trial = await share("acct-judge", "judge");
    await answer(others, "山本の配った先の答え");
    await answer(mine, "佐藤の配った先の答え");
    await answer(trial, "審査員の試し");

    const forSato = await loadSurveyOverview(db, "office-demo", viewerOf(sato.principal), AT);
    expect(forSato.shares.map((s) => s.token)).toEqual([mine]);
    expect(forSato.answers.map((a) => a.id)).toEqual(["W002"]);
    expect(JSON.stringify(forSato)).not.toMatch(/山本の配った先|審査員の試し/);

    const forAdmin = await loadSurveyOverview(db, "office-demo", viewerOf(yamamoto()), AT);
    expect(forAdmin.shares).toHaveLength(3);
    expect(forAdmin.answers.map((a) => a.id)).toEqual(["W001", "W002", "T001"]);
  });
});

describe("毎朝 4 時の戻し", () => {
  it("審査員が足したアカウントと、その人が作ったリンク・答え（T81 の前の care_manager の物も）が消える。本物は残る", async () => {
    const made = await addAndLogin(judgeCm(), "judge-made-1");
    const real = await share("acct-yamamoto", "care_manager");
    await answer(real, "本物");
    const old = await share(made.id, "care_manager");
    await answer(old, "試し");
    expect((await createLinkRequest(db, made.principal, { memo: "" }, T0, ORIGIN)).status).toBe(200);

    for (const s of demoResetStatements(AT)) sqlite.exec(s);
    expect(count("SELECT count(*) AS n FROM accounts WHERE id = ?", made.id)).toBe(0);
    expect(count("SELECT count(*) AS n FROM accounts WHERE judge_made = 1")).toBe(0);
    expect((sqlite.prepare("SELECT token FROM survey_shares").all() as Array<{ token: string }>).map((r) => r.token)).toEqual([real]);
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(1);
    // 印の人のセッションは次の要求で切れる（アカウントが無い）
    const l = await login(db, {}, SECRET, { loginId: "judge-made-1", password: made.password }, NOW_SEC);
    expect(l.ok).toBe(false);
  });
});

describe("ケアマネ追加の ID の重なり（低）", () => {
  it("同じ事業所の ID は「ID 使用中」、ほかの事業所の ID は「ID 不可」（使用中と言わない）。どちらも足さない", async () => {
    await addAndLogin(yamamoto(), "sato");
    const same = await addCareManagerRequest(db, yamamoto(), { displayName: "佐藤 二", loginId: "sato" }, AT, FAST);
    expect(same).toMatchObject({ status: 409, body: { error: "login_taken", label: "ID 使用中" } });
    const cross = await addCareManagerRequest(db, partnerCm(), { displayName: "佐藤 三", loginId: "SATO" }, AT, FAST);
    expect(cross.status).toBe(409);
    expect(cross.body).toMatchObject({ error: "login_unavailable", label: "ID 不可" });
    expect(JSON.stringify(cross.body)).not.toContain("使用中");
    // 審査員がデモ事業所から協力事業所の ID を試しても「ID 不可」（協力事業所に誰がいるかを使用中と言わない）
    expect((await addCareManager(db, officeActor(partnerCm())!, { displayName: "協力 二", loginId: "partner2" }, AT, FAST)).ok).toBe(true);
    const fromDemo = await addCareManagerRequest(db, judgeCm(), { displayName: "架空", loginId: "partner2" }, AT, FAST);
    expect(fromDemo).toMatchObject({ status: 409, body: { error: "login_unavailable", label: "ID 不可" } });
    expect(count("SELECT count(*) AS n FROM accounts WHERE login_id = 'partner2'")).toBe(1);
    expect(count("SELECT count(*) AS n FROM accounts WHERE lower(login_id) = 'sato'")).toBe(1);
  });
});

describe("migration 0025 は前からある審査員の追加・再発行に印を付ける", () => {
  it("事業所の経過の書き手が審査員の care_manager_added と再発行だけ。山本が足した人・固定のアカウントは 0", () => {
    const dir = new URL("../../migrations/", import.meta.url);
    const names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
    const old = new DatabaseSync(":memory:");
    old.exec("PRAGMA foreign_keys = ON;");
    // 種は書類の見直しの表（0032、T136）と紙の手入れの表（0033、T135）も空にするので 0032・0033 も先に（新しい表を作るだけで accounts・経過に触れない）。
    // 種はデモ事業所の情報と地域（0035、T148）も書くので 0035 も先に（offices に列を足すだけで accounts・経過に触れない）
    for (const n of names.filter((x) => x < "0025_" || x.startsWith("0032_") || x.startsWith("0033_") || x.startsWith("0035_"))) old.exec(readFileSync(new URL(n, dir), "utf8"));
    for (const s of seedStatements()) {
      // 種は 0025 の前の形でも入る（judge_made の列を書かない）
      old.exec(s);
    }
    const add = (id: string, by: string, kind: string, change: string | null) => {
      old.exec(`INSERT INTO accounts (id, office_id, role, display_name, login_id) VALUES ('${id}', 'office-demo', 'care_manager', '${id}', '${id}')`);
      const payload = change ? `{"accountId":"${id}","change":"${change}"}` : `{"accountId":"${id}"}`;
      old.exec(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
         VALUES ('ot-${id}', 'office-demo', '${by}', 'care_manager', '${kind}', 'x', '${payload}', '${AT}')`,
      );
    };
    add("acct-a", "acct-judge", "care_manager_added", null);
    add("acct-b", "acct-yamamoto", "care_manager_added", null);
    add("acct-c", "acct-yamamoto", "care_manager_changed", "rename");
    old.exec(
      `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
       VALUES ('ot-c-reset', 'office-demo', 'acct-judge', 'care_manager', 'care_manager_changed', 'x', '{"accountId":"acct-c","change":"reset_password"}', '${AT}')`,
    );
    add("acct-d", "acct-judge", "care_manager_changed", "rename");
    old.exec(readFileSync(new URL(names.find((n) => n.startsWith("0025_"))!, dir), "utf8"));
    const marks = old.prepare("SELECT id, judge_made FROM accounts WHERE id LIKE 'acct-%' ORDER BY id").all() as Array<{ id: string; judge_made: number }>;
    const m = Object.fromEntries(marks.map((r) => [r.id, r.judge_made]));
    expect(m).toMatchObject({ "acct-a": 1, "acct-b": 0, "acct-c": 1, "acct-d": 0, "acct-judge": 0, "acct-yamamoto": 0, "acct-nishimura": 0 });
    old.close();
  });
});
