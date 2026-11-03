// 利用者の追加・担当の割当・一覧から外す・ケアマネの追加（docs/tasks/T30.md）。
// 新規の作成が事業所に閉じる、担当の割当、ケアマネの追加が管理者だけ、外す印、本人の経過と事業所の経過の記録。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人と、協力事業所の本人 1 人（テストだけ）。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { verifyPassword } from "../auth/password.ts";
import { login, type Principal } from "../auth/principal.ts";
import { personInScope } from "../auth/scope.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadOfficeLog, loadOfficeTowns, logLine } from "../disaster/db.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { normalizeKana, normalizeLoginId, parsePersonInput, parseStaffInput } from "./forms.ts";
import { addCareManagerRequest, createPersonRequest, peopleBackHref, peoplePost } from "./http.ts";
import { assignPerson, createPerson, listCareManagers, listOfficePeople, setUnlisted } from "./people.ts";
import { officeActor } from "./scope.ts";
import { addCareManager, generateInitialPassword } from "./staff.ts";
import { officeEntryOf } from "./timeline.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const PARTNER_PERSON = "p-partner-1";
const TODAY = "2026-11-03";
const AT = "2026-11-03T01:00:00.000Z";
/** テストだけのハッシュの回数（速くする） */
const FAST = { iterations: 1000 };

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01')`,
    )
    .run(PARTNER_PERSON);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };

/** デモ事業所の山本（管理者） */
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

/** 審査員のケアマネの役（管理者でない。書き手は審査員のアカウント） */
const judgeCm = (): Principal =>
  yamamoto({ judge: true, admin: false, accountId: "acct-judge", displayName: "山本" });

/** 協力事業所のケアマネ（管理者） */
const partnerCm = (): Principal =>
  yamamoto({ accountId: "acct-partner-cm", displayName: null, office: PARTNER, caseloadOf: "acct-partner-cm" });

const medical = (): Principal => yamamoto({ role: "medical", admin: false, accountId: null, office: null, caseloadOf: null });
const family = (): Principal =>
  yamamoto({ role: "family", admin: false, accountId: null, caseloadOf: null, personId: "p-01", contactId: "c-01-1" });

const NEW = { name: "架空 一郎", kana: "かくう いちろう", birthDate: "1941-04-01", sex: "male", careManagerId: "acct-yamamoto" };

const count = (sql: string, ...args: (string | number | null)[]) =>
  (sqlite.prepare(sql).get(...args) as { n: number }).n;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

/** 管理者でないケアマネ（佐藤）を足して、その Principal */
async function addSato(): Promise<{ id: string; principal: Principal; password: string }> {
  const r = await addCareManager(db, officeActor(yamamoto())!, { displayName: "佐藤", loginId: "sato" }, AT, FAST);
  if (!r.ok) throw new Error("足せない");
  return {
    id: r.account.id,
    password: r.password,
    principal: yamamoto({ admin: false, accountId: r.account.id, displayName: "佐藤", caseloadOf: r.account.id }),
  };
}

