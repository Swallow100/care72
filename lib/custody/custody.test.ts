// 行政・医療班の受け持ち（docs/tasks/T23.md）。
// 事業所をまたぐ検索（ヒットに住所・電話・漢字の氏名が無い）、受け入れの記録と第三者提供の記録、壁（受け入れの前は開けない）、
// ケアマネの一覧の状態「到着 避難所」、その場で登録と引受、受け持ちの一覧と絞り込みの元、搬送・退所、QR からの受け入れ。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人と、協力事業所の本人 1 人・医療班のアカウント 1 つ（テストだけ）。
// 色の言葉（至急・要確認・不明・無事）は文字で書かず色の値で比べる（言葉は別の作業で変わる）。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { personInScope } from "../auth/scope.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadOfficeLog } from "../disaster/db.ts";
import { personDisaster } from "../disaster/person.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { loadPersonPage, timelineItems, toPersonView } from "../person.ts";
import { currentQrToken, issueQr } from "../qr/store.ts";
import { staffActor, UNAFFILIATED_OFFICE_ID, type StaffActor } from "./actor.ts";
import { loadStaffBoard } from "./board.ts";
import { parseOnSite, parseSearch, searchKey } from "./forms.ts";
import {
  qrReceivePost,
  receiveRequest,
  registerRequest,
  releaseRequest,
  searchRequest,
  shelterRequest,
  takePost,
} from "./http.ts";
import { listShelters, searchPeople, shelterPeople } from "./search.ts";
import { receive, registerOnSite, release } from "./store.ts";
import { listUnaffiliated, takeOver } from "./takeover.ts";
import { officeActor } from "../office/scope.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
/** 発災（大雨）・受け入れ・今 */
const DISASTER_AT = "2026-11-03T00:00:00.000Z";
const AT = "2026-11-03T01:00:00.000Z";
const LATER = "2026-11-03T01:30:00.000Z";
const NOW = "2026-11-03T02:00:00.000Z";
const SHELTER = "みどり小学校";
const SECRET = "test-secret-for-custody-0123456789";
const PARTNER_PERSON = "p-partner-1";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, ledger)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01',
               '{"basic":{"address":{"city":"松山市","town":"ほしぞら町"}},"care":{},"medical":{"devices":[],"medications":[]},"evacuation":{"hazards":[]},"notes":[],"pending":[]}')`,
    )
    .run(PARTNER_PERSON);
  sqlite
    .prepare(`INSERT INTO contacts (id, person_id, kind, relation, name, phone) VALUES ('c-pt-1', ?, 'family', '娘', '架空 花子', '090-0000-0099')`)
    .run(PARTNER_PERSON);
  // 別の医療班のアカウント（事業所なし）
  sqlite
    .prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`)
    .run();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

const base: Principal = {
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: null,
  office: DEMO,
  caseloadOf: null,
  personId: null,
  contactId: null,
};
/** 審査員の医療班の役 */
const medical = (p: Partial<Principal> = {}): Principal => ({ ...base, ...p });
/** 別の医療班（事業所なし） */
const medical2 = (): Principal => medical({ judge: false, accountId: "acct-med-2", displayName: "医療班 2", office: null });
const government = (): Principal => medical({ role: "government", judge: false, accountId: "acct-med-2", office: null });
/** 山本（デモ事業所のケアマネ・管理者） */
const yamamoto = (): Principal =>
  medical({ role: "care_manager", judge: false, admin: true, accountId: "acct-yamamoto", displayName: "山本", caseloadOf: "acct-yamamoto" });
/** 審査員のケアマネの役 */
const judgeCm = (): Principal => medical({ role: "care_manager", caseloadOf: "acct-yamamoto", displayName: "山本" });
const family = (): Principal => medical({ role: "family", judge: false, accountId: null, personId: "p-01", contactId: "c-01-1" });
const self = (): Principal => medical({ role: "self", judge: false, accountId: null, personId: "p-01" });

