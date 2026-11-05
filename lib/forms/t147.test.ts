// T147 書類の画面の分かりにくい所の直し（docs/tasks/T147.md、docs/progress/t147.md）。
// 架空の様式（こもれび市、lib/forms/komorebi-form.fixture.ts）と種の架空の 10 人を手元の D1（node:sqlite）に入れて確かめる。Claude は呼ばない。

import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { FillToggle, FILL_LABELS as TOGGLE_LABELS } from "../../components/forms/FillToggle.tsx";
import { Form9Paper, FORM9_PREVIEW_LABEL } from "../../components/forms/Form9Paper.tsx";
import { SCROLL_LIST, SelectList } from "../../components/ui/Select.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadPersonPage } from "../person.ts";
import { readOptions } from "../ui/select.ts";
import { documentMenu } from "./document-list.ts";
import { handleEntries } from "./form-entries-http.ts";
import { boxPt, freeText, loadFormEntries, withFreeItems, withMatsuyamaEntries, type FormEntry } from "./form-entries.ts";
import type { Form9Sheet } from "./form9.ts";
import { komorebiReadResult } from "./komorebi-form.fixture.ts";
import { addedFormHref, checkReadResult, MAPPING_LABELS, type FormMapping } from "./mapping.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { MUNICIPAL_LABELS } from "./municipal-forms.ts";
import { FONT_MAX_PT, FONT_MIN_PT } from "./overlay-sheet.ts";
import { ORIGINALS, type OriginalManifest } from "./originals.ts";
import { paperEditData } from "./paper-edit.ts";
import { BOX_MIN_MM, FILL_LABELS, moveBox, resizeBox, type PaperSlot } from "./paper-fill.ts";
import { mappedPaper, matsuyamaPaper } from "./paper-fill-server.ts";
import { paperQuestions } from "./paper-slots.ts";
import { closePreview, previewPrint, PRINT_PREVIEW_ATTR, type PrintWindow } from "./print.ts";
import type { PageImage } from "./page-images.ts";
import { CAO_ENTRY, MATSUYAMA_ENTRY } from "./catalog.ts";

const OFFICE = "office-demo";
const MAPPING_ID = "fm-t147";
const FORM_ID = `mapped:${MAPPING_ID}` as const;
const OPTS = { today: "2026-11-06", officeName: "デモ事業所" };
const A4: PageImage = { page: 1, width: 1413, height: 2000, bytes: 1 };
const IMAGES: PageImage[] = [A4, { ...A4, page: 2 }];
const NOW = new Date("2026-11-06T01:00:00.000Z");
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

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

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const mapping = (): FormMapping => checkReadResult(komorebiReadResult("mincho")).mapping;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  const m = mapping();
  sqlite
    .prepare(
      `INSERT INTO form_mappings (id, office_id, title, form_hash, source_kind, mapping, status, created_at, checked_at, updated_at, page_images)
       VALUES (?, ?, ?, NULL, 'manual', ?, 'checked', ?, ?, ?, ?)`,
    )
    .run(MAPPING_ID, OFFICE, m.title, JSON.stringify(m), NOW.toISOString(), NOW.toISOString(), NOW.toISOString(), JSON.stringify(IMAGES));
});

