// T101 原本の枠の寸法の表（lib/forms/frame-*.ts）を、原本の PDF の罫線と照らす。原本はリポジトリに無いので、
// 作業者の手元にあるときだけ（T101_ORIGINALS に原本の PDF を置いたフォルダ。matsuyama.pdf・kiroku.pdf）。無ければ飛ばす。
// 版のハッシュが ORIGINALS と違う PDF は照らさない（違う版の枠と比べない）。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasHLine, hasVLine, pdfLines } from "../../tools/print/pdf-lines.ts";
import { KIROKU_FRAME } from "./frame-kiroku.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import type { Frame } from "./frame-sheet.ts";
import { ORIGINALS, type OriginalId } from "./originals.ts";

const DIR = process.env.T101_ORIGINALS ?? "";
/** 罫線の位置の許し（mm） */
const TOL = 0.3;

function original(id: OriginalId): Uint8Array | null {
  const path = join(DIR, `${id}.pdf`);
  if (!DIR || !existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  return createHash("sha256").update(bytes).digest("hex") === ORIGINALS[id].sha256 ? bytes : null;
}

describe.each([
  ["matsuyama", MATSUYAMA_FRAME as Frame<string>],
  ["kiroku", KIROKU_FRAME as Frame<string>],
] as const)("%s の枠の表と原本の罫線", (id, frame) => {
  const pdf = original(id);
  it.runIf(pdf !== null)("ruled の欄の矩形の 4 辺は、原本の罫線の中心から ±0.3mm（辺の 8 割を線が覆う）", async () => {
    const pages = await pdfLines(pdf!, ORIGINALS[id].usePages);
    const bad: string[] = [];
    let checked = 0;
    for (const a of frame.areas) {
      if (!a.ruled) continue;
      const p = pages.find((x) => x.page === a.page)!;
      const { x, y, w, h } = a.box;
      const edges: Array<[string, boolean]> = [
        ["上", hasHLine(p.H, y, x, x + w, TOL)],
        ["下", hasHLine(p.H, y + h, x, x + w, TOL)],
        ["左", hasVLine(p.V, x, y, y + h, TOL)],
        ["右", hasVLine(p.V, x + w, y, y + h, TOL)],
      ];
      for (const [name, ok] of edges) if (!ok) bad.push(`${a.keys.join("+")} ${name}`);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    expect(bad).toEqual([]);
  });

  it.runIf(pdf !== null)("頁の大きさは原本の PDF の頁と同じ（±0.05mm）", async () => {
    const pages = await pdfLines(pdf!, ORIGINALS[id].usePages);
    for (const p of pages) {
      const f = frame.pages.find((x) => x.page === p.page)!;
      expect(Math.abs(p.w - f.w)).toBeLessThan(0.05);
      expect(Math.abs(p.h - f.h)).toBeLessThan(0.05);
    }
  });
});