const actor = (p: Principal = medical()): StaffActor => staffActor(p)!;

const count = (sql: string, ...args: (string | number | null)[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;

function heavyRain(startedAt = DISASTER_AT) {
  sqlite
    .prepare(
      `INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, version, updated_by, updated_at)
       VALUES ('office-demo', 'heavy_rain', ?, 'acct-yamamoto', 'none', 1, 'acct-yamamoto', ?)`,
    )
    .run(startedAt, startedAt);
}

const MATSUMOTO = {
  name: "松本 ミツ",
  kana: "まつもと みつ",
  age: "80",
  medications: "アムロジピン\nワーファリン",
  devices: [],
  contact: { relation: "息子", name: "", phone: "090-0000-0011" },
  shelter: SHELTER,
};

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("役の壁", () => {
  it("受け持つのは行政・医療班だけ。ケアマネ・本人・家族・役を選ぶ前の審査員は持たない", () => {
    expect(staffActor(medical())).toMatchObject({ accountId: "acct-judge", role: "medical", judge: true });
    expect(staffActor(government())).toMatchObject({ accountId: "acct-med-2", role: "government" });
    for (const p of [yamamoto(), judgeCm(), family(), self(), medical({ role: "unselected" }), null]) expect(staffActor(p)).toBeNull();
  });

  it("API: ログインなしは 401、ケアマネ・家族・本人は 403", async () => {
    const q = { text: "ヤマダ" };
    expect((await searchRequest(db, null, q, TODAY)).status).toBe(401);
    for (const p of [yamamoto(), family(), self()]) {
      expect((await searchRequest(db, p, q, TODAY)).status).toBe(403);
      expect((await receiveRequest(db, p, { personId: "p-01", shelter: SHELTER, via: "search" }, AT)).status).toBe(403);
      expect((await registerRequest(db, p, MATSUMOTO, { at: AT, today: TODAY })).status).toBe(403);
      expect((await shelterRequest(db, p, { shelter: SHELTER }, TODAY)).status).toBe(403);
      expect((await releaseRequest(db, p, { custodyId: "cu-x", kind: "discharged" }, AT)).status).toBe(403);
    }
    expect(count("SELECT count(*) AS n FROM custody")).toBe(0);
  });

  it("受け入れの前は本人のページを開けない。受け入れると開け、搬送・退所で閉じると開けない", async () => {
    expect(await personInScope(db, medical(), "p-01")).toBeNull();
    expect(await loadPersonPage(db, medical(), "p-01")).toBeNull();
    const r = await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    expect(r.ok).toBe(true);
    expect((await personInScope(db, medical(), "p-01"))?.id).toBe("p-01");
    expect((await loadPersonPage(db, medical(), "p-01"))?.person.name).toBe("山田 ハナ");
    // 別の医療班は自分で受け入れるまで開けない。ほかの人も開けない
    expect(await personInScope(db, medical2(), "p-01")).toBeNull();
    expect(await personInScope(db, medical(), "p-02")).toBeNull();
    if (!r.ok) return;
    expect((await release(db, actor(), { custodyId: r.custodyId, kind: "transported", note: "かわなぎ総合病院" }, LATER)).ok).toBe(true);
    expect(await personInScope(db, medical(), "p-01")).toBeNull();
  });

  it("引受はケアマネの役だけ（医療班は 403）", async () => {
    expect(await takePost(db, medical(), form({ person: "p-01" }), AT)).toEqual({ status: 403 });
    expect(await takePost(db, null, form({ person: "p-01" }), AT)).toEqual({ status: 401 });
  });
});

describe("検索（事業所をまたぐ）", () => {
  it("ほかの事業所の人も見つかり、ヒットはカナ・生年月日・年齢だけ（住所・電話・漢字の氏名なし）", async () => {
    const out = await searchRequest(db, medical(), { text: "かくう" }, TODAY);
    expect(out.status).toBe(200);
    const hits = out.body.hits as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(1);
    expect(Object.keys(hits[0]).sort()).toEqual(["age", "ageReported", "birthDate", "id", "kana", "mine"]);
    expect(hits[0]).toMatchObject({ id: PARTNER_PERSON, kana: "カクウ タロウ", birthDate: "1940-01-01", age: 86, mine: false });
    const text = JSON.stringify(out.body);
    for (const leak of ["架空 太郎", "ほしぞら", "松山市", "090-", "架空 花子", "office-partner", "協力事業所"]) expect(text).not.toContain(leak);
  });

  it("生年月日だけ・氏名（漢字）でも探せ、空白の違いを問わない。種の 10 人の住所・電話も出ない", async () => {
    const byBirth = await searchPeople(db, actor(), { text: "", birth: "1942-04-18" }, TODAY);
    expect(byBirth.hits.map((h) => h.id)).toEqual(["p-01"]);
    const q = parseSearch({ text: "山田　ハナ" }, TODAY);
    expect(q).toEqual({ ok: true, value: { text: searchKey("山田ハナ"), birth: null } });
    const byName = await searchPeople(db, actor(), q.ok ? q.value : { text: "", birth: null }, TODAY);
    expect(byName.hits.map((h) => h.id)).toEqual(["p-01"]);
    const both = await searchRequest(db, medical(), { text: "ヤマダ", birth: "1942-04-18" }, TODAY);
    expect((both.body.hits as unknown[]).length).toBe(1);
    expect(JSON.stringify(both.body)).not.toMatch(/かわなぎ|090-|山田/);
    const none = await searchRequest(db, medical(), { text: "ヤマダ", birth: "1950-01-01" }, TODAY);
    expect(none.body.hits).toEqual([]);
  });

  it("条件が足りない検索は断る（全件を返さない）", async () => {
    expect((await searchRequest(db, medical(), { text: "" }, TODAY)).body.error).toBe("query");
    expect((await searchRequest(db, medical(), { text: "ヤ" }, TODAY)).body.error).toBe("query");
    expect((await searchRequest(db, medical(), { text: "", birth: "2030-01-01" }, TODAY)).body.error).toBe("birth");
    // LIKE の印は文字として扱う
    expect((await searchRequest(db, medical(), { text: "%%" }, TODAY)).body.hits).toEqual([]);
  });

  it("受け入れたあとは mine の印", async () => {
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    const r = await searchPeople(db, actor(), { text: "ヤマダ", birth: null }, TODAY);
    expect(r.hits[0]).toMatchObject({ id: "p-01", mine: true });
  });
});

describe("受け入れの記録と第三者提供の記録", () => {
  it("誰が・いつ・どこを経過に、相手・範囲・時刻を提供の記録に", async () => {
    const out = await receiveRequest(db, medical(), { personId: "p-01", shelter: " みどり小学校 ", via: "search" }, AT);
    expect(out.status).toBe(200);
    const cu = sqlite.prepare("SELECT * FROM custody").all() as Array<Record<string, unknown>>;
    expect(cu).toHaveLength(1);
    expect(cu[0]).toMatchObject({ person_id: "p-01", holder_id: "acct-judge", holder_role: "medical", shelter: SHELTER, via: "search", received_at: AT, released_at: null });

    const tl = sqlite.prepare("SELECT * FROM timeline_entries WHERE person_id = 'p-01' AND kind = 'received'").all() as Array<Record<string, unknown>>;
    expect(tl).toHaveLength(1);
    expect(tl[0]).toMatchObject({ author_id: "acct-judge", author_role: "medical", body: SHELTER, occurred_at: AT });
    expect(JSON.parse(String(tl[0].payload))).toMatchObject({ source: "custody", shelter: SHELTER, via: "search", custodyId: cu[0].id });

    const pr = sqlite.prepare("SELECT * FROM third_party_provisions").all() as Array<Record<string, unknown>>;
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatchObject({
      person_id: "p-01",
      custody_id: cu[0].id,
      recipient_id: "acct-judge",
      recipient_role: "medical",
      recipient_name: "審査員",
      recipient_judge: 1,
      basis: "consent",
      medical_consent: "granted",
      shelter: SHELTER,
      provided_at: AT,
      closed_at: null,
    });
    expect(JSON.parse(String(pr[0].scope))).toEqual(["identity", "medical", "evacuation", "people_partial"]);
  });

  it("本人のページの経過は「受入 みどり小学校 医療班」", async () => {
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    const rows = (await loadPersonPage(db, medical(), "p-01"))!;
    const item = timelineItems(rows).find((t) => t.at === AT)!;
    expect(item).toMatchObject({ kind: "受入", body: SHELTER });
    expect(item.who.startsWith("医療班")).toBe(true);
  });

  it("医療班への提供に同意の無い 9 渡辺は、範囲は本人確認だけで根拠は生命・身体の保護", async () => {
    await receive(db, actor(), { personId: "p-09", shelter: SHELTER, via: "search" }, AT);
    const pr = sqlite.prepare("SELECT basis, medical_consent, scope FROM third_party_provisions").get() as Record<string, string>;
    expect(pr).toMatchObject({ basis: "vital", medical_consent: "refused" });
    expect(JSON.parse(pr.scope)).toEqual(["identity"]);
  });

  it("同じ人の 2 回目は受入済。避難所は要る。無い人は該当なし", async () => {
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    expect(await receive(db, actor(), { personId: "p-01", shelter: "別の所", via: "search" }, LATER)).toEqual({ ok: false, error: "already" });
    expect((await receiveRequest(db, medical(), { personId: "p-02", shelter: "  ", via: "search" }, AT)).body.error).toBe("shelter");
    expect((await receiveRequest(db, medical(), { personId: "p-nobody", shelter: SHELTER, via: "search" }, AT)).status).toBe(404);
    expect(count("SELECT count(*) AS n FROM custody")).toBe(1);
    // 別の医療班は同じ人を受け入れられる（アカウントごと）
    expect((await receive(db, actor(medical2()), { personId: "p-01", shelter: SHELTER, via: "shelter" }, LATER)).ok).toBe(true);
  });
});

describe("ケアマネの一覧の状態「到着 避難所」", () => {
  it("大雨のとき、受け入れた人は緑で理由が「到着 みどり小学校」。本人のページ・様式 9 も同じ", async () => {
    heavyRain();
    const before = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    const was = before!.rows.find((r) => r.id === "p-09")!.triage!;
    expect(was.color).not.toBe("green");

    await receive(db, actor(), { personId: "p-09", shelter: SHELTER, via: "search" }, AT);
    const after = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    const t = after!.rows.find((r) => r.id === "p-09")!.triage!;
    expect(t.color).toBe("green");
    expect(t.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);

    const page = (await loadPersonPage(db, yamamoto(), "p-09"))!;
    const d = await personDisaster(db, page, NOW);
    expect(d.triage).toMatchObject({ color: "green", reason: t.reason });

    const f9 = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: { now: NOW, disasterAt: DISASTER_AT, outageAt: null } });
    const row = f9!.sheet.rows.find((r) => r.id === "p-09")!;
    expect(row.color).toBe("green");
    // 様式 9 の結果の列は「受入」と避難所（lib/labels.ts の TIMELINE_KIND_LABELS）
    expect(row.result).toMatchObject({ label: "受入", location: "shelter", place: SHELTER });
  });

  it("受け入れより後の赤は赤に戻る。発災より前に閉じた受け入れは数えない（受入中は数える。T80）", async () => {
    heavyRain();
    const r = await receive(db, actor(), { personId: "p-09", shelter: SHELTER, via: "search" }, AT);
    sqlite
      .prepare(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s-red', 'p-09', 'red', 'self', ?)`)
      .run(LATER);
    const c = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    expect(c!.rows.find((r) => r.id === "p-09")!.triage!.color).toBe("red");

    // 発災を受け入れのあとにずらしても、受入中（解除していない）の受け入れは数える（赤の信号も消して比べる。T80）
    sqlite.exec("DELETE FROM signals WHERE id = 's-red'");
    sqlite.prepare("UPDATE disaster_state SET started_at = ?").run(NOW);
    const open = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    expect(open!.rows.find((r) => r.id === "p-09")!.triage!.reason).toBe(`到着 ${SHELTER}`);

    // 発災より前に閉じた（退所）受け入れは数えない
    if (!r.ok) throw new Error(r.error);
    expect((await release(db, actor(), { custodyId: r.custodyId, kind: "discharged", note: null }, LATER)).ok).toBe(true);
    const c2 = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    expect(c2!.rows.find((r) => r.id === "p-09")!.triage!.reason.includes(SHELTER)).toBe(false);
  });

  it("最終連絡の列は電話の信号だけ（受け入れは入れない）", async () => {
    heavyRain();
    await receive(db, actor(), { personId: "p-09", shelter: SHELTER, via: "search" }, AT);
    const c = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    expect(c!.rows.find((r) => r.id === "p-09")!.lastContact).toBeNull();
  });
});

describe("台帳に無い人（その場で登録）と引受", () => {
  it("最小の項目で登録し、所属なし・on_site・申告の年齢で、登録した人の受け持ちに入る（提供の記録は作らない）", async () => {
    const out = await registerRequest(db, medical(), MATSUMOTO, { at: AT, today: TODAY });
    expect(out.status).toBe(200);
    const id = String(out.body.personId);
    const p = sqlite.prepare("SELECT * FROM people WHERE id = ?").get(id) as Record<string, unknown>;
    expect(p).toMatchObject({
      office_id: UNAFFILIATED_OFFICE_ID,
      care_manager_id: null,
      name: "松本 ミツ",
      kana: "マツモト ミツ",
      birth_date: null,
      reported_age: 80,
      origin: "on_site",
      plan_status: "none",
    });
    const ledger = JSON.parse(String(p.ledger));
    expect(ledger.medical.medications.map((m: { name: string }) => m.name)).toEqual(["アムロジピン", "ワーファリン"]);
    const contact = sqlite.prepare("SELECT relation, name, phone FROM contacts WHERE person_id = ?").get(id);
    expect(contact).toMatchObject({ relation: "息子", name: null, phone: "090-0000-0011" });
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = ? AND via = 'on_site' AND released_at IS NULL", id)).toBe(1);
    expect(count("SELECT count(*) AS n FROM third_party_provisions")).toBe(0);
    // 本人のページを開け、経過は「台帳作成 医療班」と「受入」
    const rows = (await loadPersonPage(db, medical(), id))!;
    const kinds = timelineItems(rows).map((t) => t.kind);
    expect(kinds).toContain("受入");
    // 生年月日が無いので、本人のページの年齢は申告の年齢
    expect(toPersonView(rows, { today: TODAY }).head.age).toBe(80);
    // 検索で見つかり、年齢は申告の印
    const s = await searchPeople(db, actor(), { text: "マツモト", birth: null }, TODAY);
    expect(s.hits).toEqual([{ id, kana: "マツモト ミツ", birthDate: null, age: 80, ageReported: true, mine: true }]);
  });

  it("入力の誤り: 氏名・カナ・年齢か生年月日・電話・避難所", () => {
    expect(parseOnSite({ ...MATSUMOTO, name: "" }, TODAY)).toEqual({ ok: false, error: "name" });
    expect(parseOnSite({ ...MATSUMOTO, kana: "松本" }, TODAY)).toEqual({ ok: false, error: "kana" });
    expect(parseOnSite({ ...MATSUMOTO, age: "" }, TODAY)).toEqual({ ok: false, error: "age" });
    expect(parseOnSite({ ...MATSUMOTO, age: "200" }, TODAY)).toEqual({ ok: false, error: "age" });
    expect(parseOnSite({ ...MATSUMOTO, age: "", birthDate: "1946-05-01" }, TODAY).ok).toBe(true);
    expect(parseOnSite({ ...MATSUMOTO, contact: { phone: "でんわ" } }, TODAY)).toEqual({ ok: false, error: "phone" });
    expect(parseOnSite({ ...MATSUMOTO, shelter: "" }, TODAY)).toEqual({ ok: false, error: "shelter" });
    expect(parseOnSite({ ...MATSUMOTO, devices: ["oxygen", "x"] }, TODAY)).toEqual({ ok: false, error: "invalid" });
    const ok = parseOnSite({ ...MATSUMOTO, devices: ["oxygen"], contact: {} }, TODAY);
    expect(ok.ok && ok.value).toMatchObject({ devices: [{ kind: "oxygen" }], contact: null, age: 80 });
  });

  it("ケアマネが引き受けると自分の事業所・担当に移り、経過は「引受 山本」、事業所の経過に引受", async () => {
    const r = await registerOnSite(db, actor(), parseOnSiteOk(), AT, { personId: "p-matsumoto" });
    expect(r.ok).toBe(true);
    const list = await listUnaffiliated(db, TODAY);
    expect(list).toEqual([
      { id: "p-matsumoto", kana: "マツモト ミツ", age: 80, ageReported: true, shelters: [SHELTER], createdAt: AT, createdWhen: "11/3 10:00" },
    ]);
    // 引き受ける前はケアマネも開けない
    expect(await personInScope(db, yamamoto(), "p-matsumoto")).toBeNull();

    const out = await takePost(db, judgeCm(), form({ person: "p-matsumoto" }), LATER);
    expect(out).toEqual({ status: 303, location: "/office#unaffiliated" });
    const p = sqlite.prepare("SELECT office_id, care_manager_id, version FROM people WHERE id = 'p-matsumoto'").get();
    expect(p).toMatchObject({ office_id: "office-demo", care_manager_id: "acct-yamamoto", version: 2 });
    expect(await listUnaffiliated(db, TODAY)).toEqual([]);

    const rows = (await loadPersonPage(db, yamamoto(), "p-matsumoto"))!;
    const take = timelineItems(rows).find((t) => t.at === LATER)!;
    expect(take).toMatchObject({ kind: "引受", body: "山本" });
    const log = await loadOfficeLog(db, "office-demo");
    expect(log[0]).toMatchObject({ kind: "person_taken", label: "引受", person: "松本 ミツ", body: "山本" });

    // ケアマネの担当一覧に出る。医療班の受け持ちは閉じない
    const c = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    expect(c!.rows.find((x) => x.id === "p-matsumoto")).toMatchObject({ name: "松本 ミツ", age: 80 });
    expect(await personInScope(db, medical(), "p-matsumoto")).not.toBeNull();

    // 2 回目・台帳から作った人は引き受けない
    expect(await takeOver(db, officeActor(yamamoto())!, "p-matsumoto", NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await takeOver(db, officeActor(yamamoto())!, PARTNER_PERSON, NOW)).toEqual({ ok: false, error: "not_found" });
  });
});

function parseOnSiteOk() {
  const r = parseOnSite(MATSUMOTO, TODAY);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("受け持ちの一覧", () => {
  it("自分の受け持ちだけ、事業所をまたいで、避難所・状態・所属を持つ。上の人数は状態の 4 色", async () => {
    heavyRain();
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    await receive(db, actor(), { personId: PARTNER_PERSON, shelter: "そらみ台小学校", via: "search" }, AT);
    await registerOnSite(db, actor(), parseOnSiteOk(), AT, { personId: "p-matsumoto" });
    await receive(db, actor(medical2()), { personId: "p-02", shelter: SHELTER, via: "search" }, AT);

    const board = await loadStaffBoard(db, actor(), TODAY, NOW);
    expect(board.rows.map((r) => r.personId).sort()).toEqual(["p-01", "p-matsumoto", PARTNER_PERSON].sort());
    expect(board.shelters).toEqual(["そらみ台小学校", SHELTER].sort((a, b) => a.localeCompare(b, "ja")));
    const total = Object.values(board.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
    const yamada = board.rows.find((r) => r.personId === "p-01")!;
    expect(yamada).toMatchObject({ office: "デモ事業所", unaffiliated: false, shelter: SHELTER, color: "green", age: 84 });
    expect(yamada.marks.length).toBeGreaterThan(0);
    // 375 の幅で氏名の下に出す医療の印（T54）: 同じ並びに時計のいちばん短い残り
    expect(yamada.markItems.map((x) => x.label)).toEqual(yamada.marks);
    expect(yamada.markItems.find((x) => x.label === "酸素")?.remaining).toMatch(/^[\d.]+(h|分|日)$|^超過$/);
    const m = board.rows.find((r) => r.personId === "p-matsumoto")!;
    // その場で登録した人は時計が無いので印は空（表は台帳の機器を代わりに出す）
    expect(m.markItems).toEqual([]);
    expect(m).toMatchObject({ office: "所属なし", unaffiliated: true, age: 80, ageReported: true, color: "green" });
    expect(m.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
    // 並びの番号は 1 から
    expect(board.rows.map((r) => r.rank).sort()).toEqual([1, 2, 3]);
    // 要配慮（医療の印・機器・薬のある人）
    expect(board.medical).toBe(2);

    // 別の医療班の受け持ちは別
    const other = await loadStaffBoard(db, actor(medical2()), TODAY, NOW);
    expect(other.rows.map((r) => r.personId)).toEqual(["p-02"]);
  });

  it("医療班への提供を断った人は、氏名の下の医療の印も出さない（医療の列と同じ）", async () => {
    heavyRain();
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    expect(sqlite.prepare(`UPDATE consents SET status = 'refused' WHERE person_id = 'p-01' AND kind = 'medical'`).run().changes).toBe(1);
    const yamada = (await loadStaffBoard(db, actor(), TODAY, NOW)).rows.find((r) => r.personId === "p-01")!;
    expect(yamada).toMatchObject({ marks: [], markItems: [], devices: [], remain: null, reason: "" });
  });

  it("搬送で一覧から外れ、経過に「搬送 行き先」、提供の記録を閉じる。閉じた行はもう閉じない", async () => {
    const r = await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    if (!r.ok) throw new Error(r.error);
    const out = await releaseRequest(db, medical(), { custodyId: r.custodyId, kind: "transported", note: "かわなぎ総合病院" }, LATER);
    expect(out.status).toBe(200);
    expect((await loadStaffBoard(db, actor(), TODAY, NOW)).rows).toEqual([]);
    const tl = sqlite.prepare("SELECT kind, body, author_role FROM timeline_entries WHERE person_id = 'p-01' AND occurred_at = ?").get(LATER);
    expect(tl).toMatchObject({ kind: "transported", body: "かわなぎ総合病院", author_role: "medical" });
    expect(sqlite.prepare("SELECT closed_at FROM third_party_provisions").get()).toEqual({ closed_at: LATER });
    expect(sqlite.prepare("SELECT release_kind, released_by FROM custody").get()).toEqual({ release_kind: "transported", released_by: "acct-judge" });
    expect((await releaseRequest(db, medical(), { custodyId: r.custodyId, kind: "discharged" }, NOW)).body.error).toBe("released");
    // 別の人の受け持ちは閉じられない
    const r2 = await receive(db, actor(medical2()), { personId: "p-02", shelter: SHELTER, via: "search" }, AT);
    if (!r2.ok) throw new Error(r2.error);
    expect((await releaseRequest(db, medical(), { custodyId: r2.custodyId, kind: "discharged" }, NOW)).status).toBe(404);
  });

  it("退所の経過は「退所」", async () => {
    const r = await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    if (!r.ok) throw new Error(r.error);
    await release(db, actor(), { custodyId: r.custodyId, kind: "discharged", note: null }, LATER);
    // 閉じたあとはケアマネのページで確かめる
    const rows = (await loadPersonPage(db, yamamoto(), "p-01"))!;
    expect(timelineItems(rows).find((t) => t.at === LATER)).toMatchObject({ kind: "退所" });
  });
});

describe("避難所の一覧（既に受け入れられた人）", () => {
  it("避難所の名前と人数、その避難所の人はカナ・生年月日・年齢だけ。受け入れると mine", async () => {
    await receive(db, actor(medical2()), { personId: "p-02", shelter: SHELTER, via: "search" }, AT);
    await receive(db, actor(medical2()), { personId: "p-03", shelter: "みずほし公民館", via: "search" }, AT);
    expect(await listShelters(db)).toEqual([
      { shelter: "みずほし公民館", people: 1 },
      { shelter: SHELTER, people: 1 },
    ].sort((a, b) => (a.shelter < b.shelter ? -1 : 1)));
    const out = await shelterRequest(db, medical(), { shelter: SHELTER }, TODAY);
    const hits = out.body.hits as Array<Record<string, unknown>>;
    expect(hits).toEqual([{ id: "p-02", kana: "コバヤシ トシ", birthDate: "1940-02-09", age: 86, ageReported: false, mine: false }]);
    expect(JSON.stringify(out.body)).not.toMatch(/小林|090-|かわなぎ/);
    await receiveRequest(db, medical(), { personId: "p-02", shelter: SHELTER, via: "shelter" }, LATER);
    expect((await shelterPeople(db, actor(), SHELTER, TODAY))[0].mine).toBe(true);
  });
});

describe("QR からの受け入れ", () => {
  it("トークンを引き直して受け入れ、/staff へ。本人の id はフォームに要らない", async () => {
    const row = (await issueQr(db, "p-01", AT))!;
    const token = (await currentQrToken("p-01", row, SECRET))!;
    const nowSec = Math.floor(Date.parse(AT) / 1000) + 60;
    const out = await qrReceivePost(db, medical(), form({ token, shelter: SHELTER }), { secret: SECRET, nowSec, at: LATER });
    expect(out).toEqual({ status: 303, location: "/staff" });
    expect(sqlite.prepare("SELECT person_id, via FROM custody").get()).toEqual({ person_id: "p-01", via: "qr" });
    // 2 回目も /staff（受入済は誤りにしない）
    expect(await qrReceivePost(db, medical(), form({ token, shelter: SHELTER }), { secret: SECRET, nowSec, at: NOW })).toEqual({ status: 303, location: "/staff" });
    // 無効のトークン・避難所なし・ケアマネ
    expect(await qrReceivePost(db, medical(), form({ token: "x.y", shelter: SHELTER }), { secret: SECRET, nowSec, at: NOW })).toEqual({
      status: 303,
      location: "/staff?error=not_found",
    });
    expect(await qrReceivePost(db, medical2(), form({ token, shelter: "" }), { secret: SECRET, nowSec, at: NOW })).toEqual({
      status: 303,
      location: "/staff?error=shelter",
    });
    expect(await qrReceivePost(db, yamamoto(), form({ token, shelter: SHELTER }), { secret: SECRET, nowSec, at: NOW })).toEqual({ status: 403 });
    expect(count("SELECT count(*) AS n FROM custody")).toBe(1);
  });
});
