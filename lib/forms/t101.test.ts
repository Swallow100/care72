// T101 原本の枠に値を置く紙（計画書〔松山市〕・医療要約〔災害診療記録2018〕）、未記入の色付け、避難経路の受け口、原本の取り込み。
// 原本の PDF はリポジトリに入れないので、ここのテストは原本の枠の寸法の表（lib/forms/frame-*.ts）と紙の中身を見る。
// 原本の罫線と照らすテストは t101-original.test.ts（原本が手元にあるときだけ）。印刷の頁の寸法は print-pages.test.ts。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlaySheet } from "../../components/forms/OverlaySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { KIROKU_FRAME } from "./frame-kiroku.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { kirokuFrameSheet, matsuyamaFrameSheet, ROUTE_MAP_BOX_MM, ROUTE_MAP_SLOT } from "./frame-build.ts";
import { buildFrameSheet, takeLines, type Frame } from "./frame-sheet.ts";
import { buildMatsuyamaSheet, MATSUYAMA_FIELDS, NONE, sub, t, value, type MatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary, MEDICAL_FIELDS, type MedicalSummary } from "./medical-summary.ts";
import {
  ORIGINALS,
  originalManifestKey,
  originalPageKey,
  parseManifest,
  pngFitsPage,
  pngSize,
  rasterScale,
  RASTER_MAX_PIXELS,
  sha256Hex,
  type OriginalManifest,
} from "./originals.ts";
import { loadOriginal, originalImportPost, originalPageGet, originalSourceGet, type OriginalBucket } from "./originals-http.ts";
import { ANNEX_MARK, FONT_MIN_PT, type OverlaySheet as Sheet } from "./overlay-sheet.ts";
import { seedRows } from "./print-harness.ts";
import { isUnconfirmedCell, matsuyamaUnconfirmed, medicalUnconfirmed } from "./unconfirmed.ts";
import type { Principal } from "../auth/principal.ts";

const TODAY = "2026-11-04";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const manifestOf = (id: "matsuyama" | "kiroku"): OriginalManifest => ({
  id,
  sha256: ORIGINALS[id].sha256,
  pages: ORIGINALS[id].usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-04T00:00:00.000Z",
});
const matsuyamaOf = (i: number): MatsuyamaSheet => buildMatsuyamaSheet(seedRows(SEED_PEOPLE[i]), OPTS);
const medicalOf = (i: number): MedicalSummary | null => {
  const r = buildMedicalSummary(seedRows(SEED_PEOPLE[i]), OPTS);
  return r.kind === "sheet" ? r.sheet : null;
};
const items = (s: Sheet) => s.pages.flatMap((p) => p.items.map((it) => ({ ...it, page: p.page })));
const textOf = (s: Sheet, fieldId: string) =>
  items(s)
    .filter((i) => i.kind === "text" && i.fieldId === fieldId)
    .flatMap((i) => (i.kind === "text" ? i.lines : []))
    .join("");

// ---------- 枠の寸法の表 ----------