async function created(p: Principal = yamamoto(), input: Record<string, string> = NEW): Promise<string> {
  const r = await createPersonRequest(db, p, input, { at: AT, today: TODAY });
  if (r.status !== 200) throw new Error(`作れない: ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}

describe("入力の読み方", () => {
  it("カナはひらがな・半角カナ・全角の空白をそろえる", () => {
    expect(normalizeKana("かくう　いちろう")).toBe("カクウ イチロウ");
    expect(normalizeKana("ｶｸｳ ｲﾁﾛｳ")).toBe("カクウ イチロウ");
    expect(normalizeKana("  ヤマダ   ハナ ")).toBe("ヤマダ ハナ");
  });

  it("利用者: 5 つの欄を確かめる", () => {
    const ok = parsePersonInput(NEW, TODAY);
    expect(ok).toEqual({
      ok: true,
      value: { name: "架空 一郎", kana: "カクウ イチロウ", birthDate: "1941-04-01", sex: "male", careManagerId: "acct-yamamoto" },
    });
    expect(parsePersonInput({ ...NEW, name: " " }, TODAY)).toEqual({ ok: false, error: "name" });
    expect(parsePersonInput({ ...NEW, name: "あ".repeat(41) }, TODAY)).toEqual({ ok: false, error: "name" });
    expect(parsePersonInput({ ...NEW, kana: "Kakuu" }, TODAY)).toEqual({ ok: false, error: "kana" });
    expect(parsePersonInput({ ...NEW, birthDate: "1941-02-30" }, TODAY)).toEqual({ ok: false, error: "birth" });
    expect(parsePersonInput({ ...NEW, birthDate: "2026-11-04" }, TODAY)).toEqual({ ok: false, error: "birth" });
    expect(parsePersonInput({ ...NEW, birthDate: "1899-12-31" }, TODAY)).toEqual({ ok: false, error: "birth" });
    expect(parsePersonInput({ ...NEW, sex: "" }, TODAY)).toEqual({ ok: false, error: "sex" });
    expect(parsePersonInput({ ...NEW, careManagerId: "a b" }, TODAY)).toEqual({ ok: false, error: "care_manager" });
    expect(parsePersonInput(null, TODAY)).toEqual({ ok: false, error: "invalid" });
  });

  it("ケアマネ: ID は小文字の半角にそろえ、審査員の ID と形の違う ID は断る", () => {
    expect(normalizeLoginId(" Ｓａｔｏ ")).toBe("sato");
    expect(parseStaffInput({ displayName: " 佐藤 ", loginId: "Sato.K" })).toEqual({
      ok: true,
      value: { displayName: "佐藤", loginId: "sato.k" },
    });
    expect(parseStaffInput({ displayName: "佐藤", loginId: "judge" })).toEqual({ ok: false, error: "login_id" });
    expect(parseStaffInput({ displayName: "佐藤", loginId: "ab" })).toEqual({ ok: false, error: "login_id" });
    expect(parseStaffInput({ displayName: "佐藤", loginId: "さとう" })).toEqual({ ok: false, error: "login_id" });
    expect(parseStaffInput({ displayName: "", loginId: "sato" })).toEqual({ ok: false, error: "display_name" });
  });

  it("初期パスワードは 12 字＋区切りで、見分けにくい字を使わず、毎回違う", () => {
    const a = generateInitialPassword();
    expect(a).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    expect(a).not.toMatch(/[01ilo]/);
    expect(new Set(Array.from({ length: 20 }, generateInitialPassword)).size).toBe(20);
  });
});

describe("利用者追加", () => {
  it("ケアマネで作ると、未作成で担当一覧に 11 人目が出て、本人のページが開ける", async () => {
    const r = await createPersonRequest(db, yamamoto(), NEW, { at: AT, today: TODAY });
    expect(r.status).toBe(200);
    const id = r.body.id as string;
    expect(r.body.href).toBe(`/?open=${id}`);

    const list = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, AT);
    expect(list?.rows).toHaveLength(11);
    const row = list?.rows.find((x) => x.id === id);
    expect(row).toMatchObject({ name: "架空 一郎", kana: "カクウ イチロウ", age: 85, plan: "none", pending: 0 });

    const page = await loadPersonPage(db, yamamoto(), id);
    expect(page?.person).toMatchObject({ office_id: "office-demo", care_manager_id: "acct-yamamoto", origin: "care_manager" });
    expect(JSON.parse(page!.person.ledger)).toMatchObject({ basic: { sex: "male" }, pending: [] });
    // 同意は全部「未確認」の行で入る（T69a。記録した人は足した人、時刻は足した時刻）
    expect(page?.consents.map((c) => [c.kind, c.status, c.recorded_by, c.recorded_at]).sort()).toEqual(
      [
        ["medical", "unconfirmed", "acct-yamamoto", AT],
        ["plan_share", "unconfirmed", "acct-yamamoto", AT],
        ["registry", "unconfirmed", "acct-yamamoto", AT],
        ["supporters", "unconfirmed", "acct-yamamoto", AT],
      ],
    );
  });

  it("作った人は同じ事業所に閉じる: 協力事業所のケアマネからは見えない", async () => {
    const id = await created();
    expect(await personInScope(db, partnerCm(), id)).toBeNull();
    expect(await loadPersonPage(db, partnerCm(), id)).toBeNull();
    expect(await personInScope(db, yamamoto(), id)).not.toBeNull();
  });

  it("担当に別の事業所のケアマネ・ケアマネでない行は選べない（何も書かない）", async () => {
    const before = count("SELECT count(*) AS n FROM people");
    const other = await createPersonRequest(db, yamamoto(), { ...NEW, careManagerId: "acct-partner-cm" }, { at: AT, today: TODAY });
    expect(other).toMatchObject({ status: 400, body: { error: "care_manager", label: "担当 不正" } });
    const judgeRow = await createPersonRequest(db, yamamoto(), { ...NEW, careManagerId: "acct-judge" }, { at: AT, today: TODAY });
    expect(judgeRow.status).toBe(400);
    // 協力事業所のケアマネが山本を担当にして作ることもできない（デモ事業所に入らない）
    const cross = await createPersonRequest(db, partnerCm(), NEW, { at: AT, today: TODAY });
    expect(cross.status).toBe(400);
    expect(count("SELECT count(*) AS n FROM people")).toBe(before);
    expect(count("SELECT count(*) AS n FROM timeline_entries")).toBe(0);
    expect(count("SELECT count(*) AS n FROM office_timeline_entries")).toBe(0);
  });

  it("協力事業所のケアマネは自分の事業所に作れる", async () => {
    const id = await created(partnerCm(), { ...NEW, careManagerId: "acct-partner-cm" });
    expect(await personInScope(db, partnerCm(), id)).toMatchObject({ office_id: "office-partner" });
    expect(await personInScope(db, yamamoto(), id)).toBeNull();
  });

  it("審査員のケアマネの役も作れる。書き手は審査員のアカウント、担当の既定は山本", async () => {
    expect(officeActor(judgeCm())).toMatchObject({ authorId: "acct-judge", admin: false, defaultCareManagerId: "acct-yamamoto" });
    const id = await created(judgeCm());
    const t = sqlite.prepare("SELECT author_id, author_role FROM timeline_entries WHERE person_id = ?").get(id);
    expect(t).toMatchObject({ author_id: "acct-judge", author_role: "care_manager" });
  });

  it("ケアマネの役でなければ断る: 医療班・家族は 403、ログインなしは 401", async () => {
    expect((await createPersonRequest(db, medical(), NEW, { at: AT, today: TODAY })).status).toBe(403);
    expect((await createPersonRequest(db, family(), NEW, { at: AT, today: TODAY })).status).toBe(403);
    expect((await createPersonRequest(db, null, NEW, { at: AT, today: TODAY })).status).toBe(401);
    expect(count("SELECT count(*) AS n FROM people WHERE office_id = 'office-demo'")).toBe(10);
  });

  it("本人の経過に「利用者追加 担当 山本」（台帳作成の行は重ねない）、事業所の経過に本人の名前つき", async () => {
    const id = await created();
    const page = await loadPersonPage(db, yamamoto(), id);
    const items = timelineItems(page!);
    expect(items).toEqual([
      expect.objectContaining({ kind: "利用者追加", body: "担当 山本", who: "ケアマネ 山本", derived: false }),
    ]);
    // 種の人は今まで通り「入力 台帳作成」
    const seed = timelineItems((await loadPersonPage(db, yamamoto(), "p-01"))!);
    expect(seed.some((x) => x.kind === "入力" && x.body === "台帳作成")).toBe(true);

    const log = await loadOfficeLog(db, "office-demo");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "person_added", label: "利用者追加", person: "架空 一郎", body: "担当 山本", who: "山本" });
    expect(logLine(log[0])).toMatch(/^利用者追加 架空 一郎 担当 山本 山本 /);
    // 事業所の経過の表には本人の名前を書かない（id だけ）
    const raw = sqlite.prepare("SELECT body, payload FROM office_timeline_entries").get() as { body: string; payload: string };
    expect(raw.body).not.toContain("架空");
    expect(JSON.parse(raw.payload)).toEqual({ personId: id, to: "acct-yamamoto" });
  });
});

describe("担当の割当", () => {
  it("担当を変えると、前の担当の一覧から消え、新しい担当の一覧に出る。両方の経過に残る", async () => {
    const sato = await addSato();
    const r = await assignPerson(db, officeActor(yamamoto())!, { personId: "p-02", from: "acct-yamamoto", to: sato.id }, AT);
    expect(r).toEqual({ ok: true, changed: true });

    const mine = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, AT);
    const his = await loadCaseload(db, { officeId: "office-demo", careManagerId: sato.id }, TODAY, AT);
    expect(mine?.rows.map((x) => x.id)).not.toContain("p-02");
    expect(his?.rows.map((x) => x.id)).toEqual(["p-02"]);
    expect((await listCareManagers(db, "office-demo")).map((c) => [c.name, c.people])).toEqual([
      ["山本", 9],
      ["佐藤", 1],
    ]);

    const items = timelineItems((await loadPersonPage(db, yamamoto(), "p-02"))!);
    expect(items.at(-1)).toMatchObject({ kind: "担当変更", body: "担当 山本 → 佐藤", who: "ケアマネ 山本" });
    // 同じ時刻のケアマネ追加の行と並びが入れ替わることがある（created_at が同じ ms なら id の順）ので、種類で引く
    const assigned = (await loadOfficeLog(db, "office-demo")).find((e) => e.kind === "person_assigned");
    expect(assigned).toMatchObject({ kind: "person_assigned", label: "担当変更", body: "担当 山本 → 佐藤" });
    expect(assigned?.person).toBeTruthy();
  });

  it("管理者でないケアマネも割り当てられる（ケアマネ追加はできない）", async () => {
    const sato = await addSato();
    const r = await assignPerson(db, officeActor(sato.principal)!, { personId: "p-03", from: "acct-yamamoto", to: sato.id }, AT);
    expect(r).toEqual({ ok: true, changed: true });
    const t = sqlite
      .prepare("SELECT author_id FROM timeline_entries WHERE person_id = 'p-03' AND kind = 'note'")
      .get() as { author_id: string };
    expect(t.author_id).toBe(sato.id);
  });

  it("画面で読んだ担当と今の担当が違えば競合で、何も書かない", async () => {
    const sato = await addSato();
    const a = officeActor(yamamoto())!;
    expect(await assignPerson(db, a, { personId: "p-02", from: "acct-yamamoto", to: sato.id }, AT)).toEqual({
      ok: true,
      changed: true,
    });
    const logs = count("SELECT count(*) AS n FROM office_timeline_entries");
    // もう佐藤になっているのに「山本から」を送る
    expect(await assignPerson(db, a, { personId: "p-02", from: "acct-yamamoto", to: "acct-yamamoto" }, AT)).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(count("SELECT count(*) AS n FROM office_timeline_entries")).toBe(logs);
  });

  it("同じ担当なら何も書かない", async () => {
    expect(
      await assignPerson(db, officeActor(yamamoto())!, { personId: "p-02", from: "acct-yamamoto", to: "acct-yamamoto" }, AT),
    ).toEqual({ ok: true, changed: false });
    expect(count("SELECT count(*) AS n FROM timeline_entries")).toBe(0);
  });

  it("事業所の壁: 別の事業所のケアマネを担当にできない、別の事業所の本人は変えられない", async () => {
    const a = officeActor(yamamoto())!;
    expect(await assignPerson(db, a, { personId: "p-02", from: "acct-yamamoto", to: "acct-partner-cm" }, AT)).toEqual({
      ok: false,
      error: "care_manager",
    });
    expect(await assignPerson(db, a, { personId: PARTNER_PERSON, from: "acct-partner-cm", to: "acct-yamamoto" }, AT)).toEqual({
      ok: false,
      error: "not_found",
    });
    const p = officeActor(partnerCm())!;
    expect(await assignPerson(db, p, { personId: "p-02", from: "acct-yamamoto", to: "acct-partner-cm" }, AT)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(sqlite.prepare("SELECT care_manager_id FROM people WHERE id = 'p-02'").get()).toEqual({ care_manager_id: "acct-yamamoto" });
    expect(sqlite.prepare("SELECT care_manager_id FROM people WHERE id = ?").get(PARTNER_PERSON)).toEqual({
      care_manager_id: "acct-partner-cm",
    });
  });

  it("フォームの POST: 事業所の担当の表へ 303、誤りは people_error。医療班・家族は 403、ログインなしは 401", async () => {
    const sato = await addSato();
    const ok = await peoplePost(db, yamamoto(), form({ action: "assign", person: "p-04", from: "acct-yamamoto", to: sato.id, back: "office" }), AT);
    expect(ok).toEqual({ status: 303, location: "/office#assign" });
    const conflict = await peoplePost(db, yamamoto(), form({ action: "assign", person: "p-04", from: "acct-yamamoto", to: "acct-yamamoto" }), AT);
    expect(conflict).toEqual({ status: 303, location: "/office?people_error=conflict#assign" });
    const bad = await peoplePost(db, yamamoto(), form({ action: "delete", person: "p-04" }), AT);
    expect(bad).toEqual({ status: 303, location: peopleBackHref("office", "bad") });
    expect(await peoplePost(db, medical(), form({ action: "unlist", person: "p-04" }), AT)).toEqual({ status: 403 });
    expect(await peoplePost(db, family(), form({ action: "unlist", person: "p-04" }), AT)).toEqual({ status: 403 });
    expect(await peoplePost(db, null, form({ action: "unlist", person: "p-04" }), AT)).toEqual({ status: 401 });
  });
});

describe("ケアマネ追加", () => {
  it("管理者が足すと、ハッシュだけが表に入り、初期パスワードでログインでき、自分の担当一覧（空）が開く", async () => {
    const r = await addCareManagerRequest(db, yamamoto(), { displayName: "佐藤", loginId: "Sato" }, AT, FAST);
    expect(r.status).toBe(200);
    const password = r.body.password as string;
    const account = r.body.account as { id: string; loginId: string };
    expect(account.loginId).toBe("sato");

    const row = sqlite.prepare("SELECT * FROM accounts WHERE id = ?").get(account.id) as Record<string, unknown>;
    expect(row).toMatchObject({ office_id: "office-demo", role: "care_manager", is_office_admin: 0, display_name: "佐藤", login_id: "sato" });
    expect(row.password_hash).toMatch(/^pbkdf2-sha256:1000:/);
    expect(await verifyPassword(password, row.password_hash as string)).toBe(true);
    // 平文は表のどこにも無い（アカウント・経過）
    const everything = JSON.stringify([
      sqlite.prepare("SELECT * FROM accounts").all(),
      sqlite.prepare("SELECT * FROM office_timeline_entries").all(),
      sqlite.prepare("SELECT * FROM timeline_entries").all(),
    ]);
    expect(everything).not.toContain(password);

    const l = await login(db, {}, "test-secret-0123456789-0123456789-abcdef", { loginId: "sato", password }, 1_800_000_000);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.principal).toMatchObject({ role: "care_manager", admin: false, caseloadOf: account.id, office: { id: "office-demo" } });
    const list = await loadCaseload(db, { officeId: "office-demo", careManagerId: account.id }, TODAY, AT);
    expect(list?.rows).toEqual([]);

    const log = await loadOfficeLog(db, "office-demo");
    expect(log[0]).toMatchObject({ kind: "care_manager_added", label: "ケアマネ追加", body: "佐藤", who: "山本", person: null });
  });

  it("管理者だけ: 管理者でないケアマネ・審査員のケアマネの役・医療班は 403、ログインなしは 401。何も足さない", async () => {
    const sato = await addSato();
    const before = count("SELECT count(*) AS n FROM accounts");
    const input = { displayName: "鈴木", loginId: "suzuki" };
    expect((await addCareManagerRequest(db, sato.principal, input, AT, FAST)).status).toBe(403);
    expect((await addCareManagerRequest(db, judgeCm(), input, AT, FAST)).status).toBe(403);
    expect((await addCareManagerRequest(db, medical(), input, AT, FAST)).status).toBe(403);
    expect((await addCareManagerRequest(db, null, input, AT, FAST)).status).toBe(401);
    expect(count("SELECT count(*) AS n FROM accounts")).toBe(before);
    // lib の入口も管理者でなければ断る
    expect(await addCareManager(db, officeActor(sato.principal)!, input, AT, FAST)).toEqual({ ok: false, error: "forbidden" });
  });

  it("使われている ID・審査員の ID は断る", async () => {
    await addSato();
    const dup = await addCareManagerRequest(db, yamamoto(), { displayName: "佐藤 二", loginId: "SATO" }, AT, FAST);
    expect(dup).toMatchObject({ status: 409, body: { error: "login_taken", label: "ID 使用中" } });
    const seeded = await addCareManagerRequest(db, yamamoto(), { displayName: "山本 二", loginId: "yamamoto" }, AT, FAST);
    expect(seeded.status).toBe(409);
    const judge = await addCareManagerRequest(db, yamamoto(), { displayName: "審査", loginId: "judge" }, AT, FAST);
    expect(judge).toMatchObject({ status: 400, body: { error: "login_id" } });
  });

  it("足したケアマネは事業所の中だけ: 協力事業所の管理者が足した人はデモ事業所の担当にできない", async () => {
    const r = await addCareManager(db, officeActor(partnerCm())!, { displayName: "協力 二", loginId: "partner2" }, AT, FAST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await listCareManagers(db, "office-partner")).map((c) => c.id)).toContain(r.account.id);
    expect((await listCareManagers(db, "office-demo")).map((c) => c.id)).not.toContain(r.account.id);
    expect(
      await assignPerson(db, officeActor(yamamoto())!, { personId: "p-02", from: "acct-yamamoto", to: r.account.id }, AT),
    ).toEqual({ ok: false, error: "care_manager" });
  });
});

describe("一覧から外す", () => {
  it("外すと担当一覧・様式 9・停電の人数から外れ、「外した人」に出る。本人のページは開ける。戻すと元に戻る", async () => {
    const a = officeActor(yamamoto())!;
    expect(await setUnlisted(db, a, { personId: "p-05", unlisted: true }, AT)).toEqual({ ok: true, changed: true });

    const list = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, AT);
    expect(list?.rows).toHaveLength(9);
    expect(list?.rows.map((x) => x.id)).not.toContain("p-05");
    expect(list?.unlisted).toEqual([expect.objectContaining({ id: "p-05", unlistedAt: AT })]);

    const f9 = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: null });
    expect(f9?.sheet.rows.map((r) => r.id)).not.toContain("p-05");
    expect((await loadOfficeTowns(db, "office-demo")).reduce((n, t) => n + t.count, 0)).toBe(9);
    expect((await listCareManagers(db, "office-demo"))[0].people).toBe(9);
    expect((await listOfficePeople(db, "office-demo", TODAY)).find((p) => p.id === "p-05")?.unlistedAt).toBe(AT);

    // 消していない: 本人のページは開ける
    expect(await loadPersonPage(db, yamamoto(), "p-05")).not.toBeNull();
    expect(count("SELECT count(*) AS n FROM people WHERE id = 'p-05'")).toBe(1);

    // 同じ印をもう一度は何も書かない
    expect(await setUnlisted(db, a, { personId: "p-05", unlisted: true }, AT)).toEqual({ ok: true, changed: false });

    const later = "2026-11-03T02:00:00.000Z";
    expect(await setUnlisted(db, a, { personId: "p-05", unlisted: false }, later)).toEqual({ ok: true, changed: true });
    const back = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, later);
    expect(back?.rows).toHaveLength(10);
    expect(back?.unlisted).toEqual([]);

    const items = timelineItems((await loadPersonPage(db, yamamoto(), "p-05"))!);
    expect(items.slice(-2).map((x) => x.kind)).toEqual(["一覧除外", "一覧復帰"]);
    const log = await loadOfficeLog(db, "office-demo");
    expect(log.map((x) => x.kind)).toEqual(["person_relisted", "person_unlisted"]);
    expect(log.every((x) => x.person !== null)).toBe(true);
  });

  it("担当一覧の「外した人」から戻すと担当一覧へ 303。別の事業所の本人は外せない", async () => {
    const a = officeActor(yamamoto())!;
    await setUnlisted(db, a, { personId: "p-05", unlisted: true }, AT);
    expect(await peoplePost(db, yamamoto(), form({ action: "relist", person: "p-05", back: "caseload" }), AT)).toEqual({
      status: 303,
      location: "/",
    });
    expect(await setUnlisted(db, a, { personId: PARTNER_PERSON, unlisted: true }, AT)).toEqual({ ok: false, error: "not_found" });
    expect(sqlite.prepare("SELECT unlisted_at FROM people WHERE id = ?").get(PARTNER_PERSON)).toEqual({ unlisted_at: null });
  });

  it("本人の経過の行は source office で読める（kind は note のまま）", async () => {
    await setUnlisted(db, officeActor(yamamoto())!, { personId: "p-06", unlisted: true }, AT);
    const row = sqlite.prepare("SELECT kind, payload FROM timeline_entries WHERE person_id = 'p-06'").get() as {
      kind: "note";
      payload: string;
    };
    expect(row.kind).toBe("note");
    expect(officeEntryOf(row)).toEqual({ source: "office", action: "unlisted" });
  });
});

describe("種の入れ直し", () => {
  it("足した人・ケアマネ・経過・外した印は種の入れ直しで消える", async () => {
    await created();
    await addSato();
    await setUnlisted(db, officeActor(yamamoto())!, { personId: "p-05", unlisted: true }, AT);
    for (const s of seedStatements()) sqlite.exec(s);
    expect(count("SELECT count(*) AS n FROM people")).toBe(10);
    expect(count("SELECT count(*) AS n FROM accounts WHERE office_id = 'office-demo'")).toBe(2);
    expect(count("SELECT count(*) AS n FROM office_timeline_entries")).toBe(0);
    expect(count("SELECT count(*) AS n FROM people WHERE unlisted_at IS NOT NULL")).toBe(0);
  });
});
