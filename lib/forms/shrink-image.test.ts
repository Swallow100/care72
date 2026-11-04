// T68 の 7: 写真を端末で縮める。寸法の計算・形の判定・名前は純な関数でテストする（canvas で縮める本体はブラウザだけ）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jpegName, SHRINK_QUALITY, SHRINK_SIDES, shrinkSize, sniffKind } from "./shrink-image.ts";

describe("縮める寸法（shrinkSize）", () => {
  it("長い辺を上限に収め、縦横の比を保つ。小さい物は拡げない", () => {
    // iPhone の 12M の写真（横・縦）
    expect(shrinkSize(4032, 3024, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(shrinkSize(3024, 4032, 2000)).toEqual({ w: 1500, h: 2000 });
    expect(shrinkSize(4032, 3024, 1400)).toEqual({ w: 1400, h: 1050 });
    expect(shrinkSize(1200, 800, 2000)).toEqual({ w: 1200, h: 800 });
    expect(shrinkSize(2000, 10, 2000)).toEqual({ w: 2000, h: 10 });
    // 細長い物も 1 px より小さくしない
    expect(shrinkSize(40000, 3, 2000)).toEqual({ w: 2000, h: 1 });
    expect(shrinkSize(0, 100, 2000)).toEqual({ w: 0, h: 0 });
  });

  it("1 回目は 2,000 px、上限を超えれば 1,400 px。品質 0.85", () => {
    expect(SHRINK_SIDES).toEqual([2000, 1400]);
    expect(SHRINK_QUALITY).toBe(0.85);
  });
});

describe("形の判定（sniffKind）", () => {
  const head = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 8));
  it("JPEG・PNG・PDF は中身の頭で決め、ほか（HEIC・WebP・GIF・空）は null", () => {
    expect(sniffKind(head(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffKind(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffKind(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    // HEIC は 4 バイト目から ftypheic
    expect(sniffKind(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
    expect(sniffKind(new TextEncoder().encode("RIFF\0\0\0\0"))).toBeNull();
    expect(sniffKind(new TextEncoder().encode("GIF89a\0\0"))).toBeNull();
    expect(sniffKind(new Uint8Array(0))).toBeNull();
  });

  it("名前は拡張子を .jpg に", () => {
    expect(jpegName("IMG_0001.HEIC.png")).toBe("IMG_0001.HEIC.jpg");
    expect(jpegName("様式.png")).toBe("様式.jpg");
    expect(jpegName("photo")).toBe("photo.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
  });
});

describe("使う所（様式の読み取りと入れる欄の写真）", () => {
  it("様式の読み取りも入れる欄も、縮めてから黒塗りの画面へ（T83。生のファイルは送らない）", () => {
    const panel = readFileSync(new URL("../../components/forms/mapping/FormReadPanel.tsx", import.meta.url), "utf8");
    expect(panel.indexOf("shrinkImage(file, Number.POSITIVE_INFINITY)")).toBeGreaterThan(0);
    expect(panel.indexOf("shrinkImage(file, Number.POSITIVE_INFINITY)")).toBeLessThan(panel.indexOf("setRedacting([shrunk.file])"));
    expect(panel).not.toContain('body.append("file"');
    const intake = readFileSync(new URL("../../components/person/Intake.tsx", import.meta.url), "utf8");
    expect(intake.indexOf("shrinkImage(")).toBeGreaterThan(0);
    expect(intake.indexOf("shrinkImage(")).toBeLessThan(intake.indexOf("setRedacting(ok)"));
  });
});
