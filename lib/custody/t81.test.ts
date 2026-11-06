// T81: 審査員の壁（朝の見直し 11/4 の安全 高 1・中 3）。
// 審査員が医療班・行政の役のとき、検索・避難所・受入・QR 受入・受け持ちの一覧・本人のページはデモの人だけ。
// 所属なしの人の引受は、審査員（とデモ事業所）はデモのアカウントが登録した人だけ、ほかの事業所はそれ以外だけ。
// 審査員の見本の流れ（山田 ハナを探して受け入れる・その場で登録してケアマネの役で引き受ける）は今までどおり。
// D1 は node:sqlite に種の 10 人と、協力事業所の本人 1 人・審査員でない医療班のアカウント 1 つ（テストだけ）。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { personInScope } from "../auth/scope.ts";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { demoPersonSql, isWalled } from "../auth/wall.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { officeActor } from "../office/scope.ts";
import { loadPersonPage } from "../person.ts";
import { currentQrToken, issueQr } from "../qr/store.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { loadStaffBoard } from "./board.ts";
import { parseOnSite } from "./forms.ts";
import { qrReceivePost, receiveRequest, searchRequest, shelterRequest, takePost } from "./http.ts";
import { listShelters, searchPeople } from "./search.ts";
import { receive, registerOnSite } from "./store.ts";
import { listUnaffiliated, takeOver } from "./takeover.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-04";
const AT = "2026-11-04T01:00:00.000Z";
const LATER = "2026-11-04T01:30:00.000Z";
const NOW = "2026-11-04T02:00:00.000Z";
const SHELTER = "みどり小学校";
const SECRET = "test-secret-for-custody-t81-0123456789";
const PARTNER_PERSON = "p-partner-1";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, ledger)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01',
               '{"basic":{},"care":{},"medical":{"devices":[],"medications":[]},"evacuation":{"hazards":[]},"notes":[],"pending":[]}')`,
    )
    .run(PARTNER_PERSON);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`).run();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };

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
const judgeMedical = (p: Partial<Principal> = {}): Principal => ({ ...base, ...p });
const judgeGovernment = (): Principal => judgeMedical({ role: "government" });
/** 審査員でない医療班（事業所なし） */
const medical2 = (): Principal => judgeMedical({ judge: false, accountId: "acct-med-2", displayName: "医療班 2", office: null });
/** 審査員のケアマネの役 */
const judgeCm = (): Principal => judgeMedical({ role: "care_manager", caseloadOf: "acct-yamamoto", displayName: "山本" });
/** 山本（デモ事業所の管理者。審査員でない） */
const yamamoto = (): Principal =>
  judgeMedical({ role: "care_manager", judge: false, admin: true, accountId: "acct-yamamoto", displayName: "山本", caseloadOf: "acct-yamamoto" });
/** 協力事業所のケアマネ（管理者） */
const partnerCm = (): Principal =>
  judgeMedical({ role: "care_manager", judge: false, admin: true, accountId: "acct-partner-cm", office: PARTNER, caseloadOf: "acct-partner-cm" });

