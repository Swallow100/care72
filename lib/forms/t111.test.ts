// T111 計画書の紙で、値の無い欄を別紙に回さない・「なし」を刷りすぎない。
// 居ない人の欄（実施者 2・近親者が居ないときのフリガナなど）は空き枠（empty）、値の無い特記の段は刷らない、
// 「なし」だけの値は収まらなくても別紙に回さない。原本の枠の紙（T101）・前からの紙面（T85）・対応表の紙（T86）の 3 つでそろえる。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE, type SeedContact, type SeedPerson } from "../../seed/people.ts";
import type { Ledger } from "../db/types.ts";
import { matsuyamaFrameSheet } from "./frame-build.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { BLANK, buildMatsuyamaSheet, cellText, EMPTY, MATSUYAMA_FIELDS, NONE, type MatsuyamaKey, type MatsuyamaSheet as Sheet } from "./matsuyama.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import { buildOverlaySheet, cellLines, isNoneOnly, type OverlaySheet as Overlay } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";
import { isUnconfirmedCell, matsuyamaUnconfirmed } from "./unconfirmed.ts";

const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const MANIFEST: OriginalManifest = {
  id: "matsuyama",
  sha256: ORIGINALS.matsuyama.sha256,
  pages: ORIGINALS.matsuyama.usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-05T00:00:00.000Z",
};

const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

/** 連絡先（種と同じ既定） */
const contact = (c: Partial<SeedContact> & Pick<SeedContact, "id" | "kind">): SeedContact => ({
  relation: null,
  name: null,
  phone: null,
  reach: null,
  emergency_order: null,
  supporter_order: null,
  night_ok: null,
  has_car: null,
  has_smartphone: null,
  note: null,
  ...c,
});

/** 登録したばかりの人（氏名・カナ・生年月日・性別と町名だけ。医療・特記なし） */
const FRESH_LEDGER: Ledger = {
  basic: { sex: "male", address: { city: "松山市", town: "そらみ台" } },
  care: {},
  medical: { devices: [], medications: [] },
  evacuation: { hazards: [] },
  notes: [],
  pending: [],
};
const SON = contact({ id: "c-new-1", kind: "family", relation: "長男", name: "中村 一郎", phone: "090-0000-0099", reach: "nearby", emergency_order: 1, supporter_order: 1 });
const DAUGHTER = contact({ id: "c-new-2", kind: "family", relation: "長女", name: "中村 花", phone: "090-0000-0098", reach: "far", emergency_order: 2, supporter_order: 2 });

/** 支援者 n 人の新しい人（0 人は連絡先なし） */
function fresh(supporters: 0 | 1 | 2): SeedPerson {
  const base = seed("p-10");
  return {
    ...base,
    person: { ...base.person, id: `p-new-${supporters}`, name: "中村 太郎", kana: "ナカムラ タロウ", birth_date: "1941-03-12" },
    ledger: FRESH_LEDGER,
    contacts: [SON, DAUGHTER].slice(0, supporters),
    clocks: [],
    refusedConsents: [],
  };
}

const sheetOf = (p: SeedPerson): Sheet => buildMatsuyamaSheet(seedRows(p), OPTS);
const frameOf = (p: SeedPerson): Overlay => matsuyamaFrameSheet(sheetOf(p), MANIFEST);
const items = (s: Overlay) => s.pages.flatMap((p) => p.items);
const textItems = (s: Overlay) => items(s).flatMap((i) => (i.kind === "text" ? [i] : []));
const marked = (s: Overlay, fieldId: string) => items(s).some((i) => i.kind === "mark" && i.fieldId === fieldId);
/** 色付けで塗る欄（key の集まり） */
const fillKeys = (s: Overlay) => new Set(s.pages.flatMap((p) => p.fills.flatMap((f) => f.keys)));
/** 帯の未確認と同じ欄（key の集まり） */
const unconfirmedKeys = (sheet: Sheet) =>
  new Set(MATSUYAMA_FIELDS.filter((f) => f.shape !== "handwrite" && isUnconfirmedCell(sheet.cells[f.key])).map((f) => f.key as string));

const SUPPORTER_PARTS = ["kana", "name", "address", "phone", "mobile", "relation", "consent"] as const;
const supporterKeys = (n: 1 | 2) => SUPPORTER_PARTS.map((p) => `supporter${n}.${p}` as MatsuyamaKey);

