// T135 紙の上でその場で入れる・文字の枠と画像・紙から質問（docs/tasks/T135.md、docs/progress/t135.md）。
// 架空の様式（こもれび市、lib/forms/komorebi-form.fixture.ts）に、台帳に項目の無い欄（様式だけの欄）と連絡先の欄を足した対応表で、
// 手元の D1（node:sqlite）に種の 10 人を入れて確かめる。Claude は呼ばない。

import type { DatabaseSync } from "node:sqlite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { seedStatements } from "../../seed/sql.ts";
import { chromePath } from "../../tools/print/chrome.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { answerChanges } from "../intake/answer.ts";
import { questionQueue } from "../intake/ask.ts";
import { loadPersonPage, type PersonPageRows } from "../person.ts";
import { assetGet, assetsGet, assetsPost, sniffImage } from "./form-assets.ts";
import { checkFieldValue, handleEntries } from "./form-entries-http.ts";
import { freeText, loadFormEntries, withFreeItems, type FormEntry } from "./form-entries.ts";
import { ITEM_INPUTS } from "./item-inputs.ts";
import { komorebiReadResult } from "./komorebi-form.fixture.ts";
import { checkReadResult, LEDGER_ITEMS, type FieldBox, type FormMapping, type MappingField } from "./mapping.ts";
import { fitText, FONT_MAX_PT, FONT_MIN_PT, textEm, type OverlaySheet as Sheet } from "./overlay-sheet.ts";
import type { PageImage, PageImageBucket } from "./page-images.ts";
import { joinParts, liveFont, partsOf, slotChanges, toggleOption, type PaperSlot } from "./paper-fill.ts";
import { mappedPaper, matsuyamaPaper } from "./paper-fill-server.ts";
import { paperQuestions } from "./paper-slots.ts";
import { paperCss, paperPage, readRepoFile } from "./print-harness.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import { intakeField } from "../intake/fields.ts";

const OFFICE = "office-demo";
const MAPPING_ID = "fm-t135";
const FORM_ID = `mapped:${MAPPING_ID}` as const;
const OPTS = { today: "2026-11-05", officeName: "デモ事業所" };
const A4: PageImage = { page: 1, width: 1413, height: 2000, bytes: 1 };
const IMAGES: PageImage[] = [A4, { ...A4, page: 2 }];
const NOW = new Date("2026-11-05T07:00:00.000Z");

const cm: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: OFFICE, name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};
const medical: Principal = { ...cm, role: "medical", office: null, accountId: "acct-med", caseloadOf: null };

const field = (f: Partial<MappingField> & Pick<MappingField, "id" | "page" | "label" | "shape" | "item">): MappingField => ({
  section: "",
  position: "",
  options: [],
  removed: false,
  ai: null,
  box: null,
  ...f,
});

/** こもれび市の様式に、様式だけの欄（受付番号・届出日・防災マップ確認）と緊急連絡先の住所・フリガナを足した対応表 */
function mapping(): FormMapping {
  const m = checkReadResult(komorebiReadResult("mincho")).mapping;
  return {
    ...m,
    fields: [
      ...m.fields,
      field({ id: "f101", page: 1, label: "受付番号", shape: "text", item: null, box: { x: 0.6, y: 0.04, w: 0.3, h: 0.025 } }),
      field({
        id: "f102",
        page: 1,
        label: "届出日",
        shape: "date",
        item: null,
        options: ["年", "月", "日"],
        box: { x: 0.3, y: 0.07, w: 0.4, h: 0.025 },
        optionBoxes: [
          { x: 0.3, y: 0.07, w: 0.08, h: 0.025 },
          { x: 0.42, y: 0.07, w: 0.06, h: 0.025 },
          { x: 0.52, y: 0.07, w: 0.06, h: 0.025 },
        ],
      }),
      field({
        id: "f103",
        page: 2,
        label: "防災マップ確認",
        shape: "choice",
        item: null,
        options: ["あり", "なし"],
        box: { x: 0.3, y: 0.6, w: 0.4, h: 0.03 },
        optionBoxes: [
          { x: 0.31, y: 0.61, w: 0.018, h: 0.013 },
          { x: 0.45, y: 0.61, w: 0.018, h: 0.013 },
        ],
      }),
      field({ id: "f104", page: 1, section: "緊急連絡先", label: "住所", shape: "text", item: "emergency1.address", box: { x: 0.3, y: 0.545, w: 0.62, h: 0.03 } }),
      field({ id: "f105", page: 1, section: "緊急連絡先", label: "フリガナ", shape: "text", item: "emergency1.kana", box: { x: 0.3, y: 0.405, w: 0.62, h: 0.03 } }),
    ],
  };
}

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

