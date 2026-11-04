// PDF の頁の罫線を mm で取る道具（テストと手元の確かめだけ。配信のコードからは使わない）。T101。
// pdf.js の getOperatorList で、線（constructPath を stroke した物）と細い塗りの矩形（Excel などの罫線）を、save/restore・transform・
// フォームの行列を追って頁の左上を原点の mm にする。水平・垂直の線分だけ返す。字は読まない（原本の字をリポジトリに持たない）。

export type HLine = { y: number; x0: number; x1: number; w: number };
export type VLine = { x: number; y0: number; y1: number; w: number };
export type PageLines = { page: number; w: number; h: number; H: HLine[]; V: VLine[] };

type Matrix = [number, number, number, number, number, number];
const MM = 25.4 / 72;

const mul = (a: Matrix, b: readonly number[]): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** PDF の頁ごとの罫線。pages を渡せばその頁だけ */
export async function pdfLines(pdf: Uint8Array, pages?: readonly number[]): Promise<PageLines[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { OPS } = pdfjs;
  const doc = await pdfjs.getDocument({ data: pdf.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const out: PageLines[] = [];
  const strokeOps = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fillOps = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let n = 1; n <= doc.numPages; n++) {
    if (pages && !pages.includes(n)) continue;
    const page = await doc.getPage(n);
    const [, , pw, ph] = page.view;
    const ops = await page.getOperatorList();
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    let lw = 1;
    const stack: Array<[Matrix, number]> = [];
    const H: HLine[] = [];
    const V: VLine[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) {
        stack.push([ctm, lw]);
        if (fn === OPS.paintFormXObjectBegin && Array.isArray(args?.[0])) ctm = mul(ctm, args[0] as number[]);
      } else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) {
        const s = stack.pop();
        if (s) [ctm, lw] = s;
      } else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
      else if (fn === OPS.setLineWidth) lw = args[0] as number;
      else if (fn === OPS.constructPath) {
        const paintOp = args[0] as number;
        const raw = args[1] as unknown;
        const data = (Array.isArray(raw) ? raw[0] : raw) as ArrayLike<number> | undefined;
        if (!data) continue;
        const shapes: Array<Array<[number, number]>> = [];
        let cur: Array<[number, number]> | null = null;
        // 描き方: 0 moveTo・1 lineTo・2 curveTo・3 quadraticCurveTo・4 closePath（pdf.js の DrawOPS）
        for (let k = 0; k < data.length; ) {
          const op = data[k++];
          if (op === 0) {
            cur = [[data[k], data[k + 1]]];
            shapes.push(cur);
            k += 2;
          } else if (op === 1) {
            cur?.push([data[k], data[k + 1]]);
            k += 2;
          } else if (op === 2) {
            cur?.push([data[k + 4], data[k + 5]]);
            k += 6;
          } else if (op === 3) {
            cur?.push([data[k + 2], data[k + 3]]);
            k += 4;
          } else if (op === 4) {
            if (cur) cur.push(cur[0]);
          } else break;
        }
        const scaleW = Math.hypot(ctm[0], ctm[1]);
        for (const sh of shapes) {
          const P = sh.map(([x, y]) => apply(ctm, x, y)).map(([x, y]) => [x * MM, (ph - y) * MM] as const);
          if (strokeOps.has(paintOp)) {
            for (let j = 1; j < P.length; j++) {
              const [x0, y0] = P[j - 1];
              const [x1, y1] = P[j];
              const w = lw * scaleW * MM;
              if (Math.abs(y0 - y1) < 0.05 && Math.abs(x0 - x1) > 0.3) H.push({ y: (y0 + y1) / 2, x0: Math.min(x0, x1), x1: Math.max(x0, x1), w });
              else if (Math.abs(x0 - x1) < 0.05 && Math.abs(y0 - y1) > 0.3) V.push({ x: (x0 + x1) / 2, y0: Math.min(y0, y1), y1: Math.max(y0, y1), w });
            }
          }
          if (fillOps.has(paintOp) && P.length >= 4) {
            const xs = P.map((p) => p[0]);
            const ys = P.map((p) => p[1]);
            const x0 = Math.min(...xs);
            const x1 = Math.max(...xs);
            const y0 = Math.min(...ys);
            const y1 = Math.max(...ys);
            if (y1 - y0 < 0.8 && x1 - x0 > 0.5) H.push({ y: (y0 + y1) / 2, x0, x1, w: y1 - y0 });
            else if (x1 - x0 < 0.8 && y1 - y0 > 0.5) V.push({ x: (x0 + x1) / 2, y0, y1, w: x1 - x0 });
          }
        }
      }
    }
    out.push({ page: n, w: pw * MM, h: ph * MM, H, V });
  }
  await doc.cleanup();
  return out;
}

/** y の水平線のうち x0〜x1 の大半（8 割）を覆う線があるか（tol mm の内） */
export function hasHLine(lines: readonly HLine[], y: number, x0: number, x1: number, tol: number): boolean {
  const near = lines.filter((l) => Math.abs(l.y - y) <= tol);
  return covered(near.map((l) => [l.x0, l.x1]), x0, x1) >= 0.8 * (x1 - x0);
}

export function hasVLine(lines: readonly VLine[], x: number, y0: number, y1: number, tol: number): boolean {
  const near = lines.filter((l) => Math.abs(l.x - x) <= tol);
  return covered(near.map((l) => [l.y0, l.y1]), y0, y1) >= 0.8 * (y1 - y0);
}

/** 区間 [a, b] のうち、segs が覆う長さ */
function covered(segs: Array<[number, number]>, a: number, b: number): number {
  const s = segs.map(([p, q]) => [Math.max(p, a), Math.min(q, b)] as const).filter(([p, q]) => q > p).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = a;
  for (const [p, q] of s) {
    if (q <= end) continue;
    total += q - Math.max(p, end);
    end = q;
  }
  return total;
}