describe("原本の枠の寸法の表", () => {
  const frames: Array<[string, Frame<string>]> = [
    ["松山市", MATSUYAMA_FRAME as Frame<string>],
    ["災害診療記録2018", KIROKU_FRAME as Frame<string>],
  ];
  it.each(frames)("%s: 矩形は頁の中、大きさは正", (_, frame) => {
    for (const s of [...frame.slots, ...frame.areas]) {
      const page = frame.pages.find((p) => p.page === s.page)!;
      expect(page).toBeTruthy();
      expect(s.box.w).toBeGreaterThan(0);
      expect(s.box.h).toBeGreaterThan(0);
      expect(s.box.x).toBeGreaterThanOrEqual(0);
      expect(s.box.y).toBeGreaterThanOrEqual(0);
      expect(s.box.x + s.box.w).toBeLessThanOrEqual(page.w);
      expect(s.box.y + s.box.h).toBeLessThanOrEqual(page.h);
    }
  });

  it("頁の大きさは原本の PDF の頁（ORIGINALS の pageMm）と同じ", () => {
    for (const p of MATSUYAMA_FRAME.pages) expect({ w: p.w, h: p.h }).toEqual(ORIGINALS.matsuyama.pageMm);
    for (const p of KIROKU_FRAME.pages) expect({ w: p.w, h: p.h }).toEqual(ORIGINALS.kiroku.pageMm);
    expect(MATSUYAMA_FRAME.pages.map((p) => p.page)).toEqual([...ORIGINALS.matsuyama.usePages]);
    expect(KIROKU_FRAME.pages.map((p) => p.page)).toEqual([...ORIGINALS.kiroku.usePages]);
  });

  it("松山市: 手で書く欄のほかは、どの欄にも書く所（字・□）がある。色付けの欄の矩形もある", () => {
    const placed = new Set(MATSUYAMA_FRAME.slots.flatMap((s) => (s.kind === "text" ? [...s.keys] : [s.key])));
    const areas = new Set(MATSUYAMA_FRAME.areas.flatMap((a) => [...a.keys]));
    for (const f of MATSUYAMA_FIELDS) {
      if (f.shape === "handwrite" || f.key === "head.date") continue;
      expect(placed.has(f.key), f.key).toBe(true);
      expect(areas.has(f.key), f.key).toBe(true);
    }
  });

  it("松山市: 選ぶ欄の □ は、その欄の選択肢（と中の選択肢）の名前", () => {
    for (const s of MATSUYAMA_FRAME.slots) {
      if (s.kind !== "mark" && s.kind !== "detail") continue;
      const def = MATSUYAMA_FIELDS.find((f) => f.key === s.key)!;
      const head = s.option.split("/")[0];
      // 実施者・組織の同意※は「同意」の □ だけ（様式に □ が 1 つ）
      const options: readonly string[] = "options" in def && def.options ? def.options : [];
      const known = [...options, "同意", "あり", "高齢者", "障がい者", "大正", "昭和", "平成", "令和"];
      expect(known.some((o) => o === head || o.startsWith(head)), `${s.key} ${s.option}`).toBe(true);
    }
  });

  it("災害診療記録2018: 医師が書く欄には書く所も色付けの矩形も無い", () => {
    const doctor = new Set(MEDICAL_FIELDS.filter((f) => "doctor" in f && f.doctor).map((f) => f.key as string));
    for (const s of KIROKU_FRAME.slots) expect(doctor.has(s.kind === "text" ? s.keys[0] : s.key)).toBe(false);
    for (const a of KIROKU_FRAME.areas) for (const k of a.keys) expect(doctor.has(k)).toBe(false);
  });
});

// ---------- 値の取り方 ----------

describe("値の取り方（take）", () => {
  it("氏名は最初の空白で分ける。年月日・元号・階・歳・1 字", () => {
    const name = value([t("山田 ハナ")]);
    expect(takeLines(name, { part: "family" })).toEqual(["山田"]);
    expect(takeLines(name, { part: "given" })).toEqual(["ハナ"]);
    expect(takeLines(value([t("ヤマダハナ")]), { part: "family" })).toEqual(["ヤマダハナ"]);
    expect(takeLines(value([t("ヤマダハナ")]), { part: "given" })).toEqual([]);
    const date = value([t("令和 8 年 11 月 4 日")]);
    expect(takeLines(date, { part: "ey" })).toEqual(["令和8"]);
    expect(takeLines(date, { part: "y" })).toEqual(["8"]);
    expect(takeLines(date, { part: "m" })).toEqual(["11"]);
    expect(takeLines(date, { part: "d" })).toEqual(["4"]);
    expect(takeLines(value([t("1940 年 3 月 2 日"), sub("昭和 15 年"), t("86 歳")]), { part: "age" })).toEqual(["86"]);
    expect(takeLines(value([t("2"), t("階")]), { part: "num" })).toEqual(["2"]);
    // 形が違えば全部（値を落とさない）
    expect(takeLines(value([t("1階 和室")]), { part: "num" })).toEqual(["1階 和室"]);
    expect(takeLines(value([t("19500908Mヤマダハナ")]), { part: "char", index: 8 })).toEqual(["M"]);
  });

  it("関係先の行は TEL の添えの前と後に分ける", () => {
    const c = value([t("鈴木"), sub("民生委員"), sub("TEL"), t("090-0000-0011")], [t("佐藤"), sub("TEL"), t("090-0000-0012")]);
    expect(takeLines(c, { line: 0, part: "name" })).toEqual(["鈴木 民生委員"]);
    expect(takeLines(c, { line: 0, part: "tel" })).toEqual(["090-0000-0011"]);
    expect(takeLines(c, { line: 1, part: "tel" })).toEqual(["090-0000-0012"]);
    expect(takeLines(NONE, { line: 1, part: "tel" })).toEqual([]);
  });
});