function insertMapping(m: FormMapping, office = OFFICE, id = MAPPING_ID) {
  sqlite
    .prepare(
      `INSERT INTO form_mappings (id, office_id, title, form_hash, source_kind, mapping, status, created_at, checked_at, updated_at, page_images)
       VALUES (?, ?, ?, NULL, 'manual', ?, 'checked', ?, ?, ?, ?)`,
    )
    .run(id, office, m.title, JSON.stringify(m), NOW.toISOString(), NOW.toISOString(), NOW.toISOString(), JSON.stringify(IMAGES));
}

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  insertMapping(mapping());
});

const rowsOf = async (id = "p-01") => (await loadPersonPage(db, cm, id))!;

async function paper(personId = "p-01", m = mapping()) {
  const rows = await rowsOf(personId);
  return { rows, ...(await mappedPaper(db, { rows, officeId: OFFICE, mappingId: MAPPING_ID, mapping: m, images: IMAGES, opts: OPTS, overlay: true, edit: true })) };
}

const slotOf = (slots: readonly PaperSlot[], key: string) => slots.find((s) => s.key === key)!;
const textsOf = (sheet: Sheet, id: string) =>
  sheet.pages.flatMap((p) => p.items.filter((i): i is Extract<typeof i, { kind: "text" }> => i.kind === "text" && i.fieldId === id));
