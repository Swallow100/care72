// 元の様式の原本（T101、docs/DECISIONS.md「書類」）。計画書（松山市）と医療要約（災害診療記録2018）は、原本の頁を下に敷いて
// 欄の矩形に台帳の値を置く。原本の頁は配信に入れない（利用の条件。docs/progress/t101.md「原本の置き場」）。
// 事業所が公式の原本を一度取り込み（公式の URL から。取れなければ事業所が落とした PDF を選ぶ）、ブラウザが刷る解像度の PNG にして
// R2 に置く。下に敷くのはその PNG。版が違う原本（ハッシュが違う）は取り込まない（欄の矩形は版ごとに原本から起こした値のため）。
//
// ブラウザでも読む（取り込みの部品が URL・頁・解像度を使う）ので、サーバーだけの物は import しない。

import { pageImagePrefix } from "./page-images.ts";

export type OriginalId = "matsuyama" | "kiroku";

export type OriginalSpec = {
  id: OriginalId;
  /** 原本の題（画面の注） */
  title: string;
  /** 公式の PDF（取り込みの元。ここ以外から取らない） */
  url: string;
  /** 公式の PDF を置いている頁 */
  page: string;
  /** 欄の矩形を起こした版の PDF の SHA-256（16 進）。違えば取り込まない */
  sha256: string;
  /** その版の PDF の大きさ（バイト） */
  bytes: number;
  /** 版の短い形（画面の注） */
  version: string;
  /** PDF の頁の数 */
  pdfPages: number;
  /** 下に敷く頁（PDF の頁の番号）。医療要約は 1 頁目（基本情報）だけ */
  usePages: readonly number[];
  /** 頁の大きさ（mm。PDF の MediaBox） */
  pageMm: { w: number; h: number };
};

/** 原本の一覧。sha256・bytes・pageMm は作業者が公式の URL から取った PDF で確かめた値（11/4） */
export const ORIGINALS: Record<OriginalId, OriginalSpec> = {
  matsuyama: {
    id: "matsuyama",
    title: "松山市避難行動要支援者名簿登録申込書 兼 個別避難計画",
    url: "https://www.city.matsuyama.ehime.jp/kurashi/fukushi/shogai/hinankodo/kobetsuhinannkeikaku.files/R8.9.10keikaku.pdf",
    page: "https://www.city.matsuyama.ehime.jp/kurashi/fukushi/shogai/hinankodo/kobetsuhinannkeikaku.html",
    sha256: "43fe25c9adf797a11bb1ecfe965ca89bde34ea761d13da9a003476f88a03b7f6",
    bytes: 731073,
    version: "様式【2026.9.10】",
    pdfPages: 2,
    usePages: [1, 2],
    pageMm: { w: 209.97, h: 296.93 },
  },
  kiroku: {
    id: "kiroku",
    title: "災害診療記録2018（一般診療版）",
    url: "https://www.mhlw.go.jp/content/10600000/001684173.pdf",
    page: "https://www.mhlw.go.jp/stf/newpage_71340.html",
    sha256: "92c1627f34b51ab7f21246780a8788327da6a5bd7c059d45dfb98a24d06c94b6",
    bytes: 286366,
    version: "通知別添４-１",
    pdfPages: 4,
    usePages: [1],
    pageMm: { w: 210.02, h: 297.01 },
  },
};

export const ORIGINAL_IDS = Object.keys(ORIGINALS) as OriginalId[];

export function isOriginalId(v: string): v is OriginalId {
  return (ORIGINAL_IDS as string[]).includes(v);
}

/** 取り込みで断る理由（lib/forms/originals-http.ts が返し、取り込みの部品が出す） */
export type OriginalError = "login_required" | "forbidden" | "not_found" | "invalid" | "version" | "source_failed" | "store_failed";

/** 画面に出す言葉（2〜4 字） */
export const ORIGINAL_ERROR_LABELS: Record<OriginalError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  not_found: "該当なし",
  invalid: "形式不正",
  version: "版相違",
  source_failed: "取得失敗",
  store_failed: "保存失敗",
};

// ---------- 刷る解像度 ----------

