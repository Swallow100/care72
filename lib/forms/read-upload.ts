// 様式の読み取り（app/api/forms/read、components/forms/mapping/FormReadPanel.tsx）の送る形（T83、見直しの安全 中 5）。
// ブラウザとサーバーの両方が使う（node:buffer などサーバーだけの物は置かない）。
//
// 様式の写真・PDF も、台帳の写真の読み取り（T52）と同じ黒塗りの画面（components/person/RedactSheet.tsx）を必ず通る。
// 白紙の様式なら塗らずに送れる（確かめの窓「塗り無し」で人が「送信」を選んだ印 bare）、記入済みなら書いた値を塗ってから送る。
// 送るのは塗った後の頁の画像（JPEG、付け足しなし）を頁の順に 1〜PDF_PAGES_MAX 枚と、頁ごとの印（source・page・redacted・bare）。
// 前の形（file の欄に生の写真・PDF）は「未加工」で断る。1 要求で全部の頁を受け、Claude の呼び出しは今までどおり 1 回（頁を並べて渡す）。

import { BARE_MARK, parseReadMeta, PDF_PAGES_MAX, RAW_FILE_FIELD, READ_FORM, type ReadMeta } from "../intake/read-form.ts";
import { checkPackedInk } from "./ink.ts";

/** 頁の印刷の字の位置（T133、lib/forms/ink.ts の保存の形の JSON）の欄。頁ごとに 1 つ（作れなかった頁は空の文字） */
export const INK_FIELD = "ink";
/** 印刷の字の位置の JSON 1 頁の上限（字の数） */
const INK_MAX_CHARS = 200_000;

/** 1 要求で送れる頁の数（PDF は頭から 3 頁まで。様式は 2 頁） */
export const FORM_READ_PAGES_MAX = PDF_PAGES_MAX;

/** ブラウザから送る 1 頁（RedactSheet の RedactedPage と同じ形の所だけ） */
export type FormReadPage = { blob: Blob; meta: ReadMeta; bare: boolean; /** 頁の印刷の字の位置（T133。無ければ送らない） */ ink?: number[] | null };

/** 送る形を作る。頁の順に、印と画像を同じ欄の名前で並べる（受ける側は getAll で同じ順に読む） */
export function buildFormReadForm(pages: ReadonlyArray<FormReadPage>): FormData {
  const form = new FormData();
  for (const p of pages) {
    form.append(READ_FORM.source, p.meta.source);
    form.append(READ_FORM.page, String(p.meta.page));
    form.append(READ_FORM.redacted, String(p.meta.redacted));
    form.append(READ_FORM.bare, p.bare && p.meta.redacted === 0 ? BARE_MARK : "0");
    form.append(READ_FORM.image, p.blob, `redacted-${p.meta.page}.jpg`);
  }
  // 印刷の字の位置（T133）は全部の頁に 1 つずつ（無い頁は空の文字）。1 頁も無ければ欄を付けない
  if (pages.some((p) => p.ink)) for (const p of pages) form.append(INK_FIELD, p.ink ? JSON.stringify(p.ink) : "");
  return form;
}

/** 受けた印刷の字の位置（頁の順）。欄が無い・数が合わなければ全部 null（位置なしで置く。読み取りは止めない） */
export function formReadInksOf(form: FormData, pages: number): Array<number[] | null> {
  const raw = form.getAll(INK_FIELD);
  if (raw.length !== pages) return Array.from({ length: pages }, () => null);
  return raw.map((v) => {
    if (typeof v !== "string" || v === "" || v.length > INK_MAX_CHARS) return null;
    try {
      return checkPackedInk(JSON.parse(v));
    } catch {
      return null;
    }
  });
}

export type FormReadPagesError = "invalid" | "not_redacted";

/**
 * 受けた形を読む。画像は中身を見ない（中身の確かめは lib/intake/read-check.ts の checkRedactedImage）。
 * - 生のファイルの欄（file）がある・印が無い・形が違う・隠した所 0 で人が選んだ印が無い → not_redacted
 * - 画像が無い・多すぎる・文字の欄・頁の並びが合わない（写真は 1 枚、PDF は 1・2・3 の順、元は 1 つ） → invalid
 */
export function formReadPagesOf(form: FormData): { ok: true; pages: Array<{ image: File; meta: ReadMeta }> } | { ok: false; error: FormReadPagesError } {
  if (form.has(RAW_FILE_FIELD)) return { ok: false, error: "not_redacted" };
  const images = form.getAll(READ_FORM.image);
  if (images.length === 0 || images.length > FORM_READ_PAGES_MAX) return { ok: false, error: "invalid" };
  if (images.some((x) => typeof x === "string")) return { ok: false, error: "invalid" };
  const sources = form.getAll(READ_FORM.source);
  const pageNos = form.getAll(READ_FORM.page);
  const redacted = form.getAll(READ_FORM.redacted);
  const bare = form.getAll(READ_FORM.bare);
  if ([sources, pageNos, redacted, bare].some((a) => a.length !== images.length)) return { ok: false, error: "not_redacted" };
  const pages: Array<{ image: File; meta: ReadMeta }> = [];
  for (let i = 0; i < images.length; i++) {
    const meta = parseReadMeta({ source: sources[i], page: pageNos[i], redacted: redacted[i], bare: bare[i] });
    if (!meta) return { ok: false, error: "not_redacted" };
    pages.push({ image: images[i] as File, meta });
  }
  const source = pages[0].meta.source;
  if (pages.some((p) => p.meta.source !== source)) return { ok: false, error: "invalid" };
  if (source === "photo" && pages.length !== 1) return { ok: false, error: "invalid" };
  if (pages.some((p, i) => p.meta.page !== i + 1)) return { ok: false, error: "invalid" };
  return { ok: true, pages };
}