const call = async (body: Record<string, unknown>, p: Principal | null = cm) => {
  const r = await handleEntries(db, p, { personId: "p-01", formId: FORM_ID, ...body }, NOW);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

/** その場の入力の値で台帳に入れる（画面の保存と同じ形） */
async function inline(slot: PaperSlot, next: Parameters<typeof slotChanges>[1], version: number) {
  const { changes, bad } = slotChanges(slot, next);
  expect(bad).toBe(false);
  return call({ op: "ledger", fieldKeys: [slot.key], version, edit: true, changes });
}

describe("台帳の項目の元の表（添付の様式）", () => {
  it("表の欄は全部入れる欄の表にある。台帳の項目の鍵だけ", () => {
    const keys = new Set(LEDGER_ITEMS.map((i) => i.key as string));
    for (const [item, inputs] of Object.entries(ITEM_INPUTS)) {
      expect(keys.has(item), item).toBe(true);
      for (const i of inputs!) if (i.kind === "field") expect(intakeField(i.key), `${item} ${i.key}`).toBeDefined();
    }
  });
});

describe("紙の欄の一覧（mappedSlots）", () => {
  it("台帳の欄はその場（字・選ぶ）か窓、様式だけの欄は手入れ。手書きの欄は押せない", async () => {
    const { fill } = await paper();
    const s = fill!.slots;
    // 字の欄（避難先・緊急連絡先の住所・フリガナ）はその場で台帳へ
    expect(slotOf(s, fieldId("避難先")).input.kind).toBe("text");
    expect(slotOf(s, fieldId("避難先")).dest).toBe("ledger");
    expect(slotOf(s, "f104")).toMatchObject({ dest: "ledger", input: { kind: "text" }, ledger: { kind: "contact", part: "address" } });
    // 性別は □ を押して台帳の選択肢へ
    const sex = slotOf(s, fieldId("性別"));
    expect(sex.input.kind).toBe("choice");
    if (sex.input.kind === "choice") expect(sex.input.options.map((o) => o.value).sort()).toEqual(["female", "male"]);
    // 氏名・電話（電話と携帯の 2 つ）・同意は窓
    expect(slotOf(s, fieldId("氏名", "本人")).input.kind).toBe("window");
    expect(slotOf(s, fieldId("電話", "緊急連絡先")).input.kind).toBe("window");
    // 様式だけの欄
    expect(slotOf(s, "f101")).toMatchObject({ dest: "form", input: { kind: "text" }, empty: true });
    const date = slotOf(s, "f102");
    expect(date.input.kind === "text" && date.input.parts?.map((p) => p.sep)).toEqual(["年", "月", "日"]);
    expect(slotOf(s, "f103")).toMatchObject({ dest: "form", input: { kind: "choice", multi: false } });
    // 手書きの欄（本人署名・市受付印）と台帳の別の値から作る欄（作成日）は押せない
    expect(s.find((x) => x.label === "本人署名")).toBeUndefined();
    expect(s.find((x) => x.label === "市受付印")).toBeUndefined();
    expect(s.find((x) => x.label === "作成日")).toBeUndefined();
  });

  it("同意の無い範囲の欄は押せない（計画共有の無い人の医療機器）", async () => {
    sqlite.prepare("UPDATE consents SET status = 'refused' WHERE person_id = 'p-01' AND kind = 'plan_share'").run();
    const { fill } = await paper();
    expect(fill!.slots.find((x) => x.label === "医療機器を使っている")).toBeUndefined();
  });
});

const fieldId = (label: string, section?: string) => mapping().fields.find((f) => f.label === label && (section === undefined || f.section === section))!.id;

describe("押して入れた値の行き先", () => {
  it("台帳の欄: 入れた値が台帳に入り、紙のその欄に刷られる。誰がいつの印", async () => {
    const before = await paper();
    const slot = slotOf(before.fill!.slots, fieldId("避難先"));
    const r = await inline(slot, "こもれび小学校 体育館", before.rows.person.version!);
    expect(r.status).toBe(200);
    const after = await paper();
    const ledger = JSON.parse(after.rows.person.ledger);
    expect(ledger.evacuation.destination1).toBe("こもれび小学校 体育館");
    expect(textsOf(after.overlay!, slot.key).flatMap((t) => t.lines).join("")).toContain("こもれび小学校 体育館");
    // 印（台帳）と誰がいつ。値は台帳が正なので印の行に持たない
    const hand = slotOf(after.fill!.slots, slot.key).hand!;
    expect(hand.by).toBe("山本");
    expect(hand.at).toBe(NOW.toISOString());
    const row = sqlite.prepare("SELECT kind, value, author_id FROM form_entries WHERE field_key = ?").get(slot.key) as Record<string, unknown>;
    expect(row).toEqual({ kind: "ledger", value: "", author_id: "acct-yamamoto" });
    // 経過は面の編集と同じ「ケアマネが直した」
    const tl = sqlite.prepare("SELECT body FROM timeline_entries WHERE person_id = 'p-01' ORDER BY created_at DESC LIMIT 1").get() as { body: string };
    expect(tl.body).toContain("直した");
    // 台帳に入ったので、ほかの様式（計画書）にも効く
    const m = buildMatsuyamaSheet(after.rows, OPTS);
    expect(JSON.stringify(m.cells["shelter.city.place"])).toContain("こもれび小学校 体育館");
  });

  it("□ を押すと台帳の選択肢に入る（性別）・もう一度押すと外れる", async () => {
    const p0 = await paper();
    const sex = slotOf(p0.fill!.slots, fieldId("性別"));
    const now = Array.isArray(sex.value) ? sex.value : [];
    const target = now.includes("female") ? "male" : "female";
    await inline(sex, toggleOption(sex.value, target, false), p0.rows.person.version!);
    const p1 = await paper();
    expect(JSON.parse(p1.rows.person.ledger).basic.sex).toBe(target);
    expect(toggleOption([target], target, false)).toEqual([]);
  });

  it("様式だけの欄: その人のその様式の手入れとして残る（台帳は変わらない）。部品の欄は部品ごと", async () => {
    const p0 = await paper();
    const ledgerBefore = p0.rows.person.ledger;
    const num = slotOf(p0.fill!.slots, "f101");
    expect((await call({ op: "put", entry: { id: "fe-num-000001", kind: "field", fieldKey: "f101", page: null, box: null, value: JSON.stringify("A-0012") } })).status).toBe(200);
    const date = slotOf(p0.fill!.slots, "f102");
    if (date.input.kind !== "text" || !date.input.parts) throw new Error("parts");
    const seps = date.input.parts.map((x) => x.sep);
    const joined = joinParts(["令和8", "11", "5"], seps);
    expect(joined).toBe("令和8年11月5日");
    expect(partsOf(joined, seps)).toEqual(["令和8", "11", "5"]);
    await call({ op: "put", entry: { id: "fe-date-00001", kind: "field", fieldKey: "f102", page: null, box: null, value: JSON.stringify(joined) } });
    await call({ op: "put", entry: { id: "fe-map-000001", kind: "field", fieldKey: "f103", page: null, box: null, value: JSON.stringify(["あり"]) } });
    const p1 = await paper();
    expect(p1.rows.person.ledger).toBe(ledgerBefore);
    expect(textsOf(p1.overlay!, num.key).flatMap((t) => t.lines)).toEqual(["A-0012"]);
    // 部品ごとの空きに置く（年・月・日）
    expect(textsOf(p1.overlay!, "f102").map((t) => t.lines.join(""))).toEqual(["令和8", "11", "5"]);
    // □ の欄は選んだ □ に印
    const marks = p1.overlay!.pages[1].items.filter((i) => i.kind === "mark" && i.fieldId === "f103");
    expect(marks).toHaveLength(1);
    // 帯の未確認・対応なしから外れ、色付けもしない
    expect(p1.sheet.unconfirmed).not.toContain("受付番号");
    expect(p1.overlay!.pages[0].fills.some((f) => f.keys.includes("f101"))).toBe(false);
    expect(p1.overlay!.pages[0].fills.some((f) => f.keys.includes(fieldId("避難先")))).toBe(false);
    // 誰がいつ
    const entries = await loadFormEntries(db, OFFICE, "p-01", FORM_ID);
    expect(entries.find((e) => e.fieldKey === "f101")).toMatchObject({ kind: "field", by: "山本", at: NOW.toISOString() });
    // ほかの人・ほかの様式には効かない
    expect(await loadFormEntries(db, OFFICE, "p-02", FORM_ID)).toEqual([]);
    expect(await loadFormEntries(db, OFFICE, "p-01", "matsuyama")).toEqual([]);
  });

  it("様式だけの欄に台帳の欄の鍵・形の合わない値は断る", async () => {
    const bad = (fieldKey: string, value: unknown) =>
      call({ op: "put", entry: { id: "fe-bad-000001", kind: "field", fieldKey, page: null, box: null, value: JSON.stringify(value) } });
    expect((await bad(fieldId("避難先"), "x")).status).toBe(400);
    expect((await bad("f103", ["ない選択肢"])).status).toBe(400);
    expect((await bad("f101", "")).status).toBe(400);
    expect((await bad(fieldId("本人署名"), "署名")).status).toBe(400);
    expect(checkFieldValue({ shape: "check", options: [] }, "true")).toBe(true);
    expect(checkFieldValue({ shape: "text", options: [] }, JSON.stringify("あ".repeat(201)))).toBeNull();
  });
});

describe("氏名・住所・電話は紙に本当の値（仮名化の伏字を出さない）", () => {
  const MASKS = ["（氏名）", "（町名）", "（電話）", "（住所）", "（生年月日）", "Aさん", "支援者1"];

  it("紙の上で入れた連絡先のフリガナ・住所・電話が、そのまま紙に刷られる", async () => {
    const p0 = await paper();
    const v0 = p0.rows.person.version!;
    await inline(slotOf(p0.fill!.slots, "f104"), "こもれび市 さくら町", v0);
    const p1 = await paper();
    await inline(slotOf(p1.fill!.slots, "f105"), "ヤマダ イチロウ", p1.rows.person.version!);
    // 電話は窓（電話と携帯）。窓の保存も同じ受け口
    const p2 = await paper();
    const phone = slotOf(p2.fill!.slots, fieldId("電話", "緊急連絡先"));
    const tel = phone.target!.inputs.find((i) => i.kind === "contact" && i.part === "mobile")!;
    if (tel.kind !== "contact") throw new Error("contact");
    await call({ op: "ledger", fieldKeys: [phone.key], version: p2.rows.person.version!, edit: true, changes: [{ t: "contact", id: tel.contactId, value: { kind: tel.contactKind, mobile: "090-0000-0091" }, overwrite: true }] });
    const p3 = await paper();
    const all = JSON.stringify(p3.overlay);
    expect(textsOf(p3.overlay!, "f104").flatMap((t) => t.lines).join("")).toBe("こもれび市 さくら町");
    expect(textsOf(p3.overlay!, "f105").flatMap((t) => t.lines).join("")).toBe("ヤマダ イチロウ");
    expect(all).toContain("090-0000-0091");
    // 本人の氏名・住所の欄も台帳の本当の値
    expect(textsOf(p3.overlay!, fieldId("氏名", "本人")).flatMap((t) => t.lines).join("")).toBe(p3.rows.person.name);
    for (const m of MASKS) expect(all, m).not.toContain(m);
  });

  it("紙から質問で答えた値も本当の値で紙に（問いの答えは台帳へ）", async () => {
    const p0 = await paper();
    const q = p0.fill!.questions.find((x) => x.key.endsWith(".kana"));
    expect(q).toBeDefined();
    const changes = answerChanges(q!, { kind: "value", value: "モリ ハナコ" })!;
    const keys = p0.fill!.slots.filter((s) => s.asks?.includes(q!.key)).map((s) => s.key);
    expect(keys).toContain("f105");
    expect((await call({ op: "ledger", fieldKeys: keys, version: p0.rows.person.version!, edit: false, changes })).status).toBe(200);
    const p1 = await paper();
    expect(textsOf(p1.overlay!, "f105").flatMap((t) => t.lines).join("")).toBe("モリ ハナコ");
    expect(p1.fill!.questions.some((x) => x.key === q!.key)).toBe(false);
    for (const m of MASKS) expect(JSON.stringify(p1.overlay), m).not.toContain(m);
  });
});

describe("字は欄の矩形の中だけ（紙と画面が同じ決まり）", () => {
  it("刷る字は fitText の大きさで、欄の幅と高さに収まる。画面の大きさも同じ関数", async () => {
    const p0 = await paper();
    const long = "こもれび市立こもれび第二小学校 体育館（指定避難所・福祉避難スペースあり）".repeat(4);
    await inline(slotOf(p0.fill!.slots, fieldId("避難先")), long, p0.rows.person.version!);
    const p1 = await paper();
    const slot = slotOf(p1.fill!.slots, fieldId("避難先"));
    const items = textsOf(p1.overlay!, slot.key);
    expect(items).toHaveLength(1);
    const it0 = items[0];
    const page = p1.overlay!.pages[0].image;
    const wMm = it0.box.w * page.w - 1.6;
    const hMm = it0.box.h * page.h - 1;
    const fontMm = (it0.fontPt * 25.4) / 72;
    expect(it0.fontPt).toBeGreaterThanOrEqual(FONT_MIN_PT);
    expect(it0.fontPt).toBeLessThan(FONT_MAX_PT);
    for (const l of it0.lines) expect(textEm(l) * fontMm).toBeLessThanOrEqual(wMm + 1e-6);
    expect(it0.lines.length * fontMm * 1.15).toBeLessThanOrEqual(hMm + 1e-6);
    // 画面の入力の大きさ（liveFont）は紙と同じ
    expect(liveFont(long, slot.mm, slot.maxPt).fontPt).toBe(it0.fontPt);
    // 下限でも入らなければ下限のまま（刷ると別紙）
    const huge = "あ".repeat(400);
    expect(liveFont(huge, slot.mm, slot.maxPt)).toMatchObject({ fontPt: FONT_MIN_PT, overflow: true });
    expect(fitText([huge], slot.mm.w, slot.mm.h)).toBeNull();
  });

  it("文字の枠も同じ決まり。下限でも入らなければ枠に入る行まで（枠の外へ出さない）", () => {
    const f = freeText("避難の時は隣の方に声を掛けてもらう", 60, 12, FONT_MAX_PT)!;
    expect(f.fontPt).toBe(fitText(["避難の時は隣の方に声を掛けてもらう"], 60, 12)!.fontPt);
    const clipped = freeText("あ".repeat(300), 20, 6, FONT_MAX_PT)!;
    expect(clipped).toMatchObject({ fontPt: FONT_MIN_PT, clipped: true });
    const fontMm = (FONT_MIN_PT * 25.4) / 72;
    expect(clipped.lines.length * fontMm * 1.15).toBeLessThanOrEqual(6 - 1 + 1e-6);
  });
});

describe("文字の枠と画像", () => {
  const box: FieldBox = { x: 0.1, y: 0.82, w: 0.4, h: 0.05 };

  async function putAsset(office = OFFICE) {
    const objects = new Map<string, Uint8Array>();
    const bucket: PageImageBucket = {
      put: async (k, v) => void objects.set(k, v),
      get: async (k) => (objects.has(k) ? { body: objects.get(k)!, size: objects.get(k)!.length } : null),
    };
    const form = new FormData();
    form.set("file", new Blob([PNG], { type: "image/png" }), "map.png");
    form.set("name", "避難経路の写し");
    form.set("kind", "map");
    form.set("width", "4");
    form.set("height", "2");
    const p = office === OFFICE ? cm : { ...cm, office: { id: office, name: "他", kind: "regular" as const } };
    const r = await assetsPost(db, bucket, p, form, NOW);
    return { objects, bucket, res: (await r.json()) as { ok: boolean; asset: { id: string; src: string } } };
  }

  it("置いた枠と画像は紙の同じ位置の物になり、紙面の HTML にも同じ位置で出る", async () => {
    const { res } = await putAsset();
    expect(res.ok).toBe(true);
    expect((await call({ op: "put", entry: { id: "fe-text-00001", kind: "text", fieldKey: null, page: 1, box, value: "鍵は玄関の植木鉢の下" } })).status).toBe(200);
    const imgBox = { x: 0.55, y: 0.82, w: 0.3, h: 0.1 };
    expect((await call({ op: "put", entry: { id: "fe-img-000001", kind: "image", fieldKey: null, page: 2, box: imgBox, value: res.asset.id } })).status).toBe(200);
    const p = await paper();
    const t = p.overlay!.pages[0].items.find((i) => i.kind === "text" && i.free === "fe-text-00001");
    expect(t).toMatchObject({ box, lines: ["鍵は玄関の植木鉢の下"] });
    const pic = p.overlay!.pages[1].items.find((i) => i.kind === "picture");
    expect(pic).toMatchObject({ box: imgBox, src: res.asset.src, alt: "避難経路の写し" });
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: p.overlay!, imageSrc: () => "", checked: "", layer: true }));
    expect(html).toContain('data-free="fe-text-00001"');
    expect(html).toContain("left:10.000%;top:82.000%;width:40.000%;height:5.000%");
    expect(html).toMatch(/<img class="ov-picture" style="left:55\.000%;top:82\.000%;width:30\.000%;height:10\.000%"/);
    expect(html).toContain('class="ov-layer"');
    // 画面の手入れの一覧にも
    expect(p.fill!.free.map((e) => e.id).sort()).toEqual(["fe-img-000001", "fe-text-00001"]);
  });

  it("取り消し（removed_at）と、同じ id での戻し（取消の取消）", async () => {
    await call({ op: "put", entry: { id: "fe-text-00002", kind: "text", fieldKey: null, page: 1, box, value: "一" } });
    expect((await call({ op: "remove", id: "fe-text-00002" })).body).toMatchObject({ removed: 1 });
    expect((await loadFormEntries(db, OFFICE, "p-01", FORM_ID)).some((e) => e.id === "fe-text-00002")).toBe(false);
    const row = sqlite.prepare("SELECT removed_at FROM form_entries WHERE id = 'fe-text-00002'").get() as { removed_at: string };
    expect(row.removed_at).toBe(NOW.toISOString());
    await call({ op: "put", entry: { id: "fe-text-00002", kind: "text", fieldKey: null, page: 1, box, value: "一" } });
    expect((await loadFormEntries(db, OFFICE, "p-01", FORM_ID)).find((e) => e.id === "fe-text-00002")?.value).toBe("一");
    // 様式だけの欄は 1 欄 1 行（別の id で入れ直すと前の行は取り消す）
    await call({ op: "put", entry: { id: "fe-num-000001", kind: "field", fieldKey: "f101", page: null, box: null, value: JSON.stringify("1") } });
    await call({ op: "put", entry: { id: "fe-num-000002", kind: "field", fieldKey: "f101", page: null, box: null, value: JSON.stringify("2") } });
    const nums = (await loadFormEntries(db, OFFICE, "p-01", FORM_ID)).filter((e) => e.fieldKey === "f101");
    expect(nums.map((e) => e.value)).toEqual([JSON.stringify("2")]);
  });

  it("台帳の値の取消: 前の値で入れ直すと台帳も紙も前に戻る", async () => {
    const p0 = await paper();
    const slot0 = slotOf(p0.fill!.slots, fieldId("避難先"));
    const before = slot0.value;
    await inline(slot0, "仮の避難先", p0.rows.person.version!);
    const p1 = await paper();
    const slot1 = slotOf(p1.fill!.slots, slot0.key);
    expect(slot1.value).toBe("仮の避難先");
    await inline(slot1, before, p1.rows.person.version!);
    const p2 = await paper();
    expect(slotOf(p2.fill!.slots, slot0.key).value).toBe(before);
  });

  it("枠と画像の値の決まり（空の字・頁の外・ほかの事業所の画像・上限）", async () => {
    expect((await call({ op: "put", entry: { id: "fe-text-00003", kind: "text", fieldKey: null, page: 1, box, value: "  " } })).status).toBe(400);
    expect((await call({ op: "put", entry: { id: "fe-text-00003", kind: "text", fieldKey: null, page: 3, box, value: "あ" } })).status).toBe(400);
    expect((await call({ op: "put", entry: { id: "fe-text-00003", kind: "text", fieldKey: null, page: 1, box: { x: 0.1, y: 0.1, w: 0.001, h: 0.001 }, value: "あ" } })).status).toBe(400);
    sqlite.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-other', '他', 'regular', '架空市')");
    const other = await putAsset("office-other");
    expect(other.res.ok).toBe(true);
    expect((await call({ op: "put", entry: { id: "fe-img-000003", kind: "image", fieldKey: null, page: 1, box, value: other.res.asset.id } })).status).toBe(400);
    for (let i = 0; i < 40; i++) await call({ op: "put", entry: { id: `fe-many-${String(i).padStart(6, "0")}`, kind: "text", fieldKey: null, page: 1, box, value: "あ" } });
    expect((await call({ op: "put", entry: { id: "fe-many-x00041", kind: "text", fieldKey: null, page: 1, box, value: "あ" } })).status).toBe(409);
  });

  it("画像の取り込み: JPEG・PNG だけ、自分の事業所の物だけ読める", async () => {
    const { objects, bucket, res } = await putAsset();
    const key = [...objects.keys()][0];
    expect(key).toBe(`forms/${OFFICE}/assets/${res.asset.id}.png`);
    const got = await assetGet(db, bucket, cm, res.asset.id);
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("image/png");
    expect(got.headers.get("Cache-Control")).toBe("private, no-store");
    const otherOffice = { ...cm, office: { id: "office-x", name: "x", kind: "regular" as const } };
    expect((await assetGet(db, bucket, otherOffice, res.asset.id)).status).toBe(404);
    expect((await assetGet(db, bucket, null, res.asset.id)).status).toBe(401);
    const list = (await (await assetsGet(db, cm)).json()) as { assets: Array<{ id: string }> };
    expect(list.assets.map((a) => a.id)).toEqual([res.asset.id]);
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    const bad = new FormData();
    bad.set("file", new Blob([new TextEncoder().encode("%PDF-1.7 x")]), "a.pdf");
    bad.set("name", "x");
    bad.set("kind", "map");
    bad.set("width", "1");
    bad.set("height", "1");
    expect((await assetsPost(db, bucket, cm, bad, NOW)).status).toBe(400);
    // 紙に置く画像は Claude に送らない（取り込みの受け口は Claude を呼ぶ層を読まない）
    expect(readRepoFile("lib/forms/form-assets.ts")).not.toMatch(/from "\.\.\/claude|askJson/);
    expect(readRepoFile("components/forms/PaperFill.tsx")).not.toMatch(/\/api\/forms\/read|\/api\/intake\/(read|extract)/);
  });
});

