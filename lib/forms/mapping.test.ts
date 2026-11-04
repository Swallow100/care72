// 様式の対応表（T08）: 台帳の項目の一覧、AI の返事の検査（台帳に無い項目名を弾く）、保存の検査、差し込みの並びと値、同意の範囲。
// Opus の返事は固定の JSON（lib/forms/cao-form.fixture.ts、内閣府の様式例から手で起こした物）で差し替える。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MappedSheet as MappedPaper } from "../../components/forms/MappedSheet.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { PersonPageRows } from "../person.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { buildMappedSheet, ITEM_VALUES, matchOption, type MappedSheet } from "./mapped-sheet.ts";
import {
  blankField,
  checkReadResult,
  itemCatalog,
  LEDGER_ITEM_KEYS,
  LEDGER_ITEMS,
  mappingStats,
  parseMappingInput,
  type FormMapping,
  type ReadResult,
} from "./mapping.ts";
import { cellText } from "./matsuyama.ts";

const TODAY = "2026-11-02";

/** 種の 1 人を、D1 から読んだのと同じ形にする（lib/forms/matsuyama.test.ts と同じ） */
function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const OPTS = { today: TODAY, officeName: "デモ事業所" };

const cao = () => checkReadResult(CAO_FORM_READ).mapping;
/** 紙面の欄の値（段と名前で引く） */
function cellOf(sheet: MappedSheet, label: string, section = ""): string {
  for (const p of sheet.pages) {
    for (const s of p.sections) {
      if (s.section !== section) continue;
      const r = s.rows.find((x) => x.field.label === label);
      if (r) return cellText(r.cell);
    }
  }
  throw new Error(`欄が無い: ${section} ${label}`);
}

describe("台帳の項目の一覧", () => {
  it("key は重ならず、差し込みは全部の key の出し方を持つ", () => {
    expect(new Set(LEDGER_ITEM_KEYS).size).toBe(LEDGER_ITEM_KEYS.length);
    expect(Object.keys(ITEM_VALUES).sort()).toEqual([...LEDGER_ITEM_KEYS].sort());
    expect(LEDGER_ITEMS.length).toBeGreaterThanOrEqual(60);
  });

  it("Claude に渡す項目表は key・名前・区分・説明だけで、種の人の値が入らない", () => {
    const json = JSON.stringify(itemCatalog());
    for (const p of SEED_PEOPLE) {
      expect(json).not.toContain(p.person.name);
      expect(json).not.toContain(p.ledger.basic.address?.town ?? "＿");
      for (const c of p.contacts) {
        if (c.name) expect(json).not.toContain(c.name);
        if (c.phone) expect(json).not.toContain(c.phone);
      }
    }
    expect(itemCatalog()[0]).toEqual({ key: "person.name", group: "本人", label: "氏名" });
  });
});