// ---------- 欄の値 ----------

describe("居ない人の欄は空き枠（問い 1 は (a)）", () => {
  it("支援者 1 人: 実施者 2 の欄は全部空き枠（「なし」でも未確認でもない）", () => {
    const s = sheetOf(fresh(1));
    for (const k of supporterKeys(2)) expect(s.cells[k], k).toEqual(EMPTY);
    expect(cellText(s.cells["supporter1.name"])).toBe("中村 一郎");
  });

  it("支援者 0 人: 実施者 1 の氏名だけ「なし」、ほかの欄と実施者 2 は空き枠。近親者も氏名だけ「なし」", () => {
    const s = sheetOf(fresh(0));
    expect(s.cells["supporter1.name"]).toEqual(NONE);
    for (const k of supporterKeys(1).filter((k) => k !== "supporter1.name")) expect(s.cells[k], k).toEqual(EMPTY);
    for (const k of supporterKeys(2)) expect(s.cells[k], k).toEqual(EMPTY);
    expect(s.cells["kin.name"]).toEqual(NONE);
    for (const k of ["kin.kana", "kin.relation", "kin.phone", "kin.mobile", "kin.address"] as const) expect(s.cells[k], k).toEqual(EMPTY);
  });

  it("支援者 2 人: 実施者 2 の欄に値（今のまま）", () => {
    const s = sheetOf(fresh(2));
    expect(cellText(s.cells["supporter2.name"])).toBe("中村 花");
    expect(cellText(s.cells["supporter2.relation"])).toContain("長女");
  });

  it("実施者 2 だけ居る人は、実施者 1 の欄を「なし」にしない（空き枠）", () => {
    const p = { ...fresh(0), contacts: [{ ...DAUGHTER, supporter_order: 2 }] };
    const s = sheetOf(p);
    expect(s.cells["supporter1.name"]).toEqual(EMPTY);
    expect(cellText(s.cells["supporter2.name"])).toBe("中村 花");
  });

  it("台帳に実施者 2 の pending があれば未確認（理由つき）のまま", () => {
    const p = { ...fresh(1), ledger: { ...FRESH_LEDGER, pending: [{ field: "people.supporter2", status: "unknown" as const }] } };
    expect(sheetOf(p).cells["supporter2.name"]).toEqual({ kind: "unconfirmed", reason: "unknown" });
  });

  it("空き枠は未確認に数えず、帯にも出さない", () => {
    expect(isUnconfirmedCell(EMPTY)).toBe(false);
    expect(cellLines(EMPTY)).toEqual([]);
    expect(cellText(EMPTY)).toBe("");
    const names = matsuyamaUnconfirmed(sheetOf(fresh(1))).fields.map((f) => f.name);
    expect(names.filter((n) => n.startsWith("実施者2"))).toEqual([]);
  });

  it("地域の支援者の名前の無い 2 行は、居なければ空き枠", () => {
    expect(sheetOf(fresh(1)).cells["local.other"]).toEqual(EMPTY);
  });
});

describe("特記事項の値の無い段は刷らない（問い 2 は (a)）", () => {
  it("本人の言葉・その他が無ければ空き枠。値があれば今のまま", () => {
    const s = sheetOf(fresh(1));
    expect(s.cells["notes.words"]).toEqual(EMPTY);
    expect(cellText(sheetOf(seed("p-01")).cells["notes.words"])).toBe("薬は 2 階の箪笥");
  });

  it("原本の枠の紙の特記事項に「本人の言葉 なし」「夜間支援 なし」を書かない", () => {
    const night = { ...fresh(1), contacts: [{ ...SON, night_ok: 0 as const }] };
    expect(sheetOf(night).cells["supporter.night"]).toEqual(NONE);
    for (const p of [fresh(0), fresh(1), night]) {
      const notes = textItems(frameOf(p))
        .filter((i) => i.fieldId === "notes")
        .flatMap((i) => i.lines)
        .join("");
      expect(notes, p.person.id).not.toContain("本人の言葉");
      expect(notes, p.person.id).not.toContain("夜間支援");
    }
  });

  it("前からの紙面も同じ: 値の無い段は描かない、値のある段は描く", () => {
    const html = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: sheetOf(fresh(1)) }));
    expect(html).not.toContain('data-field="notes.words"');
    expect(html).toContain('data-field="notes.other"');
    const p01 = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: sheetOf(seed("p-01")) }));
    expect(p01).toContain('data-field="notes.words"');
  });
});

