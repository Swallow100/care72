import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QrBlock } from "../../components/forms/QrBlock.tsx";
import { qrMatrix, qrSvgPath, QR_QUIET } from "./image.ts";
import { QR_LABELS } from "./labels.ts";

const URL_TEXT = "https://care72.example/q/eyJ2IjoxLCJwIjoicC0wMSIsImciOjEsImlhdCI6MTc5MzAwMDAwMCwiZXhwIjoxODAwNzc2MDAwfQ.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("QR の画像", () => {
  it("点の並びは QR の大きさ（21 + 4n）で、3 つの角に位置の印（7×7 の外枠）がある", () => {
    const m = qrMatrix(URL_TEXT);
    expect((m.size - 21) % 4).toBe(0);
    expect(m.dark).toHaveLength(m.size);
    const finder = (ox: number, oy: number) => {
      for (let i = 0; i < 7; i++) {
        expect(m.dark[oy][ox + i]).toBe(true);
        expect(m.dark[oy + 6][ox + i]).toBe(true);
        expect(m.dark[oy + i][ox]).toBe(true);
        expect(m.dark[oy + i][ox + 6]).toBe(true);
      }
      expect(m.dark[oy + 1][ox + 1]).toBe(false);
      expect(m.dark[oy + 3][ox + 3]).toBe(true);
    };
    finder(0, 0);
    finder(m.size - 7, 0);
    finder(0, m.size - 7);
  });

  it("path は黒の点の数だけ塗る（横につないでも数は同じ）。周りの白の分ずれる", () => {
    const m = qrMatrix("care72");
    const dark = m.dark.flat().filter(Boolean).length;
    const path = qrSvgPath(m);
    const widths = [...path.matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0);
    expect(widths).toBe(dark);
    expect(path.startsWith(`M${QR_QUIET} ${QR_QUIET}`)).toBe(true);
  });

  it("部品は 1 行と期限（JST の日付）を添え、URL の文字は出さない", () => {
    const html = renderToStaticMarkup(createElement(QrBlock, { url: URL_TEXT, expiresAt: "2027-01-30T15:30:00.000Z" }));
    expect(html).toContain(QR_LABELS.blockNote);
    expect(html).toContain("期限 2027-01-31");
    expect(html).not.toContain("/q/");
    expect(html).not.toContain("eyJ2");
    expect(html).toContain('fill="#000"');
  });
});
