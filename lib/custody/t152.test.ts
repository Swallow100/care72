// T152: 医療班の受け入れの流れ。受入一覧の最初の入り方 3 つ（QR 読取・氏名検索・新規登録）、受け入れたあとの行き先（?received=）と
// 表の上に出す行、見本の QR（審査員の壁の中のデモ事業所だけ）、受け入れた人の画面（要約 → 経過 → 残り、見える物は本人のページの範囲のまま）。
// D1 は node:sqlite に種の 10 人（デモ事業所の 10 人は種の QR を作った形）と、審査員でない医療班のアカウント 1 つ（テストだけ）。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 受入の入口・経過の書き足しの部品は useRouter を読む（描くだけなので空の物）
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { SEED_AT } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { ReceivedPerson } from "../../components/staff/ReceivedPerson.tsx";
import { StaffIntake } from "../../components/staff/StaffIntake.tsx";
import { StaffTable } from "../../components/staff/StaffTable.tsx";
import { tokenOfCodes, detectorOf } from "../../components/staff/QrCamera.tsx";
import { CHECK_CARE_MANAGER_ID, CHECK_OFFICE_ID, checkSeedId } from "../auth/demo.ts";
import type { Principal } from "../auth/principal.ts";
import { scopeOfRows } from "../consent/scope.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadPersonPage, toPersonView, type PersonView } from "../person.ts";
import { resolveQrToken, currentQrToken, issueQr } from "../qr/store.ts";
import { medicalConsentOf } from "../qr/view.ts";
import { DEMO_QR } from "../seed/demo.ts";
import { staffActor } from "./actor.ts";
import { loadStaffBoard } from "./board.ts";
import { ENTRY_KINDS, parseReceived, pinReceived, qrTokenFrom } from "./entry.ts";
import { parseOnSite } from "./forms.ts";
import { qrReceivePost, receiveRequest, registerRequest } from "./http.ts";
import { CUSTODY_VIA_LABELS, ENTRY_LABELS, RECEIVED_LABELS } from "./labels.ts";
import { qrPagePath, receivedHref } from "./paths.ts";
import { openCustodyOf, receivedLayout, SUMMARY_PARTS } from "./received.ts";
import { QR_SAMPLE_MAX, qrSamples } from "./samples.ts";
import { receive, registerOnSite } from "./store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-06";
const AT = "2026-11-06T01:00:00.000Z";
const LATER = "2026-11-06T01:30:00.000Z";
const SHELTER = "みどり小学校";
const SECRET = "test-secret-for-custody-t152-0123456789";
/** 種の QR の作った時刻の 1 日あと（期限は 180 日） */
const NOW_SEC = Math.floor(Date.parse(SEED_AT) / 1000) + 86_400;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  // 種の事業所（デモ・確認用）の 10 人は QR を作った形（lib/seed/demo.ts の DEMO_QR と同じ）
  sqlite
    .prepare("UPDATE people SET qr_generation = ?, qr_issued_at = ?, qr_ttl_days = ? WHERE office_id IN (?, ?)")
    .run(DEMO_QR.generation, DEMO_QR.issuedAt, DEMO_QR.ttlDays, "office-demo", CHECK_OFFICE_ID);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`).run();
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
/** 審査員の医療班の役（壁の中） */
const judgeMedical = (p: Partial<Principal> = {}): Principal => ({ ...base, ...p });
/** 審査員でない医療班（壁の外） */
const medical2 = (): Principal => judgeMedical({ judge: false, accountId: "acct-med-2", displayName: "医療班 2", office: null });
const yamamoto = (): Principal => judgeMedical({ role: "care_manager", judge: false, accountId: "acct-yamamoto", displayName: "山本", caseloadOf: "acct-yamamoto" });

async function token(personId: string): Promise<string> {
  const row = sqlite.prepare("SELECT qr_generation, qr_issued_at, qr_ttl_days FROM people WHERE id = ?").get(personId) as {
    qr_generation: number;
    qr_issued_at: string;
    qr_ttl_days: number;
  };
  return (await currentQrToken(personId, row, SECRET))!;
}

function form(v: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
}

async function staffView(p: Principal, personId: string): Promise<PersonView> {
  const rows = (await loadPersonPage(db, p, personId))!;
  return toPersonView(rows, { today: TODAY, scope: scopeOfRows(p.role, rows), viewer: p });
}

describe("入り方の 3 つと QR の文字", () => {
  it("並びは QR 読取・氏名検索・新規登録", () => {
    expect([...ENTRY_KINDS]).toEqual(["qr", "search", "register"]);
  });

  it("URL・頁の道・トークンだけのどれからもトークンを取り出す。形の違う物は null", async () => {
    const t = await token("p-01");
    expect(qrTokenFrom(t)).toBe(t);
    expect(qrTokenFrom(`https://care72.app/q/${t}`)).toBe(t);
    expect(qrTokenFrom(`  http://localhost:3072/q/${t}?x=1#y  `)).toBe(t);
    expect(qrTokenFrom(`/q/${encodeURIComponent(t)}`)).toBe(t);
    // ほかの元の URL でも道の /q/<token> だけを読む（開くのはこのアプリの /q/）
    expect(qrTokenFrom(`https://example.invalid/q/${t}`)).toBe(t);
    for (const bad of ["", "   ", "x.y", "https://care72.app/people/p-01", "https://care72.app/q/a.b", "q/%E0%A4%A", "a".repeat(2000)]) {
      expect(qrTokenFrom(bad)).toBeNull();
    }
    expect(qrTokenFrom(null)).toBeNull();
  });

  it("QR の頁へは避難所の名前だけを渡す。受け入れたあとは受け持ちの id だけ", () => {
    expect(qrPagePath("abc.def", SHELTER)).toBe(`/q/abc.def?shelter=${encodeURIComponent(SHELTER)}`);
    expect(qrPagePath("abc.def", "  ")).toBe("/q/abc.def");
    expect(qrPagePath("abc.def")).toBe("/q/abc.def");
    expect(receivedHref("cu-1")).toBe("/staff?received=cu-1");
    expect(parseReceived({ received: "cu-1" })).toEqual(["cu-1"]);
    expect(parseReceived({ received: ["cu-1", "cu-2"] })).toEqual([]);
    expect(parseReceived({ received: "cu 1<script>" })).toEqual([]);
    expect(parseReceived({})).toEqual([]);
  });

  it("受け入れたばかりの行を先頭に（並びの番号は変えない。絞込で見えない人は動かさない）", () => {
    const rows = [
      { custodyId: "a", rank: 1 },
      { custodyId: "b", rank: 2 },
      { custodyId: "c", rank: 3 },
    ];
    expect(pinReceived(rows, "c")).toEqual([rows[2], rows[0], rows[1]]);
    expect(pinReceived(rows, "a")).toEqual(rows);
    expect(pinReceived(rows, "z")).toEqual(rows);
    expect(pinReceived(rows, null)).toEqual(rows);
  });

  it("カメラの読み取り: 読めた文字の中の初めのトークン。使えない端末は読み取りの部品なし", async () => {
    const t = await token("p-02");
    expect(tokenOfCodes([{ rawValue: "https://example.invalid/other" }, { rawValue: `https://care72.app/q/${t}` }])).toBe(t);
    expect(tokenOfCodes([{ rawValue: "not a qr url" }, {}])).toBeNull();
    expect(detectorOf({})).toBeNull();
    expect(detectorOf(null)).toBeNull();
    class FakeDetector {
      async detect() {
        return [];
      }
    }
    expect(detectorOf({ BarcodeDetector: FakeDetector })).toBe(FakeDetector);
  });
});