// ---------- 計画書（松山市） ----------

describe("計画書を原本の枠に", () => {
  it("頁は原本の 2 頁。頁の画像の箱は頁いっぱい（原本の余白は画像の中）", () => {
    const s = matsuyamaFrameSheet(matsuyamaOf(0), manifestOf("matsuyama"));
    expect(s.pages.map((p) => p.page)).toEqual([1, 2]);
    for (const p of s.pages) expect(p.image).toEqual({ x: 0, y: 0, w: 209.97, h: 296.93 });
  });

  it("種の 10 人で、欄の矩形（字・印・色付け）は人によって動かない（同じ欄はいつも同じ所）", () => {
    const at = new Map<string, string>();
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const s = matsuyamaFrameSheet(matsuyamaOf(i), manifestOf("matsuyama"));
      for (const it of items(s)) {
        const key = `${it.page}:${it.fieldId}`;
        const box = JSON.stringify(it.box);
        if (it.fieldId === "notes" || it.fieldId === "route.text") continue; // 避難経路は地図の有無で上を使う（下の受け口のテスト）
        if (at.has(key)) expect(box, key).toBe(at.get(key));
        else at.set(key, box);
      }
      for (const p of s.pages) {
        for (const f of p.fills) {
          const key = `${p.page}:fill:${f.keys[0]}:${JSON.stringify(f.box)}`;
          // 色付けの矩形は表の矩形のどれか（人で変わらない）
          expect(MATSUYAMA_FRAME.areas.some((a) => a.keys.includes(f.keys[0] as never))).toBe(true);
          at.set(key, key);
        }
      }
    }
  });

  it("氏名・生年月日・作成日を原本の所に分けて書く（刷ってある 年・月・日 は書かない）", () => {
    const sheet = matsuyamaOf(0);
    const s = matsuyamaFrameSheet(sheet, manifestOf("matsuyama"));
    const [family, given] = SEED_PEOPLE[0].person.name.split(/\s+/);
    expect(textOf(s, "target.name:family")).toBe(family);
    expect(textOf(s, "target.name:given")).toBe(given);
    expect(textOf(s, "head.date:ey")).toBe("令和8");
    expect(textOf(s, "head.date:m")).toBe("11");
    expect(textOf(s, "head.date:d")).toBe("4");
    // 生年月日: 元号は □ にレ点、年月日は数だけ
    const birthMarks = items(s).filter((i) => i.kind === "mark" && i.fieldId.startsWith("target.birth:"));
    expect(birthMarks).toHaveLength(1);
    expect(textOf(s, "target.birth:y")).toMatch(/^\d+$/);
  });

  it("選んだ選択肢の □ にレ点。□ の無い選択肢（高齢者・あり）は字を丸で囲む", () => {
    const s = matsuyamaFrameSheet(matsuyamaOf(0), manifestOf("matsuyama"));
    const marks = items(s).filter((i) => i.kind === "mark");
    expect(marks.length).toBeGreaterThan(3);
    const elderly = marks.find((m) => m.fieldId === "target.category:高齢者");
    if (elderly && elderly.kind === "mark") expect(elderly.mark).toBe("circle");
    const sex = marks.find((m) => m.fieldId.startsWith("target.sex:"));
    expect(sex && sex.kind === "mark" ? sex.mark : null).toBe("check");
  });

  it("未確認・手書き・同意の無い欄は空ける（紙に「未確認」を刷らない）", () => {
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const sheet = matsuyamaOf(i);
      const s = matsuyamaFrameSheet(sheet, manifestOf("matsuyama"));
      // 値の無い欄（kind unconfirmed）は何も書かない。値の中の未確認の印の言葉も書かない（台帳の文の中の字はそのまま）
      for (const f of MATSUYAMA_FIELDS) {
        if (sheet.cells[f.key].kind !== "unconfirmed") continue;
        expect(items(s).some((it) => it.kind === "text" && (it.fieldId === f.key || it.fieldId.startsWith(`${f.key}:`))), f.key).toBe(false);
      }
      for (const it of items(s)) if (it.kind === "text") expect(it.lines.some((l) => l.trim() === "未確認")).toBe(false);
      expect(items(s).some((it) => it.fieldId.startsWith("sign.") || it.fieldId.startsWith("city.") || it.fieldId.startsWith("head.number"))).toBe(false);
    }
  });

  it("収まらない値は欄に「別紙」、値は別紙の頁へ（値を落とさない）。別紙があれば特記事項の「別紙」は あり", () => {
    const sheet = matsuyamaOf(0);
    const long = "とても長い避難の課題の書き足し".repeat(30);
    const big: MatsuyamaSheet = { ...sheet, cells: { ...sheet.cells, "risk.issues": value([t(long)]) } };
    const s = matsuyamaFrameSheet(big, manifestOf("matsuyama"));
    expect(textOf(s, "risk.issues")).toBe(ANNEX_MARK);
    const row = s.annex.find((r) => r.fieldId === "risk.issues");
    expect(row?.lines.join("")).toBe(long);
    expect(row?.reason).toBe("overflow");
    expect(items(s).some((i) => i.fieldId === "notes.annex:あり")).toBe(true);
    expect(items(s).some((i) => i.fieldId === "notes.annex:なし")).toBe(false);
  });

  it("字は原本の地の大きさ（9.84pt）から 6pt まで", () => {
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const s = matsuyamaFrameSheet(matsuyamaOf(i), manifestOf("matsuyama"));
      for (const it of items(s)) {
        if (it.kind !== "text") continue;
        expect(it.fontPt).toBeLessThanOrEqual(MATSUYAMA_FRAME.maxPt);
        expect(it.fontPt).toBeGreaterThanOrEqual(FONT_MIN_PT);
      }
    }
  });

  it("様式に置き場の無い値（2 人目からの関係先・□ の無い書き足し）は特記事項に名前つきで足す", () => {
    const sheet = matsuyamaOf(0);
    const extra: MatsuyamaSheet = {
      ...sheet,
      cells: {
        ...sheet.cells,
        "local.welfare": value([t("鈴木"), sub("TEL"), t("090-0000-0021")], [t("高橋"), sub("TEL"), t("090-0000-0022")]),
      },
    };
    const s = matsuyamaFrameSheet(extra, manifestOf("matsuyama"));
    expect(textOf(s, "local.welfare:name0")).toBe("鈴木");
    expect(textOf(s, "local.welfare:tel0")).toBe("090-0000-0021");
    const notes = textOf(s, "notes") + s.annex.map((r) => r.lines.join("")).join("");
    expect(notes).toContain("高橋");
  });
});