const rowsOf = async (id = "p-01") => (await loadPersonPage(db, cm, id))!;
async function paper(personId = "p-01") {
  const rows = await rowsOf(personId);
  return { rows, ...(await mappedPaper(db, { rows, officeId: OFFICE, mappingId: MAPPING_ID, mapping: mapping(), images: IMAGES, opts: OPTS, overlay: true, edit: true })) };
}
const fieldId = (label: string, section?: string) => mapping().fields.find((f) => f.label === label && (section === undefined || f.section === section))!.id;
const slotOf = (slots: readonly PaperSlot[], key: string) => slots.find((s) => s.key === key)!;
const manifest: OriginalManifest = {
  id: "matsuyama",
  sha256: ORIGINALS.matsuyama.sha256,
  pages: ORIGINALS.matsuyama.usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-05T00:00:00.000Z",
};
const call = async (body: Record<string, unknown>, formId: string = FORM_ID) => {
  const r = await handleEntries(db, cm, { personId: "p-01", formId, ...body }, NOW);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("1. 地域の一覧は一覧の中だけで送る", () => {
  it("scrollList の一覧は高さを画面の 6 割までにし、端で周りの画面を送らない。既定の一覧は今のまま", () => {
    const model = readOptions(Array.from({ length: 47 }, (_, i) => createElement("option", { key: i, value: String(i) }, `県${i}`)));
    const shown = model.items.map((_, i) => i);
    const base = { id: "l", model, shown, values: ["0"], active: 0, multiple: false, search: null };
    const scroll = renderToStaticMarkup(createElement(SelectList, { ...base, scroll: true }));
    expect(SCROLL_LIST).toContain("overscroll-contain");
    expect(SCROLL_LIST).toContain("overflow-y-auto");
    for (const c of SCROLL_LIST.split(" ")) expect(scroll).toContain(c);
    expect(scroll).toContain("data-scroll");
    const plain = renderToStaticMarkup(createElement(SelectList, base));
    expect(plain).not.toContain("overscroll-contain");
    expect(plain).not.toContain("data-scroll");
  });

  it("地域選択の都道府県・市町村の選ぶ所が scrollList", () => {
    const src = read("../../components/forms/mapping/MunicipalPicker.tsx");
    expect(src.match(/scrollList/g)?.length).toBe(2);
  });
});

describe("2. 様式の読み取りは「読込」", () => {
  it("読み取りの操作と地域選択の取り込みは読込。黒塗りの画面の送るボタンは様式から開いた時だけ読込（入れる欄は送信のまま）", () => {
    expect([MAPPING_LABELS.read, MAPPING_LABELS.reading]).toEqual(["読込", "読込中"]);
    expect([MUNICIPAL_LABELS.fetch, MUNICIPAL_LABELS.aiRead, MUNICIPAL_LABELS.retry]).toEqual(["読込", "AI読込", "再読込"]);
    expect(read("../../components/forms/mapping/FormReadPanel.tsx")).toContain("sendLabel={L.read}");
    const redact = read("../../components/person/RedactSheet.tsx");
    expect(redact).toContain("sendLabel = L.send");
    expect(read("../../components/person/Intake.tsx")).not.toContain("sendLabel");
  });

  it("手作成は AI が使えない時・読込に失敗した時だけ開いて出し、ふだんは畳む", () => {
    const src = read("../../components/forms/mapping/FormReadPanel.tsx");
    expect(src).toContain("const showManual = !aiReady || fail !== null || manualOpen;");
    expect(src).toContain("data-manual-toggle");
  });
});

describe("3・4. 様式 9 の見出し・印刷の見本・空欄の色", () => {
  it("様式 9 の画面は何の紙かの見出しで、刷る紙を画面にも出す（印刷見本）。ほかの所は印刷のときだけ", async () => {
    const page = read("../../app/office/form9/page.tsx");
    expect(page).toContain('title: "災害時利用者一覧表"');
    expect(page).toContain("onScreen");
    const sheet: Form9Sheet = { mode: "normal", rows: [] };
    const props = { sheet, office: "デモ事業所", date: "令和8年11月6日", order: "平時", report: null };
    const screen = renderToStaticMarkup(createElement(Form9Paper, { ...props, onScreen: true }));
    expect(screen).toContain(FORM9_PREVIEW_LABEL);
    expect(screen).not.toContain('class="print-only"');
    const printOnly = renderToStaticMarkup(createElement(Form9Paper, props));
    expect(printOnly).toContain('class="print-only"');
    expect(printOnly).not.toContain(FORM9_PREVIEW_LABEL);
  });

  it("印刷は見本を出してから印刷の画面を 1 回開く（書体を読み終えてから）。閉じると見本の印を外す", async () => {
    const order: string[] = [];
    const attrs = new Map<string, string>();
    let fontsDone = false;
    const win = {
      location: { href: "http://localhost/office/form9" },
      history: { replaceState: () => undefined },
      document: {
        fonts: { ready: new Promise((r) => setTimeout(r, 5)).then(() => void (fontsDone = true)) },
        images: [],
        querySelectorAll: () => [],
        documentElement: { setAttribute: (n: string, v: string) => void attrs.set(n, v) },
      },
      scrollTo: () => order.push("scroll"),
      print: () => order.push(fontsDone ? "print" : "print-early"),
    } as PrintWindow & { scrollTo: () => void; document: PrintWindow["document"] & { documentElement: { setAttribute(n: string, v: string): void } } };
    expect(await previewPrint(win)).toBe(true);
    expect(order).toEqual(["scroll", "print"]);
    expect(attrs.get(PRINT_PREVIEW_ATTR)).toBe("1");
    closePreview({ documentElement: { removeAttribute: (n: string) => void attrs.delete(n) } });
    expect(attrs.has(PRINT_PREVIEW_ATTR)).toBe(false);
    // 見本の間は @media print と同じ物を画面でも隠し、印刷だけの物を出す。見本の帯は残す
    const css = read("../../components/forms/paper.css");
    expect(css).toContain("html[data-print-preview] .print-only");
    expect(css).toContain(":not(.print-preview-bar)");
    expect(css).toContain("html[data-print-preview] .pf-layer");
    // 層が隠れる見本では、紙の上に置いた文字の枠と画像（紙の物）を出す
    expect(css).toContain("html[data-print-preview] [data-paper-fill] .ov-img [data-free]");
    const button = read("../../components/ui/PrintButton.tsx");
    expect(button).toContain("previewPrint(window)");
  });

  it("空欄の色は 2 つの版を並べて今の版に印（色なしが既定・提出用）", () => {
    expect([TOGGLE_LABELS.off, TOGGLE_LABELS.on]).toEqual(["色なし", "空欄着色"]);
    const off = renderToStaticMarkup(createElement(FillToggle, { here: "/office/form9", fill: false }));
    expect(off).toMatch(/aria-current="true"[^>]*data-fill-option="off"/);
    expect(off).toContain('href="/office/form9?fill=1"');
    const on = renderToStaticMarkup(createElement(FillToggle, { here: "/office/form9", fill: true }));
    expect(on).toMatch(/aria-current="true"[^>]*data-fill-option="on"/);
    expect(on).toContain('href="/office/form9"');
  });
});

describe("5. 足した様式の出方", () => {
  it("確認済の対応表は計画書の段の上に「追加済」、下書きは「下書き」で確かめの画面へ、元からある様式はその下", () => {
    const options = [
      { id: "matsuyama" as const, entry: MATSUYAMA_ENTRY },
      { id: "cao" as const, entry: CAO_ENTRY },
      { id: "mapping:fm-a" as const, entry: { ...CAO_ENTRY, id: "mapping:fm-a", short: "金沢風（架空）" } },
    ];
    const menu = documentMenu(options as never, "matsuyama", { doc: "plan", form: options[0] } as never, [{ id: "fm-d", title: "下書きの様式", issuer: "架空市" }]);
    expect(menu.plan.map((m) => [m.key, m.mark ?? null])).toEqual([
      ["mapping:fm-a", "added"],
      ["draft:fm-d", "draft"],
      ["matsuyama", null],
      ["cao", null],
    ]);
    expect(menu.plan[1].href).toBe("/forms/mapping/fm-d");
    expect(addedFormHref("fm-a")).toBe("/forms?form=mapping%3Afm-a&added=1");
  });

  it("事業所の画面から様式9 と使用様式の段を外し、書類の画面に（既定設定・CSV 出力）", () => {
    const office = read("../../app/office/page.tsx");
    expect(office).not.toContain("Form9Section");
    expect(office).not.toContain("FormChoice");
    const forms = read("../../app/forms/page.tsx");
    expect(forms).toContain("setDefault=");
    expect(forms).toContain("FORM9_CSV_PATH");
    expect(read("../../components/forms/mapping/MappingEditor.tsx")).toContain("addedFormHref(id)");
  });
});

describe("7. 紙の上の言葉", () => {
  it("「印」は入力箇所、行き先は台帳保存・様式のみ、取消は一手戻す（窓の取消と取り違えない）", () => {
    expect(FILL_LABELS.marks).toBe("入力箇所");
    expect([FILL_LABELS.toLedger, FILL_LABELS.toForm]).toEqual(["台帳保存", "様式のみ"]);
    expect([FILL_LABELS.undo, FILL_LABELS.redo]).toEqual(["一手戻す", "一手進む"]);
    expect([FILL_LABELS.addText, FILL_LABELS.addImage, FILL_LABELS.place, FILL_LABELS.upload]).toEqual(["文字追加", "画像追加", "位置選択", "画像取込"]);
    // 2〜4 字（「本人のページ」は画面の名前、確かめの窓の本文は除く）
    const skip = new Set(["page", "leave"]);
    for (const [k, v] of Object.entries(FILL_LABELS)) if (!skip.has(k)) expect([...v].length, `${k} ${v}`).toBeLessThanOrEqual(4);
  });
});

describe("8. 欄を押してその場で書く（台帳の 1 か所に書けない欄は様式のみ）", () => {
  it("添付の様式: 本人の氏名・住所は窓でなくその場の字で、様式のみ（本人のページへの道）。打ち込みの欄の無い窓は出さない", async () => {
    const p = await paper();
    const s = p.fill!.slots;
    for (const label of ["氏名", "住所"]) {
      const slot = slotOf(s, fieldId(label, "本人"));
      expect(slot, label).toMatchObject({ dest: "form", input: { kind: "text" }, pageLink: { href: "/people/p-01" } });
      // 今の紙の字が初めの値（台帳の値をそのまま直せる）
      expect(typeof slot.value === "string" && slot.value.length > 0, label).toBe(true);
    }
    // 同意の欄は紙では選ばない（本人のページの同意の面への道の窓だけ）
    const items = new Map(mapping().fields.map((f) => [f.id, f.item]));
    for (const w of s.filter((x) => x.input.kind === "window")) {
      if (items.get(w.key)?.startsWith("consent.")) continue;
      const writable = w.target!.inputs.some((i) => i.kind !== "page") || w.target!.text !== undefined;
      expect(writable, w.label).toBe(true);
    }
    // □ の欄（医療機器を使っている）も、元が本人のページの面への道だけなら □ を押して様式のみ（今の紙の印が初めの値）
    const device = s.find((x) => x.label.includes("医療機器"));
    if (device) expect(device).toMatchObject({ dest: "form", pageLink: { href: "/people/p-01" } });
  });

  it("様式のみで入れた氏名は紙に刷られ、台帳は変わらない。ほかの人・様式に効かない", async () => {
    const p0 = await paper();
    const slot = slotOf(p0.fill!.slots, fieldId("氏名", "本人"));
    const before = p0.rows.person.name;
    const r = await call({ op: "put", entry: { id: "fe-name-00001", kind: "field", fieldKey: slot.key, page: null, box: null, value: JSON.stringify("架空 様式名") } });
    expect(r.status).toBe(200);
    const p1 = await paper();
    expect(slotOf(p1.fill!.slots, slot.key)).toMatchObject({ value: "架空 様式名", entryId: "fe-name-00001", hand: { by: "山本" } });
    const texts = p1.overlay!.pages.flatMap((pg) => pg.items).filter((i) => i.kind === "text" && i.fieldId === slot.key);
    expect(texts.map((t) => (t.kind === "text" ? t.lines.join("") : "")).join("")).toContain("架空");
    expect((await rowsOf()).person.name).toBe(before);
    const other = await paper("p-02");
    expect(slotOf(other.fill!.slots, slot.key).entryId).toBeUndefined();
  });

  it("台帳に無い欄で問いがあれば、様式のみの欄でも質問に出る（質問で台帳を埋められる）", async () => {
    const p = await paper("p-01");
    const pageAsk = p.fill!.slots.filter((s) => s.pageLink && s.gap === "ask" && (s.asks ?? []).length > 0);
    const qs = paperQuestions((await import("../intake/ask.ts")).questionQueue(p.rows), p.fill!.slots);
    for (const s of pageAsk) for (const k of s.asks!) expect(qs.map((q) => q.key), s.label).toContain(k);
  });

  it("計画書（原本の枠の紙）: 氏名（氏と名）・住所はその場の字で様式のみ。入れると紙の氏と名に分けて刷る", async () => {
    const rows = await rowsOf();
    const m0 = await matsuyamaPaper(db, { rows, officeId: OFFICE, sheet: buildMatsuyamaSheet(rows, OPTS), manifest, routeMap: null, edit: true });
    for (const key of ["target.name", "target.address"]) {
      expect(slotOf(m0.fill!.slots, key), key).toMatchObject({ dest: "form", input: { kind: "text" }, pageLink: { href: "/people/p-01" } });
    }
    const r = await call({ op: "put", entry: { id: "fe-tname-0001", kind: "field", fieldKey: "target.name", page: null, box: null, value: JSON.stringify("架空 様式") } }, "matsuyama");
    expect(r.status).toBe(200);
    const m1 = await matsuyamaPaper(db, { rows, officeId: OFFICE, sheet: buildMatsuyamaSheet(rows, OPTS), manifest, routeMap: null, edit: true });
    const cell = m1.sheet.cells["target.name"];
    expect(cell.kind === "value" && cell.lines.flat().map((x) => x.text).join("")).toBe("架空 様式");
    const items = m1.framed!.pages[0].items.filter((i) => i.kind === "text" && i.fieldId.startsWith("target.name"));
    expect(items.map((i) => (i.kind === "text" ? i.lines.join("") : ""))).toEqual(expect.arrayContaining(["架空", "様式"]));
    // 選ぶ欄・同意・手書き・元の無い欄の様式のみの字は受けない
    for (const key of ["target.sex", "consent.registry", "sign.self", "no.such", "shelter.city.place"]) {
      const bad = await call({ op: "put", entry: { id: `fe-bad-${key.replace(/[^A-Za-z]/g, "")}`, kind: "field", fieldKey: key, page: null, box: null, value: JSON.stringify("x") } }, "matsuyama");
      expect(bad.status, key).toBe(400);
    }
  });

  it("計画書（前からの紙面）: 本人のページへの道だけの字の欄は、窓の中で打てる今の紙の字を持つ", async () => {
    const rows = await rowsOf();
    const sheet = withMatsuyamaEntries(buildMatsuyamaSheet(rows, OPTS), []);
    const data = paperEditData(rows, { cells: sheet.cells, entries: [] });
    const name = data.targets.find((t) => t.key === "target.name")!;
    expect(name.inputs.every((i) => i.kind === "page")).toBe(true);
    expect(name.text).toBe(rows.person.name);
    // 台帳に書ける欄（性別の □ など）は text を持たない
    expect(data.targets.find((t) => t.key === "target.sex")?.text).toBeUndefined();
    // 手入れのある欄は id を持つ（消すとき）
    const entry: FormEntry = { id: "fe-tname-0002", kind: "field", fieldKey: "target.name", page: null, box: null, value: JSON.stringify("架空 様式"), by: "山本", at: NOW.toISOString() };
    const withEntry = paperEditData(rows, { cells: withMatsuyamaEntries(sheet, [entry]).cells, entries: [entry] });
    expect(withEntry.targets.find((t) => t.key === "target.name")).toMatchObject({ text: "架空 様式", entryId: "fe-tname-0002" });
  });
});

describe("9・10. 質問の面と保存", () => {
  it("質問の面は聞く問いがあれば開いて出す（開いた直後は紙を送らない）。帯に保存と保存の状態。未保存のまま離れる時は確かめる", () => {
    const src = read("../../components/forms/PaperFill.tsx");
    expect(src).toContain("useState(() => data.questions.length > 0)");
    expect(src).toContain("!askScroll.current");
    expect(src).toContain("data-fill-save");
    expect(src).toContain("data-save-state={saveState}");
    expect(src).toContain("useLeaveGuard(leaveRef, root)");
    const guard = read("../../components/forms/leave-guard.ts");
    expect(guard).toContain('addEventListener("beforeunload"');
    expect(guard).toContain("appConfirm(L.leave");
    expect([FILL_LABELS.saved, FILL_LABELS.saving, FILL_LABELS.unsaved, FILL_LABELS.failed]).toEqual(["保存済", "保存中", "未保存", "保存失敗"]);
  });
});

describe("11. 文字の枠の大きさと場所", () => {
  const page = { w: 210, h: 297 };
  const box = { x: 0.2, y: 0.2, w: 0.3, h: 0.05 };

  it("本体をつまむと動き、頁の外へ出ない", () => {
    expect(moveBox(box, 0.1, 0.05)).toEqual({ x: 0.3, y: 0.25, w: 0.3, h: 0.05 });
    expect(moveBox(box, 1, 1)).toEqual({ x: 0.7, y: 0.95, w: 0.3, h: 0.05 });
    expect(moveBox(box, -1, -1)).toMatchObject({ x: 0, y: 0 });
  });

  it("4 つの角と 4 つの辺: つまんだ辺だけが動き、反対の辺は留まる。下限より小さくしない", () => {
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const e = resizeBox(box, "e", 0.1, 0.3, page);
    expect(e).toMatchObject({ x: 0.2, y: 0.2, h: 0.05 });
    expect(e.w).toBeCloseTo(0.4, 6);
    const w = resizeBox(box, "w", 0.1, 0, page);
    expect(w.x + w.w).toBeCloseTo(right, 6);
    expect(w.x).toBeCloseTo(0.3, 6);
    const n = resizeBox(box, "n", 0, -0.05, page);
    expect(n.y + n.h).toBeCloseTo(bottom, 6);
    expect(n.y).toBeCloseTo(0.15, 6);
    const nw = resizeBox(box, "nw", -0.1, -0.1, page);
    expect(nw.x + nw.w).toBeCloseTo(right, 6);
    expect(nw.y + nw.h).toBeCloseTo(bottom, 6);
    const tiny = resizeBox(box, "se", -1, -1, page);
    expect(tiny.w * page.w).toBeCloseTo(BOX_MIN_MM.w, 1);
    expect(tiny.h * page.h).toBeCloseTo(BOX_MIN_MM.h, 1);
    const out = resizeBox(box, "se", 5, 5, page);
    expect(out.x + out.w).toBeLessThanOrEqual(1);
    expect(out.y + out.h).toBeLessThanOrEqual(1);
  });

  it("画像は角で縦横の比を保つ", () => {
    const img = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    const r = resizeBox(img, "se", 0.1, 0.4, page, true);
    expect(r.h / r.w).toBeCloseTo(0.5, 4);
    expect(r.w).toBeCloseTo(0.3, 6);
  });

  it("字の大きさを選べる（上限として効き、入らなければ縮む・下限 6pt）。表には box の中に持ち、PDF も同じ大きさ", async () => {
    const put = async (pt: number | null | undefined, id = "fe-text-00001") =>
      call({ op: "put", entry: { id, kind: "text", fieldKey: null, page: 1, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.08 }, value: "架空の書き足し", ...(pt !== undefined ? { pt } : {}) } });
    expect((await put(16)).status).toBe(200);
    let entries = await loadFormEntries(db, OFFICE, "p-01", FORM_ID);
    expect(entries.find((e) => e.id === "fe-text-00001")).toMatchObject({ pt: 16, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.08 } });
    const raw = sqlite.prepare("SELECT box FROM form_entries WHERE id = 'fe-text-00001'").get() as { box: string };
    expect(JSON.parse(raw.box)).toMatchObject({ pt: 16 });
    // 紙（PDF と同じ描き方）の字は選んだ大きさ（入れば）
    const p = await paper();
    const item = p.overlay!.pages[0].items.find((i) => i.kind === "text" && i.fieldId === "free:fe-text-00001");
    expect(item?.kind === "text" && item.fontPt).toBe(16);
    // 自動に戻す（null）と紙の欄と同じ上限
    expect((await put(null)).status).toBe(200);
    entries = await loadFormEntries(db, OFFICE, "p-01", FORM_ID);
    expect(entries.find((e) => e.id === "fe-text-00001")?.pt).toBeUndefined();
    // 入らなければ縮む・下限 6pt。選べる上限の外は断る
    const big = freeText("架空の長い書き足し".repeat(20), 30, 8, 24);
    expect(big!.fontPt).toBeGreaterThanOrEqual(FONT_MIN_PT);
    expect(big!.fontPt).toBeLessThan(24);
    expect((await put(30, "fe-text-00002")).status).toBe(400);
    expect(boxPt({ pt: 5 })).toBeNull();
    expect(boxPt({ pt: 12 })).toBe(12);
    // 画像の矩形の pt は持たない
    const sheet = withFreeItems(p.overlay!, [{ id: "x", kind: "text", fieldKey: null, page: 1, box: { x: 0, y: 0, w: 0.5, h: 0.05 }, value: "架空", by: null, at: "", pt: null }], new Map(), FONT_MAX_PT);
    expect(sheet.pages[0].items.some((i) => i.kind === "text" && i.fieldId === "free:x")).toBe(true);
  });
});