describe("壁", () => {
  it("ケアマネの役で自分の事業所の人だけ。医療班・ログインなしは断る", async () => {
    expect((await call({ op: "remove", id: "fe-x-0000001" }, null)).status).toBe(401);
    expect((await call({ op: "remove", id: "fe-x-0000001" }, medical)).status).toBe(403);
    sqlite.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-other', '他', 'regular', '架空市')");
    const other = { ...cm, office: { id: "office-other", name: "他", kind: "regular" as const }, accountId: null };
    expect((await call({ op: "remove", id: "fe-x-0000001" }, other)).status).toBe(404);
    expect((await handleEntries(db, cm, { op: "remove", personId: "p-01", formId: "mapped:fm-none", id: "fe-x-0000001" }, NOW)).status).toBe(404);
  });

  it("書ける人でなければ欄の一覧を作らない（紙には手入れが効く）", async () => {
    await call({ op: "put", entry: { id: "fe-num-000001", kind: "field", fieldKey: "f101", page: null, box: null, value: JSON.stringify("B-1") } });
    const rows = await rowsOf();
    const r = await mappedPaper(db, { rows, officeId: OFFICE, mappingId: MAPPING_ID, mapping: mapping(), images: IMAGES, opts: OPTS, overlay: true, edit: false });
    expect(r.fill).toBeNull();
    expect(textsOf(r.overlay!, "f101").flatMap((t) => t.lines)).toEqual(["B-1"]);
  });
});

