// T134 の 1・2・6: 自治体の様式の一覧の形（全部の行に公式の URL と版）、地域で選ぶ・検索、取り込めない物、
// 政令指定都市と都道府県庁所在地がどれも一覧か「未収録の理由」にあること、役所のファイル本体をリポジトリに入れていないこと。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORIGINALS } from "./originals.ts";
import {
  allMunicipalEntries,
  availability,
  cityForOffice,
  FORMAT_MIME,
  isOfficialHost,
  isOfficialUrl,
  MUNICIPAL_CITIES,
  MUNICIPAL_FORMATS,
  MUNICIPAL_SKIPPED,
  municipalEntry,
  municipalFileName,
  normalizeQuery,
  PREFECTURES,
  REF_ROLES,
  regionTree,
  searchMunicipal,
  TERMS_FLAGS,
} from "./municipal-forms.ts";

const DESIGNATED = [
  "札幌市", "仙台市", "さいたま市", "千葉市", "横浜市", "川崎市", "相模原市", "新潟市", "静岡市", "浜松市",
  "名古屋市", "京都市", "大阪市", "堺市", "神戸市", "岡山市", "広島市", "北九州市", "福岡市", "熊本市",
];
/** 都道府県庁所在地（東京都は新宿区） */
const CAPITALS = [
  "札幌市", "青森市", "盛岡市", "仙台市", "秋田市", "山形市", "福島市", "水戸市", "宇都宮市", "前橋市", "さいたま市", "千葉市", "新宿区", "横浜市",
  "新潟市", "富山市", "金沢市", "福井市", "甲府市", "長野市", "岐阜市", "静岡市", "名古屋市", "津市", "大津市", "京都市", "大阪市", "神戸市",
  "奈良市", "和歌山市", "鳥取市", "松江市", "岡山市", "広島市", "山口市", "徳島市", "高松市", "松山市", "高知市", "福岡市", "佐賀市", "長崎市",
  "熊本市", "大分市", "宮崎市", "鹿児島市", "那覇市",
];

