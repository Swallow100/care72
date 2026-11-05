// Excel・Word を描いた頁の形（T119）。読む所（xlsx・docx）が頁ごとにこれを作り、描く所（draw.ts）が canvas に描く。
// 長さは全部 mm（頁の左上が原点）。元の印刷の枠の位置と比べる数（罫線の線分）もこの形から取る。

export type Stroke = { color: string; /** 線の太さ mm */ width: number; /** 破線の長さ（mm の並び） */ dash?: number[] };

export type FontSpec = {
  /** CSS の書体の並び（fonts.ts の cssFamily） */
  family: string;
  /** 字の大きさ mm */
  size: number;
  bold?: boolean;
  italic?: boolean;
};

export type Box = { x: number; y: number; w: number; h: number };

export type PageItem =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: Stroke; radius?: number }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  | { k: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: Stroke }
  | { k: "path"; points: Array<[number, number]>; closed: boolean; fill?: string; stroke?: Stroke }
  | {
      k: "text";
      text: string;
      /** 横書き: 基準線の上の x（align の位置）。縦書き: 列の真ん中の x */
      x: number;
      /** 横書き: 字の基準線（alphabetic）の y。縦書き: 1 字目の上の y */
      y: number;
      font: FontSpec;
      color: string;
      align?: "left" | "center" | "right";
      /** これより長ければ横に詰める（canvas の maxWidth） */
      maxWidth?: number;
      /** 1 字ずつの左の x（均等割付など。あれば align・maxWidth より先） */
      chars?: number[];
      /** 縦書き（上から下へ 1 字ずつ） */
      vertical?: boolean;
      /** この矩形の外を描かない */
      clip?: Box;
      underline?: boolean;
    }
  | { k: "image"; x: number; y: number; w: number; h: number; data: Uint8Array; type: "image/png" | "image/jpeg" | "image/gif" }
  /** □（フォームのチェックボックス）。checked ならレ点 */
  | { k: "check"; x: number; y: number; size: number; checked: boolean; round?: boolean };

export type OfficePage = {
  /** 頁の幅・高さ mm */
  w: number;
  h: number;
  items: PageItem[];
  /** シートの名前（Excel）。Word は null */
  sheet: string | null;
  /** シートの中・文書の中の頁の番号（1 から） */
  page: number;
  /** シートに印刷範囲が決めてある（Excel。既定で送るシートの手掛かり。T122） */
  printArea?: boolean;
};

export const PT_MM = 25.4 / 72;
export const EMU_MM = 1 / 36000;
export const TWIP_MM = 25.4 / 1440;
export const INCH_MM = 25.4;
/** 96 dpi の画素 */
export const PX_MM = 25.4 / 96;

/** 字の幅を測る（mm）。ブラウザは canvas の measureText、テストと台は見積もり（fonts.ts の estimateWidth） */
export type Measure = (text: string, font: FontSpec) => number;