describe("紙から質問", () => {
  it("この紙の空いた欄で台帳に項目のある欄の問いだけ（列の順のまま）。文で答える問いは出さない", async () => {
    const p = await paper();
    const all = questionQueue(p.rows);
    const qs = p.fill!.questions;
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThan(all.length);
    const keys = new Set(p.fill!.slots.filter((s) => s.empty && s.dest === "ledger").flatMap((s) => s.asks ?? []));
    for (const q of qs) {
      expect(keys.has(q.key), q.key).toBe(true);
      expect(q.answer.kind).not.toBe("free");
    }
    // 列の順
    const order = all.map((q) => q.key);
    expect(qs.map((q) => order.indexOf(q.key))).toEqual([...qs.map((q) => order.indexOf(q.key))].sort((a, b) => a - b));
    // 様式だけの欄（台帳に項目が無い）は問いにならない
    expect(paperQuestions(all, p.fill!.slots.filter((s) => s.dest === "form"))).toEqual([]);
  });

  it("「不明」「次回」は今の決まりのまま残り、問いから外れる", async () => {
    const p0 = await paper();
    const q = p0.fill!.questions[0];
    await call({ op: "ledger", fieldKeys: [], version: p0.rows.person.version!, edit: false, changes: answerChanges(q, { kind: "pending", status: "unknown" })! });
    const p1 = await paper();
    expect(p1.fill!.questions.some((x) => x.key === q.key)).toBe(false);
    expect(JSON.stringify(JSON.parse(p1.rows.person.ledger).pending ?? [])).toContain(q.key);
  });
});