describe("一覧の形", () => {
  it("市: id は英数字で重ならない・都道府県は 47 のどれか・公式の頁は公式のドメインの https・条件の印と要約・確かめた日", () => {
    const ids = new Set<string>();
    for (const c of MUNICIPAL_CITIES) {
      expect(c.id, c.name).toMatch(/^[a-z0-9-]{2,30}$/);
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(PREFECTURES as readonly string[], c.name).toContain(c.pref);
      expect(c.name, c.id).toMatch(/[市町村区]$/);
      expect(isOfficialUrl(c.pageUrl), `${c.name} ${c.pageUrl}`).toBe(true);
      expect(TERMS_FLAGS as readonly string[], c.name).toContain(c.terms.flag);
      expect(c.terms.summary.length, c.name).toBeGreaterThan(5);
      expect(c.terms.summary.length, c.name).toBeLessThanOrEqual(100);
      if (c.terms.url !== null) expect(isOfficialHost(new URL(c.terms.url).hostname), `${c.name} ${c.terms.url}`).toBe(true);
      expect(c.checkedAt, c.name).toMatch(/^2026-1[01]-\d{2}$/);
      expect(c.forms.length, c.name).toBeGreaterThan(0);
    }
  });

  it("様式: 全部の行に公式の URL（公式のドメインの https）と版（SHA-256）・バイト数・形式・頁数（旧形式は無し）・様式名", () => {
    const ids = new Set<string>();
    const urls = new Set<string>();
    for (const { city, form: f } of allMunicipalEntries()) {
      expect(f.id, f.name).toMatch(new RegExp(`^${city.id}-\\d{1,2}$`));
      expect(ids.has(f.id), f.id).toBe(false);
      ids.add(f.id);
      expect(urls.has(f.url), f.url).toBe(false);
      urls.add(f.url);
      expect(isOfficialUrl(f.url), `${city.name} ${f.url}`).toBe(true);
      expect(MUNICIPAL_FORMATS, f.id).toContain(f.format);
      expect(f.sha256, f.id).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes, f.id).toBeGreaterThan(1000);
      expect(f.name.length, f.id).toBeGreaterThan(2);
      if (f.format === "doc" || f.format === "xls") expect(f.pages, f.id).toBeNull();
      else expect(f.pages, f.id).toBeGreaterThanOrEqual(1);
    }
    // 同じ版のファイルを 2 行にしない
    const shas = allMunicipalEntries().map((e) => e.form.sha256);
    expect(new Set(shas).size).toBe(shas.length);
  });

  it("記載例・手引き・同意書・関連の様式は様式本体と分け、リンクだけ（公式のドメイン）", () => {
    let n = 0;
    for (const c of MUNICIPAL_CITIES) {
      for (const r of c.refs) {
        n++;
        expect(REF_ROLES as readonly string[], r.name).toContain(r.role);
        expect(isOfficialHost(new URL(r.url).hostname), r.url).toBe(true);
        // 様式本体の行と同じファイルを指さない
        expect(c.forms.some((f) => f.url === r.url), r.url).toBe(false);
      }
      // 様式本体の名前に記載例・記入例だけの物を入れない（「記入例つき」のブックは本体）
      for (const f of c.forms) expect(f.name, f.id).not.toMatch(/^[（(【]?記[載入]例[）)】]?$/);
    }
    expect(n).toBeGreaterThan(50);
  });

  it("松山市は T101 の原本と同じ版（アプリに専用の紙がある＝内蔵）", () => {
    const m = municipalEntry("matsuyama-1")!;
    expect(m.form.builtin).toBe("matsuyama");
    expect(m.form.url).toBe(ORIGINALS.matsuyama.url);
    expect(m.form.sha256).toBe(ORIGINALS.matsuyama.sha256);
    expect(availability(m)).toEqual({ ok: false, reason: "builtin" });
  });

  it("政令指定都市（20）と都道府県庁所在地（47）は、どれも一覧に様式があるか、未収録の理由がある", () => {
    const listed = new Set(MUNICIPAL_CITIES.map((c) => c.name));
    const skipped = new Map(MUNICIPAL_SKIPPED.map((s) => [s.city, s]));
    const targets = [...new Set([...DESIGNATED, ...CAPITALS])];
    expect(targets).toHaveLength(52);
    for (const t of targets) expect(listed.has(t) || skipped.has(t), t).toBe(true);
    for (const t of targets) expect(listed.has(t) && skipped.has(t), t).toBe(false);
    // 未収録の理由
    for (const s of MUNICIPAL_SKIPPED) {
      expect(PREFECTURES as readonly string[], s.city).toContain(s.pref);
      expect(s.reason.length, s.city).toBeGreaterThan(5);
      if (s.pageUrl && !isOfficialHost(new URL(s.pageUrl).hostname)) expect(s.reason, s.city).toContain("ドメイン");
    }
    // 進みの数（docs/progress/t134.md）と合う: 一覧の市区 46・様式 72、優先の 52 のうち一覧 38・未収録 14
    expect(MUNICIPAL_CITIES).toHaveLength(46);
    expect(allMunicipalEntries()).toHaveLength(72);
    expect(targets.filter((t) => listed.has(t))).toHaveLength(38);
  });
});

describe("公式のドメイン", () => {
  it("lg.jp と、.jp で自治体の型の名前（city・town・village・vill・pref）を持つホストだけ", () => {
    for (const h of ["www.city.sapporo.jp", "www4.city.kanazawa.lg.jp", "info.city.tsu.mie.jp", "www.pref.osaka.lg.jp", "www.town.ando.nara.jp", "www.vill.example.nagano.jp", "www.city.kofu.lg.jp"])
      expect(isOfficialHost(h), h).toBe(true);
    for (const h of ["www.nishi.or.jp", "example.com", "city.example.com", "www.kanafuku.jp", "cityhall.jp", "www.city.sapporo.jp.evil.com", "WWW.CITY.SAPPORO.JP/"])
      expect(isOfficialHost(h), h).toBe(false);
  });
  it("URL は https・ポートなし・利用者名なし", () => {
    expect(isOfficialUrl("https://www.city.sapporo.jp/a.pdf")).toBe(true);
    expect(isOfficialUrl("http://www.city.sapporo.jp/a.pdf")).toBe(false);
    expect(isOfficialUrl("https://www.city.sapporo.jp:8443/a.pdf")).toBe(false);
    expect(isOfficialUrl("https://u:p@www.city.sapporo.jp/a.pdf")).toBe(false);
    expect(isOfficialUrl("not a url")).toBe(false);
  });
});

