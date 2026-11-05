// T68 のテスト: 事業所の地域（市と地図の中心）、migration 0017、種と戻しの様式・中心、defaultPlanForm、既定の中心。
// 保存は node:sqlite の D1。本物の API は呼ばない。
import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SEED_OFFICES } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { defaultPlanForm, loadPlanForm } from "../forms/plan-form.ts";
import { DEFAULT_CENTER, pickCenter, roundPoint } from "../map/center.ts";
import { demoResetStatements } from "../seed/reset.ts";
import { loadOfficePlace, parsePlaceForm, placePost, savePlace } from "./place.ts";

const AT = "2026-11-04T03:00:00.000Z";

const admin: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};
const notAdmin: Principal = { ...admin, admin: false, accountId: "acct-cm-2" };
const judge: Principal = { ...admin, judge: true, admin: false, accountId: "acct-judge" };
const medical: Principal = { ...admin, role: "medical", office: null, caseloadOf: null };

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});

const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const office = () => sqlite.prepare("SELECT city, center_lat, center_lng, plan_form FROM offices WHERE id = 'office-demo'").get();

describe("migration 0017（offices の地図の中心）", () => {
  const MIGRATIONS = new URL("../../migrations/", import.meta.url);
  const names = () => readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();

  it("番号は 0017 で 1 つだけ", () => {
    expect(names().filter((n) => n.startsWith("0017_"))).toEqual(["0017_office_center.sql"]);
  });

  it("前からある事業所の行は中心が NULL（ほかの列はそのまま）", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("PRAGMA foreign_keys = ON;");
    for (const n of names().filter((n) => n < "0017_")) d.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    d.exec("INSERT INTO offices (id, name, kind, city, created_at) VALUES ('o-old', '前の事業所', 'regular', '高知市', '2026-11-01T00:00:00.000Z')");
    const before = d.prepare("SELECT * FROM offices").all();
    for (const n of names().filter((n) => n >= "0017_")) d.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    const after = d.prepare("SELECT * FROM offices").all() as Array<Record<string, unknown>>;
    // 0027（T115）の試用事業所の印も後から足す列（前からある行は 0）。0030（T125）の事業所の区域も後から足す列（前からある行は NULL）。
    // 0036（T148）の事業所の情報と地域の列も後から足す列（前からある行は NULL。lib/office/t148.test.ts）
    expect(
      after.map(
        ({ center_lat: _a, center_lng: _b, judge_sandbox: _c, hazards: _d, address: _e, phone: _f, fax: _g, office_number: _h, region_cities: _i, region_km: _j, ...rest }) => rest,
      ),
    ).toEqual(before);
    expect(after.map((r) => r.hazards)).toEqual([null]);
    expect(after.map((r) => [r.center_lat, r.center_lng])).toEqual([[null, null]]);
    expect(after.map((r) => r.judge_sandbox)).toEqual([0]);
    d.close();
  });

  it("緯度は -90〜90・経度は -180〜180、両方ある か 両方ない（CHECK）", () => {
    const set = (lat: number | null, lng: number | null) => sqlite.prepare("UPDATE offices SET center_lat = ?, center_lng = ? WHERE id = 'office-partner'").run(lat, lng);
    expect(() => set(33.56, 133.53)).not.toThrow();
    expect(() => set(null, null)).not.toThrow();
    for (const [lat, lng] of [
      [33.5, null],
      [null, 133.5],
      [91, 133],
      [33, 181],
    ] as const) {
      expect(() => set(lat, lng), `${lat},${lng}`).toThrow(/CHECK/);
    }
  });
});

