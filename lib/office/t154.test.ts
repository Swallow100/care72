// T154 のテスト（docs/tasks/T154.md）: 全国の市区町村の表、地域を団体コードで選ぶ形、場所を変えたときに気象庁の欄・地図・上の帯・
// 様式の一覧の初めの市がそろって変わること、T148 の文字の値の写し、利用者の住所の市の内外。
// D1 は node:sqlite（lib/db/test-d1.ts）に種。気象庁は fixtures の作った見本（本物には繋がない）。ハッシュの回数はテストだけ減らす。

import type { D1Database } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MainCityPicker, OtherCitiesPicker } from "../../components/office/CityPicker.tsx";
import { seedStatements } from "../../seed/sql.ts";
import { CHECK_OFFICE_ID, DEMO_OFFICE_ID, LOGIN_CARE_MANAGER_ID } from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { chooseSandbox, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { municipalEntry, MUNICIPAL_CITIES } from "../forms/municipal-forms.ts";
import { loadJmaAlerts, loadRegionWarnings } from "../jma/alerts.ts";
import { fixtureFetcher, SAMPLE_DIR } from "../jma/fixture-fetch.ts";
import { fetchJma, toStored } from "../jma/run.ts";
import { relevantAreaCodes } from "../jma/store.ts";
import { municipalityGeo, municipalityGeoCount } from "../municipality/geo.ts";
import {
  allMunicipalities,
  matchCity,
  municipalityByCode,
  municipalityOfAddress,
  PREFECTURE_NAMES,
  resolveCityName,
} from "../municipality/names.ts";
import { areaSuggestions, kmCovering, loadOfficeRegion, officeAreaOf, type OfficeAreaRow } from "./area.ts";
import { addRegionCity, loadOfficePlace, placePost, savePlace } from "./place.ts";

const SECRET = "t154-test-secret-0123456789abcdef-0123";
const NOW = 1_793_900_000;
const AT = "2026-11-06T03:00:00.000Z";
const JMA_NOW = "2026-11-03T14:00:00.000Z";
const FAST = { iterations: 1000 };
// テストだけの値
const YAMAMOTO_PW = "T154-yamamoto-Pass";
const JUDGE_PW = "T154-judge-Pass-01";

/** 団体コード（総務省の全国地方公共団体コード、6 桁） */
const C = {
  matsuyama: "382019",
  toon: "382159",
  iyo: "382108",
  imabari: "382027",
  hiroshima: "341002",
  hiroshimaNaka: "341011",
  fuchuTokyo: "132063",
  fuchuHiroshima: "342084",
  hamamatsu: "221309",
} as const;

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
  for (const s of seedStatements({ passwordHashes: { [LOGIN_CARE_MANAGER_ID]: yamamotoHash } })) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const form = (o: Record<string, string | string[]>) => ({
  get: (k: string) => (k in o ? (Array.isArray(o[k]) ? (o[k] as string[])[0] : o[k]) : null),
  getAll: (k: string) => (k in o ? (Array.isArray(o[k]) ? (o[k] as string[]) : [o[k]]) : []),
});
const office = (id: string) => sqlite.prepare("SELECT * FROM offices WHERE id = ?").get(id) as Record<string, unknown>;

async function loginOk(loginId: string, password: string, at = NOW) {
  const r = await login(db, env(), SECRET, { loginId, password }, at);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  return r;
}
const yamamoto = async () => (await loginOk("yamamoto", YAMAMOTO_PW)).principal;
/** 試用事業所（T115）。利用者がいない事業所の地域だけを変えて、効き方を見る */
async function sandbox(): Promise<Principal> {
  const t = (await loginOk("judge", JUDGE_PW)).token;
  const r = await chooseSandbox(db, env(), SECRET, t, NOW + 10, AT);
  if (!r.ok) throw new Error(`試用事業所に入れない: ${r.error}`);
  const p = await resolvePrincipal(db, env(), SECRET, r.token, NOW + 11);
  if (!p) throw new Error("試用事業所");
  return p;
}

// ---------- 表 ----------

describe("全国の市区町村の表", () => {
  it("団体コードは 6 桁で重ならず、47 の都道府県がそろう。政令指定都市の区は市を親に持つ", () => {
    const all = allMunicipalities();
    expect(all.length).toBe(1918);
    expect(new Set(all.map((m) => m.code)).size).toBe(all.length);
    expect(all.every((m) => /^\d{6}$/.test(m.code))).toBe(true);
    expect(new Set(all.map((m) => m.pref))).toEqual(new Set(PREFECTURE_NAMES));
    expect(all.filter((m) => m.parent).length).toBe(171);
    expect(municipalityByCode(C.hiroshimaNaka)).toMatchObject({ pref: "広島県", name: "広島市中区", kana: "ひろしましなかく", parent: C.hiroshima });
    expect(municipalityByCode(C.matsuyama)).toMatchObject({ pref: "愛媛県", name: "松山市", kana: "まつやまし", parent: null });
  });

  it("気象庁の市町村等のコード: 松山市は 1 つ、浜松市は 2 つ（南部・北部）、広島市は区ごと、札幌市の区は市のコード", () => {
    expect(municipalityGeo(C.matsuyama)).toMatchObject({ jmaCodes: ["3820100"], jmaGroups: ["380010"], jmaOffices: ["380000"] });
    expect(municipalityGeo(C.toon)?.jmaCodes).toEqual(["3821500"]);
    expect(municipalityGeo(C.hamamatsu)?.jmaCodes).toEqual(["2213001", "2213002"]);
    expect(municipalityGeo(C.hiroshima)?.jmaCodes).toHaveLength(8);
    expect(municipalityGeo(C.hiroshimaNaka)?.jmaCodes).toEqual(["3410100"]);
    expect(municipalityGeo("011011")?.jmaCodes).toEqual(["0110000"]);
    // 北方領土の 6 村は気象庁の区域が無い（表に名前だけ）
    expect(municipalityGeoCount()).toBe(allMunicipalities().length - 6);
    expect(municipalityGeo("016951")).toBeNull();
  });

  it("代表の点は日本の中で、範囲の中。松山市の点は市街から 10 km 以内", () => {
    for (const m of allMunicipalities()) {
      const g = municipalityGeo(m.code);
      if (!g) continue;
      expect(g.point.lat, m.code).toBeGreaterThan(20);
      expect(g.point.lat, m.code).toBeLessThan(46);
      expect(g.point.lng, m.code).toBeGreaterThan(122);
      expect(g.point.lng, m.code).toBeLessThan(154);
      expect(g.box.s <= g.point.lat && g.point.lat <= g.box.n && g.box.w <= g.point.lng && g.point.lng <= g.box.e, m.code).toBe(true);
    }
    const p = municipalityGeo(C.matsuyama)!.point;
    const km = Math.hypot((p.lat - 33.84) * 111.32, (p.lng - 132.765) * 92.5);
    expect(km).toBeLessThan(10);
  });

  it("文字の市を当てる: 同じ名前の市は都道府県で決まるときだけ。都道府県の頭・郡・ヶとケ・所在地の頭", () => {
    expect(resolveCityName("府中市").kind).toBe("ambiguous");
    expect(matchCity("府中市")).toBeNull();
    expect(matchCity("府中市", "広島県")?.code).toBe(C.fuchuHiroshima);
    expect(matchCity("東京都府中市", "広島県")?.code).toBe(C.fuchuTokyo);
    expect(matchCity(" 松山市 ")?.code).toBe(C.matsuyama);
    expect(matchCity("上浮穴郡久万高原町")?.name).toBe("久万高原町");
    expect(matchCity("鎌ヶ谷市")?.code).toBe(matchCity("鎌ケ谷市")?.code);
    expect(matchCity("鎌ヶ谷市")).not.toBeNull();
    expect(matchCity("架空市")).toBeNull();
    expect(matchCity("")).toBeNull();
    expect(municipalityOfAddress("愛媛県松山市みずほし町")?.code).toBe(C.matsuyama);
    expect(municipalityOfAddress("広島県広島市中区架空町")?.code).toBe(C.hiroshimaNaka);
    expect(municipalityOfAddress("府中市架空町")).toBeNull();
  });
});

// ---------- 1 つの関数 ----------

const row = (o: Partial<OfficeAreaRow>): OfficeAreaRow => ({
  city: null,
  city_code: null,
  region_cities: null,
  region_city_codes: null,
  center_lat: null,
  center_lng: null,
  region_km: null,
  address: null,
  ...o,
});

describe("officeAreaOf（地域を団体コードで決める 1 か所）", () => {
  it("デモ事業所の種: 主な市 松山市・周りの市 東温市、気象庁の市町村等・中心・広さ・様式の初めの市", async () => {
    const o = office(DEMO_OFFICE_ID) as unknown as OfficeAreaRow;
    const a = officeAreaOf(o);
    expect(a.main?.code).toBe(C.matsuyama);
    expect(a.mainSaved).toBe(true);
    expect(a.others.map((m) => m.code)).toEqual([C.toon]);
    expect(a.cities).toEqual(["松山市", "東温市"]);
    expect(a.jmaCodes).toEqual(["3820100", "3821500"]);
    expect(a.center).toEqual({ lat: 33.84, lng: 132.765 });
    expect(a.map).toEqual({ center: { lat: 33.84, lng: 132.765 }, km: 25 });
    expect(a.formsCityId).toBe("matsuyama");
  });

  it("T148 の文字の値は表で当てて写す。同じ名前の市は所在地の都道府県で、当たらない物は未選択・未照合", () => {
    const fuchu = officeAreaOf(row({ city: "府中市", address: "広島県府中市架空町" }));
    expect(fuchu.main?.code).toBe(C.fuchuHiroshima);
    expect(fuchu.mainSaved).toBe(false);
    expect(fuchu.jmaCodes).toEqual(["3420800"]);
    const none = officeAreaOf(row({ city: "府中市" }));
    expect(none.main).toBeNull();
    expect(none.mainText).toBe("府中市");
    expect(none.jmaCodes).toEqual([]);
    const legacy = officeAreaOf(row({ city: "松山市", region_cities: '["東温市","架空市"]' }));
    expect(legacy.others.map((m) => m.name)).toEqual(["東温市"]);
    expect(legacy.unmatched).toEqual(["架空市"]);
    expect(legacy.cities).toEqual(["松山市", "東温市", "架空市"]);
    // 中心が無ければ主な市の代表の点、広さは地域の市の範囲が入る km
    expect(legacy.center).toEqual(municipalityGeo(C.matsuyama)!.point);
    expect(legacy.km).toBe(kmCovering(legacy.center!, [legacy.main!, ...legacy.others]));
    // 置いた広さが先
    expect(officeAreaOf(row({ city_code: C.matsuyama, region_km: 5 })).km).toBe(5);
  });

  it("利用者の住所の市: 地域の中・地域に追加の候補（団体コードつき）・表に当たらない住所に分ける。区と市は同じ地域", () => {
    const a = officeAreaOf(row({ city_code: C.hiroshima, region_city_codes: JSON.stringify([C.fuchuHiroshima]) }));
    const s = areaSuggestions(a, [
      { city: "広島市中区", count: 2 },
      { city: "府中市", count: 1 },
      { city: "三次市", count: 3 },
      { city: "架空町", count: 1 },
      { city: "", count: 4 },
    ]);
    expect(s.add).toEqual([{ code: matchCity("三次市")!.code, city: "三次市", label: "広島県三次市", count: 3 }]);
    expect(s.unmatched).toEqual([{ city: "架空町", count: 1 }]);
  });
});

// ---------- 場所を変えると、全部がそろって変わる ----------

describe("場所を変えると気象庁の欄・上の帯・地図・様式の初めの市がそろって変わる", () => {
  // cron は取った電文を取り直さない（写すのはその時の地域の市の行だけ）。地域を変えたあとの新しい電文の代わりに、写しを空にして取り直す
  const fetchNow = async () => {
    sqlite.exec("DELETE FROM jma_quake_points; DELETE FROM jma_quakes; DELETE FROM jma_warnings; DELETE FROM jma_entries; DELETE FROM jma_fetch_state;");
    return fetchJma(db, fixtureFetcher(SAMPLE_DIR), JMA_NOW);
  };

  it("松山市 → 広島市: 大雨の発表の地域、地図の中心、様式の初めの市", async () => {
    const s = await sandbox();
    const id = s.office!.id;
    expect(await placePost(db, s, form({ city_code: C.matsuyama, region: "1" }))).toMatchObject({ status: 303, location: "/office#office-place" });
    await fetchNow();
    const a1 = await loadJmaAlerts(db, id, JMA_NOW);
    expect([...new Set(a1.rows.map((r) => r.areaName))]).toEqual(["松山市"]);
    expect(a1.rows.map((r) => r.kind)).toContain("レベル3大雨警報");
    expect(await loadRegionWarnings(db, id)).toEqual({ count: 1, kinds: ["レベル3大雨警報"] });
    const p1 = await loadOfficePlace(db, id);
    expect(p1?.map?.center).toEqual(p1?.center);
    const r1 = officeAreaOf(office(id) as unknown as OfficeAreaRow);
    expect(r1.formsCityId).toBe("matsuyama");

    expect(await placePost(db, s, form({ city_code: C.hiroshima, region: "1" }))).toMatchObject({ status: 303, location: "/office#office-place" });
    await fetchNow();
    const a2 = await loadJmaAlerts(db, id, JMA_NOW);
    expect([...new Set(a2.rows.map((r) => r.areaName))]).toEqual(["広島市中区", "広島市南区"]);
    expect(a2.rows.every((r) => r.kind === "強風注意報")).toBe(true);
    // 注意報だけなので上の帯の警報は 0
    expect(await loadRegionWarnings(db, id)).toEqual({ count: 0, kinds: [] });
    const p2 = await loadOfficePlace(db, id);
    const hiroshima = municipalityGeo(C.hiroshima)!;
    expect(p2?.city).toBe("広島市");
    expect(p2?.map?.center).toEqual(p2?.center);
    expect(p2?.center).not.toEqual(p1?.center);
    // 中心は広島市の範囲の中（前の松山市に残らない）
    expect(p2!.center!.lat).toBeGreaterThanOrEqual(hiroshima.box.s);
    expect(p2!.center!.lat).toBeLessThanOrEqual(hiroshima.box.n);
    expect(officeAreaOf(office(id) as unknown as OfficeAreaRow).formsCityId).toBe("hiroshima");
    expect(municipalEntry(MUNICIPAL_CITIES.find((c) => c.id === "hiroshima")!.forms[0].id)?.city.pref).toBe("広島県");
    expect(office(id)).toMatchObject({ city: "広島市", city_code: C.hiroshima, region_cities: null, region_city_codes: null });
  });

  it("同じ名前の市を取り違えない: 東京都府中市には広島県府中市の発表を出さない", async () => {
    const s = await sandbox();
    const id = s.office!.id;
    await placePost(db, s, form({ city_code: C.fuchuHiroshima, region: "1" }));
    await fetchNow();
    expect((await loadJmaAlerts(db, id, JMA_NOW)).rows.map((r) => `${r.kind} ${r.areaName} ${r.areaCode}`)).toEqual(["強風注意報 府中市 3420800"]);
    await placePost(db, s, form({ city_code: C.fuchuTokyo, region: "1" }));
    expect((await loadJmaAlerts(db, id, JMA_NOW)).rows).toEqual([]);
    expect(await loadRegionWarnings(db, id)).toEqual({ count: 0, kinds: [] });
  });

  it("周りの市を足すと、その市の発表も（主な市 → 周りの市の順）。地図の広さは範囲が入るように広がる", async () => {
    const s = await sandbox();
    const id = s.office!.id;
    await placePost(db, s, form({ city_code: C.matsuyama, region: "1" }));
    const km1 = (await loadOfficePlace(db, id))!.map!.km;
    await placePost(db, s, form({ city_code: C.matsuyama, region: "1", region_code: [C.toon, C.iyo] }));
    expect(office(id)).toMatchObject({ region_cities: '["東温市","伊予市"]', region_city_codes: `["${C.toon}","${C.iyo}"]` });
    await fetchNow();
    expect((await loadJmaAlerts(db, id, JMA_NOW)).rows.map((r) => `${r.kind} ${r.areaName}`)).toEqual(["レベル3大雨警報 松山市", "雷注意報 松山市", "大雨注意報 東温市"]);
    expect((await loadOfficePlace(db, id))!.map!.km).toBeGreaterThanOrEqual(km1);
  });

  it("中心を動かしていなければ市を変えると中心は新しい市の点、動かしていれば置いた中心のまま", async () => {
    const y = await yamamoto();
    const before = office(CHECK_OFFICE_ID);
    // 種の中心のまま（フォームは今の中心を送る）で今治市へ
    await placePost(db, y, form({ city_code: C.imabari, center_lat: String(before.center_lat), center_lng: String(before.center_lng), region: "1" }));
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ city: "今治市", city_code: C.imabari, ...pointCols(municipalityGeo(C.imabari)!.point) });
    // 中心を動かして松山市へ戻すと、置いた中心のまま
    await placePost(db, y, form({ city_code: C.matsuyama, center_lat: "33.85", center_lng: "132.75", region: "1" }));
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ city: "松山市", center_lat: 33.85, center_lng: 132.75 });
    // 審査員のデモ事業所は変わらない
    expect(office(DEMO_OFFICE_ID)).toMatchObject({ city: "松山市", city_code: C.matsuyama, center_lat: 33.84 });
  });

  it("保存は表に無い団体コードを断る。前の形の文字の保存も団体コードを書く（文字と団体コードが食い違わない）", async () => {
    const y = await yamamoto();
    expect(await placePost(db, y, form({ city_code: "999999", region: "1" }))).toMatchObject({ location: "/office?form_error=place#office-place" });
    expect(await placePost(db, y, form({ city_code: C.matsuyama, region: "1", region_code: "000000" }))).toMatchObject({ location: "/office?form_error=place#office-place" });
    expect(await savePlace(db, y, { city: "今治市", center: null })).toEqual({ ok: true });
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ city: "今治市", city_code: C.imabari });
    expect(await savePlace(db, y, { city: "架空市", center: null })).toEqual({ ok: true });
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ city: "架空市", city_code: null });
    expect((await loadOfficeRegion(db, CHECK_OFFICE_ID))?.cityCode).toBeNull();
    // 未選択のまま（選ぶ部品は前の文字を city で送る）周りの市・区域だけ直しても保存できる。団体コードは NULL のまま
    expect(await placePost(db, y, form({ city: "府中市", region: "1", region_code: C.toon, zone: "flood" }))).toMatchObject({ location: "/office#office-place" });
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ city: "府中市", city_code: null, region_city_codes: `["${C.toon}"]` });
  });
});

