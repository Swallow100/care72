// 写真を端末で縮めて JPEG にする（docs/tasks/T68.md の 7）。様式の読み取り（components/forms/mapping/FormReadPanel.tsx）と、
// 本人のページの入れる欄の写真（components/person/Intake.tsx → 黒塗りの画面 RedactSheet.tsx の前）で使う。
// - 長い辺を 2,000 px まで縮め、JPEG の品質 0.85 に。それでもサーバーの上限（FORM_FILE_MAX_BYTES、5 MB）を超えれば長い辺 1,400 px でもう一度
// - PNG の透けた所は白い地に描く（黒にしない）。canvas を通すので元の EXIF（位置・端末）は付かない
// - PDF はそのまま（大きさは呼ぶ側が見る。入れる欄の PDF は黒塗りの画面が頁を画像にするので上限は効かない）
// - 形は中身の頭で決める（JPEG・PNG・PDF・HEIC）。ほかは断り、画面は「JPEG・PNG・PDF」と 1 行で出す
// - HEIC（iPhone の写真。T120）はブラウザが描ければ（Safari）JPEG に直す。描けないブラウザ（Chrome・Edge）は「HEIC 不可」
//   （HEIC を読む部品は LGPL の物しか無く、依存に足せない。iPhone の Safari は写真を選ぶときに JPEG に直して渡すことも多い）
// 寸法の計算（shrinkSize）と形の判定（sniffKind）は純な関数でテストする。縮める本体（shrinkImage）はブラウザだけで動く。
// サーバーの上限は変えない。順は 縮小 → 塗り → 送る（塗りは縮めた絵の上でするので、縮小で塗った所がにじまない）。

import { FORM_FILE_MAX_BYTES } from "./mapping.ts";

/** 縮める長い辺（px）。1 つ目で上限を超えたら 2 つ目 */
export const SHRINK_SIDES = [2000, 1400] as const;
/** JPEG の品質 */
export const SHRINK_QUALITY = 0.85;

/** 長い辺を max に収める寸法（拡げない。1 px より小さくしない） */
export function shrinkSize(w: number, h: number, max: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const ratio = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}

export type ShrinkKind = "jpeg" | "png" | "pdf" | "heic";

/** HEIC・HEIF の箱の印（ftyp の後ろの種類） */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** HEIC・HEIF か（中身の頭 12 バイト: 4〜7 が ftyp、8〜11 が種類） */
export function isHeic(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  return ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12));
}

/** 頭を読む長さ */
export const SNIFF_BYTES = 12;

/** 中身の頭（12 バイト）で形を決める。JPEG・PNG・PDF・HEIC のほかは null（WebP・GIF など） */
export function sniffKind(head: Uint8Array): ShrinkKind | null {
  const has = (sig: number[]) => sig.every((x, i) => head[i] === x);
  if (has([0xff, 0xd8, 0xff])) return "jpeg";
  if (has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (has([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (isHeic(head)) return "heic";
  return null;
}

/** 縮めたファイルの名前（拡張子を .jpg に） */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, "");
  return `${base || "photo"}.jpg`;
}

export type ShrinkResult =
  | { ok: true; file: File; kind: "image" | "pdf" }
  /** type: JPEG・PNG・PDF・HEIC でない・読めない。heic: HEIC をこのブラウザが描けない。large: 1,400 px でも上限を超える */
  | { ok: false; error: "type" | "heic" | "large" };

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/** 写真を縮めて JPEG に（ブラウザだけ）。PDF はそのまま返す */
export async function shrinkImage(file: File, maxBytes = FORM_FILE_MAX_BYTES): Promise<ShrinkResult> {
  const kind = file.size > 0 ? sniffKind(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())) : null;
  if (kind === null) return { ok: false, error: "type" };
  // HEIC は描けたブラウザだけ下の canvas で JPEG に直る。描けなければ HEIC 不可
  const failed = kind === "heic" ? "heic" : "type";
  if (kind === "pdf") return { ok: true, file, kind: "pdf" };
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    for (const side of SHRINK_SIDES) {
      const { w, h } = shrinkSize(img.naturalWidth, img.naturalHeight, side);
      if (w === 0) return { ok: false, error: failed };
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, error: failed };
      // PNG の透けた所は白い地に
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await toBlob(canvas, SHRINK_QUALITY);
      if (blob && blob.size <= maxBytes) return { ok: true, file: new File([blob], jpegName(file.name), { type: "image/jpeg" }), kind: "image" };
    }
    return { ok: false, error: "large" };
  } catch {
    return { ok: false, error: failed };
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}
