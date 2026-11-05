// 様式9（厚労省 介護施設・事業所の自然災害 BCP ひな形の様式9 のシート）の原本の枠の寸法（T101）。
// 原本は Excel で、刷った頁は Excel が列幅・行の高さ・印刷の倍率から組む。紙は同じ寸法で罫線を描き（ベクタ）、ひな形の字を刷って、欄に値を置く。
// ひな形は公共データ利用規約（第1.0版）で、出典を書けば複製・加工してよい（docs/progress/t101.md「原本の置き場」）。
//
// 値は作業者が原本（ORIGINAL_FORM9 の URL の Excel）のシートの XML から起こした物:
// - 列幅（文字の数）: A 1・B 3.625・C 12.375・D 7.625・E 7.625・F 9.25・G 15.125・H 29.25・I 12.875・J 12.875・K 26.25・L 9.875・M 8.25・N 0.5。
//   既定の書体は游ゴシック 11pt（最大の数字の幅 8px）なので画素は round(幅 × 8)、96dpi で mm に、印刷の倍率 73% を掛ける
// - 行の高さ（pt）: 3 行目 18.75、7〜26 行目 27（customHeight）、ほかは既定の 15.75。× 73%
// - 余白: 左右 0.70866in・上下 0.74803in（pageMargins）、A4 横、印刷の範囲 A1:N27、中央寄せなし
// - 罫線: B5:M26 の全部のセルに細線（border 1、thin）。結合: B5:B6・C5:E5・F5:F6・G5:G6・H5:H6・I5:J5・K5:K6・L5:L6・M5:M6
// - 字（メイリオ UI → BIZ UDPゴシック）: 題 11pt 太字・事業所名と作成 11pt・見出し 10pt（中央、折り返し）・No 11pt（中央）・欄 9pt。× 73%
// Excel の行の高さと列幅は表示する端末の書体で少し変わるので、Excel で PDF に書き出した物と照らした差を docs/progress/t101.md に書く

/** 原本の Excel（リポジトリに入れない。リンクだけ） */
export const ORIGINAL_FORM9 = {
  url: "https://www.mhlw.go.jp/content/000749545.xlsx",
  page: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/kaigo_koureisha/douga_00002.html",
  sha256: "85353d3adffcb6eb9f27cf313661c3ec69b00f9065720d4fbd6169a6f5800f2c",
  sheet: "様式9",
} as const;

export const FORM9_PRINT_SCALE = 0.73;
const SCALE = FORM9_PRINT_SCALE;
const PX_MM = 25.4 / 96;
const PT_MM = 25.4 / 72;
/** 游ゴシック 11pt の最大の数字の幅（px） */
const MDW = 8;
const r2 = (v: number) => Math.round(v * 100) / 100;
const colMm = (chars: number) => Math.round(chars * MDW) * PX_MM * SCALE;
const rowMm = (pt: number) => pt * PT_MM * SCALE;

/** 列幅（mm、刷った紙の上）。A〜N */
export const FORM9_COL_CHARS = [1, 3.625, 12.375, 7.625, 7.625, 9.25, 15.125, 29.25, 12.875, 12.875, 26.25, 9.875, 8.25, 0.5] as const;
/** 行の高さ（pt）。1〜27 行目 */
const ROW_PT = Array.from({ length: 27 }, (_, i) => (i + 1 === 3 ? 18.75 : i + 1 >= 7 && i + 1 <= 26 ? 27 : 15.75));

export const FORM9_PAGE_MM = { w: 297, h: 210 } as const;
export const FORM9_MARGIN_MM = { left: r2(0.70866141732283472 * 25.4), top: r2(0.74803149606299213 * 25.4) } as const;

/** 列の左の線の位置（mm、頁の左から）。index 0 が A の左、14 が N の右 */
export const FORM9_COL_X: readonly number[] = FORM9_COL_CHARS.reduce<number[]>((xs, c) => [...xs, xs[xs.length - 1] + colMm(c)], [FORM9_MARGIN_MM.left]).map(r2);
/** 行の上の線の位置（mm、頁の上から）。index 0 が 1 行目の上、27 が 27 行目の下 */
export const FORM9_ROW_Y: readonly number[] = ROW_PT.reduce<number[]>((ys, pt) => [...ys, ys[ys.length - 1] + rowMm(pt)], [FORM9_MARGIN_MM.top]).map(r2);

/** 列の名前 → 列の番号（A=0） */
const COL = Object.fromEntries([..."ABCDEFGHIJKLMN"].map((c, i) => [c, i])) as Record<string, number>;