/**
 * 下に敷く PNG の解像度。罫線が刷って甘くならない 400dpi（A4 の長い辺 4,677 px）。
 * iPhone の Safari の canvas は 16,777,216 画素までなので、超えるときはそこまで下げる（rasterScale）
 */
export const RASTER_DPI = 400;
export const RASTER_MAX_PIXELS = 16_777_216;
/** 受け取る PNG の長い辺の下限（これより粗いと線が甘い。300dpi の A4 で 3,508 px） */
export const RASTER_MIN_LONG_SIDE = 3_400;
/** 受け取る PNG 1 枚の上限（バイト） */
export const RASTER_MAX_BYTES = 15 * 1024 * 1024;

/** PDF の頁（pt）を描く倍率。400dpi、画素の上限を超えるなら下げる */
export function rasterScale(widthPt: number, heightPt: number, maxPixels = RASTER_MAX_PIXELS): number {
  const want = RASTER_DPI / 72;
  const pixels = widthPt * want * heightPt * want;
  return pixels <= maxPixels ? want : Math.sqrt(maxPixels / (widthPt * heightPt));
}

// ---------- 置き場 ----------

/** R2 の置き場。forms/<事業所>/ の下なので、デモ事業所の戻しで消える（lib/seed/reset.ts） */
export function originalPrefix(officeId: string, id: OriginalId): string {
  return `${pageImagePrefix(officeId)}originals/${id}/`;
}
export const originalPageKey = (officeId: string, id: OriginalId, page: number) => `${originalPrefix(officeId, id)}${page}.png`;
export const originalManifestKey = (officeId: string, id: OriginalId) => `${originalPrefix(officeId, id)}manifest.json`;

/** 画面が原本の頁を読む道（app/api/forms/originals/[id]/pages/[page]） */
export function originalPageHref(id: OriginalId, page: number): string {
  return `/api/forms/originals/${id}/pages/${page}`;
}
/** 取り込みの道（POST）と、公式の URL から取る道（GET） */
export const originalImportHref = (id: OriginalId) => `/api/forms/originals/${id}`;
export const originalSourceHref = (id: OriginalId) => `/api/forms/originals/${id}/source`;

export type OriginalPage = { page: number; width: number; height: number; bytes: number };

/** 取り込んだ原本の記録（R2 の manifest.json） */
export type OriginalManifest = {
  id: OriginalId;
  sha256: string;
  pages: OriginalPage[];
  importedAt: string;
};

const posInt = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;

/** manifest.json を読む。版が今の版でない・頁が欠けている・壊れていれば null（原本なしとして前からの紙面） */
export function parseManifest(id: OriginalId, json: string | null | undefined): OriginalManifest | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const spec = ORIGINALS[id];
  if (m.id !== id || m.sha256 !== spec.sha256 || typeof m.importedAt !== "string" || !Array.isArray(m.pages)) return null;
  const pages: OriginalPage[] = [];
  for (const x of m.pages) {
    if (!x || typeof x !== "object") return null;
    const p = x as Record<string, unknown>;
    if (!spec.usePages.includes(p.page as number) || !posInt(p.width, 20000) || !posInt(p.height, 20000) || !posInt(p.bytes, RASTER_MAX_BYTES)) return null;
    pages.push({ page: p.page as number, width: p.width as number, height: p.height as number, bytes: p.bytes as number });
  }
  if (pages.length !== spec.usePages.length || spec.usePages.some((n) => !pages.some((p) => p.page === n))) return null;
  return { id, sha256: spec.sha256, pages: [...pages].sort((a, b) => a.page - b.page), importedAt: m.importedAt };
}

// ---------- PNG ----------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG の幅と高さ（IHDR）。PNG でなければ null */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  // 8 から長さ 4・型 4（IHDR）・幅 4・高さ 4
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const u32 = (o: number) => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** 頁の PNG が原本の頁の形か（縦横の比が 1% 以内、長い辺が下限以上） */
export function pngFitsPage(size: { width: number; height: number }, pageMm: { w: number; h: number }): boolean {
  const ratio = size.width / size.height;
  const want = pageMm.w / pageMm.h;
  return Math.abs(ratio - want) / want <= 0.01 && Math.max(size.width, size.height) >= RASTER_MIN_LONG_SIDE;
}

/** 16 進の SHA-256（Workers とブラウザの WebCrypto） */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