const actor = (p: Principal = judgeMedical()): StaffActor => staffActor(p)!;
const count = (sql: string, ...args: (string | number | null)[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function onSite(name: string, kana: string) {
  const r = parseOnSite({ name, kana, age: "80", medications: "", devices: [], contact: {}, shelter: SHELTER }, TODAY);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** T81 の前に審査員が受け入れたほかの事業所の人の受け持ち（壁の無い受入で作る） */
async function legacyJudgeCustody(personId = PARTNER_PERSON) {
  const r = await receive(db, { ...actor(), walled: false }, { personId, shelter: SHELTER, via: "search" }, AT);
  expect(r.ok).toBe(true);
}

describe("壁の中の人", () => {
  it("審査員はどの役でも壁の中。審査員が足したアカウントも。ほかは外", () => {
    expect(isWalled(judgeMedical())).toBe(true);
    expect(isWalled(judgeCm())).toBe(true);
    expect(isWalled(yamamoto())).toBe(false);
    expect(isWalled({ ...yamamoto(), judgeMade: true })).toBe(true);
    expect(isWalled(medical2())).toBe(false);
    expect(isWalled(null)).toBe(false);
    expect(actor().walled).toBe(true);
    expect(actor(medical2()).walled).toBe(false);
    expect(officeActor(judgeCm())).toMatchObject({ walled: true, placeEdit: false });
    expect(officeActor(yamamoto())).toMatchObject({ walled: false, placeEdit: true });
  });

  it("デモの人: デモ事業所の 10 人と、デモのアカウントがその場で登録した所属なしの人。協力事業所の人・ほかの医療班が登録した人は外", async () => {
    await registerOnSite(db, actor(), onSite("架空 一", "カクウ イチ"), AT, { personId: "p-onsite-judge" });
    await registerOnSite(db, actor(medical2()), onSite("架空 二", "カクウ ニ"), AT, { personId: "p-onsite-other" });
    const demo = (sqlite.prepare(`SELECT p.id FROM people p WHERE ${demoPersonSql("p", DEMO_OFFICE_ID)} ORDER BY p.id`).all() as Array<{ id: string }>).map(
      (r) => r.id,
    );
    expect(demo).toContain("p-01");
    expect(demo).toContain("p-onsite-judge");
    expect(demo).not.toContain(PARTNER_PERSON);
    expect(demo).not.toContain("p-onsite-other");
    expect(demo.filter((id) => /^p-\d\d$/.test(id))).toHaveLength(10);
  });
});

describe("審査員の検索・避難所・受入はデモの人だけ（医療班・行政の役）", () => {
  it("協力事業所の人はカナでも生年月日でも見つからない。審査員でない医療班は見つかる", async () => {
    for (const p of [judgeMedical(), judgeGovernment()]) {
      const byKana = await searchRequest(db, p, { text: "かくう" }, TODAY);
      expect(byKana.status).toBe(200);
      expect(byKana.body.hits, p.role).toEqual([]);
      const byBirth = await searchRequest(db, p, { text: "", birth: "1940-01-01" }, TODAY);
      expect(JSON.stringify(byBirth.body)).not.toContain(PARTNER_PERSON);
    }
    const other = await searchRequest(db, medical2(), { text: "かくう" }, TODAY);
    expect((other.body.hits as Array<{ id: string }>).map((h) => h.id)).toEqual([PARTNER_PERSON]);
  });

  it("id を知っていても受け入れられない（無いのと同じ not_found）。受け持ち・提供の記録・経過は書かない", async () => {
    const out = await receiveRequest(db, judgeMedical(), { personId: PARTNER_PERSON, shelter: SHELTER, via: "search" }, AT);
    expect(out.status).toBe(404);
    expect(out.body).toMatchObject({ ok: false, error: "not_found" });
    expect(await receive(db, actor(judgeGovernment()), { personId: PARTNER_PERSON, shelter: SHELTER, via: "shelter" }, AT)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = ?", PARTNER_PERSON)).toBe(0);
    expect(count("SELECT count(*) AS n FROM third_party_provisions WHERE person_id = ?", PARTNER_PERSON)).toBe(0);
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = ?", PARTNER_PERSON)).toBe(0);
    // 審査員でない医療班は受け入れられる
    expect((await receive(db, actor(medical2()), { personId: PARTNER_PERSON, shelter: SHELTER, via: "search" }, AT)).ok).toBe(true);
  });

  it("QR（本人の 1 枚の裏）を持っていても、ほかの事業所の人は受け入れられない。デモの人の QR は今までどおり", async () => {
    const row = (await issueQr(db, PARTNER_PERSON, AT))!;
    expect(row).not.toBeNull();
    const token = (await currentQrToken(PARTNER_PERSON, row, SECRET))!;
    const nowSec = Math.floor(Date.parse(AT) / 1000) + 60;
    const out = await qrReceivePost(db, judgeMedical(), form({ token, shelter: SHELTER }), { secret: SECRET, nowSec, at: LATER });
    expect(out).toEqual({ status: 303, location: "/staff?error=not_found" });
    expect(count("SELECT count(*) AS n FROM custody")).toBe(0);

    const demo = (await issueQr(db, "p-01", AT))!;
    const demoToken = (await currentQrToken("p-01", demo, SECRET))!;
    const demoOut = await qrReceivePost(db, judgeMedical(), form({ token: demoToken, shelter: SHELTER }), { secret: SECRET, nowSec, at: LATER });
    const cu = sqlite.prepare("SELECT id FROM custody").get() as { id: string };
    expect(demoOut).toEqual({ status: 303, location: `/staff?received=${cu.id}` });
    expect(sqlite.prepare("SELECT person_id, holder_id, via FROM custody").all()).toEqual([{ person_id: "p-01", holder_id: "acct-judge", via: "qr" }]);
  });

  it("避難所の一覧と人数: 審査員はデモの人だけ数え、ほかの事業所の人しかいない避難所は出ない。ほかの医療班は全部", async () => {
    await receive(db, actor(medical2()), { personId: PARTNER_PERSON, shelter: "そらみ台小学校", via: "search" }, AT);
    await receive(db, actor(medical2()), { personId: "p-02", shelter: SHELTER, via: "search" }, AT);
    expect(await listShelters(db, actor())).toEqual([{ shelter: SHELTER, people: 1 }]);
    expect((await listShelters(db, actor(medical2()))).map((s) => s.shelter).sort()).toEqual(["そらみ台小学校", SHELTER].sort());
    const judgeHits = await shelterRequest(db, judgeMedical(), { shelter: "そらみ台小学校" }, TODAY);
    expect(judgeHits.body.hits).toEqual([]);
    const otherHits = await shelterRequest(db, medical2(), { shelter: "そらみ台小学校" }, TODAY);
    expect((otherHits.body.hits as Array<{ id: string }>).map((h) => h.id)).toEqual([PARTNER_PERSON]);
  });

  it("T81 の前に開いた受け持ちがあっても、審査員の受け持ちの一覧・本人のページに出ない（毎朝 4 時の戻しで閉じる。lib/seed/seed.test.ts）", async () => {
    await legacyJudgeCustody();
    await receive(db, actor(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    const board = await loadStaffBoard(db, actor(), TODAY, NOW);
    expect(board.rows.map((r) => r.personId)).toEqual(["p-01"]);
    expect(await personInScope(db, judgeMedical(), PARTNER_PERSON)).toBeNull();
    expect(await loadPersonPage(db, judgeMedical(), PARTNER_PERSON)).toBeNull();
    expect(await personInScope(db, judgeMedical(), "p-01")).not.toBeNull();
    // 審査員でない医療班の受け持ちは今までどおり開ける
    await receive(db, actor(medical2()), { personId: PARTNER_PERSON, shelter: SHELTER, via: "search" }, AT);
    expect(await personInScope(db, medical2(), PARTNER_PERSON)).not.toBeNull();
  });

  it("見本の流れ: 審査員は山田 ハナを探して受け入れ、本人のページを開ける。その場で登録した人も受け持ちに出る", async () => {
    const hits = await searchPeople(db, actor(), { text: "ヤマダ", birth: null }, TODAY);
    expect(hits.hits.map((h) => h.id)).toEqual(["p-01"]);
    expect((await receiveRequest(db, judgeMedical(), { personId: "p-01", shelter: SHELTER, via: "search" }, AT)).status).toBe(200);
    expect(await loadPersonPage(db, judgeMedical(), "p-01")).not.toBeNull();
    await registerOnSite(db, actor(), onSite("架空 一", "カクウ イチ"), AT, { personId: "p-onsite-judge" });
    const found = await searchPeople(db, actor(), { text: "カクウ", birth: null }, TODAY);
    expect(found.hits.map((h) => h.id)).toEqual(["p-onsite-judge"]);
    const board = await loadStaffBoard(db, actor(), TODAY, NOW);
    expect(board.rows.map((r) => r.personId).sort()).toEqual(["p-01", "p-onsite-judge"]);
  });
});

describe("所属なしの人の引受（中 3）", () => {
  beforeEach(async () => {
    await registerOnSite(db, actor(), onSite("架空 一", "カクウ イチ"), AT, { personId: "p-onsite-judge" });
    await registerOnSite(db, actor(medical2()), onSite("架空 二", "カクウ ニ"), AT, { personId: "p-onsite-other" });
  });
  const ids = async (p: Principal) => (await listUnaffiliated(db, officeActor(p)!, TODAY)).map((x) => x.id);

  it("審査員（ケアマネの役）とデモ事業所は、デモのアカウントが登録した人だけ出る。ほかの事業所はそれ以外だけ", async () => {
    expect(await ids(judgeCm())).toEqual(["p-onsite-judge"]);
    expect(await ids(yamamoto())).toEqual(["p-onsite-judge"]);
    expect(await ids({ ...yamamoto(), judgeMade: true, admin: false })).toEqual(["p-onsite-judge"]);
    expect(await ids(partnerCm())).toEqual(["p-onsite-other"]);
  });

  it("審査員はほかの医療班が登録した人を引き受けられない（翌朝の戻しで消してしまう）。協力事業所は審査員の登録を引き受けられない", async () => {
    expect(await takeOver(db, officeActor(judgeCm())!, "p-onsite-other", LATER)).toEqual({ ok: false, error: "not_found" });
    expect(await takePost(db, judgeCm(), form({ person: "p-onsite-other" }), LATER)).toEqual({
      status: 303,
      location: "/office?people_error=not_found#unaffiliated",
    });
    expect(await takeOver(db, officeActor(partnerCm())!, "p-onsite-judge", LATER)).toEqual({ ok: false, error: "not_found" });
    expect(sqlite.prepare("SELECT id, office_id FROM people WHERE id IN ('p-onsite-judge', 'p-onsite-other') ORDER BY id").all()).toEqual([
      { id: "p-onsite-judge", office_id: "office-unaffiliated" },
      { id: "p-onsite-other", office_id: "office-unaffiliated" },
    ]);
    expect(count("SELECT count(*) AS n FROM office_timeline_entries WHERE kind = 'person_taken'")).toBe(0);
  });

  it("見本の流れ: 審査員のケアマネの役は自分の登録を引き受けられ、協力事業所はほかの医療班の登録を引き受けられる", async () => {
    expect(await takeOver(db, officeActor(judgeCm())!, "p-onsite-judge", LATER)).toEqual({ ok: true, personId: "p-onsite-judge" });
    expect(await takeOver(db, officeActor(partnerCm())!, "p-onsite-other", LATER)).toEqual({ ok: true, personId: "p-onsite-other" });
    expect(sqlite.prepare("SELECT id, office_id FROM people WHERE id IN ('p-onsite-judge', 'p-onsite-other') ORDER BY id").all()).toEqual([
      { id: "p-onsite-judge", office_id: "office-demo" },
      { id: "p-onsite-other", office_id: "office-partner" },
    ]);
  });
});