export type Form9Cell = { x: number; y: number; w: number; h: number };
/** セルの矩形（mm）。"C5" や結合の "C5:E5" */
export function form9Cell(ref: string): Form9Cell {
  const [a, b = a] = ref.split(":");
  const at = (r: string) => ({ c: COL[r[0]], r: Number(r.slice(1)) });
  const p = at(a);
  const q = at(b);
  const x0 = FORM9_COL_X[p.c];
  const x1 = FORM9_COL_X[q.c + 1];
  const y0 = FORM9_ROW_Y[p.r - 1];
  const y1 = FORM9_ROW_Y[q.r];
  return { x: x0, y: y0, w: r2(x1 - x0), h: r2(y1 - y0) };
}

/** 字の大きさ（pt、刷った紙の上） */
export const FORM9_FONT_PT = { title: r2(11 * SCALE), office: r2(11 * SCALE), head: r2(10 * SCALE), no: r2(11 * SCALE), cell: r2(9 * SCALE) } as const;

/** 見出しのセル（ひな形の字のまま。改行は Excel のセルの中の改行） */
export const FORM9_HEADS: ReadonlyArray<{ ref: string; text: string }> = [
  { ref: "B5:B6", text: "No" },
  { ref: "C5:E5", text: "優先順位※" },
  { ref: "F5:F6", text: "地域\n区分" },
  { ref: "G5:G6", text: "氏名　(年齢)" },
  { ref: "H5:H6", text: "住所(自治会)" },
  { ref: "I5:J5", text: "想定される避難場所" },
  { ref: "K5:K6", text: "特記" },
  { ref: "L5:L6", text: "担当ケアマネ" },
  { ref: "M5:M6", text: "安否確認\nできた日" },
  { ref: "C6", text: "医療・介護" },
  { ref: "D6", text: "環境" },
  { ref: "E6", text: "避難" },
  { ref: "I6", text: "避難所" },
  { ref: "J6", text: "介護・医療機関" },
];

/** 1 枚のひな形の行の数（7〜26 行目） */
export const FORM9_ROWS_PER_PAGE = 20;
/** 値を置く列（No の B は刷ってある番号）。form9.ts の列の id と、ひな形の列 */
export const FORM9_VALUE_COLS = [
  { id: "medicalCare", col: "C" },
  { id: "environment", col: "D" },
  { id: "evacuation", col: "E" },
  { id: "area", col: "F" },
  { id: "nameAge", col: "G" },
  { id: "address", col: "H" },
  { id: "shelter", col: "I" },
  { id: "facility", col: "J" },
  { id: "notes", col: "K" },
  { id: "careManager", col: "L" },
  { id: "checkedAt", col: "M" },
] as const;
export type Form9ValueColumn = (typeof FORM9_VALUE_COLS)[number]["id"];

/** 罫線（B5:M26 の全部のセルの細線）。水平線は 5〜27 行目の上の線、垂直線は B〜N の左の線（結合の中の線は描かない） */
export function form9Lines(): Array<{ x1: number; y1: number; x2: number; y2: number; id: string }> {
  const out: Array<{ x1: number; y1: number; x2: number; y2: number; id: string }> = [];
  const xL = FORM9_COL_X[COL.B];
  const xR = FORM9_COL_X[COL.M + 1];
  const yT = FORM9_ROW_Y[4];
  const yB = FORM9_ROW_Y[26];
  // 水平: 5 行目の上・7〜27 行目の上。6 行目の上は C〜E と I〜J だけ（ほかは結合）
  for (const r of [5, ...Array.from({ length: 21 }, (_, i) => 7 + i)]) out.push({ x1: xL, y1: FORM9_ROW_Y[r - 1], x2: xR, y2: FORM9_ROW_Y[r - 1], id: `h${r}` });
  out.push({ x1: FORM9_COL_X[COL.C], y1: FORM9_ROW_Y[5], x2: FORM9_COL_X[COL.E + 1], y2: FORM9_ROW_Y[5], id: "h6-CE" });
  out.push({ x1: FORM9_COL_X[COL.I], y1: FORM9_ROW_Y[5], x2: FORM9_COL_X[COL.J + 1], y2: FORM9_ROW_Y[5], id: "h6-IJ" });
  // 垂直: B〜N の左。D・E の左（C5:E5 の中）と J の左（I5:J5 の中）は 6 行目から
  for (const c of [..."BCDEFGHIJKLMN"]) {
    const inside = c === "D" || c === "E" || c === "J";
    out.push({ x1: FORM9_COL_X[COL[c]], y1: inside ? FORM9_ROW_Y[5] : yT, x2: FORM9_COL_X[COL[c]], y2: yB, id: `v${c}` });
  }
  return out.map((l) => ({ ...l, x1: r2(l.x1), y1: r2(l.y1), x2: r2(l.x2), y2: r2(l.y2) }));
}