describe("計画書（原本の枠の紙）", () => {
  it("まつやま総合防災マップからの引用は様式だけの欄（□ を押して印、帯の手書きから外れる）", async () => {
    const rows = await rowsOf();
    const manifest: OriginalManifest = {
      id: "matsuyama",
      sha256: ORIGINALS.matsuyama.sha256,
      pages: ORIGINALS.matsuyama.usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
      importedAt: "2026-11-05T00:00:00.000Z",
    };
    const sheet = buildMatsuyamaSheet(rows, OPTS);
    const r0 = await matsuyamaPaper(db, { rows, officeId: OFFICE, sheet, manifest, routeMap: null, edit: true });
    const slot = slotOf(r0.fill!.slots, "route.map");
    expect(slot).toMatchObject({ dest: "form", input: { kind: "choice" } });
    const res = await handleEntries(db, cm, { op: "put", personId: "p-01", formId: "matsuyama", entry: { id: "fe-rmap-00001", kind: "field", fieldKey: "route.map", page: null, box: null, value: JSON.stringify(["なし"]) } }, NOW);
    expect(res.status).toBe(200);
    const r1 = await matsuyamaPaper(db, { rows, officeId: OFFICE, sheet, manifest, routeMap: null, edit: true });
    const cell = r1.sheet.cells["route.map"];
    expect(cell.kind === "choice" && cell.options.find((o) => o.label === "なし")?.on).toBe(true);
    expect(r1.framed!.pages[1].items.some((i) => i.kind === "mark" && i.fieldId.startsWith("route.map"))).toBe(true);
    // 台帳の欄（避難先）はその場で、入れ子の値（薬）は窓
    expect(slotOf(r1.fill!.slots, "shelter.city.place").input.kind).toBe("text");
    const drugs = r1.fill!.slots.find((x) => x.label.includes("医薬品情報"))!;
    expect(drugs.input.kind).toBe("window");
    expect(drugs.target!.inputs.some((i) => i.kind === "page")).toBe(true);
    // 計画書の様式だけの欄でない欄は断る
    const bad = await handleEntries(db, cm, { op: "put", personId: "p-01", formId: "matsuyama", entry: { id: "fe-rmap-00002", kind: "field", fieldKey: "shelter.city.place", page: null, box: null, value: JSON.stringify("x") } }, NOW);
    expect(bad.status).toBe(400);
  });
});

