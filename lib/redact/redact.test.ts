// 写真・PDF を送る前に塗って隠す（T52）の純な計算のテスト。
// 画面（components/person/RedactSheet.tsx）は描くだけで、座標・塗り・JPEG の中身の確かめはここ。

import { describe, expect, it } from "vitest";
import { fitView, imageToView, panView, viewToImage, zoomAt, ZOOM_MAX, type Frame } from "./view.ts";
import { hitRect, rectFromDrag, redactReducer, initialRedact, totalHidden, unpainted, MIN_RECT_PX, type Rect } from "./rects.ts";
import { outputSize, paintRects, PAINT_PAD, OUTPUT_MAX_SIDE } from "./paint.ts";
import { hasJpegMetadata, isJpeg, jpegSegments, stripJpegMetadata } from "./jpeg.ts";

const frame: Frame = { w: 400, h: 300 };
const image = { w: 2000, h: 1000 };

describe("表示の座標（拡大した座標 → 画像の座標）", () => {
  it("全体の表示は枠に収まり、真ん中に置く", () => {
    const v = fitView(frame, image);
    // 幅で収まる（400/2000 = 0.2）。高さは 200 で上下に 50 ずつ
    expect(v.scale).toBeCloseTo(0.2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(50);
    expect(viewToImage(v, { x: 0, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(viewToImage(v, { x: 400, y: 250 })).toEqual({ x: 2000, y: 1000 });
  });

  it("拡大しても、押した所の下の画像の点は動かない。行きと帰りが合う", () => {
    const v0 = fitView(frame, image);
    const at = { x: 100, y: 120 };
    const before = viewToImage(v0, at);
    const v1 = zoomAt(v0, frame, image, 4, at);
    expect(v1.zoom).toBe(4);
    const after = viewToImage(v1, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    const back = imageToView(v1, after);
    expect(back.x).toBeCloseTo(at.x);
    expect(back.y).toBeCloseTo(at.y);
  });

  it("拡大は 1〜上限、拡大中は画像が枠を外れない（端で止まる）。全体の大きさでは動かない", () => {
    const v0 = fitView(frame, image);
    expect(zoomAt(v0, frame, image, 0.2, { x: 0, y: 0 }).zoom).toBe(1);
    expect(zoomAt(v0, frame, image, 99, { x: 0, y: 0 }).zoom).toBe(ZOOM_MAX);
    // 全体の大きさで送っても真ん中のまま
    expect(panView(v0, frame, image, 300, 300)).toEqual(v0);
    const v2 = zoomAt(v0, frame, image, 2, { x: 200, y: 150 });
    // 右下へ大きく送ると、画像の左上が枠の左上で止まる
    const p = panView(v2, frame, image, 5000, 5000);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    const q = panView(v2, frame, image, -5000, -5000);
    expect(q.x).toBeCloseTo(frame.w - image.w * q.scale);
    expect(q.y).toBeCloseTo(frame.h - image.h * q.scale);
  });
});

describe("四角", () => {
  const v = fitView(frame, image);

  it("引いた向きによらず左上と大きさにし、画像の外は切る", () => {
    const r = rectFromDrag(v, image, { x: 300, y: 200 }, { x: 100, y: 100 });
    expect(r).toEqual({ x: 500, y: 250, w: 1000, h: 500 });
    // 画像の外まで引いた所は画像の端で切る
    const c = rectFromDrag(v, image, { x: -50, y: 0 }, { x: 40, y: 80 });
    expect(c).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });

  it("小さすぎる四角（押しただけ・指の揺れ）は作らない", () => {
    expect(rectFromDrag(v, image, { x: 100, y: 100 }, { x: 100.5, y: 100.5 })).toBeNull();
    expect(MIN_RECT_PX).toBeGreaterThan(0);
  });

  it("押した所の四角は上に描いた物から選ぶ", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 50, y: 50, w: 100, h: 100 },
    ];
    expect(hitRect(rects, { x: 60, y: 60 })).toBe(1);
    expect(hitRect(rects, { x: 10, y: 10 })).toBe(0);
    expect(hitRect(rects, { x: 500, y: 500 })).toBe(-1);
  });

  it("足す・外す・一手戻す・全解除。戻すと前の頁の形に戻る", () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
    const b: Rect = { x: 20, y: 20, w: 10, h: 10 };
    let s = initialRedact(["p1", "p2"]);
    s = redactReducer(s, { type: "add", page: "p1", rect: a });
    s = redactReducer(s, { type: "add", page: "p2", rect: b });
    s = redactReducer(s, { type: "add", page: "p1", rect: b });
    expect(s.rects.p1).toEqual([a, b]);
    expect(totalHidden(s)).toBe(3);
    s = redactReducer(s, { type: "remove", page: "p1", index: 0 });
    expect(s.rects.p1).toEqual([b]);
    s = redactReducer(s, { type: "clear", page: "p1" });
    expect(s.rects.p1).toEqual([]);
    // 全解除を戻す → 外すを戻す → 足すを戻す
    s = redactReducer(s, { type: "undo" });
    expect(s.rects.p1).toEqual([b]);
    s = redactReducer(s, { type: "undo" });
    expect(s.rects.p1).toEqual([a, b]);
    s = redactReducer(s, { type: "undo" });
    expect(s.rects.p1).toEqual([a]);
    expect(s.lastPage).toBe("p1");
    s = redactReducer(s, { type: "undo" });
    expect(s.rects.p2).toEqual([]);
    expect(s.lastPage).toBe("p2");
    // 戻す物が無ければそのまま
    const same = redactReducer(redactReducer(s, { type: "undo" }), { type: "undo" });
    expect(same.past).toHaveLength(0);
    // 何も無い頁の全解除・無い番号の外すは手に数えない
    expect(redactReducer(s, { type: "clear", page: "p2" }).past).toHaveLength(s.past.length);
    expect(redactReducer(s, { type: "remove", page: "p1", index: 9 }).past).toHaveLength(s.past.length);
  });

  it("塗らずに送る頁を拾う（送る前の確認「隠す所なし」に出す）", () => {
    let s = initialRedact([]);
    const pages = ["p1", "p2", "p3"];
    expect(unpainted(s, pages)).toEqual(["p1", "p2", "p3"]);
    s = redactReducer(s, { type: "add", page: "p2", rect: { x: 0, y: 0, w: 5, h: 5 } });
    expect(unpainted(s, pages)).toEqual(["p1", "p3"]);
    // 一手戻すと、また塗っていない頁に
    expect(unpainted(redactReducer(s, { type: "undo" }), pages)).toEqual(pages);
  });
});

describe("塗り", () => {
  it("塗った四角の中のピクセルは黒、外は元のまま。端は余白の分だけ広げて塗る", () => {
    const w = 20;
    const h = 10;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    paintRects(data, w, h, [{ x: 5.5, y: 3.2, w: 4, h: 2 }]);
    const at = (x: number, y: number) => [...data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
    // 中は黒（透明でない）
    for (let y = 3; y <= 5; y++) for (let x = 5; x <= 9; x++) expect(at(x, y)).toEqual([0, 0, 0, 255]);
    // 余白の分は塗る
    expect(at(5 - PAINT_PAD, 3)).toEqual([0, 0, 0, 255]);
    // 遠くは元のまま
    expect(at(0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(19, 9)).toEqual([255, 255, 255, 255]);
  });

  it("画像の外にはみ出した四角でも、配列の外を書かない", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    paintRects(data, 4, 4, [{ x: -10, y: -10, w: 100, h: 100 }]);
    expect([...data].every((v, i) => (i % 4 === 3 ? v === 255 : v === 0))).toBe(true);
    expect(data.length).toBe(64);
  });

  it("送る大きさは長い辺を上限に縮め、縦横の比を保つ（小さい物は拡げない）", () => {
    expect(outputSize(4000, 3000)).toEqual({ w: OUTPUT_MAX_SIDE, h: 1500, ratio: 0.5 });
    expect(outputSize(800, 600)).toEqual({ w: 800, h: 600, ratio: 1 });
  });
});

// ---------- JPEG ----------

/** 区切り（FF xx）と長さ付きの中身 */
const seg = (marker: number, body: number[]) => [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const JFIF = seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const EXIF = seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("MM"), 0, 42, 0, 0, 0, 8, 0x47, 0x50, 0x53]); // 位置の欄の代わり
const XMP = seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<x/>")]);
const COMMENT = seg(0xfe, ascii("iPhone"));
const DQT = seg(0xdb, [0, ...new Array(64).fill(1)]);
// 走査の頭（SOS）のあとは圧縮の中身。FF 00 と再開の印（FF D0）を含む
const SCAN = [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];

const jpeg = (...parts: number[][]) => new Uint8Array(parts.flat());

describe("JPEG の付け足し（EXIF の位置・端末）", () => {
  it("中身の頭で JPEG を見分ける", () => {
    expect(isJpeg(jpeg(SOI, JFIF, DQT, SCAN, EOI))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new TextEncoder().encode("%PDF-1.7"))).toBe(false);
  });

  it("EXIF・XMP・コメントがあれば見つけ、canvas の出す形（JFIF だけ）には無い", () => {
    expect(hasJpegMetadata(jpeg(SOI, JFIF, DQT, SCAN, EOI))).toBe(false);
    expect(hasJpegMetadata(jpeg(SOI, EXIF, DQT, SCAN, EOI))).toBe(true);
    expect(hasJpegMetadata(jpeg(SOI, JFIF, XMP, DQT, SCAN, EOI))).toBe(true);
    expect(hasJpegMetadata(jpeg(SOI, JFIF, COMMENT, DQT, SCAN, EOI))).toBe(true);
    // 壊れた形（長さが外へ出る）は「ある」と見る（通さない側に倒す）
    expect(hasJpegMetadata(new Uint8Array([...SOI, 0xff, 0xe0, 0xff, 0xff, 1]))).toBe(true);
  });

  it("EXIF・XMP・コメントを外し、ほかの区切りと圧縮の中身はそのまま残す", () => {
    const raw = jpeg(SOI, EXIF, JFIF, COMMENT, XMP, DQT, SCAN, EOI);
    const out = stripJpegMetadata(raw);
    expect(hasJpegMetadata(out)).toBe(false);
    expect([...out]).toEqual([...SOI, ...JFIF, ...DQT, ...SCAN, ...EOI]);
    // 文字の「Exif」「GPS」が残らない
    const text = new TextDecoder("latin1").decode(out);
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("GPS");
    expect(jpegSegments(out)!.map((s) => s.marker)).toEqual([0xd8, 0xe0, 0xdb, 0xda]);
  });
});