describe("12. 様式 9 の紙の上で書く（行の人ごと）", () => {
  it("行の欄に書いた字はその行の人の手入れで、表・紙・CSV の値に効く。ほかの人には効かない。空にすると表の値に戻る", async () => {
    const { form9Slots, loadForm9Entries, withForm9Entries, FORM9_FILL_COLS } = await import("./form9-fill.ts");
    const { loadForm9 } = await import("./form9-db.ts");
    const scope = { officeId: OFFICE };
    const data = (await loadForm9(db, scope, { today: OPTS.today, situation: null }))!;
    const first = data.sheet.rows[0];
    const second = data.sheet.rows[1];
    const put = (personId: string, col: string, value: string, id = "fe-f9-000001") =>
      handleEntries(db, cm, { op: "put", personId, formId: "form9", entry: { id, kind: "field", fieldKey: col, page: null, box: null, value: JSON.stringify(value) } }, NOW);
    expect((await put(first.id, "notes", "架空の特記（紙で）")).status).toBe(200);
    // 知らない列・No の列は断る
    expect((await put(first.id, "no", "1", "fe-f9-000002")).status).toBe(400);
    expect((await put(first.id, "color", "赤", "fe-f9-000003")).status).toBe(400);
    const entries = await loadForm9Entries(db, OFFICE);
    const sheet = withForm9Entries(data.sheet, entries);
    expect(sheet.rows[0].cells.notes).toBe("架空の特記（紙で）");
    expect(sheet.rows[1].cells.notes).toBe(second.cells.notes);
    // 紙の欄: 行ごと・列ごと（No のほか 11 列）。1 行目の特記は手入れの id と誰がいつ
    const slots = form9Slots(sheet, entries);
    expect(FORM9_FILL_COLS.length).toBe(11);
    expect(slots.length).toBe(sheet.rows.length * 11);
    const s = slots.find((x) => x.personId === first.id && x.col === "notes")!;
    expect(s).toMatchObject({ sheet: 0, first: 1, value: "架空の特記（紙で）", entryId: "fe-f9-000001", hand: { by: "山本" } });
    // 2 行目の欄は 1 行目の 1 つ下（行の高さ）
    const s2 = slots.find((x) => x.personId === second.id && x.col === "notes")!;
    expect(s2.box.y - s.box.y).toBeCloseTo(s.box.h, 1);
    // 取り消すと表の値に戻る
    expect((await handleEntries(db, cm, { op: "remove", personId: first.id, formId: "form9", id: "fe-f9-000001" }, NOW)).status).toBe(200);
    expect(withForm9Entries(data.sheet, await loadForm9Entries(db, OFFICE)).rows[0].cells.notes).toBe(first.cells.notes);
    // 画面: 印刷見本に層を置き、書ける人は Form9Fill で包む。CSV も同じ値
    expect(read("../../app/office/form9/page.tsx")).toContain("<Form9Fill slots={form9Slots(sheet, entries)}>");
    expect(read("../../app/office/form9/csv/route.ts")).toContain("withForm9Entries(loaded.sheet");
    // 包みも刷る物（main の直接の子）なので、印刷と見本で画面の表・見出しを隠す規則が効く
    expect(read("../../components/forms/Form9Fill.tsx")).toMatch(/data-form9-fill data-paper-print/);
    expect(read("../../components/forms/paper.css")).toContain("main:has(> [data-paper-print]) > :not([data-paper-print])");
  });
});