describe("取り込めるか", () => {
  it("旧形式（.doc・.xls）と条件の印が許諾要の市は取り込まない。ほかは取り込める", () => {
    for (const e of allMunicipalEntries()) {
      const a = availability(e);
      if (e.form.builtin) expect(a).toEqual({ ok: false, reason: "builtin" });
      else if (e.form.format === "doc" || e.form.format === "xls") expect(a, e.form.id).toEqual({ ok: false, reason: "legacy" });
      else if (e.city.terms.flag === "許諾要") expect(a, e.form.id).toEqual({ ok: false, reason: "permission" });
      else expect(a, e.form.id).toEqual({ ok: true });
    }
    const usable = allMunicipalEntries().filter((e) => availability(e).ok);
    expect(usable.length).toBeGreaterThanOrEqual(50);
    // 旧形式だけの市（PDF に保存してから事業所が自分で入れる）
    expect(MUNICIPAL_CITIES.filter((c) => c.forms.every((f) => f.format === "doc" || f.format === "xls")).map((c) => c.name).sort()).toEqual(
      ["堺市", "山形市", "福井市", "高知市"].sort(),
    );
  });
  it("取り込みの File の名前と形", () => {
    const e = municipalEntry("kumamoto-1")!;
    expect(municipalFileName(e)).toMatch(/\.(pdf|xlsx)$/);
    expect(FORMAT_MIME[e.form.format]).toMatch(/^application\//);
  });
});

describe("地域で選ぶ・検索", () => {
  it("都道府県はコードの順、市町村は様式のある所だけ", () => {
    const tree = regionTree();
    const order = tree.map((p) => PREFECTURES.indexOf(p.pref as (typeof PREFECTURES)[number]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(tree[0].pref).toBe("北海道");
    expect(tree.at(-1)!.pref).toBe("沖縄県");
    const ehime = tree.find((p) => p.pref === "愛媛県")!;
    expect(ehime.cities.map((c) => c.name).sort()).toEqual(["今治市", "松山市"].sort());
    expect(tree.flatMap((p) => p.cities).every((c) => c.forms > 0)).toBe(true);
  });
  it("検索は都道府県・市町村・様式名・形式で、空白で区切った語を全部含む物。全角半角・カタカナを寄せる", () => {
    expect(searchMunicipal("")).toEqual([]);
    expect(searchMunicipal("   ")).toEqual([]);
    expect(searchMunicipal("熊本").map((e) => e.form.id).every((id) => id.startsWith("kumamoto-"))).toBe(true);
    expect(searchMunicipal("熊本").length).toBeGreaterThan(0);
    const xl = searchMunicipal("熊本 excel");
    expect(xl.length).toBe(1);
    expect(xl[0].form.format).toBe("xlsx");
    expect(searchMunicipal("ＥＸＣＥＬ 熊本").map((e) => e.form.id)).toEqual(xl.map((e) => e.form.id));
    expect(searchMunicipal("医療的ケア").every((e) => e.city.name === "松本市")).toBe(true);
    expect(searchMunicipal("愛媛県").map((e) => e.city.name).sort()).toEqual(["今治市", "松山市"].sort());
    expect(searchMunicipal("存在しない市")).toEqual([]);
    expect(normalizeQuery("カタカナ ＡＢＣ")).toBe("かたかなabc");
  });
  it("事業所の市から一覧の市（同じ名前が 2 つあれば選ばない）", () => {
    expect(cityForOffice("松山市")?.id).toBe("matsuyama");
    expect(cityForOffice("愛媛県松山市")?.id).toBe("matsuyama");
    expect(cityForOffice("高知市")?.id).toBe("kochi");
    expect(cityForOffice("")).toBeNull();
    expect(cityForOffice("府中市")).toBeNull();
  });
});

describe("役所のファイル本体をリポジトリに入れていない", () => {
  it("リポジトリの中の PDF・Excel・Word のどれも一覧の版のハッシュと同じでない", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const skip = new Set(["node_modules", ".git", ".next", ".open-next", ".wrangler", "dist", "out"]);
    const want = new Set(allMunicipalEntries().map((e) => e.form.sha256));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if ([".pdf", ".xlsx", ".docx", ".xls", ".doc", ".xlsm", ".docm"].includes(extname(name).toLowerCase())) {
          if (want.has(createHash("sha256").update(readFileSync(p)).digest("hex"))) found.push(p);
        }
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });
});