// ---------- 未記入の色付け ----------

describe("未記入の色付け（帯の未確認と同じ欄）", () => {
  it("松山市: 塗る欄は帯の未確認の欄と同じ（種の 10 人）", () => {
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const sheet = matsuyamaOf(i);
      const s = matsuyamaFrameSheet(sheet, manifestOf("matsuyama"));
      const filled = new Set(s.pages.flatMap((p) => p.fills.flatMap((f) => f.keys)));
      const want = new Set(MATSUYAMA_FIELDS.filter((f) => f.shape !== "handwrite" && isUnconfirmedCell(sheet.cells[f.key])).map((f) => f.key as string));
      expect([...filled].sort()).toEqual([...want].sort());
      expect(want.size).toBe(matsuyamaUnconfirmed(sheet).count);
    }
  });

  it("医療要約: 塗る欄は帯の未確認の欄と同じ", () => {
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const sheet = medicalOf(i);
      if (!sheet) continue;
      const s = kirokuFrameSheet(sheet, manifestOf("kiroku"));
      const filled = new Set(s.pages.flatMap((p) => p.fills.flatMap((f) => f.keys)));
      const placed = new Set(KIROKU_FRAME.areas.flatMap((a) => [...a.keys] as string[]));
      // 枠の無い欄（既往症など、別紙の物）は塗る所が無い
      const want = medicalUnconfirmed(sheet).fields.length;
      expect(filled.size).toBeLessThanOrEqual(want);
      for (const k of filled) expect(placed.has(k)).toBe(true);
    }
  });

  it("塗りは欄の矩形の内側（罫線から 0.45mm 離す）", () => {
    const s = matsuyamaFrameSheet(matsuyamaOf(0), manifestOf("matsuyama"));
    for (const p of s.pages) {
      for (const f of p.fills) {
        const area = MATSUYAMA_FRAME.areas.find((a) => a.page === p.page && a.keys.includes(f.keys[0] as never) && Math.abs(a.box.x + 0.45 - f.box.x * p.image.w) < 0.01)!;
        expect(area).toBeTruthy();
        expect(f.box.y * p.image.h).toBeCloseTo(area.box.y + 0.45, 2);
        expect(f.box.w * p.image.w).toBeCloseTo(area.box.w - 0.9, 2);
      }
    }
  });

  it("紙面: 既定は塗りを描かない。色付けの版だけ .ov-fill（欄の id つき）", () => {
    const s = matsuyamaFrameSheet(matsuyamaOf(0), manifestOf("matsuyama"));
    const plain = renderToStaticMarkup(createElement(OverlaySheet, { sheet: s, imageSrc: (n: number) => `/p/${n}.png`, checked: "", kind: "matsuyama" }));
    const filled = renderToStaticMarkup(createElement(OverlaySheet, { sheet: s, imageSrc: (n: number) => `/p/${n}.png`, checked: "", kind: "matsuyama", fill: true }));
    expect(plain).not.toContain("ov-fill");
    const count = s.pages.reduce((n, p) => n + p.fills.length, 0);
    expect(count).toBeGreaterThan(0);
    expect((filled.match(/class="ov-fill"/g) ?? []).length).toBe(count);
    expect(filled).toContain('data-fill="1"');
    expect(filled).toContain("data-fill-keys=");
  });
});

