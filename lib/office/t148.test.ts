// T148 のテスト（docs/tasks/T148.md）: 事業所の情報、複数の市にまたがる地域、ケアマネの ID とパスワード。
// D1 は node:sqlite（lib/db/test-d1.ts）に種。気象庁は fixtures の作った見本（本物には繋がない）。ハッシュの回数はテストだけ減らす。
// 値はみなテストだけの物（本物のパスワード・鍵ではない）。

import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DisasterBadge } from "../../components/disaster/DisasterBadge.tsx";
import { SEED_OFFICES, SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID, DEMO_SECOND_CARE_MANAGER_ID, FIXED_ACCOUNT_IDS } from "../auth/demo.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { changeOwnPassword, NEW_PASSWORD_MAX, NEW_PASSWORD_MIN, passwordChangeRequest } from "../auth/password-change.ts";
import { checkPassword, PASSWORD_MAX, PASSWORD_MIN, passwordProblemLabel, passwordProblems } from "../auth/password-rule.ts";
import { chooseJudgeRole, chooseSandbox, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { officeZonesOf } from "../drill/db.ts";
import { form9Csv } from "../forms/form9-csv.ts";
import { form9Scope, loadForm9 } from "../forms/form9-db.ts";
import { cellText, buildMatsuyamaSheet } from "../forms/matsuyama.ts";
import { cityForOffice, cityForRegion } from "../forms/municipal-forms.ts";
import { seedRows } from "../forms/print-harness.ts";
import { loadJmaAlerts, loadRegionWarnings } from "../jma/alerts.ts";
import { fixtureFetcher, SAMPLE_DIR } from "../jma/fixture-fetch.ts";
import { fetchJma } from "../jma/run.ts";
import { fitView, place } from "../map/geo.ts";
import { initialView, REGION_MIN_Z, regionBox, regionView } from "../map/region.ts";
import { demoResetStatements } from "../seed/reset.ts";
import { addCareManagerRequest, careManagerActionRequest } from "./http.ts";
import { parseStaffInput } from "./forms.ts";
import { addRegionCity, loadOfficePlace, parsePlaceForm, placePost, savePlace } from "./place.ts";
import { loadOfficeProfile, normalizeOfficeNumber, normalizePhone, parseProfileForm, profilePost } from "./profile.ts";
import { citySuggestions, loadOfficeRegion, mapRegionOf, officeZonesFrom, parseRegionCities, regionCitiesOf, regionKmOf } from "./region.ts";
import { officeActor } from "./scope.ts";
import { setupItems } from "./setup.ts";
import { addCareManager, generateInitialPassword, resetCareManagerPassword } from "./staff.ts";

const SECRET = "t148-test-secret-0123456789abcdef-0123";
const NOW = 1_793_900_000;
const AT = "2026-11-06T03:00:00.000Z";
const JMA_NOW = "2026-11-03T14:00:00.000Z";
const TODAY = "2026-11-06";
const FAST = { iterations: 1000 };
// テストだけの値（決まりに合う物と合わない物）
const YAMAMOTO_PW = "T148-yamamoto-Pass";
const JUDGE_PW = "T148-judge-Pass-01";
const CHOSEN = "Kakuu-Pass-148!";

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

const form = (o: Record<string, string | string[]>) => ({
  get: (k: string) => (k in o ? (Array.isArray(o[k]) ? (o[k] as string[])[0] : o[k]) : null),
  getAll: (k: string) => (k in o ? (Array.isArray(o[k]) ? (o[k] as string[]) : [o[k]]) : []),
});
const office = (id = DEMO_OFFICE_ID) => sqlite.prepare("SELECT * FROM offices WHERE id = ?").get(id) as Record<string, unknown>;

async function loginOk(loginId: string, password: string, at = NOW) {
  const r = await login(db, env(), SECRET, { loginId, password }, at);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}
const yamamoto = async () => (await loginOk("yamamoto", YAMAMOTO_PW)).principal;
async function judgeCm(): Promise<Principal> {
  const t = (await loginOk("judge", JUDGE_PW)).token;
  const r = await chooseJudgeRole(db, env(), SECRET, t, "care_manager", NOW + 5);
  if (!r) throw new Error("審査員の役");
  return r.principal;
}
async function sandbox(): Promise<Principal> {
  const t = (await loginOk("judge", JUDGE_PW)).token;
  const r = await chooseSandbox(db, env(), SECRET, t, NOW + 10, AT);
  if (!r.ok) throw new Error(`試用事業所に入れない: ${r.error}`);
  const p = await resolvePrincipal(db, env(), SECRET, r.token, NOW + 11);
  if (!p) throw new Error("試用事業所");
  return p;
}

// ---------- migration 0035 ----------

describe("migration 0035（事業所の情報と地域）", () => {
  const MIGRATIONS = new URL("../../migrations/", import.meta.url);
  const names = () => readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();

  it("番号は 0035 で 1 つだけ", () => {
    expect(names().filter((n) => n.startsWith("0035_"))).toEqual(["0035_office_profile_region.sql"]);
  });

  it("前からある事業所の行は新しい列が NULL（ほかの列はそのまま）。形の違う値は CHECK で断る", () => {
    const d = new DatabaseSync(":memory:");
    d.exec("PRAGMA foreign_keys = ON;");
    for (const n of names().filter((n) => n < "0035_")) d.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    d.exec("INSERT INTO offices (id, name, kind, city, created_at) VALUES ('o-old', '前の事業所', 'regular', '高知市', '2026-11-01T00:00:00.000Z')");
    const before = d.prepare("SELECT * FROM offices").get() as Record<string, unknown>;
    for (const n of names().filter((n) => n >= "0035_")) d.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    const after = d.prepare("SELECT * FROM offices").get() as Record<string, unknown>;
    expect(after).toEqual({ ...before, address: null, phone: null, fax: null, office_number: null, region_cities: null, region_km: null });
    const bad = (set: string) => expect(() => d.exec(`UPDATE offices SET ${set} WHERE id = 'o-old'`), set).toThrow(/CHECK/);
    bad("office_number = '12345'");
    bad("office_number = '12345abcde'");
    bad("region_km = 15");
    bad("region_cities = '{\"a\":1}'");
    bad("region_cities = 'not json'");
    bad("address = ''");
    d.exec(`UPDATE offices SET office_number = '0123456789', region_km = 20, region_cities = '["東温市"]' WHERE id = 'o-old'`);
    d.close();
  });

  it("種のデモ事業所は架空の所在地・電話・周りの市を持ち、松山市の中心のまま。ほかの事業所は持たない", () => {
    const demo = office();
    expect(demo).toMatchObject({ city: "松山市", center_lat: 33.84, center_lng: 132.765, address: "愛媛県松山市みずほし町", phone: "090-0000-0090" });
    expect(JSON.parse(String(demo.region_cities))).toEqual(["東温市"]);
    expect(demo.region_km).toBeNull();
    expect(demo.office_number).toBeNull();
    expect(office("office-partner")).toMatchObject({ address: null, phone: null, region_cities: null });
    expect(SEED_OFFICES.filter((o) => "address" in o).map((o) => o.id)).toEqual([DEMO_OFFICE_ID]);
  });

  it("デモ事業所の戻しは事業所の情報と地域も種に戻す", () => {
    sqlite.exec(`UPDATE offices SET name = '変えた名前', address = '変えた所', phone = NULL, region_cities = NULL, region_km = 40 WHERE id = '${DEMO_OFFICE_ID}'`);
    for (const s of demoResetStatements(AT)) sqlite.exec(s);
    expect(office()).toMatchObject({ name: "デモ事業所", address: "愛媛県松山市みずほし町", phone: "090-0000-0090", region_km: null });
    expect(JSON.parse(String(office().region_cities))).toEqual(["東温市"]);
  });
});

// ---------- 事業所の情報 ----------

describe("事業所の情報", () => {
  it("形を読む: 名称は必ず・所在地は 80 字まで・電話と FAX は数字 6〜15 字（全角・横棒をそろえる）・事業所番号は数字 10 桁", () => {
    const ok = parseProfileForm(form({ name: " 架空  ケアセンター ", address: "愛媛県松山市そらみ台", phone: "０８９ー０００ー００００", fax: "", number: "38 0000 0001" }));
    expect(ok).toEqual({ ok: true, value: { name: "架空 ケアセンター", address: "愛媛県松山市そらみ台", phone: "089-000-0000", fax: null, number: "3800000001" } });
    expect(parseProfileForm(form({ name: "" }))).toEqual({ ok: false, error: "name" });
    expect(parseProfileForm(form({ name: "あ".repeat(41) }))).toEqual({ ok: false, error: "name" });
    expect(parseProfileForm(form({ name: "架空", address: "あ".repeat(81) }))).toEqual({ ok: false, error: "address" });
    expect(parseProfileForm(form({ name: "架空", phone: "電話です" }))).toEqual({ ok: false, error: "phone" });
    expect(parseProfileForm(form({ name: "架空", fax: "12" }))).toEqual({ ok: false, error: "fax" });
    expect(parseProfileForm(form({ name: "架空", number: "123456789" }))).toEqual({ ok: false, error: "number" });
    expect(normalizePhone("(089) 000-0000")).toBe("(089) 000-0000");
    expect(normalizeOfficeNumber("３８０００００００１")).toBe("3800000001");
  });

  it("管理者が保存すると表に入り、計画書・様式 9・ヘッダーの事業所名がその名前になる", async () => {
    const y = await yamamoto();
    const r = await profilePost(db, y, form({ name: "架空ケアセンター", address: "愛媛県松山市そらみ台", phone: "090-0000-0091", fax: "", number: "0000000001" }));
    expect(r).toEqual({ status: 303, location: "/office#office-profile" });
    expect(await loadOfficeProfile(db, DEMO_OFFICE_ID)).toEqual({
      name: "架空ケアセンター",
      address: "愛媛県松山市そらみ台",
      phone: "090-0000-0091",
      fax: null,
      number: "0000000001",
    });
    // ヘッダー・役の Principal（次の要求から）
    expect((await yamamoto()).office?.name).toBe("架空ケアセンター");
    // 様式 9（画面と CSV の事業所名）
    const f9 = await loadForm9(db, form9Scope(y)!, { today: TODAY, situation: null });
    expect(f9?.office.name).toBe("架空ケアセンター");
    expect(form9Csv(f9!.sheet, { officeName: f9!.office.name, madeAt: AT })).toContain("事業所名：架空ケアセンター");
    // 計画書の計画作成者（画面は offices.name を読む。app/people/[id]/forms/matsuyama）
    const name = (sqlite.prepare("SELECT name FROM offices WHERE id = ?").get(DEMO_OFFICE_ID) as { name: string }).name;
    const sheet = buildMatsuyamaSheet(seedRows(SEED_PEOPLE[0]), { today: TODAY, officeName: name });
    expect(cellText(sheet.cells["plan.author"])).toContain("架空ケアセンター");
  });

  it("形が違えば欄の名前を添えて戻し、表は変えない", async () => {
    const before = office();
    expect(await profilePost(db, await yamamoto(), form({ name: "架空", phone: "abc" }))).toEqual({
      status: 303,
      location: "/office?profile_error=phone#office-profile",
    });
    expect(office()).toEqual(before);
  });

  it("デモ事業所の審査員（ケアマネの役）と管理者でないケアマネは書けない。試用事業所の審査員は自分の事業所だけ書ける", async () => {
    const before = office();
    expect(await profilePost(db, await judgeCm(), form({ name: "審査員が変えた" }))).toEqual({ status: 403 });
    expect(await profilePost(db, null, form({ name: "x" }))).toEqual({ status: 401 });
    const y = await yamamoto();
    const notAdmin: Principal = { ...y, admin: false, accountId: DEMO_SECOND_CARE_MANAGER_ID };
    expect(await profilePost(db, notAdmin, form({ name: "x" }))).toEqual({ status: 403 });
    expect(office()).toEqual(before);
    const s = await sandbox();
    expect(await profilePost(db, s, form({ name: "試し 架空事業所", address: "高知県高知市架空町" }))).toMatchObject({ status: 303 });
    expect(await loadOfficeProfile(db, s.office!.id)).toMatchObject({ name: "試し 架空事業所", address: "高知県高知市架空町" });
    expect(office()).toEqual(before);
  });

  it("準備の欄: 所在地が未入力なら「事業所 未入力」（渡さなければ前と同じ）", () => {
    const base = { center: { lat: 33.8, lng: 132.7 }, careManagers: [{ disabled: false }, { disabled: false }], people: [{ careManagerId: "a", unlistedAt: null }], careManagerLater: false };
    expect(setupItems(base)).toEqual([]);
    expect(setupItems({ ...base, profileMissing: false })).toEqual([]);
    expect(setupItems({ ...base, profileMissing: true, center: null }).map((i) => [i.kind, i.label, i.status, i.href])).toEqual([
      ["profile", "事業所", "未入力", "#office-profile"],
      ["place", "地域", "未設定", "#office-place"],
    ]);
  });
});

// ---------- 地域 ----------

describe("地域（主な市＋周りの市・広さ・区域）", () => {
  it("周りの市の形: 区切った 1 欄・複数の欄、重なりと主な市を落とす、8 つまで、20 字まで", () => {
    expect(parsePlaceForm(form({ city: "松山市", region: "1", region_city: "東温市・砥部町、松山市 東温市", region_km: "auto", flood_depth: "none" }))).toEqual({
      city: "松山市",
      center: null,
      region: { others: ["東温市", "砥部町"], km: null, zones: [] },
    });
    expect(parsePlaceForm(form({ city: "松山市", region: "1", region_city: ["伊予市", "", "東温市"], region_km: "40", zone: ["tsunami", "flood"], flood_depth: "3" }))).toEqual({
      city: "松山市",
      center: null,
      region: { others: ["伊予市", "東温市"], km: 40, zones: [{ kind: "flood", depthM: 3 }, { kind: "tsunami", depthM: null }] },
    });
    const nine = Array.from({ length: 9 }, (_, i) => `架空${i}市`).join("・");
    expect(parsePlaceForm(form({ city: "松山市", region: "1", region_city: nine }))).toBeNull();
    expect(parsePlaceForm(form({ city: "松山市", region: "1", region_city: "あ".repeat(21) }))).toBeNull();
    expect(parsePlaceForm(form({ city: "松山市", region: "1", region_km: "15" }))).toBeNull();
    expect(parsePlaceForm(form({ city: "松山市", region: "1", zone: "other" }))).toBeNull();
    expect(parsePlaceForm(form({ city: "松山市", region: "1", flood_depth: "2" }))).toBeNull();
    // 印の無い前の形のフォームは市と中心だけ（周りの市・広さ・区域を書かない）
    expect(parsePlaceForm(form({ city: "松山市" }))).toEqual({ city: "松山市", center: null });
  });

  it("保存すると周りの市・広さ・区域が表に入り、印の無い前の形の保存は周りの市・区域を残す", async () => {
    const y = await yamamoto();
    expect(
      await placePost(
        db,
        y,
        form({ city: "松山市", center_lat: "33.84", center_lng: "132.765", region: "1", region_city: "東温市・伊予市", region_km: "20", zone: ["flood", "landslide"], flood_depth: "0.5" }),
      ),
    ).toEqual({ status: 303, location: "/office#office-place" });
    expect(office()).toMatchObject({ region_cities: '["東温市","伊予市"]', region_km: 20, hazards: '[{"kind":"flood","depthM":0.5},{"kind":"landslide"}]' });
    expect(await savePlace(db, y, { city: "松山市", center: { lat: 33.84, lng: 132.765 } })).toEqual({ ok: true });
    expect(office()).toMatchObject({ region_cities: '["東温市","伊予市"]', region_km: 20 });
    // 周りの市を空にすると NULL、区域を全部外すと区域なし（"[]"）
    await placePost(db, y, form({ city: "松山市", region: "1", region_city: "", region_km: "" }));
    expect(office()).toMatchObject({ region_cities: null, region_km: null, hazards: "[]" });
  });

  it("審査員（ケアマネの役）は地域を書けない（前と同じ）。試用事業所の審査員は書ける", async () => {
    const before = office();
    expect(await placePost(db, await judgeCm(), form({ city: "高知市", region: "1", region_city: "南国市" }))).toEqual({ status: 403 });
    expect(await placePost(db, await judgeCm(), form({ add_city: "南国市" }))).toEqual({ status: 403 });
    expect(office()).toEqual(before);
    const s = await sandbox();
    expect(await placePost(db, s, form({ city: "高知市", region: "1", region_city: "南国市" }))).toMatchObject({ status: 303 });
    expect(regionCitiesOf(office(s.office!.id) as { city: string; region_cities: string | null })).toEqual(["高知市", "南国市"]);
  });

  it("地域の読み方: 主な市が先、重なり・空・主な市を落とす。広さは置かなければ自動（周りの市が無ければ 10 km、あれば 20 km）", () => {
    expect(regionCitiesOf({ city: "松山市", region_cities: '["東温市","","松山市","東温市"]' })).toEqual(["松山市", "東温市"]);
    expect(regionCitiesOf({ city: "松山市", region_cities: "壊れた" })).toEqual(["松山市"]);
    expect(parseRegionCities('[1,"砥部町"]', "松山市")).toEqual(["砥部町"]);
    expect(regionKmOf(null, 1)).toBe(10);
    expect(regionKmOf(null, 3)).toBe(20);
    expect(regionKmOf(5, 3)).toBe(5);
    expect(regionKmOf(15, 1)).toBe(10);
  });

  it("地域に追加: 利用者の住所の市で地域に入っていない市を人数の順に。押すと周りの市の後ろに 1 つ足す", async () => {
    sqlite.exec(`UPDATE people SET ledger = json_set(ledger, '$.basic.address.city', '伊予市') WHERE id IN ('p-02', 'p-03')`);
    sqlite.exec(`UPDATE people SET ledger = json_set(ledger, '$.basic.address.city', '砥部町') WHERE id = 'p-04'`);
    sqlite.exec(`UPDATE people SET ledger = json_set(ledger, '$.basic.address.city', '東温市') WHERE id = 'p-05'`);
    const r = await loadOfficeRegion(db, DEMO_OFFICE_ID);
    expect(r?.cities).toEqual(["松山市", "東温市"]);
    expect(r?.suggestions).toEqual([
      { city: "伊予市", count: 2 },
      { city: "砥部町", count: 1 },
    ]);
    const y = await yamamoto();
    expect(await placePost(db, y, form({ add_city: "伊予市" }))).toEqual({ status: 303, location: "/office#office-place" });
    expect(await addRegionCity(db, y, "伊予市")).toEqual({ ok: true });
    expect(await addRegionCity(db, y, "松山市")).toEqual({ ok: true });
    expect(JSON.parse(String(office().region_cities))).toEqual(["東温市", "伊予市"]);
    expect((await loadOfficeRegion(db, DEMO_OFFICE_ID))?.suggestions).toEqual([{ city: "砥部町", count: 1 }]);
    // 区のある市は同じ市（「○○市○○区」）。空の市は候補にしない
    expect(citySuggestions(["広島市"], [{ city: "広島市中区", count: 2 }, { city: "", count: 3 }])).toEqual([]);
  });

  it("事業所の区域は訓練（lib/drill/db.ts の officeZonesOf）と同じ読み方。デモ事業所の NULL は架空の街の区域", async () => {
    for (const t of [null, "", "[]", "壊れた", '["tsunami"]', '[{"kind":"flood","depthM":3},{"kind":"flood"},{"kind":"x"},{"kind":"landslide","depthM":"深い"}]']) {
      expect(officeZonesFrom(t, DEMO_OFFICE_ID), String(t)).toEqual(officeZonesOf(t, DEMO_OFFICE_ID));
      expect(officeZonesFrom(t, "office-partner"), String(t)).toEqual(officeZonesOf(t, "office-partner"));
    }
    expect((await loadOfficeRegion(db, DEMO_OFFICE_ID))?.zones).toEqual([{ kind: "flood", depthM: 0.5 }]);
    await placePost(db, await yamamoto(), form({ city: "松山市", region: "1", zone: "tsunami" }));
    const saved = (sqlite.prepare("SELECT hazards FROM offices WHERE id = ?").get(DEMO_OFFICE_ID) as { hazards: string }).hazards;
    expect(officeZonesOf(saved, DEMO_OFFICE_ID)).toEqual([{ kind: "tsunami", depthM: null }]);
  });

  it("様式の一覧の初めの市: 地域の市を順に見て一覧にある最初の市（主な市が一覧に無ければ周りの市）", () => {
    expect(cityForRegion(["松山市", "東温市"])?.id).toBe(cityForOffice("松山市")?.id);
    expect(cityForRegion(["架空市", "松山市"])?.id).toBe(cityForOffice("松山市")?.id);
    expect(cityForRegion(["架空市"])).toBeNull();
    expect(cityForRegion([])).toBeNull();
  });
});

describe("地域が気象庁の欄と上の帯に効く", () => {
  // 気象庁の写しは事業所の地域の市（周りの市も）と利用者の市の行だけ（lib/jma/store.ts の relevantCities）。地域を変えてから取る
  const fetchNow = () => fetchJma(db, fixtureFetcher(SAMPLE_DIR), JMA_NOW);

  it("写す市に周りの市も入る（cron が取る時に）", async () => {
    sqlite.exec(`UPDATE offices SET region_cities = '["伊予市"]' WHERE id = 'office-partner'`);
    const { relevantCities } = await import("../jma/store.ts");
    expect(await relevantCities(db)).toEqual(expect.arrayContaining(["松山市", "東温市", "伊予市"]));
  });

  it("周りの市の発表も出す（主な市 → 周りの市 → 利用者の市の順）。利用者がいない市は該当 0 人", async () => {
    // デモ事業所の周りの市（東温市）は種なので、写しにある。協力事業所（利用者なし・松山市）は周りの市が無ければ松山市だけ
    await fetchNow();
    const before = await loadJmaAlerts(db, "office-partner", JMA_NOW);
    expect([...new Set(before.rows.map((r) => r.areaName))]).toEqual(["松山市"]);
    sqlite.exec(`UPDATE offices SET region_cities = '["東温市"]' WHERE id = 'office-partner'`);
    const after = await loadJmaAlerts(db, "office-partner", JMA_NOW);
    expect(after.rows.map((r) => `${r.kind} ${r.areaName} ${r.people}`)).toEqual(["レベル3大雨警報 松山市 0", "雷注意報 松山市 0", "大雨注意報 東温市 0"]);
  });

  it("主な市を外し周りの市だけ変えると、その市の発表だけ（利用者の市が無いとき）", async () => {
    await fetchNow();
    sqlite.exec(`UPDATE offices SET city = '東温市', region_cities = NULL WHERE id = 'office-partner'`);
    const a = await loadJmaAlerts(db, "office-partner", JMA_NOW);
    expect(a.rows.map((r) => r.areaName)).toEqual(["東温市"]);
  });

  it("上の帯の警報の数は気象庁の欄の警報（注意報でない物）と同じ。D1 は 1 回の往復", async () => {
    await fetchNow();
    const jma = await loadJmaAlerts(db, DEMO_OFFICE_ID, JMA_NOW);
    const w = await loadRegionWarnings(db, DEMO_OFFICE_ID);
    expect(w.count).toBe(jma.rows.filter((r) => r.warning).length);
    expect(w).toEqual({ count: 1, kinds: ["レベル3大雨警報"] });
    sqlite.exec(`UPDATE offices SET city = '東温市', region_cities = NULL WHERE id = 'office-partner'`);
    expect(await loadRegionWarnings(db, "office-partner")).toEqual({ count: 0, kinds: [] });
    expect(await loadRegionWarnings(db, "office-none")).toEqual({ count: 0, kinds: [] });
  });

  it("帯の印: 平時の「警報 2」は押すと事業所の画面の気象庁の欄へ、災害モードは状態の印に添える。色の印は使わない", () => {
    const html = (mark: Parameters<typeof DisasterBadge>[0]["mark"], link: boolean, count: number) =>
      renderToStaticMarkup(createElement(DisasterBadge, { mark, link, warnings: { count, kinds: ["大雨警報", "洪水警報"] } }));
    const normal = html({ kind: "normal", label: "平時" }, true, 2);
    expect(normal).toContain('href="/office#jma"');
    expect(normal).toContain("警報 2");
    expect(normal).toContain('title="大雨警報・洪水警報"');
    expect(normal).not.toMatch(/state-(urgent|ok|check)/);
    expect(html({ kind: "normal", label: "平時" }, true, 0)).not.toContain("警報");
    const disaster = html({ kind: "disaster", label: "大雨", details: ["レベル 4"] }, false, 1);
    expect(disaster).toContain("警報 1");
    expect(disaster).not.toContain("href");
  });
});

describe("地域が地図の中心と広さに効く", () => {
  const pins = SEED_PEOPLE.flatMap((p) => (p.ledger.basic.location ? [p.ledger.basic.location] : []));
  const pinFit = (pts: typeof pins) => fitView(pts, { minZ: 11, maxZ: 15, fallback: { lat: 33.84, lng: 132.765 } });

  it("ピンがある地図の初めの表示は前と同じ（デモ事業所の 10 人）。ピンが無ければ地域の表示", async () => {
    expect(pins.length).toBeGreaterThan(0);
    const place0 = await loadOfficePlace(db, DEMO_OFFICE_ID);
    const region = mapRegionOf(place0!)!;
    expect(region).toEqual({ center: { lat: 33.84, lng: 132.765 }, km: 20 });
    expect(initialView(pins.length, pinFit(pins), region)).toEqual(pinFit(pins));
    expect(initialView(0, pinFit([]), region)).toEqual(regionView(region));
    expect(initialView(0, pinFit([]), null)).toEqual(pinFit([]));
  });

  it("地域の表示は中心から km の四角が枠に入り、広いほど引く（40 km でも地図の一番引いた所まで）", () => {
    const c = { lat: 33.84, lng: 132.765 };
    const zs = [5, 10, 20, 40].map((km) => regionView({ center: c, km }).z);
    expect([...zs].sort((a, b) => b - a)).toEqual(zs);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(REGION_MIN_Z);
    for (const km of [5, 10, 20]) {
      const v = regionView({ center: c, km });
      for (const corner of regionBox(c, km)) {
        const p = place(v, corner);
        expect(p.left, `${km} km`).toBeGreaterThanOrEqual(-0.01);
        expect(p.left, `${km} km`).toBeLessThanOrEqual(100.01);
        expect(p.top, `${km} km`).toBeGreaterThanOrEqual(-0.01);
        expect(p.top, `${km} km`).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it("中心が無い事業所は地域の表示なし（地図は前からの既定の真ん中）。周りの市を足すと自動の広さが 10 → 20 km", () => {
    expect(mapRegionOf({ center: null, cities: ["松山市"], km: null })).toBeNull();
    expect(mapRegionOf({ center: { lat: 33, lng: 133 }, cities: ["松山市"], km: null })?.km).toBe(10);
    expect(mapRegionOf({ center: { lat: 33, lng: 133 }, cities: ["松山市", "東温市"], km: null })?.km).toBe(20);
    expect(mapRegionOf({ center: { lat: 33, lng: 133 }, cities: ["松山市", "東温市"], km: 5 })?.km).toBe(5);
  });
});

// ---------- パスワード ----------

describe("パスワードの決まり（1 か所）", () => {
  it("10〜64 字・大文字・小文字・記号。足りない物を決まりの順に", () => {
    expect(PASSWORD_MIN).toBe(10);
    expect(PASSWORD_MAX).toBe(64);
    expect([NEW_PASSWORD_MIN, NEW_PASSWORD_MAX]).toEqual([PASSWORD_MIN, PASSWORD_MAX]);
    expect(passwordProblems(CHOSEN)).toEqual([]);
    expect(passwordProblems("Abcdefgh!")).toEqual(["length"]);
    expect(passwordProblems("abcdefghij!")).toEqual(["upper"]);
    expect(passwordProblems("ABCDEFGHIJ!")).toEqual(["lower"]);
    expect(passwordProblems("Abcdefghij1")).toEqual(["symbol"]);
    expect(passwordProblems("Ａｂｃｄｅｆｇｈｉｊ！")).toEqual(["upper", "lower", "symbol"]);
    expect(passwordProblems(`Ab-${"x".repeat(62)}`)).toEqual(["length"]);
    expect(checkPassword(42)).toEqual({ ok: false, missing: ["length", "upper", "lower", "symbol"] });
    expect(passwordProblemLabel(["symbol", "upper"])).toBe("条件不足 大文字 記号");
  });

  it("サーバーが作る初期パスワードも決まりを通る（大文字・小文字・区切り）", () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInitialPassword();
      expect(p).toMatch(/^[a-hjkmnp-zA-HJKMNP-Z2-9]{4}-[a-hjkmnp-zA-HJKMNP-Z2-9]{4}-[a-hjkmnp-zA-HJKMNP-Z2-9]{4}$/);
      expect(passwordProblems(p), p).toEqual([]);
    }
  });

  it("自分のパスワードの変更も同じ決まり（前の 8 字・小文字だけは断る）", async () => {
    const y = await yamamoto();
    const actor = officeActor(y)!;
    const added = await addCareManager(db, actor, { displayName: "架空", loginId: "kakuu.1" }, AT, FAST);
    if (!added.ok) throw new Error("足せない");
    const p = (await loginOk("kakuu.1", added.password)).principal;
    expect(await changeOwnPassword(db, env(), SECRET, p, { current: added.password, next: "new-pass-1" }, NOW, FAST)).toEqual({ ok: false, error: "password" });
    const http = await passwordChangeRequest(db, env(), SECRET, p, { current: added.password, next: "new-pass-1" }, NOW, FAST);
    expect(http).toMatchObject({ status: 400, body: { error: "password", label: "条件不足 大文字" } });
    expect(await changeOwnPassword(db, env(), SECRET, p, { current: added.password, next: CHOSEN }, NOW, FAST)).toMatchObject({ ok: true });
  });
});

describe("ケアマネ追加で ID とパスワードを決める", () => {
  const accountRow = (loginId: string) =>
    sqlite.prepare("SELECT id, password_hash, password_initial, judge_made FROM accounts WHERE login_id = ?").get(loginId) as
      | { id: string; password_hash: string; password_initial: number; judge_made: number }
      | undefined;

  it("入力: パスワードは任意。入れたら決まりで確かめる", () => {
    expect(parseStaffInput({ displayName: "架空", loginId: "kakuu" })).toEqual({ ok: true, value: { displayName: "架空", loginId: "kakuu" } });
    expect(parseStaffInput({ displayName: "架空", loginId: "kakuu", password: "" })).toEqual({ ok: true, value: { displayName: "架空", loginId: "kakuu" } });
    expect(parseStaffInput({ displayName: "架空", loginId: "kakuu", password: CHOSEN })).toEqual({ ok: true, value: { displayName: "架空", loginId: "kakuu", password: CHOSEN } });
    expect(parseStaffInput({ displayName: "架空", loginId: "kakuu", password: "short" })).toEqual({ ok: false, error: "password" });
    expect(parseStaffInput({ displayName: "架空", loginId: "kakuu", password: 12345678901 })).toEqual({ ok: false, error: "password" });
  });

  it("決めたパスワードで足すと、応答にパスワードを返さず、その ID とパスワードでログインでき、初期パスワードの印は付く。表と経過に平文は無い", async () => {
    const r = await addCareManagerRequest(db, await yamamoto(), { displayName: "架空 花子", loginId: "Kakuu.H", password: CHOSEN }, AT, FAST);
    expect(r).toMatchObject({ status: 200, body: { ok: true, account: { displayName: "架空 花子", loginId: "kakuu.h" }, password: null } });
    const a = accountRow("kakuu.h")!;
    expect(await verifyPassword(CHOSEN, a.password_hash)).toBe(true);
    expect(a.password_initial).toBe(1);
    expect(a.judge_made).toBe(0);
    const logged = await loginOk("kakuu.h", CHOSEN);
    expect(logged.principal).toMatchObject({ role: "care_manager", initialPassword: true });
    const all = JSON.stringify([sqlite.prepare("SELECT * FROM accounts").all(), sqlite.prepare("SELECT * FROM office_timeline_entries").all()]);
    expect(all).not.toContain(CHOSEN);
  });

  it("パスワードを空にすれば今どおり作って 1 回だけ返す", async () => {
    const r = await addCareManagerRequest(db, await yamamoto(), { displayName: "架空", loginId: "kakuu.auto" }, AT, FAST);
    const pw = r.body.password as string;
    expect(passwordProblems(pw)).toEqual([]);
    await loginOk("kakuu.auto", pw);
  });

  it("決まりに合わないパスワードは 400「条件不足」と足りない物。表は変わらない", async () => {
    const before = sqlite.prepare("SELECT count(*) AS n FROM accounts").get();
    const r = await addCareManagerRequest(db, await yamamoto(), { displayName: "架空", loginId: "kakuu.bad", password: "abcdefghij" }, AT, FAST);
    expect(r).toEqual({ status: 400, body: { ok: false, error: "password", label: "条件不足 大文字 記号" } });
    expect(sqlite.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual(before);
  });

  it("ID の重なりは今どおり断る（同じ事業所は使用中、ほかの事業所は不可、審査員の ID は不正）", async () => {
    const y = await yamamoto();
    expect(await addCareManagerRequest(db, y, { displayName: "架空", loginId: "yamamoto", password: CHOSEN }, AT, FAST)).toMatchObject({
      status: 409,
      body: { error: "login_taken", label: "ID 使用中" },
    });
    sqlite.exec("UPDATE accounts SET login_id = 'partner1' WHERE id = 'acct-partner-cm'");
    expect(await addCareManagerRequest(db, y, { displayName: "架空", loginId: "partner1", password: CHOSEN }, AT, FAST)).toMatchObject({
      status: 409,
      body: { error: "login_unavailable" },
    });
    expect(await addCareManagerRequest(db, y, { displayName: "架空", loginId: "judge", password: CHOSEN }, AT, FAST)).toMatchObject({
      status: 400,
      body: { error: "login_id" },
    });
  });

  it("審査員が足すと印（judge_made）が付き、決めたパスワードで入っても審査員と同じ壁", async () => {
    const r = await addCareManagerRequest(db, await judgeCm(), { displayName: "架空 審査", loginId: "kakuu.j", password: CHOSEN }, AT, FAST);
    expect(r).toMatchObject({ status: 200, body: { password: null } });
    expect(accountRow("kakuu.j")?.judge_made).toBe(1);
    expect((await loginOk("kakuu.j", CHOSEN)).principal).toMatchObject({ judgeMade: true });
  });
});

describe("管理者の再設定", () => {
  async function added() {
    const r = await addCareManager(db, officeActor(await yamamoto())!, { displayName: "架空", loginId: "kakuu.r" }, AT, FAST);
    if (!r.ok) throw new Error("足せない");
    return r;
  }

  it("決めたパスワードで再設定すると返さず、そのパスワードで入れて前のパスワードは切れる。経過は「再発行」で平文は無い", async () => {
    const a = await added();
    const r = await careManagerActionRequest(db, await yamamoto(), a.account.id, { action: "reset_password", password: CHOSEN }, AT, FAST);
    expect(r).toMatchObject({ status: 200, body: { ok: true, password: null } });
    await loginOk("kakuu.r", CHOSEN);
    expect((await login(db, env(), SECRET, { loginId: "kakuu.r", password: a.password }, NOW)).ok).toBe(false);
    const log = JSON.stringify(sqlite.prepare("SELECT body, payload FROM office_timeline_entries WHERE kind = 'care_manager_changed'").all());
    expect(log).toContain("再発行");
    expect(log).not.toContain(CHOSEN);
  });

  it("決めないと今どおり作って 1 回だけ返す。決まりに合わなければ 400 で変えない", async () => {
    const a = await added();
    const y = await yamamoto();
    const auto = await careManagerActionRequest(db, y, a.account.id, { action: "reset_password" }, AT, FAST);
    expect(passwordProblems(auto.body.password as string)).toEqual([]);
    const before = (sqlite.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(a.account.id) as { password_hash: string }).password_hash;
    expect(await careManagerActionRequest(db, y, a.account.id, { action: "reset_password", password: "abc" }, AT, FAST)).toMatchObject({
      status: 400,
      body: { error: "password" },
    });
    expect((sqlite.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(a.account.id) as { password_hash: string }).password_hash).toBe(before);
  });

  it("変えられないアカウントと審査員は今どおり断る（決めたパスワードでも）", async () => {
    const y = await yamamoto();
    for (const id of FIXED_ACCOUNT_IDS) {
      const r = await careManagerActionRequest(db, y, id, { action: "reset_password", password: CHOSEN }, AT, FAST);
      expect(r, id).toMatchObject({ status: 403, body: { error: "fixed" } });
    }
    const a = await added();
    // 審査員は印の無い（本物の）アカウントを再設定できない
    expect(await resetCareManagerPassword(db, officeActor(await judgeCm())!, a.account.id, AT, { ...FAST, chosen: CHOSEN })).toEqual({ ok: false, error: "fixed" });
    // 自分は再設定できない（自分のパスワードは変更の欄から）
    expect(await resetCareManagerPassword(db, officeActor(y)!, DEMO_CARE_MANAGER_ID, AT, { ...FAST, chosen: CHOSEN })).toEqual({ ok: false, error: "fixed" });
  });
});
