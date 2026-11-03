// 黒塗りの画面（T52）の表示の座標。枠（画面の上の場所）と画像の大きさから、拡大・送りを決める純な計算。
// 画像の座標は、元の画像（写真は向きを直した後、PDF は描いた頁）のピクセル。四角はいつも画像の座標で持つ。
// 拡大は 1（枠に収まる大きさ）〜 ZOOM_MAX。拡大中は画像が枠の外へ逃げない（端で止まる）。全体の大きさのときは真ん中に置く。

export type Pt = { x: number; y: number };
export type Size = { w: number; h: number };
export type Frame = Size;
/** zoom は全体の大きさからの倍率、scale は画像 1 px が枠の何 px か、x・y は画像の左上の枠の中の位置 */
export type View = { zoom: number; scale: number; x: number; y: number };

export const ZOOM_MAX = 8;
/** ボタンとホイールの 1 段 */
export const ZOOM_STEP = 1.5;

const fitScale = (frame: Frame, image: Size) => Math.min(frame.w / image.w, frame.h / image.h);

/** 枠に収まらない向きは端で止め、収まる向きは真ん中に置く */
function clamp(v: View, frame: Frame, image: Size): View {
  const dw = image.w * v.scale;
  const dh = image.h * v.scale;
  const x = dw <= frame.w ? (frame.w - dw) / 2 : Math.min(0, Math.max(frame.w - dw, v.x));
  const y = dh <= frame.h ? (frame.h - dh) / 2 : Math.min(0, Math.max(frame.h - dh, v.y));
  return { ...v, x, y };
}

/** 全体（枠に収まる大きさ、真ん中） */
export function fitView(frame: Frame, image: Size): View {
  const scale = fitScale(frame, image);
  return clamp({ zoom: 1, scale, x: 0, y: 0 }, frame, image);
}

export function viewToImage(v: View, p: Pt): Pt {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function imageToView(v: View, p: Pt): Pt {
  return { x: v.x + p.x * v.scale, y: v.y + p.y * v.scale };
}

/** 枠の中の点 at の下の画像の点を動かさずに、倍率を zoom にする */
export function zoomAt(v: View, frame: Frame, image: Size, zoom: number, at: Pt = { x: frame.w / 2, y: frame.h / 2 }): View {
  const z = Math.min(ZOOM_MAX, Math.max(1, zoom));
  const scale = fitScale(frame, image) * z;
  const under = viewToImage(v, at);
  return clamp({ zoom: z, scale, x: at.x - under.x * scale, y: at.y - under.y * scale }, frame, image);
}

/** 指・マウスで送る */
export function panView(v: View, frame: Frame, image: Size, dx: number, dy: number): View {
  return clamp({ ...v, x: v.x + dx, y: v.y + dy }, frame, image);
}

/** 2 本の指: 前の 2 点から今の 2 点へ（間の長さの比で拡大、真ん中の動きで送る） */
export function pinchView(v: View, frame: Frame, image: Size, before: [Pt, Pt], after: [Pt, Pt]): View {
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const d0 = dist(...before);
  const ratio = d0 > 0 ? dist(...after) / d0 : 1;
  const m0 = mid(...before);
  const m1 = mid(...after);
  const zoomed = zoomAt(v, frame, image, v.zoom * ratio, m0);
  return panView(zoomed, frame, image, m1.x - m0.x, m1.y - m0.y);
}

/** 枠の大きさが変わったとき（画面の向き・幅）。倍率と真ん中の画像の点を保つ */
export function refitView(v: View, before: Frame, after: Frame, image: Size): View {
  const center = viewToImage(v, { x: before.w / 2, y: before.h / 2 });
  const scale = fitScale(after, image) * v.zoom;
  return clamp({ zoom: v.zoom, scale, x: after.w / 2 - center.x * scale, y: after.h / 2 - center.y * scale }, after, image);
}