describe("種と戻し（T68 の 4・6）", () => {
  it("種の 4 事業所は様式 松山市。デモ事業所と確認用（T144）の中心は松山市の市街（既定の中心と同じ）、ほかは未設定", () => {
    expect(SEED_OFFICES.map((o) => [o.id, o.plan_form, o.center_lat, o.center_lng])).toEqual([
      ["office-demo", "matsuyama", DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
      ["office-demo-check", "matsuyama", DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
      ["office-partner", "matsuyama", null, null],
      ["office-unaffiliated", "matsuyama", null, null],
    ]);
    expect(office()).toEqual({ city: "松山市", center_lat: 33.84, center_lng: 132.765, plan_form: "matsuyama" });
  });

  it("既定の中心は担当一覧の地図（components/map/CaseMap.tsx の FALLBACK）と同じ値", () => {
    const src = readFileSync(new URL("../../components/map/CaseMap.tsx", import.meta.url), "utf8");
    expect(src).toContain(`const FALLBACK = { lat: ${DEFAULT_CENTER.lat}, lng: ${DEFAULT_CENTER.lng} };`);
  });

  it("デモ事業所の戻し（upsert）は様式・市・中心を種に戻す。ほかの事業所には触らない", async () => {
    sqlite.exec("UPDATE offices SET plan_form = 'cao', city = '高知市', center_lat = 33.56, center_lng = 133.53 WHERE id = 'office-demo'");
    sqlite.exec("UPDATE offices SET plan_form = 'cao', center_lat = 33.56, center_lng = 133.53 WHERE id = 'office-partner'");
    for (const s of demoResetStatements(AT)) sqlite.exec(s);
    expect(office()).toEqual({ city: "松山市", center_lat: 33.84, center_lng: 132.765, plan_form: "matsuyama" });
    expect(sqlite.prepare("SELECT plan_form, center_lat FROM offices WHERE id = 'office-partner'").get()).toEqual({ plan_form: "cao", center_lat: 33.56 });
    expect((await loadPlanForm(db, "office-demo")).id).toBe("matsuyama");
  });

  it("defaultPlanForm: 松山市は松山市の様式、ほかの市は内閣府の様式例", () => {
    expect(defaultPlanForm("松山市")).toBe("matsuyama");
    expect(defaultPlanForm(" 松山市 ")).toBe("matsuyama");
    expect(defaultPlanForm("高知市")).toBe("cao");
    expect(defaultPlanForm("")).toBe("cao");
  });
});

describe("地図の真ん中（lib/map/center.ts）", () => {
  it("本人の位置 → 事業所の中心 → 既定。読めない値は飛ばす。押した所は 5 桁に丸める", () => {
    const person = { lat: 33.5, lng: 133.5 };
    const center = { lat: 33.56, lng: 133.53 };
    expect(pickCenter(person, center)).toEqual(person);
    expect(pickCenter(null, center)).toEqual(center);
    expect(pickCenter(null, null)).toEqual(DEFAULT_CENTER);
    expect(pickCenter({ lat: Number.NaN, lng: 1 }, { lat: 95, lng: 1 })).toEqual(DEFAULT_CENTER);
    expect(roundPoint({ lat: 33.123456789, lng: 133.987654321 })).toEqual({ lat: 33.12346, lng: 133.98765 });
  });
});

describe("事業所の地域の保存（T68 の 4）", () => {
  it("parsePlaceForm: 市は空を断る（20 字まで）。緯度経度は範囲の中で、両方ある か 両方ない", () => {
    expect(parsePlaceForm(form({ city: " 高知市 ", center_lat: "33.56", center_lng: "133.53" }))).toEqual({ city: "高知市", center: { lat: 33.56, lng: 133.53 } });
    expect(parsePlaceForm(form({ city: "高知市", center_lat: "", center_lng: "" }))).toEqual({ city: "高知市", center: null });
    expect(parsePlaceForm(form({ city: "高知市" }))).toEqual({ city: "高知市", center: null });
    expect(parsePlaceForm(form({ city: " " }))).toBeNull();
    expect(parsePlaceForm(form({ city: "あ".repeat(21) }))).toBeNull();
    expect(parsePlaceForm(form({ city: "高知市", center_lat: "33.56", center_lng: "" }))).toBeNull();
    expect(parsePlaceForm(form({ city: "高知市", center_lat: "", center_lng: "133.53" }))).toBeNull();
    expect(parsePlaceForm(form({ city: "高知市", center_lat: "91", center_lng: "133.53" }))).toBeNull();
    expect(parsePlaceForm(form({ city: "高知市", center_lat: "33", center_lng: "-181" }))).toBeNull();
    expect(parsePlaceForm(form({ city: "高知市", center_lat: "北", center_lng: "東" }))).toBeNull();
    expect(parsePlaceForm(null)).toBeNull();
  });

  it("管理者だけ保存できる（管理者でないケアマネ・審査員・医療班は断る）。今の利用者の市は変えない", async () => {
    const before = sqlite.prepare("SELECT ledger FROM people WHERE id = 'p-01'").get();
    const v = { city: "高知市", center: { lat: 33.56, lng: 133.53 } };
    for (const p of [notAdmin, judge, medical, null]) expect(await savePlace(db, p, v)).toEqual({ ok: false, error: "forbidden" });
    expect(office()).toMatchObject({ city: "松山市", center_lat: 33.84 });
    expect(await savePlace(db, admin, null)).toEqual({ ok: false, error: "bad" });
    expect(await savePlace(db, admin, v)).toEqual({ ok: true });
    expect(office()).toMatchObject({ city: "高知市", center_lat: 33.56, center_lng: 133.53 });
    expect(await savePlace(db, admin, { city: "高知市", center: null })).toEqual({ ok: true });
    expect(office()).toMatchObject({ center_lat: null, center_lng: null });
    expect(sqlite.prepare("SELECT ledger FROM people WHERE id = 'p-01'").get()).toEqual(before);
    // 事業所の経過には残さない
    expect(sqlite.prepare("SELECT count(*) AS n FROM office_timeline_entries WHERE body LIKE '%高知市%'").get()).toEqual({ n: 0 });
  });

  it("placePost: ログイン → 管理者 → 形 の順に断り、戻り先は事業所の画面の区分", async () => {
    expect(await placePost(db, null, form({ city: "高知市" }))).toEqual({ status: 401 });
    expect(await placePost(db, judge, form({ city: "高知市" }))).toEqual({ status: 403 });
    expect(await placePost(db, notAdmin, form({ city: "高知市" }))).toEqual({ status: 403 });
    expect(await placePost(db, admin, form({ city: "" }))).toEqual({ status: 303, location: "/office?form_error=place#office-place" });
    expect(await placePost(db, admin, form({ city: "高知市", center_lat: "33.56", center_lng: "133.53" }))).toEqual({ status: 303, location: "/office#office-place" });
    expect(office()).toMatchObject({ city: "高知市", center_lat: 33.56 });
  });

  it("loadOfficePlace: 市・中心・町名の候補（町名の無い人は数えない）。無い事業所は null", async () => {
    const p = await loadOfficePlace(db, "office-demo");
    expect(p?.city).toBe("松山市");
    expect(p?.center).toEqual(DEFAULT_CENTER);
    expect(p?.towns.length).toBeGreaterThan(0);
    expect(p?.towns.every((t) => t.trim() !== "")).toBe(true);
    // 地域の市の並びと広さ（T148）も付く（周りの市が無ければ主な市だけ、広さは自動の null）
    expect(await loadOfficePlace(db, "office-partner")).toEqual({ city: "松山市", center: null, towns: [], cities: ["松山市"], km: null });
    expect(await loadOfficePlace(db, "office-none")).toBeNull();
  });
});
