// 書類の一覧（T47 の 3）: 形、元の様式の版・題との一致、README の「書類」の節が同じ一覧を載せていること。
import { describe, expect, it } from "vitest";
import { DOCUMENT_LABELS } from "../labels.ts";
import { aboutLine, aboutParts, CAO_ENTRY, DOCUMENT_CATALOG, MATSUYAMA_ENTRY, mappingEntry, type CatalogEntry } from "./catalog.ts";
import { FORM9_TITLE } from "./form9.ts";
import { MATSUYAMA_FORM_URL, MATSUYAMA_FORM_VERSION, MATSUYAMA_TEXTS } from "./matsuyama.ts";
import { readRepoFile } from "./print-harness.ts";

const ALL: CatalogEntry[] = [...Object.values(DOCUMENT_CATALOG), CAO_ENTRY];
const ASSERTING_WORDS = ["診断", "判定", "重症", "病気がわかる"];

describe("書類の一覧", () => {
  it("全部の欄が埋まり、断定の言葉が無い", () => {
    for (const e of ALL) {
      for (const k of ["id", "official", "short", "what", "who", "route", "when", "source", "version"] as const) expect(e[k], `${e.id} ${k}`).toBeTruthy();
      for (const w of ASSERTING_WORDS) expect(aboutLine(e), `${e.id} ${w}`).not.toContain(w);
    }
  });

  it("本人のページの書類（DOCUMENT_LABELS）は全部、一覧にある", () => {
    for (const k of Object.keys(DOCUMENT_LABELS)) expect(DOCUMENT_CATALOG, k).toHaveProperty(k);
  });

  it("松山市の版・題・リンク、様式9 の題は様式の部品と同じ字", () => {
    expect(MATSUYAMA_ENTRY.official).toBe(MATSUYAMA_TEXTS.title);
    expect(MATSUYAMA_ENTRY.source).toContain(MATSUYAMA_FORM_VERSION);
    expect(MATSUYAMA_ENTRY.url).toBe(MATSUYAMA_FORM_URL);
    expect(DOCUMENT_CATALOG.form9.official).toBe(FORM9_TITLE);
  });

  it("1 行の小さな注は 正式な名前 ／ 誰が誰に ／ 版 だけ（説明の文は出さない。T79）", () => {
    expect(aboutLine(MATSUYAMA_ENTRY)).toBe("松山市避難行動要支援者名簿登録申込書 兼 個別避難計画 ／ 本人・家族 → 市 ／ 松山市 様式【2026.9.10】");
    expect(aboutParts(DOCUMENT_CATALOG.form9, { official: false })).toEqual(["事業所 → 市町村", "厚労省 BCP ひな形 様式9"]);
    for (const e of ALL) {
      // 文にしない（句点なし）。説明の文（what・when）を含めない
      expect(aboutLine(e), e.id).not.toContain("。");
      expect(aboutLine(e), e.id).not.toContain(e.what);
      expect(e.route, e.id).toContain(" → ");
    }
    const m = mappingEntry({ id: "m-1", title: "個別避難計画", issuer: "架空市", checkedAt: "2026-11-03T01:00:00.000Z" });
    expect(m.id).toBe("mapping:m-1");
    expect(m.source).toBe("架空市の様式（対応表 確認済 2026-11-03）");
    expect(aboutLine(m)).toBe("個別避難計画 ／ 本人・家族 → 市町村 ／ 架空市 対応表 確認済 2026-11-03");
  });

  it("README の「書類」の節に、一覧の書類の正式な名前と版が全部ある", () => {
    const readme = readRepoFile("README.md");
    const start = readme.indexOf("## 書類");
    expect(start).toBeGreaterThanOrEqual(0);
    const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
    for (const e of ALL) expect(section, e.id).toContain(e.official);
    expect(section).toContain(`様式【${MATSUYAMA_FORM_VERSION}】`);
    expect(section).toContain("災害診療記録2018");
  });
});