// ---------- 写しと地域に追加 ----------

describe("T148 の文字の値と地域に追加", () => {
  it("文字の値だけの事業所は表で当てて開き、保存で団体コードが入る。当たらない周りの市は未照合で残る", async () => {
    sqlite.exec(`UPDATE offices SET city_code = NULL, region_city_codes = NULL, region_cities = '["東温市","架空市"]' WHERE id = '${CHECK_OFFICE_ID}'`);
    const r = await loadOfficeRegion(db, CHECK_OFFICE_ID);
    expect(r).toMatchObject({ city: "松山市", cityCode: C.matsuyama, citySaved: false, otherCodes: [C.toon], unmatched: ["架空市"], others: ["東温市", "架空市"] });
    const y = await yamamoto();
    await placePost(db, y, form({ city_code: C.matsuyama, region: "1", region_code: C.toon, region_city: "架空市" }));
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ city_code: C.matsuyama, region_cities: '["東温市","架空市"]', region_city_codes: `["${C.toon}"]` });
    expect((await loadOfficeRegion(db, CHECK_OFFICE_ID))?.unmatched).toEqual(["架空市"]);
    // 未照合を外して保存すると消える
    await placePost(db, y, form({ city_code: C.matsuyama, region: "1", region_code: C.toon }));
    expect((await loadOfficeRegion(db, CHECK_OFFICE_ID))?.unmatched).toEqual([]);
  });

  it("地域に追加は団体コードで（前の形の名前も表で当てる）。表に当たらなければ断る", async () => {
    const y = await yamamoto();
    expect(await placePost(db, y, form({ add_code: C.iyo }))).toEqual({ status: 303, location: "/office#office-place" });
    expect(office(CHECK_OFFICE_ID)).toMatchObject({ region_cities: '["東温市","伊予市"]', region_city_codes: `["${C.toon}","${C.iyo}"]` });
    expect(await addRegionCity(db, y, "伊予市")).toEqual({ ok: true });
    expect(await addRegionCity(db, y, C.matsuyama)).toEqual({ ok: true });
    expect(await addRegionCity(db, y, "架空市")).toEqual({ ok: false, error: "bad" });
    expect(JSON.parse(String(office(CHECK_OFFICE_ID).region_city_codes))).toEqual([C.toon, C.iyo]);
  });
});