describe("受け入れたあとの行き先", () => {
  it("QR の頁の受入は受入一覧のその人の行へ。検索・新規登録の受入も受け持ちの id を返す", async () => {
    const t = await token("p-01");
    const out = await qrReceivePost(db, judgeMedical(), form({ token: t, shelter: SHELTER }), { secret: SECRET, nowSec: NOW_SEC, at: AT });
    const cu = sqlite.prepare("SELECT id FROM custody WHERE person_id = 'p-01'").get() as { id: string };
    expect(out).toEqual({ status: 303, location: receivedHref(cu.id) });

    const searched = await receiveRequest(db, judgeMedical(), { personId: "p-02", shelter: SHELTER, via: "search" }, AT);
    expect(searched.body).toMatchObject({ ok: true, personId: "p-02" });
    expect(typeof searched.body.custodyId).toBe("string");

    const registered = await registerRequest(
      db,
      judgeMedical(),
      { name: "松本 ミツ", kana: "マツモト ミツ", age: "80", birthDate: "", medications: "降圧薬", devices: [], contact: { relation: "", name: "", phone: "" }, shelter: SHELTER },
      { at: LATER, today: TODAY },
    );
    expect(registered.body).toMatchObject({ ok: true });
    expect(typeof registered.body.custodyId).toBe("string");
  });

  it("受入一覧の表: 受け入れたばかりの人の行が先頭で「新着」と「開く」。並びの番号はそのまま", async () => {
    const a = await receive(db, staffActor(judgeMedical())!, { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    const b = await receive(db, staffActor(judgeMedical())!, { personId: "p-02", shelter: SHELTER, via: "search" }, LATER);
    expect(a.ok && b.ok).toBe(true);
    const board = await loadStaffBoard(db, staffActor(judgeMedical())!, TODAY, LATER);
    const last = board.rows.find((r) => r.personId === "p-02")!;
    const html = renderToStaticMarkup(createElement(StaffTable, { rows: board.rows, shelters: board.shelters, received: [last.custodyId] }));
    const order = [...html.matchAll(/<tr data-person="([^"]+)"/g)].map((m) => m[1]);
    expect(order[0]).toBe("p-02");
    expect(html).toContain('data-fresh="true"');
    expect(html).toContain(ENTRY_LABELS.fresh);
    expect(html).toContain(`href="/people/p-02"`);
    // 番号は表の並びのまま（先頭に出しても数え直さない）
    const plain = renderToStaticMarkup(createElement(StaffTable, { rows: board.rows, shelters: board.shelters }));
    expect(plain).not.toContain("data-fresh");
    expect(last.rank).toBe(board.rows.find((r) => r.personId === "p-02")!.rank);
  });
});

describe("見本の QR", () => {
  it("審査員の壁の中（デモ事業所）だけ。トークンは QR の頁で通る。受け入れ中の人は出さない", async () => {
    const samples = await qrSamples(db, judgeMedical(), SECRET, NOW_SEC);
    expect(samples).toHaveLength(QR_SAMPLE_MAX);
    expect(samples.map((s) => s.personId)).toEqual(["p-01", "p-02", "p-03"]);
    // 出すのはカナだけ（漢字の氏名は出さない）
    expect(JSON.stringify(samples)).not.toMatch(/山田|小林|田中/);
    for (const s of samples) expect((await resolveQrToken(db, SECRET, s.token, NOW_SEC))?.p).toBe(s.personId);

    await receive(db, staffActor(judgeMedical())!, { personId: "p-01", shelter: SHELTER, via: "qr" }, AT);
    expect((await qrSamples(db, judgeMedical(), SECRET, NOW_SEC)).map((s) => s.personId)).toEqual(["p-02", "p-03", "p-04"]);
  });

  it("壁の外の医療班・ケアマネ・ログインなしには出さない。役を替えた見本のケアマネは確認用の事業所の人（T144 の壁の事業所）", async () => {
    expect(await qrSamples(db, medical2(), SECRET, NOW_SEC)).toEqual([]);
    expect(await qrSamples(db, yamamoto(), SECRET, NOW_SEC)).toEqual([]);
    expect(await qrSamples(db, null, SECRET, NOW_SEC)).toEqual([]);
    const switched = judgeMedical({
      judge: false,
      switched: true,
      accountId: CHECK_CARE_MANAGER_ID,
      office: { id: CHECK_OFFICE_ID, name: "デモ事業所（確認用）", kind: "demo" },
    });
    const own = await qrSamples(db, switched, SECRET, NOW_SEC);
    expect(own.map((s) => s.personId)).toEqual(["p-01", "p-02", "p-03"].map(checkSeedId));
    // 確認用の山本の見本は QR の頁の受入でも通る（壁の事業所が同じ）。審査員の見本にはデモ事業所の人だけ
    const out = await qrReceivePost(db, switched, form({ token: own[0].token, shelter: SHELTER }), { secret: SECRET, nowSec: NOW_SEC, at: AT });
    expect("location" in out && out.location.startsWith("/staff?received=")).toBe(true);
    expect((await qrSamples(db, judgeMedical(), SECRET, NOW_SEC)).map((s) => s.personId)).toEqual(["p-01", "p-02", "p-03"]);
  });

  it("期限の切れた QR・作っていない人は出さない", async () => {
    sqlite.prepare("UPDATE people SET qr_generation = 0, qr_issued_at = NULL WHERE id IN ('p-01', 'p-02')").run();
    expect((await qrSamples(db, judgeMedical(), SECRET, NOW_SEC)).map((s) => s.personId)).toEqual(["p-03", "p-04", "p-05"]);
    const far = Math.floor(Date.parse(SEED_AT) / 1000) + 181 * 86_400;
    expect(await qrSamples(db, judgeMedical(), SECRET, far)).toEqual([]);
    // 作り直した人の新しい版のトークン
    await issueQr(db, "p-01", AT);
    const fresh = await qrSamples(db, judgeMedical(), SECRET, Math.floor(Date.parse(AT) / 1000) + 60);
    expect(fresh[0].personId).toBe("p-01");
  });
});

describe("受入の入口の描き方", () => {
  it("入り方の 3 つを先に、避難所別は後ろ。閉じた形では流れを出さない", () => {
    const html = renderToStaticMarkup(createElement(StaffIntake, { shelters: [], defaultShelter: null }));
    const entries = [...html.matchAll(/data-entry="([^"]+)"/g)].map((m) => m[1]);
    expect(entries).toEqual(["qr", "search", "register", "shelter"]);
    for (const w of [ENTRY_LABELS.qr, ENTRY_LABELS.search, ENTRY_LABELS.register, ENTRY_LABELS.qrSub, ENTRY_LABELS.searchSub, ENTRY_LABELS.registerSub]) {
      expect(html).toContain(w);
    }
    expect(html).not.toContain("data-flow");
    // 画面に「台帳」と書かない
    expect(html).not.toContain("台帳");
  });

  it("QR 読取: 見本は渡したときだけ。カメラの使えない描き方では「写すと受入頁」", () => {
    const sample = { personId: "p-01", kana: "ヤマダ ハナ", token: "abc.def", qr: { size: 29, d: "M4 4h1v1h-1z" } };
    const withSample = renderToStaticMarkup(createElement(StaffIntake, { shelters: [], defaultShelter: SHELTER, samples: [sample], initialTab: "qr" }));
    expect(withSample).toContain('data-flow="qr"');
    expect(withSample).toContain(ENTRY_LABELS.sample);
    expect(withSample).toContain('data-sample="p-01"');
    expect(withSample).toContain(ENTRY_LABELS.url);
    expect(withSample).toContain(ENTRY_LABELS.cameraOs);
    const none = renderToStaticMarkup(createElement(StaffIntake, { shelters: [], defaultShelter: SHELTER, initialTab: "qr" }));
    expect(none).not.toContain(ENTRY_LABELS.sample);
  });

  it("新規登録: 最低限の項目（氏名・カナ・年齢・生年月日・薬・機器・連絡先）", () => {
    const html = renderToStaticMarkup(createElement(StaffIntake, { shelters: [], defaultShelter: SHELTER, initialTab: "register" }));
    for (const f of ["name", "kana", "age", "medications"]) expect(html).toContain(`data-field="${f}"`);
    expect(html).toContain('type="date"');
    expect(html).toContain('type="tel"');
  });
});

describe("受け入れた人の画面", () => {
  it("要約（薬・機器・アレルギー・連絡先）を先に、次に経過、その下に残り。要約に出した行は残りに出さない。医療班に書き足しの欄は無い（T172）", async () => {
    await receive(db, staffActor(judgeMedical())!, { personId: "p-01", shelter: SHELTER, via: "qr" }, AT);
    const view = await staffView(judgeMedical(), "p-01");
    const layout = receivedLayout(view);
    expect(layout.summary?.map((c) => c.part)).toEqual(SUMMARY_PARTS.map((s) => s.part));
    const keys = (layout.summary ?? []).flatMap((c) => c.blocks.flatMap((b) => (b.type === "row" ? [b.row.key] : [])));
    expect(keys).toEqual(expect.arrayContaining(["medical.medications", "medical.devices", "medical.allergies", "people.emergency"]));
    const restKeys = layout.rest.flatMap((s) => s.blocks.flatMap((b) => (b.type === "row" ? [b.row.key] : [])));
    for (const k of keys) expect(restKeys).not.toContain(k);
    expect(layout.rest.map((s) => s.id)[0]).toBe("medical");
    expect(layout.timeline?.id).toBe("timeline");

    const custody = await openCustodyOf(db, staffActor(judgeMedical())!, "p-01");
    expect(custody).toMatchObject({ shelter: SHELTER, via: "qr", receivedAt: AT });
    const rows = (await loadPersonPage(db, judgeMedical(), "p-01"))!;
    const html = renderToStaticMarkup(createElement(ReceivedPerson, { view, custody, consent: medicalConsentOf(rows) }));
    const at = (s: string) => html.indexOf(s);
    expect(at("data-received-head")).toBeGreaterThan(-1);
    expect(at("data-received-summary")).toBeGreaterThan(at("data-received-head"));
    expect(at('data-section="timeline"')).toBeGreaterThan(at("data-received-summary"));
    expect(at("data-received-rest")).toBeGreaterThan(at('data-section="timeline"'));
    expect(html).not.toContain('data-form="timeline"');
    expect(html).toContain('data-summary="medications"');
    expect(html).toContain("ワーファリン");
    expect(html).toContain(SHELTER);
    // 医療要約の書類（同意あり）の全文と印刷
    expect(html).toContain("data-summary-full");
    expect(html).toContain("/people/p-01/forms/medical?print=1");
    // 住所・本人の電話は医療班の範囲の外（本人のページと同じ）
    expect(html).not.toMatch(/data-field="basic\.(birth|sex|contactMeans)"/);
  });

  it("医療班への提供に同意の無い人（p-09）: 要約は同意の状態だけ。薬・機器は出さない。書き足しの欄も無い（T172）", async () => {
    await receive(db, staffActor(judgeMedical())!, { personId: "p-09", shelter: SHELTER, via: "search" }, AT);
    const view = await staffView(judgeMedical(), "p-09");
    const layout = receivedLayout(view);
    expect(layout.summary).toBeNull();
    expect(layout.rest.map((s) => s.id)).not.toContain("medical");
    const rows = (await loadPersonPage(db, judgeMedical(), "p-09"))!;
    expect(medicalConsentOf(rows)).toBe("refused");
    const html = renderToStaticMarkup(createElement(ReceivedPerson, { view, custody: null, consent: medicalConsentOf(rows) }));
    expect(html).toContain('data-withheld="refused"');
    expect(html).toContain("同意なし");
    expect(html).not.toContain('data-summary="medications"');
    expect(html).not.toContain("data-summary-full");
    expect(html).not.toContain('data-form="timeline"');
  });

  it("その場で登録した人（11 人目）: 要約に薬・機器・連絡先。医療要約の書類は作らない（同意の行が未確認）", async () => {
    const input = parseOnSite(
      {
        name: "松本 ミツ",
        kana: "マツモト ミツ",
        age: "80",
        birthDate: "",
        medications: "降圧薬",
        devices: [{ kind: "oxygen" }],
        contact: { relation: "長女", name: "松本 京子", phone: "090-0000-0011" },
        shelter: SHELTER,
      },
      TODAY,
    );
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    const r = await registerOnSite(db, staffActor(judgeMedical())!, input.value, AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const view = await staffView(judgeMedical(), r.personId);
    const layout = receivedLayout(view);
    expect(layout.summary).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement(ReceivedPerson, { view, custody: await openCustodyOf(db, staffActor(judgeMedical())!, r.personId), consent: "unconfirmed" }),
    );
    expect(html).toContain("降圧薬");
    expect(html).toContain("090-0000-0011");
    expect(html).not.toContain("data-summary-full");
    // 受け入れた避難所と入り方（その場で登録）
    expect(html).toContain(CUSTODY_VIA_LABELS.on_site);
  });

  it("受け持っていない人は読めない（壁は今のまま）", async () => {
    expect(await loadPersonPage(db, judgeMedical(), "p-01")).toBeNull();
    expect(await openCustodyOf(db, staffActor(judgeMedical())!, "p-01")).toBeNull();
    expect(RECEIVED_LABELS.back).toBe("受入一覧");
  });
});