describe("migration 0031 と戻し", () => {
  it("デモ事業所の戻しで手入れと画像の行が消える", async () => {
    await call({ op: "put", entry: { id: "fe-num-000001", kind: "field", fieldKey: "f101", page: null, box: null, value: JSON.stringify("1") } });
    const { demoResetStatements } = await import("../seed/reset.ts");
    for (const s of demoResetStatements(NOW.toISOString())) sqlite.exec(s);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM form_entries").get() as { n: number }).n).toBe(0);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM form_assets").get() as { n: number }).n).toBe(0);
  });
});

// ---------- 印刷の PDF で同じ位置 ----------

/** 4×2 の赤い PNG（画像の取り込みと紙の画像の確かめ） */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAAASFvFNAAAAEklEQVR4nGP4z8AARMjkfyQOAPBnC/U0KwZlAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
);

const chrome = chromePath();

describe.skipIf(!chrome)("印刷の PDF: 文字の枠と画像が置いた位置に出る", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  }, 120_000);

  it("PDF の字は枠の矩形の中、画像は置いた矩形の中（±0.5mm）", async () => {
    const white = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1413" height="2000"><rect width="100%" height="100%" fill="#fff"/></svg>');
    const pic = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    const entries: FormEntry[] = [
      { id: "fe-pdf-text-1", kind: "text", fieldKey: null, page: 1, box: { x: 0.12, y: 0.3, w: 0.35, h: 0.04 }, value: "鍵は玄関の植木鉢の下", by: null, at: "" },
      { id: "fe-pdf-img-01", kind: "image", fieldKey: null, page: 1, box: { x: 0.55, y: 0.6, w: 0.3, h: 0.08 }, value: "as-0000000000000001", by: null, at: "" },
    ];
    const base: Sheet = {
      personId: "p-01",
      name: "架空",
      title: "架空の様式",
      issuer: "架空",
      typeface: "gothic",
      pages: [{ page: 1, landscape: false, image: { x: 0, y: 0, w: 210, h: 297 }, items: [], fills: [] }],
      annex: [],
      unconfirmed: [],
      unmapped: [],
      withheld: [],
    };
    const sheet = withFreeItems(base, entries, new Map([["as-0000000000000001", { id: "as-0000000000000001", name: "地図", src: pic }]]), FONT_MAX_PT);
    const body = renderToStaticMarkup(createElement(OverlaySheet, { sheet, imageSrc: () => white, checked: "" }));
    await page.setContent(paperPage(body, paperCss()), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // 画像の矩形（DOM の mm）
    const rect = await page.evaluate(() => {
      const img = document.querySelector<HTMLElement>("img.ov-picture")!;
      const sec = img.closest("section")!.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const mm = 96 / 25.4;
      return { x: (r.left - sec.left) / mm, y: (r.top - sec.top) / mm, w: r.width / mm, h: r.height / mm };
    });
    expect(rect.x).toBeCloseTo(0.55 * 210, 0);
    expect(rect.y).toBeCloseTo(0.6 * 297, 0);
    expect(Math.abs(rect.w - 0.3 * 210)).toBeLessThan(0.5);
    const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: pdf.slice(), disableFontFace: true }).promise;
    const p1 = await doc.getPage(1);
    const pageH = p1.getViewport({ scale: 1 }).height;
    const tc = await p1.getTextContent();
    const MM_PT = 72 / 25.4;
    const texts = tc.items.flatMap((i) => ("str" in i && i.str.trim() !== "" ? [{ str: i.str, x: i.transform[4], y: pageH - i.transform[5], w: i.width }] : []));
    const ours = texts.filter((t) => "鍵は玄関の植木鉢の下".includes(t.str.trim()));
    expect(ours.length).toBeGreaterThan(0);
    const b = entries[0].box!;
    for (const t of ours) {
      expect(t.x).toBeGreaterThanOrEqual(b.x * 210 * MM_PT - 0.5 * MM_PT);
      expect(t.x + t.w).toBeLessThanOrEqual((b.x + b.w) * 210 * MM_PT + 0.5 * MM_PT);
      expect(t.y).toBeGreaterThanOrEqual(b.y * 297 * MM_PT - 0.5 * MM_PT);
      expect(t.y).toBeLessThanOrEqual((b.y + b.h) * 297 * MM_PT + 0.5 * MM_PT);
    }
    // 画像は PDF に描かれる（頁の上の画像の数が下の様式の画像と置いた画像の 2 つ）
    const ops = await p1.getOperatorList();
    const paints = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
    expect(paints).toBeGreaterThanOrEqual(1);
    await doc.cleanup();
  }, 120_000);
});
