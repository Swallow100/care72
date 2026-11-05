// 様式の頁の画像（T86）。様式の読み取り（app/api/forms/read）で受けた頁の画像を R2 に置き、元の様式の上に値を置く紙の下に敷く。
//
// - 置くのは黒塗りの画面（components/person/RedactSheet.tsx）を通した頁の画像（JPEG、付け足しなし）そのもの。Claude に渡した物と同じなので、
//   AI が返した欄の場所（0〜1 の矩形）はこの画像の上の場所になる。白紙の様式ならそのまま、記入済みなら人が塗った後の画像で、人の値は入らない。
// - 置き場は R2 の RECORDINGS（新しい bucket は作らない。配信の設定を変えずに済む）の forms/<事業所>/<対応表>/<頁>.jpg。
//   事業所ごとに分け、D1 の form_mappings.page_images に頁の数と大きさ（migration 0026）。
// - 置けなかったとき（R2 の失敗・JPEG の大きさが読めない）は page_images が NULL のまま。紙は前からの「欄名｜値」の 2 列で出す。
// - ブラウザでも読む（場所の確かめの画面が頁の大きさと URL を使う）ので、サーバーだけの物は import しない。

import { jpegSegments } from "../redact/jpeg.ts";
import { checkPackedInk } from "./ink.ts";
import { LIMITS } from "./mapping.ts";

/**
 * 頁の画像の大きさ。ink は頁の印刷の字・□ のかたまりの箱（T133、lib/forms/ink.ts の保存の形）。ブラウザが送る前に頁の画像から作った物で、
 * 無ければ（T133 の前に読んだ様式・作れなかった頁）印刷の字の位置なしで置く
 */
export type PageImage = { page: number; width: number; height: number; bytes: number; ink?: number[] };

/** 事業所の頁の画像の置き場の頭（デモ事業所の戻しで消す。lib/seed/reset.ts） */
export function pageImagePrefix(officeId: string): string {
  return `forms/${officeId}/`;
}

export function pageImageKey(officeId: string, mappingId: string, page: number): string {
  return `${pageImagePrefix(officeId)}${mappingId}/${page}.jpg`;
}

/** 画面が頁の画像を読む道（app/api/forms/mappings/[id]/pages/[page]） */
export function pageImageHref(mappingId: string, page: number): string {
  return `/api/forms/mappings/${encodeURIComponent(mappingId)}/pages/${page}`;
}

/** 頁の画像の形の帯（SOF。C4・C8・CC は SOF でない） */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** JPEG の幅と高さ（画素）。形が壊れている・SOF が無ければ null */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const segs = jpegSegments(bytes);
  if (!segs) return null;
  for (const s of segs) {
    if (!isSof(s.marker)) continue;
    // s.start は FF（埋め草の FF を含むことがある）。区切りの印の次から 長さ 2・精度 1・高さ 2・幅 2
    let at = s.start;
    while (at < bytes.length && bytes[at] === 0xff) at++;
    const d = at + 1;
    if (d + 7 > bytes.length) return null;
    const height = (bytes[d + 3] << 8) | bytes[d + 4];
    const width = (bytes[d + 5] << 8) | bytes[d + 6];
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

const posInt = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;

/** 保存した頁の画像の JSON を読む。頁は 1 から順に並ぶ物だけ。壊れていれば null（2 列の紙で出す） */
export function parsePageImages(json: string | null | undefined): PageImage[] | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIMITS.pages) return null;
  const out: PageImage[] = [];
  for (const [i, x] of raw.entries()) {
    if (!x || typeof x !== "object") return null;
    const p = x as Record<string, unknown>;
    if (p.page !== i + 1 || !posInt(p.width, 20000) || !posInt(p.height, 20000) || !posInt(p.bytes, 50 * 1024 * 1024)) return null;
    const ink = checkPackedInk(p.ink);
    out.push({ page: i + 1, width: p.width as number, height: p.height as number, bytes: p.bytes as number, ...(ink ? { ink } : {}) });
  }
  return out;
}

/** R2 のうち頁の画像で使う所（配信は env.RECORDINGS、テストは偽物） */
export type PageImageBucket = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: unknown; size: number } | null>;
};

/** D1 のうち使う所 */
type Db = { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } };

/**
 * 頁の画像を R2 に置き、D1 に頁の数と大きさを書く。images は頁の順。置けなければ null（対応表はそのまま、紙は 2 列）。
 * 対応表の版は上げない（サーバーの持ち物で、人が確かめる中身ではない）
 */
export async function storePageImages(
  db: Db,
  bucket: PageImageBucket,
  s: { officeId: string; mappingId: string; images: ReadonlyArray<Uint8Array>; /** 頁ごとの印刷の字の位置（T133。無い頁は null） */ inks?: ReadonlyArray<number[] | null> },
): Promise<PageImage[] | null> {
  if (s.images.length === 0 || s.images.length > LIMITS.pages) return null;
  const pages: PageImage[] = [];
  for (const [i, bytes] of s.images.entries()) {
    const size = jpegSize(bytes);
    if (!size) return null;
    const ink = checkPackedInk(s.inks?.[i]);
    pages.push({ page: i + 1, ...size, bytes: bytes.length, ...(ink ? { ink } : {}) });
  }
  try {
    for (const [i, bytes] of s.images.entries()) {
      await bucket.put(pageImageKey(s.officeId, s.mappingId, i + 1), bytes, { httpMetadata: { contentType: "image/jpeg" } });
    }
    await db
      .prepare("UPDATE form_mappings SET page_images = ?1 WHERE id = ?2 AND office_id = ?3")
      .bind(JSON.stringify(pages), s.mappingId, s.officeId)
      .run();
  } catch (e) {
    console.error("様式の頁の画像を置けない", e instanceof Error ? e.name : typeof e);
    return null;
  }
  return pages;
}