// ---------- 別紙 ----------

describe("「なし」だけの値・空の値は別紙に回さない", () => {
  it("支援者 1 人（11/5 の見直しの形）: 別紙なし、「別紙（なし）」に印、実施者 2 の欄に字なし", () => {
    const s = frameOf(fresh(1));
    expect(s.annex).toEqual([]);
    expect(marked(s, "notes.annex:なし")).toBe(true);
    expect(marked(s, "notes.annex:あり")).toBe(false);
    for (const it of textItems(s)) {
      expect(it.fieldId.startsWith("supporter2."), it.fieldId).toBe(false);
      expect(it.lines, it.fieldId).not.toContain("別紙");
    }
    // 「なし」が載るのは、分かっている「なし」の欄（民生・児童委員の連絡先なし・薬なし）だけ。実施者 2・近親者・特記には載らない
    const nones = textItems(s).filter((i) => i.lines.includes(BLANK.none)).map((i) => i.fieldId);
    expect(nones.sort()).toEqual(["local.welfare:name0", "medical.doctor+medical.drugs"]);
  });

  it("支援者 0 人: 別紙なし。実施者 1・近親者の氏名に「なし」、ほかの欄に字なし", () => {
    const s = frameOf(fresh(0));
    expect(s.annex).toEqual([]);
    expect(marked(s, "notes.annex:なし")).toBe(true);
    const nones = textItems(s).filter((i) => i.lines.includes(BLANK.none)).map((i) => i.fieldId);
    expect(nones.sort()).toEqual(["kin.name:family", "local.welfare:name0", "medical.doctor+medical.drugs", "supporter1.name:family"]);
  });

  it("支援者 2 人: 実施者 2 の欄に値が載り、収まらない値は今のまま別紙へ（別紙あり）", () => {
    const s = frameOf(fresh(2));
    expect(textItems(s).some((i) => i.fieldId.startsWith("supporter2.name"))).toBe(true);
    const long = { ...fresh(2), ledger: { ...FRESH_LEDGER, evacuation: { hazards: [], barriers: "玄関に段差 ".repeat(40) } } };
    const over = frameOf(long);
    expect(over.annex.map((r) => r.fieldId)).toContain("risk.issues");
    expect(marked(over, "notes.annex:あり")).toBe(true);
  });

  it("医療要約を添える人は、別紙の頁が無くても「別紙（あり）」（前からの紙面と同じ。T07）", () => {
    const s = frameOf(seed("p-10"));
    expect(s.annex).toEqual([]);
    expect(marked(s, "notes.annex:なし")).toBe(true);
    const med = frameOf(seed("p-01"));
    expect(cellText(sheetOf(seed("p-01")).cells["notes.annex"])).toContain("■あり");
    expect(marked(med, "notes.annex:あり")).toBe(true);
  });

  it("種の 10 人: 別紙に「なし」だけの行は無く、別紙の行は前（T106）より増えない", () => {
    // 前は実施者 1・2 のフリガナの「なし」が別紙に回っていた（p-04・p-05・p-08・p-09・p-10）
    const before: Record<string, number> = BEFORE_ANNEX;
    for (const p of SEED_PEOPLE) {
      const s = frameOf(p);
      for (const r of s.annex) expect(isNoneOnly(r.lines), `${p.person.id} ${r.fieldId}`).toBe(false);
      expect(s.annex.length, p.person.id).toBeLessThanOrEqual(before[p.person.id]);
    }
  });

  it("isNoneOnly: 「なし」だけの行の集まり", () => {
    expect(isNoneOnly(["なし"])).toBe(true);
    expect(isNoneOnly(["なし", "なし"])).toBe(true);
    expect(isNoneOnly([])).toBe(false);
    expect(isNoneOnly(["なし（同居）"])).toBe(false);
  });
});

// ---------- 帯の数え方 ----------