// ---------- cron の写す所 ----------

describe("気象庁の写し（cron）は市町村等のコードでも写す", () => {
  it("写すコードに事業所の地域と利用者の住所の市の市町村等が入る", async () => {
    const codes = await relevantAreaCodes(db);
    expect(codes).toEqual(expect.arrayContaining(["3820100", "3821500"]));
  });

  it("名前が市と違う市町村（浜松市南部）もコードで写す", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report><Control><Title>気象警報・注意報（Ｈ２７）</Title><Status>通常</Status><PublishingOffice>静岡地方気象台</PublishingOffice></Control>
<Head><ReportDateTime>2026-11-03T22:00:00+09:00</ReportDateTime><InfoType>発表</InfoType></Head>
<Body><Warning type="気象警報・注意報（市町村等）"><Item><Kind><Name>大雨注意報</Name><Status>発表</Status></Kind>
<Area><Name>浜松市南部</Name><Code>2213001</Code></Area></Item></Warning></Body></Report>`;
    const entry = { id: "t154-hamamatsu", title: "気象警報・注意報", updated: "2026-11-03T13:00:00Z", typeCode: "VPWW54", url: "x" };
    const names = toStored("extra", entry as Parameters<typeof toStored>[1], xml, JMA_NOW, ["浜松市"]);
    expect(names.warnings).toEqual([]);
    const codes = toStored("extra", entry as Parameters<typeof toStored>[1], xml, JMA_NOW, ["浜松市"], new Set(municipalityGeo(C.hamamatsu)!.jmaCodes));
    expect(codes.warnings.map((w) => w.area_name)).toEqual(["浜松市南部"]);
  });
});

// ---------- 選ぶ部品 ----------

describe("選ぶ部品（都道府県 → 市区町村）", () => {
  it("主な市は団体コードの隠しの欄。表に当たらなければ未選択と前の文字", () => {
    const html = renderToStaticMarkup(createElement(MainCityPicker, { defaultCode: C.matsuyama, defaultPref: "愛媛県", legacyText: "" }));
    expect(html).toContain('name="city_code"');
    expect(html).toContain(`value="${C.matsuyama}"`);
    expect(html).toContain("愛媛県");
    expect(html).not.toContain("未選択</span>");
    const none = renderToStaticMarkup(createElement(MainCityPicker, { defaultCode: null, defaultPref: null, legacyText: "府中市" }));
    expect(none).toContain("data-main-city-unselected");
    expect(none).toContain("府中市");
  });

  it("周りの市は選んだ物ごとに団体コード、未照合の文字は文字のまま送る", () => {
    const html = renderToStaticMarkup(
      createElement(OtherCitiesPicker, { defaultCodes: [C.toon], defaultPref: "愛媛県", unmatched: ["架空市"], mainCode: C.matsuyama, max: 8 }),
    );
    expect(html).toContain(`name="region_code" value="${C.toon}"`);
    expect(html).toContain('name="region_city" value="架空市"');
    expect(html).toContain("未照合");
    expect(html).toContain("東温市");
  });
});

const pointCols = (p: { lat: number; lng: number }) => ({ center_lat: p.lat, center_lng: p.lng });