// ---------- 避難経路の受け口（T102） ----------

describe("避難経路の地図の受け口", () => {
  it("地図が無ければ空ける。渡せば避難経路の欄に画像（文があれば欄の上 12mm を文に）", () => {
    const sheet = matsuyamaOf(0);
    const none = matsuyamaFrameSheet(sheet, manifestOf("matsuyama"));
    expect(items(none).some((i) => i.kind === "image")).toBe(false);
    const withMap = matsuyamaFrameSheet(sheet, manifestOf("matsuyama"), { routeMap: { src: "data:image/png;base64,AAAA", alt: "避難経路の地図" } });
    const pic = items(withMap).find((i) => i.kind === "image");
    expect(pic?.page).toBe(2);
    if (pic?.kind !== "image") throw new Error("画像が無い");
    expect(pic.slot).toBe(ROUTE_MAP_SLOT);
    expect(pic.box.w * 209.97).toBeCloseTo(ROUTE_MAP_BOX_MM.w, 1);
    const text = items(withMap).find((i) => i.kind === "text" && i.fieldId === "route.text");
    const h = pic.box.h * 296.93;
    if (text) expect(h).toBeCloseTo(ROUTE_MAP_BOX_MM.withTextH, 1);
    else expect(h).toBeCloseTo(ROUTE_MAP_BOX_MM.h, 1);
    const html = renderToStaticMarkup(createElement(OverlaySheet, { sheet: withMap, imageSrc: () => "/p.png", checked: "" }));
    expect(html).toContain('data-slot="route-map"');
    expect(html).toContain('alt="避難経路の地図"');
  });
});

