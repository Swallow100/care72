// T168: 評価の 8 回目の書類で残った物。どれも架空の頁と種の人で確かめる（原本の絵は使わない）。
// 1. 刷ってある小さな字のかけらを電話の区切りと読み、連絡先が置けなかった
// 2. 手段の値が「その他」でも、補記が 1 つの手段を言っていればその手段の □
// 3. □ だけに読んだ欄の中身（アレルギーの物の名前）を書く所が紙に無かった
import { describe, expect, it } from "vitest";
import { packInk, type InkBlob } from "./ink.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { FormMapping, MappingField } from "./mapping.ts";
import { soleCodeOfText } from "./option-values.ts";
import { buildOverlaySheet, inkPhoneParts, type PlaceCtx } from "./overlay-sheet.ts";
import { buildMappedSheet, type MappedSheet } from "./mapped-sheet.ts";
import { value, t } from "./matsuyama.ts";
import type { PageImage } from "./page-images.ts";
import { seedRows } from "./print-harness.ts";

const IMAGE = { x: 0, y: 0, w: 297, h: 210 };
const W = 1 / IMAGE.w;
const H = 1 / IMAGE.h;
const blob = (xMm: number, yMm: number, wMm: number, hMm: number): InkBlob => ({ x: xMm * W, y: yMm * H, w: wMm * W, h: hMm * H, box: false });
const pc = (ink: InkBlob[], others: PlaceCtx["others"] = []): PlaceCtx => ({ page: { page: 1, landscape: true, image: IMAGE, items: [], fills: [] }, ink, others });

let n = 0;
const field = (over: Partial<MappingField>): MappingField => ({
  id: `f${++n}`,
  page: 1,
  section: "",
  label: "欄",
  position: "",
  shape: "text",
  options: [],
  item: null,
  removed: false,
  ai: null,
  ...over,
});

/** 欄の左上に刷ってある小さな見出し（「住所・連絡先」の形）の字のかたまり。かけらの中に横に細い物が 2 つある */
const PRINTED_LABEL = (x: number, y: number): InkBlob[] => [
  blob(x + 0.3, y + 0.2, 0.6, 2.1),
  blob(x + 0.9, y + 0.3, 1.5, 1.9),
  blob(x + 2.5, y + 0.3, 0.9, 0.1),
  blob(x + 2.5, y + 0.8, 0.9, 1.3),
  blob(x + 3.4, y + 0.3, 1.0, 1.9),
  blob(x + 5.5, y + 1.1, 0.3, 0.4),
  blob(x + 6.9, y + 0.4, 0.3, 0.3),
  blob(x + 7.4, y + 0.3, 1.3, 1.6),
  blob(x + 6.8, y + 1.2, 2.1, 1.0),
  blob(x + 9.0, y + 0.2, 1.9, 2.1),
  blob(x + 11.1, y + 0.3, 2.1, 1.9),
];