describe("AI の返事の検査", () => {
  const one = (over: Partial<ReadResult["fields"][number]>): ReadResult => ({
    title: "様式",
    issuer: "",
    pages: 1,
    fields: [{ page: 1, section: "", label: "氏名", position: "上", shape: "text", options: [], item: "person.name", confidence: "high", reason: "合う", ...over }],
  });

  it("台帳に無い項目名は弾く（対応なし・自信は低・返った名前を残す）", () => {
    const r = checkReadResult(one({ label: "保険証番号", item: "insurance.number", confidence: "high" }));
    expect(r.rejected).toEqual([{ id: "f1", label: "保険証番号", item: "insurance.number" }]);
    expect(r.mapping.fields[0]).toMatchObject({ item: null, ai: { item: null, confidence: "low", rejected: "insurance.number" } });
  });

  it("手で書く欄は対応させない。名前の無い欄は落とす。電話番号らしい並びは消す", () => {
    const r = checkReadResult({
      title: "見本 089-000-0000",
      issuer: "",
      pages: 1,
      fields: [
        { page: 1, section: "", label: "本人署名", position: "", shape: "handwrite", options: [], item: "person.name", confidence: "medium", reason: "" },
        { page: 1, section: "", label: "  ", position: "", shape: "text", options: [], item: null, confidence: "low", reason: "" },
        { page: 3, section: "", label: "電話（例 090-1234-5678）", position: "", shape: "phone", options: [], item: "self.phone", confidence: "high", reason: "" },
      ],
    });
    expect(r.mapping.fields.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(r.mapping.fields[0]).toMatchObject({ shape: "handwrite", item: null, ai: { item: "person.name" } });
    expect(r.mapping.fields[1].label).toBe("電話（例 （番号））");
    expect(r.mapping.fields[1].page).toBe(1);
    expect(r.mapping.title).not.toMatch(/[0-9]{3}-/);
  });

  it("内閣府の様式例（固定の返事）: 41 欄のうち 34 が自動で対応、弾いた名前なし", () => {
    const r = checkReadResult(CAO_FORM_READ);
    expect(r.rejected).toEqual([]);
    expect(r.mapping).toMatchObject({ title: "個別避難計画", issuer: "内閣府（様式例）", pages: 2 });
    expect(mappingStats(r.mapping)).toEqual({ fields: 41, read: 41, autoMapped: 34, kept: 34, changed: 0, added: 0, mapped: 34, placed: 0, boxMoved: 0 });
  });
});

describe("保存の検査", () => {
  it("確かめた対応表は通り、人が直した数を数える", () => {
    const m = cao();
    const mail = m.fields.find((f) => f.label === "メールアドレス")!;
    mail.item = null;
    const other = m.fields.find((f) => f.label === "その他")!;
    other.removed = true;
    const added = { ...blankField(m.fields, 2), label: "ペット", item: "evacuation.pets" as const };
    m.fields.push(added);
    const parsed = parseMappingInput(JSON.parse(JSON.stringify(m)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(added.id).toBe("f42");
    expect(mappingStats(parsed.mapping)).toMatchObject({ fields: 41, read: 41, autoMapped: 34, kept: 33, changed: 2, added: 1, mapped: 34 });
  });

  it("台帳に無い項目名を弾く（欄の項目・AI の読んだ物のどちらでも）", () => {
    const m = cao();
    const bad = JSON.parse(JSON.stringify(m));
    bad.fields[0].item = "person.secret";
    expect(parseMappingInput(bad)).toEqual({ ok: false, error: "unknown_item", at: "f1" });
    const bad2 = JSON.parse(JSON.stringify(m));
    bad2.fields[1].ai.item = "nope";
    expect(parseMappingInput(bad2)).toEqual({ ok: false, error: "unknown_item", at: "f2" });
  });

  it("形が違う・id が重なる物は断る", () => {
    const m = cao();
    expect(parseMappingInput(null)).toMatchObject({ ok: false, error: "invalid" });
    expect(parseMappingInput({ ...m, fields: "x" })).toMatchObject({ ok: false, error: "invalid" });
    const dup = JSON.parse(JSON.stringify(m));
    dup.fields[1].id = "f1";
    expect(parseMappingInput(dup)).toEqual({ ok: false, error: "duplicate_id", at: "f1" });
    const shape = JSON.parse(JSON.stringify(m));
    shape.fields[0].shape = "signature";
    expect(parseMappingInput(shape)).toMatchObject({ ok: false, error: "invalid" });
  });
});

describe("差し込み", () => {
  it("欄の順（頁 → 段 → 欄）に、山田 ハナの台帳の値が並ぶ", () => {
    const s = buildMappedSheet(seedRows(seed("p-01")), cao(), OPTS);
    expect(s.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(s.pages[0].sections.map((x) => x.section)).toEqual([
      "",
      "避難場所",
      "緊急時の連絡先①",
      "緊急時の連絡先②",
      "避難支援等実施者情報①",
      "避難支援等実施者情報②",
    ]);
    const order = s.pages.flatMap((p) => p.sections.flatMap((x) => x.rows.map((r) => r.field.id)));
    expect(order).toEqual(cao().fields.map((f) => f.id));
    expect(s.fields).toBe(41);

    expect(cellOf(s, "氏名")).toBe("山田 ハナ");
    expect(cellOf(s, "生年月日")).toBe("昭和 17 年 4 月 18 日");
    expect(cellOf(s, "性別")).toBe("□男 ■女");
    expect(cellOf(s, "年齢")).toBe("84 歳");
    expect(cellOf(s, "住所又は居所")).toBe("松山市 かわなぎ町");
    expect(cellOf(s, "電話番号")).toBe("090-0000-0001");
    expect(cellOf(s, "ＦＡＸ番号")).toBe("未確認");
    expect(cellOf(s, "同居家族等")).toBe("なし 独居");
    expect(cellOf(s, "名称", "避難場所")).toBe("かわなぎ小学校");
    expect(cellOf(s, "氏名（団体名）", "緊急時の連絡先①")).toBe("森 恵子");
    expect(cellOf(s, "連絡先（電話番号１・電話番号２・メールアドレス・その他）", "緊急時の連絡先①")).toBe("090-0000-0011 電話");
    expect(cellOf(s, "住所", "緊急時の連絡先①")).toBe("未確認 市内");
    expect(cellOf(s, "氏名（団体名）", "緊急時の連絡先②")).toBe("木村 ヨシ");
    expect(cellOf(s, "氏名（団体名及び代表者）", "避難支援等実施者情報①")).toBe("森 恵子");
    expect(cellOf(s, "氏名（団体名及び代表者）", "避難支援等実施者情報②")).toBe("木村 ヨシ");

    const care = "避難時に配慮しなくてはならない事項";
    // □ 1 つの欄は ■・□ と値だけ（欄の名前は左の列）
    expect(cellOf(s, "介護保険の認定を受けている【要介護状態区分】", care)).toBe("■ 要介護3");
    expect(cellOf(s, "手帳所持【障害名・等級】", care)).toBe("□");
    expect(cellOf(s, "医療機器の装着等をしている", care)).toMatch(/^■ 在宅酸素 酸素濃縮器 1 L\/分 .*酸素 内蔵電池 2 時間/);
    expect(cellOf(s, "立つことや歩行ができない", care)).toBe("■ 一部");
    expect(cellOf(s, "音が聞こえない（聞き取りにくい）", care)).toBe("□");
    expect(cellOf(s, "その他", care)).toBe("□ 未確認");
    expect(cellOf(s, "特記事項")).toBe("薬は 2 階の箪笥");
    expect(cellOf(s, "避難支援時の留意事項")).toContain("歩行 一部");

    // 未確認と対応なし（FAX・避難場所の住所・カナ 4 つ・その他の □）
    expect(s.unmapped).toEqual([
      "ＦＡＸ番号",
      "避難場所 住所",
      "緊急時の連絡先① フリガナ",
      "緊急時の連絡先② フリガナ",
      "避難支援等実施者情報① フリガナ",
      "避難支援等実施者情報② フリガナ",
      "避難時に配慮しなくてはならない事項 その他",
    ]);
    expect(s.unconfirmed).toEqual(expect.arrayContaining(["ＦＡＸ番号", "緊急時の連絡先① 住所"]));
    expect(s.withheld).toEqual([]);
  });

  it("紙面: 頁ごとの A4、欄の順に名前と値、段の見出し", () => {
    const s = buildMappedSheet(seedRows(seed("p-01")), cao(), OPTS);
    const html = renderToStaticMarkup(createElement(MappedPaper, { sheet: s, meta: { date: "令和 8 年 11 月 2 日", checked: "2026-11-02 山本" } }));
    expect(html.match(/class="paper form mapped"/g)).toHaveLength(2);
    const ids = [...html.matchAll(/data-field="(f[0-9]+)"/g)].map((x) => x[1]);
    expect(ids).toEqual(cao().fields.map((f) => f.id));
    expect(html).toContain("緊急時の連絡先①");
    expect(html).toContain("山田 ハナ");
    expect(html).toMatch(/data-field="f29"[^]*?data-on="1">■<\/span><span>要介護3/);
    expect(html).toContain("確認 2026-11-02 山本");
    // ケア72 が足す言葉に言い切りの言葉が無い（様式の欄の名前「危険なことを判断できない」は様式の物）
    for (const w of ["診断", "判定", "重症", "至急"]) expect(html).not.toContain(w);
  });

  it("外した欄は出さない。手で書く欄は空ける", () => {
    const m = cao();
    m.fields.find((f) => f.label === "ＦＡＸ番号")!.removed = true;
    m.fields.push({ ...blankField(m.fields, 2), label: "本人署名", shape: "handwrite" });
    const s = buildMappedSheet(seedRows(seed("p-01")), m, OPTS);
    expect(() => cellOf(s, "ＦＡＸ番号")).toThrow();
    const sign = s.pages[1].sections.at(-1)!.rows.at(-1)!;
    expect(sign).toMatchObject({ field: { label: "本人署名" }, cell: { kind: "handwrite" } });
    expect(s.fields).toBe(41);
  });

  it("同意の範囲は松山市の様式と同じ: 支援者提供が無ければ実施者と、実施者でもある緊急連絡先 2 を省略", () => {
    // 7 加藤: 支援者への提供に同意していない。緊急連絡先 1 は弟（実施者 2）、2 は民生委員（実施者 1）
    const s = buildMappedSheet(seedRows(seed("p-07")), cao(), OPTS);
    expect(cellOf(s, "氏名（団体名及び代表者）", "避難支援等実施者情報①")).toBe("省略（支援者提供 同意なし）");
    expect(cellOf(s, "連絡先（電話番号１・電話番号２・メールアドレス・その他）", "避難支援等実施者情報②")).toBe("省略（支援者提供 同意なし）");
    expect(cellOf(s, "氏名（団体名）", "緊急時の連絡先①")).toBe("加藤 実");
    expect(cellOf(s, "氏名（団体名）", "緊急時の連絡先②")).toBe("省略（支援者提供 同意なし）");
    expect(s.withheld).toEqual(["supporters"]);
    const html = JSON.stringify(s);
    expect(html).not.toContain("前田 和夫");
    expect(html).not.toContain("090-0000-0026");
  });

  it("計画の共有が無ければ医療の項目を省略（□ の欄も）", () => {
    const rows = seedRows(seed("p-01"));
    const s = buildMappedSheet({ ...rows, consents: rows.consents.map((c) => (c.kind === "plan_share" ? { ...c, status: "refused" as const } : c)) }, cao(), OPTS);
    expect(cellOf(s, "医療機器の装着等をしている", "避難時に配慮しなくてはならない事項")).toBe("省略（計画共有 同意なし）");
    expect(s.withheld).toEqual(["plan_share"]);
    expect(JSON.stringify(s)).not.toContain("酸素濃縮器");
  });

  it("台帳の pending（不明・未聴取）は理由を添えた未確認", () => {
    const m: FormMapping = {
      title: "見本",
      issuer: "",
      pages: 1,
      fields: [
        { ...blankField([]), label: "事前避難先", item: "evacuation.destination2" },
        { ...blankField([{ ...blankField([]) }]), label: "夜間の支援者", item: "people.night" },
      ],
    };
    const s = buildMappedSheet(seedRows(seed("p-01")), m, OPTS);
    expect(cellOf(s, "事前避難先")).toBe("未確認（不明）");
    expect(cellOf(s, "夜間の支援者")).toBe("未確認（未聴取）");
  });

  it("選ぶ欄は値の言葉が選択肢に合えば ■、合わなければ □ のまま値を添える", () => {
    expect(matchOption(["同意する", "同意しない"], ["同意", "同意する"])).toBe(0);
    expect(matchOption(["同意する", "同意しない"], ["不同意", "同意しない"])).toBe(1);
    expect(matchOption(["ひとり暮らし", "日中ひとり", "高齢者のみ"], ["独居", "ひとり暮らし"])).toBe(0);
    expect(matchOption(["男", "女"], ["その他"])).toBe(-1);
    expect(matchOption(["２階建", "３階建以上"], ["2階建"])).toBe(0);
    const m: FormMapping = {
      title: "見本",
      issuer: "",
      pages: 1,
      fields: [
        { ...blankField([]), label: "同意", shape: "choice", options: ["同意する", "同意しない"], item: "consent.registry" },
        { id: "f2", page: 1, section: "", label: "構造", position: "", shape: "choice", options: ["鉄骨", "鉄筋"], item: "basic.housing.structure", removed: false, ai: null },
      ],
    };
    const s = buildMappedSheet(seedRows(seed("p-01")), m, OPTS);
    expect(cellOf(s, "同意")).toBe("■同意する □同意しない");
    expect(cellOf(s, "構造")).toBe("□鉄骨 □鉄筋 木造");
  });
});