// ---------- 医療要約（災害診療記録2018） ----------

describe("医療要約を災害診療記録2018 の 1 頁目の枠に", () => {
  it("頁は 1 頁目だけ。医師が書く欄は空ける。メディカル ID は 1 字ずつの枠に、性別は M・F を丸で", () => {
    const sheet = medicalOf(0)!;
    const s = kirokuFrameSheet(sheet, manifestOf("kiroku"));
    expect(s.pages.map((p) => p.page)).toEqual([1]);
    expect(items(s).some((i) => i.fieldId.startsWith("doctor."))).toBe(false);
    const id = sheet.medicalId.id!;
    const chars = [...id];
    for (const [i, ch] of chars.entries()) {
      if (i === 8) continue;
      expect(textOf(s, `id.medical:char${i}`), `${i}`).toBe(ch);
    }
    expect(items(s).some((i) => i.fieldId === `id.medical:=8:${chars[8]}`)).toBe(true);
  });

  it("様式に置き場の無い値（薬の用量・持出品など）は別紙へ（値を落とさない）", () => {
    for (let i = 0; i < SEED_PEOPLE.length; i++) {
      const sheet = medicalOf(i);
      if (!sheet) continue;
      const s = kirokuFrameSheet(sheet, manifestOf("kiroku"));
      for (const key of ["meds.list", "meds.carry", "patient.dwelling"] as const) {
        const lines = takeLines(sheet.cells[key], undefined);
        if (lines.length === 0) continue;
        expect(s.annex.find((r) => r.fieldId === `${key}:extra`)?.lines, `${i} ${key}`).toEqual(lines);
      }
    }
  });

  it("範囲の外の欄（医療班の画面の住所・電話）は書かない", () => {
    const r = buildMedicalSummary(seedRows(SEED_PEOPLE[0]), { ...OPTS, view: { hide: ["patient.address", "patient.phone"] } });
    if (r.kind !== "sheet") throw new Error("同意が無い");
    const s = kirokuFrameSheet(r.sheet, manifestOf("kiroku"));
    expect(textOf(s, "patient.address")).toBe("");
    expect(textOf(s, "patient.phone")).toBe("");
  });
});

// ---------- 原本の取り込み ----------

const PNG_HEAD = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
};

function fakeBucket(): OriginalBucket & { store: Map<string, Uint8Array | string> } {
  const store = new Map<string, Uint8Array | string>();
  return {
    store,
    async put(key, value) {
      store.set(key, value);
    },
    async get(key) {
      const v = store.get(key);
      if (v === undefined) return null;
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
      return { body: bytes, size: bytes.length, text: async () => (typeof v === "string" ? v : new TextDecoder().decode(v)) };
    },
  };
}

const CM = { role: "care_manager", accountId: "a-1", office: { id: "office-x", name: "x" } } as unknown as Principal;
const MEDIC = { role: "medical", accountId: "a-2", office: null } as unknown as Principal;