describe("電話の欄の刷ってある区切り", () => {
  const box = { x: 72 * W, y: 167 * H, w: 66 * W, h: 10.5 * H };
  const phone = () => field({ label: "連絡先", shape: "phone", item: "emergency2.phone", box });

  it("見出しの字のかけらを区切りと読まない", () => {
    expect(inkPhoneParts(phone(), ["090-0000-0012"], pc(PRINTED_LABEL(72.5, 167.1)))).toBeNull();
  });

  it("字の間でない本当の「　−　−　」は今までどおり分ける。見出しが一緒に刷ってあっても", () => {
    const dashes = [blob(95, 172, 2.2, 0.4), blob(115, 172, 2.2, 0.4)];
    const items = inkPhoneParts(phone(), ["090-0000-0012"], pc([...PRINTED_LABEL(72.5, 167.1), ...dashes])) as Exclude<ReturnType<typeof inkPhoneParts>, null | "fail">;
    expect(items.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["090", "0000", "0012"]);
  });

  it("高さの違う所にある 2 つの細い印は区切りの組にしない", () => {
    expect(inkPhoneParts(phone(), ["090-0000-0012"], pc([blob(95, 168, 2.2, 0.4), blob(115, 175, 2.2, 0.4)]))).toBeNull();
  });

  it("2 つの区切りの間に字があれば分けない", () => {
    expect(inkPhoneParts(phone(), ["090-0000-0012"], pc([blob(95, 172, 2.2, 0.4), blob(105, 170, 3, 3), blob(115, 172, 2.2, 0.4)]))).toBeNull();
  });

  it("括弧の組: 間に字のある縦の線は括弧にしない", () => {
    const low = { ...box, h: 6 * H };
    const f = field({ label: "電話", shape: "phone", box: low });
    const strokes = [blob(80, 168, 0.5, 2.1), blob(84, 168.1, 1.5, 1.9), blob(90, 168, 0.5, 2.1)];
    expect(inkPhoneParts(f, ["089-000-0001"], pc(strokes))).toBeNull();
    const parens = [blob(80, 168, 0.5, 2.1), blob(90, 168, 0.5, 2.1)];
    const items = inkPhoneParts(f, ["089-000-0001"], pc(parens)) as Exclude<ReturnType<typeof inkPhoneParts>, null | "fail">;
    expect(items.flatMap((i) => (i.kind === "text" ? i.lines : []))).toEqual(["089", "000-0001"]);
  });

  it("同じ書く所に別の欄（住所）がある欄は区切りに分けない", () => {
    const dashes = [blob(95, 172, 2.2, 0.4), blob(115, 172, 2.2, 0.4)];
    const f = phone();
    expect(inkPhoneParts(f, ["090-0000-0012"], pc(dashes, [{ id: f.id, box }, { id: "addr", box }]))).toBeNull();
  });

  it("住所と連絡先が 1 つの書く所の欄で、番号が 1 つの人も住所と電話の両方が紙に出る", () => {
    const addr = field({ label: "住所", item: "emergency2.address", box });
    const tel = phone();
    const mapped: MappedSheet = {
      personId: "p",
      name: "架空",
      title: "架空の様式",
      issuer: "",
      pages: [{ page: 1, sections: [{ section: "", rows: [{ field: addr, cell: value([t("松山市 ほたる坂町")]) }, { field: tel, cell: value([t("090-0000-0012")]) }] }] }],
      fields: 2,
      unconfirmed: [],
      unmapped: [],
      withheld: [],
    };
    const image: PageImage = { page: 1, width: 2970, height: 2100, bytes: 1, ink: packInk(PRINTED_LABEL(72.5, 167.1)) };
    const sheet = buildOverlaySheet(mapped, [image]);
    expect(sheet.unplacedIds ?? []).toEqual([]);
    const texts = sheet.pages[0].items.flatMap((i) => (i.kind === "text" ? i.lines : []));
    expect(texts).toContain("090-0000-0012");
    expect(texts).toContain("松山市 ほたる坂町");
  });
});

describe("手段の値が「その他」で補記が 1 つの手段を言う", () => {
  const P = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
  const cellOf = (kind: "other" | "foot", note: string | undefined, options: string[]) => {
    const p = P("p-04");
    const person = { ...p, ledger: { ...structuredClone(p.ledger), evacuation: { ...p.ledger.evacuation, transportKind: kind, transport: note } } };
    const f = field({ label: "【手段】", item: "evacuation.transport", shape: "choice", options });
    const m: FormMapping = { title: "架空の様式", issuer: "", pages: 1, fields: [f] };
    return buildMappedSheet(seedRows(person), m, { today: "2026-11-07", officeName: "デモ事業所" }).pages[0].sections[0].rows[0].cell;
  };
  const on = (c: ReturnType<typeof cellOf>) => (c.kind === "choice" ? c.options.filter((o) => o.on).map((o) => [o.label, o.detail]) : c.kind);

  it("歩いて → 徒歩の □ に印、補記はその選択肢に添える", () => {
    expect(on(cellOf("other", "民生委員と歩いて", ["徒歩", "その他"]))).toEqual([["徒歩", "民生委員と歩いて"]]);
  });
  it("徒歩の □ の無い様式は今までどおりその他の □", () => {
    expect(on(cellOf("other", "民生委員と歩いて", ["車", "その他"]))).toEqual([["その他", "民生委員と歩いて"]]);
  });
  it("手段を言わない・2 つ言う・言い換えの表の外の補記はその他のまま", () => {
    expect(on(cellOf("other", "近所の人に頼む", ["徒歩", "その他"]))).toEqual([["その他", "近所の人に頼む"]]);
    expect(on(cellOf("other", "息子の車で迎え", ["徒歩", "家族の車", "送迎", "その他"]))).toEqual([["その他", "息子の車で迎え"]]);
    expect(on(cellOf("other", "自転車", ["徒歩", "家族の車", "その他"]))).toEqual([["その他", "自転車"]]);
  });
  it("値が「その他」でない人は補記で替えない", () => {
    expect(on(cellOf("foot", "車を呼ぶ", ["徒歩", "家族の車", "その他"]))).toEqual([["徒歩", "車を呼ぶ"]]);
  });
  it("補記が 1 つだけ言う時のコード", () => {
    expect(soleCodeOfText("evacuation.transport", "民生委員と歩いて")).toBe("foot");
    expect(soleCodeOfText("evacuation.transport", "車椅子で")).toBe("wheelchair");
    expect(soleCodeOfText("evacuation.transport", "")).toBeNull();
  });
});