describe("帯の別紙と未確認の数は紙と同じ数え方", () => {
  const people: Array<[string, SeedPerson]> = [
    ["支援者 0 人", fresh(0)],
    ["支援者 1 人", fresh(1)],
    ["支援者 2 人", fresh(2)],
    ...SEED_PEOPLE.map((p): [string, SeedPerson] => [p.person.id, p]),
  ];

  it.each(people)("%s: 帯の未確認の欄 = 色付けで塗る欄、帯の別紙の数 = 紙の別紙の行", (_, p) => {
    const sheet = sheetOf(p);
    const framed = matsuyamaFrameSheet(sheet, MANIFEST);
    expect([...fillKeys(framed)].sort()).toEqual([...unconfirmedKeys(sheet)].sort());
    expect(framed.unconfirmed.length).toBe(matsuyamaUnconfirmed(sheet).count);
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: framed, imageSrc: () => "", checked: "", fill: true }));
    const annex = /data-annex="(\d+)"/.exec(html);
    expect(annex ? Number(annex[1]) : 0).toBe(framed.annex.length);
    // 空き枠は塗らない
    for (const k of supporterKeys(2)) if (sheet.cells[k].kind === "empty") expect(fillKeys(framed).has(k), k).toBe(false);
  });

  it("支援者 1 人の新しい人: 塗る欄に実施者 2・本人の言葉が無い", () => {
    const framed = frameOf(fresh(1));
    const keys = fillKeys(framed);
    for (const k of [...supporterKeys(2), "notes.words", "local.other"]) expect(keys.has(k), k).toBe(false);
  });
});

// ---------- 対応表の紙（T86）----------

describe("対応表の紙も同じ答え", () => {
  const field = (id: string, item: MappingField["item"], box: MappingField["box"], shape: MappingField["shape"] = "text"): MappingField => ({
    id,
    page: 1,
    section: "避難支援者",
    label: id,
    position: "",
    shape,
    options: [],
    item,
    removed: false,
    ai: null,
    box,
  });
  const mapping = (fields: MappingField[]): FormMapping => ({ title: "見本の様式", issuer: "見本市", pages: 1, typeface: "gothic", fields });
  const IMAGES: PageImage[] = [{ page: 1, width: 2000, height: 2828, bytes: 1 }];

  it("避難支援者 2・緊急連絡先 2 が居なければ空き枠（未確認に数えない）", () => {
    const rows = seedRows(fresh(1));
    const ctx = buildMappedSheet(rows, mapping([]), OPTS);
    expect(ctx.unconfirmed).toEqual([]);
    const items: Array<MappingField["item"]> = [
      "supporter2.name",
      "supporter2.relation",
      "supporter2.phone",
      "supporter2.address",
      "emergency2.name",
      "emergency2.relation",
      "emergency2.phone",
      "emergency2.address",
    ];
    const m = buildMappedSheet(rows, mapping(items.map((it, i) => field(`f${i}`, it, null))), OPTS);
    const cells = m.pages.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => r.cell)));
    for (const c of cells) expect(c).toEqual(EMPTY);
    expect(m.unconfirmed).toEqual([]);
  });

  it("「なし」だけの値は小さな欄に収まらなくても別紙に回さない。ほかの値は今のまま別紙へ", () => {
    const rows = seedRows(fresh(0));
    // 高さ 1mm ほどの欄（どの大きさでも収まらない）
    const tiny = { x: 0.1, y: 0.1, w: 0.3, h: 0.0035 };
    const m = buildMappedSheet(rows, mapping([field("a", "supporter1.name", tiny), field("b", "person.name", tiny)]), OPTS);
    const s = buildOverlaySheet(m, IMAGES);
    expect(s.annex.map((r) => r.fieldId)).toEqual(["b"]);
    expect(s.pages[0].items.filter((i) => i.fieldId === "a")).toEqual([]);
  });
});

/** T111 の前（origin/integrate/t11-t12 の b4b29e35）の原本の枠の紙の別紙の行の数。p-02 の 2 行は値（事業所等・手段）、ほかは全部「なし」 */
const BEFORE_ANNEX: Record<string, number> = {
  "p-01": 0,
  "p-02": 2,
  "p-03": 0,
  "p-04": 1,
  "p-05": 2,
  "p-06": 0,
  "p-07": 0,
  "p-08": 1,
  "p-09": 1,
  "p-10": 1,
};