describe("原本の取り込み", () => {
  it("PNG の大きさを読み、原本の頁の形（縦横の比 1%・長い辺 3,400px 以上）だけ通す", () => {
    expect(pngSize(PNG_HEAD(3307, 4677))).toEqual({ width: 3307, height: 4677 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngFitsPage({ width: 3307, height: 4677 }, ORIGINALS.matsuyama.pageMm)).toBe(true);
    expect(pngFitsPage({ width: 1414, height: 2000 }, ORIGINALS.matsuyama.pageMm)).toBe(false);
    expect(pngFitsPage({ width: 4677, height: 3307 }, ORIGINALS.matsuyama.pageMm)).toBe(false);
  });

  it("刷る解像度は 400dpi。iPhone の canvas の上限を超えるときは下げる", () => {
    expect(rasterScale(595.2, 841.68)).toBeCloseTo(400 / 72, 5);
    const s = rasterScale(595.2, 841.68, 10_000_000);
    expect(595.2 * s * 841.68 * s).toBeLessThanOrEqual(10_000_000 + 1);
    expect(595.2 * (400 / 72) * 841.68 * (400 / 72)).toBeLessThanOrEqual(RASTER_MAX_PIXELS);
  });

  it("版の違う PDF は断る（版相違）。合えば頁の PNG と記録を事業所の置き場に置き、読める", async () => {
    const bucket = fakeBucket();
    const bad = new FormData();
    bad.set("pdf", new Blob([new Uint8Array([1, 2, 3])]));
    const r1 = await originalImportPost(bucket, CM, "matsuyama", bad);
    expect(r1.status).toBe(409);
    expect(bucket.store.size).toBe(0);

    // 版のハッシュを偽の PDF に合わせる（本物の原本はリポジトリに無い）
    const pdf = new TextEncoder().encode("%PDF-1.7 fake");
    const spec = ORIGINALS.matsuyama;
    const saved = spec.sha256;
    (spec as { sha256: string }).sha256 = await sha256Hex(pdf);
    try {
      const form = new FormData();
      form.set("pdf", new Blob([pdf]));
      form.set("page1", new Blob([PNG_HEAD(3307, 4677)]));
      // 2 頁目が無ければ断る
      expect((await originalImportPost(bucket, CM, "matsuyama", form)).status).toBe(400);
      form.set("page2", new Blob([PNG_HEAD(1414, 2000)]));
      expect((await originalImportPost(bucket, CM, "matsuyama", form)).status).toBe(400);
      form.set("page2", new Blob([PNG_HEAD(3307, 4677)]));
      const ok = await originalImportPost(bucket, CM, "matsuyama", form, () => new Date("2026-11-04T12:00:00Z"));
      expect(ok.status).toBe(200);
      expect(bucket.store.has(originalPageKey("office-x", "matsuyama", 1))).toBe(true);
      expect(bucket.store.has(originalPageKey("office-x", "matsuyama", 2))).toBe(true);
      expect([...bucket.store.keys()].every((k) => k.startsWith("forms/office-x/originals/matsuyama/"))).toBe(true);
      // PDF は置かない
      expect([...bucket.store.values()].some((v) => typeof v !== "string" && new TextDecoder().decode(v).startsWith("%PDF"))).toBe(false);
      const m = await loadOriginal(bucket, "office-x", "matsuyama");
      expect(m?.pages.map((p) => p.page)).toEqual([1, 2]);
      const page = await originalPageGet(bucket, CM, "matsuyama", "1");
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toBe("image/png");
      expect(page.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      (spec as { sha256: string }).sha256 = saved;
    }
    // 版が変わった（記録のハッシュが今の版でない）ら原本なしとして扱う
    expect(await loadOriginal(bucket, "office-x", "matsuyama")).toBeNull();
  });

  it("壁: ログインなし 401、ケアマネの役でない 403、知らない原本・無い頁 404。ほかの事業所の置き場は読まない", async () => {
    const bucket = fakeBucket();
    expect((await originalPageGet(bucket, null, "matsuyama", "1")).status).toBe(401);
    expect((await originalPageGet(bucket, MEDIC, "matsuyama", "1")).status).toBe(403);
    expect((await originalPageGet(bucket, CM, "other", "1")).status).toBe(404);
    expect((await originalPageGet(bucket, CM, "matsuyama", "1")).status).toBe(404);
    bucket.store.set(originalManifestKey("office-y", "matsuyama"), JSON.stringify(manifestOf("matsuyama")));
    bucket.store.set(originalPageKey("office-y", "matsuyama", 1), PNG_HEAD(3307, 4677));
    expect((await originalPageGet(bucket, CM, "matsuyama", "1")).status).toBe(404);
  });

  it("公式の URL から取るのは ORIGINALS の url だけ。版が違えば 409、取れなければ 502", async () => {
    const asked: string[] = [];
    const fetcher = async (url: string) => {
      asked.push(url);
      return new Response(new Uint8Array([9, 9, 9]));
    };
    const r = await originalSourceGet(fetcher, CM, "kiroku");
    expect(r.status).toBe(409);
    expect(asked).toEqual([ORIGINALS.kiroku.url]);
    expect((await originalSourceGet(async () => new Response("x", { status: 500 }), CM, "kiroku")).status).toBe(502);
    expect((await originalSourceGet(async () => Promise.reject(new Error("x")), CM, "kiroku")).status).toBe(502);
    expect((await originalSourceGet(fetcher, MEDIC, "kiroku")).status).toBe(403);
  });

  it("記録の読み方: 頁が欠けた・知らない頁・版が違う記録は null", () => {
    const good = manifestOf("matsuyama");
    expect(parseManifest("matsuyama", JSON.stringify(good))?.pages).toHaveLength(2);
    expect(parseManifest("matsuyama", JSON.stringify({ ...good, pages: good.pages.slice(0, 1) }))).toBeNull();
    expect(parseManifest("matsuyama", JSON.stringify({ ...good, sha256: "0".repeat(64) }))).toBeNull();
    expect(parseManifest("kiroku", JSON.stringify({ ...manifestOf("kiroku"), pages: [{ page: 2, width: 1, height: 1, bytes: 1 }] }))).toBeNull();
    expect(parseManifest("matsuyama", "{")).toBeNull();
  });
});

// ---------- 組み立ての決まり（小さな枠で） ----------

describe("buildFrameSheet の決まり", () => {
  type K = "a" | "b" | "c";
  const frame: Frame<K> = {
    original: "matsuyama",
    pages: [{ page: 1, w: 100, h: 100 }],
    maxPt: 9,
    extras: "free",
    slots: [
      { kind: "text", keys: ["a"], page: 1, box: { x: 10, y: 10, w: 30, h: 6 } },
      { kind: "mark", key: "b", page: 1, option: "はい", box: { x: 10, y: 20, w: 3, h: 3 } },
      { kind: "text", keys: [], page: 1, box: { x: 10, y: 40, w: 80, h: 30 }, id: "free" },
    ],
    areas: [
      { keys: ["a"], page: 1, box: { x: 9, y: 9, w: 32, h: 8 }, ruled: true },
      { keys: ["b"], page: 1, box: { x: 9, y: 19, w: 20, h: 5 }, ruled: true },
    ],
  };
  const fields = [
    { key: "a" as const, label: "欄A" },
    { key: "b" as const, label: "欄B" },
    { key: "c" as const, label: "欄C" },
  ];
  const base = { frame, personId: "p", name: "n", title: "t", issuer: "i", fields, pages: [1], unconfirmed: [], withheld: [] };

  it("□ の無い選択肢と枠の無い欄は書き込みの欄に名前つきで", () => {
    const s = buildFrameSheet<K>({
      ...base,
      cells: {
        a: value([t("あ")]),
        b: { kind: "choice", options: [{ label: "はい", on: false }, { label: "いいえ", on: true }] },
        c: value([t("しい")]),
      },
    });
    expect(textOf(s, "free")).toBe("欄B いいえ欄C しい");
  });

  it("書き込みの欄が無い様式は別紙へ（欄ごとに 1 行）", () => {
    const s = buildFrameSheet<K>({
      ...base,
      frame: { ...frame, extras: undefined, slots: frame.slots.slice(0, 2) },
      cells: { a: value([t("あ")]), b: NONE, c: value([t("し")], [t("い")]) },
    });
    expect(s.annex).toEqual([{ fieldId: "c:extra", label: "欄C", lines: ["し", "い"], reason: "unplaced" }]);
  });
});

describe("避難経路の地図の受け口（前からの紙面）", () => {
  it("原本を取り込む前の紙面にも、渡したときだけ避難経路の段に画像", async () => {
    const { MatsuyamaSheet } = await import("../../components/forms/MatsuyamaSheet.tsx");
    const sheet = matsuyamaOf(0);
    const none = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet }));
    expect(none).not.toContain('data-slot="route-map"');
    const withMap = renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet, routeMap: { src: "/m.png", alt: "避難経路の地図" } }));
    const route = withMap.slice(withMap.indexOf('data-block="route"'));
    expect(route).toContain('data-slot="route-map"');
    expect(route).toContain('src="/m.png"');
  });
});
