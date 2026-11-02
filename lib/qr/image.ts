// QR の画像。qrcode-generator（MIT、依存なし）で点の並びを作り、SVG の 1 本の path にする。
// 色は持たない（描く側が白地に黒で描く。紙に刷っても読めるように、ライト・ダークで反転させない）。

import qrcode from "qrcode-generator";

/** 点の並び。dark[y][x] が黒 */
export type QrMatrix = { size: number; dark: boolean[][] };

/** 周りの白（4 点。QR の決まりの最小） */
export const QR_QUIET = 4;

/** 文字から点の並び。誤り訂正は M（15%。印刷の汚れ・折れに耐える）、大きさは自動 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const dark = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => qr.isDark(y, x)));
  return { size, dark };
}

/** 黒の点を横につないだ path（周りの白の分ずらす）。viewBox は 0 0 size+8 size+8 */
export function qrSvgPath(m: QrMatrix, quiet: number = QR_QUIET): string {
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.size && m.dark[y][x + run]) run++;
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join("");
}
