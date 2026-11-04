// 様式の読み取りの受け口の中身（app/api/forms/read。T83 の受け口から T86 で移した。サーバーだけ）。
//
// 黒塗りの画面（components/person/RedactSheet.tsx）を通した頁の画像（JPEG、付け足しなし）を頁の順に 1〜3 枚受け取り、
// Opus に欄と台帳の項目の対応表（T86 から欄ごとの値の場所と書体も）を出させ、下書きで保存する。
// 白紙の様式は塗らずに送れる（人が確かめの窓で「送信」を選んだ印 bare）、記入済みなら値を塗ってから。
// 生の写真・PDF（前の file の欄・PDF・PNG・EXIF の付いた JPEG）・印の無い物は「未加工」（415）で断り、Claude は呼ばない。
// 同じ頁の画像の並び（SHA-256 が同じ）が事業所にあれば読まずにその対応表を返す（上限も減らさない）。
// Claude に渡すのは塗った後の頁の画像と台帳の項目表（値は無い）だけ。台帳の値・氏名は渡さない。
//
// T86: 受けた頁の画像そのものを R2 に置き（lib/forms/page-images.ts）、元の様式の上に値を置く紙の下に敷く。
// 頁の数は AI の言う数でなく受けた画像の数にそろえる（fitPages）。読み直さずに返す対応表に画像が無ければ（T86 の前に読んだ物）、ここで置く。
// 置けなくても読み取りは成り立つ（紙は 2 列のまま）。
//
// T120: 頁ごとに読む（lib/forms/form-read.ts の readForm）。読めなかった頁があっても、読めた頁の欄で対応表にし（mapping.unread に頁）、
// 応答に unread を返す。読めなかった頁は確かめの画面の「再読」（formRereadPost、app/api/forms/mappings/[id]/reread）で、置いた頁の画像から読み直す。

import type { D1Database } from "@cloudflare/workers-types";
import type { AskJsonContext } from "../claude/call.ts";
import { checkRedactedImage } from "../intake/read-check.ts";
import { FORM_FILE_MAX_BYTES, formHash, readForm, type FormFile } from "./form-read.ts";
import { fitPages, nextFieldId, type FormMapping } from "./mapping.ts";
import { findMappingByHash, getMapping, insertReadMapping, updateReadMapping, type FormsScope } from "./mapping-db.ts";
import { mappingError, mappingErrorOf, NO_STORE } from "./mapping-http.ts";
import { pageImageKey, storePageImages, type PageImageBucket } from "./page-images.ts";
import { formReadPagesOf } from "./read-upload.ts";

export type FormReadDeps = {
  db: D1Database;
  bucket: PageImageBucket;
  /** AI を呼ぶ文脈（配信は lib/claude/cloudflare.ts の aiContextFor、テストは偽の client） */
  aiContext: (officeId: string) => Promise<AskJsonContext>;
  now?: () => string;
  newId?: () => string;
  /** 同時に読む頁の数（無ければ全部。評価の台は 1） */
  readConcurrency?: number;
};

export async function formReadPost(deps: FormReadDeps, scope: FormsScope, form: FormData): Promise<Response> {
  const got = formReadPagesOf(form);
  if (!got.ok) return mappingError(got.error);

  const files: FormFile[] = [];
  const parts: Uint8Array[] = [];
  for (const p of got.pages) {
    if (p.image.size > FORM_FILE_MAX_BYTES) return mappingError("file_large");
    const bytes = new Uint8Array(await p.image.arrayBuffer());
    const checked = checkRedactedImage(bytes);
    if (!checked.ok) return mappingError(checked.error);
    files.push(checked.file);
    parts.push(bytes);
  }

  const all = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of parts) {
    all.set(b, at);
    at += b.length;
  }
  const hash = await formHash(all);
  const known = await findMappingByHash(deps.db, scope.officeId, hash);
  if (known) {
    // 同じ頁の画像。T86 の前に読んだ物で画像が無ければ置く（場所を人が足せば、元の様式の上の紙にできる）
    if (known.page_images === null) await storePageImages(deps.db, deps.bucket, { officeId: scope.officeId, mappingId: known.id, images: parts });
    return Response.json({ ok: true, id: known.id, reused: true }, { headers: NO_STORE });
  }

  try {
    const ctx = await deps.aiContext(scope.officeId);
    const read = await readForm(files, ctx, { concurrency: deps.readConcurrency });
    const saved = await insertReadMapping(deps.db, {
      id: deps.newId?.() ?? crypto.randomUUID(),
      officeId: scope.officeId,
      hash,
      // 元の形（写真か、頁の並ぶ文書か）。送られたのは頁の画像。Excel・Word（T119）は頁の並ぶ文書として PDF と同じ印
      // （form_mappings.source_kind の CHECK は image・pdf・manual。表を作り直さないための決め。docs/progress/t119.md）
      kind: got.pages[0].meta.source === "photo" ? "image" : "pdf",
      // 頁の番号は受けた画像の順（下に敷く画像と合わせる）
      mapping: fitPages(read.mapping, files.length),
      model: read.mark.model,
      by: scope.accountId,
      at: deps.now?.() ?? new Date().toISOString(),
    });
    if (!saved.reused) await storePageImages(deps.db, deps.bucket, { officeId: scope.officeId, mappingId: saved.id, images: parts });
    return Response.json(
      { ok: true, id: saved.id, reused: saved.reused, rejected: read.rejected.length, unread: read.unread, partial: read.partial },
      { headers: NO_STORE },
    );
  } catch (e) {
    const res = mappingErrorOf(e);
    if (res) return res;
    console.error("様式の読み取りに失敗", e instanceof Error ? e.name : typeof e);
    return mappingError("ai_failed");
  }
}

/**
 * 読めなかった頁を読み直す（T120）。置いた頁の画像（R2）から mapping.unread の頁だけを読み、欄を足して unread から外す。
 * 対応表の状態（下書き・確認済）は変えず、版を 1 つ上げる。版が違えば conflict（画面に直しかけがあるときは押せない）
 */
export async function formRereadPost(deps: FormReadDeps, scope: FormsScope, id: string, version: number): Promise<Response> {
  const stored = await getMapping(deps.db, scope.officeId, id);
  if (!stored) return mappingError("not_found");
  if (stored.version !== version) return mappingError("conflict");
  const unread = stored.mapping.unread ?? [];
  if (unread.length === 0) return Response.json({ ok: true, version: stored.version, mapping: stored.mapping, unread: [] }, { headers: NO_STORE });
  // 頁の画像を置けなかった対応表は読み直せない（受けた画像を持たない）
  if (!stored.pageImages) return mappingError("not_found");

  const files: FormFile[] = [];
  const pageNumbers: number[] = [];
  for (const page of unread) {
    const obj = await deps.bucket.get(pageImageKey(scope.officeId, id, page));
    if (!obj) continue;
    const bytes = new Uint8Array(await new Response(obj.body as BodyInit).arrayBuffer());
    // 置いた画像は受けたときに確かめた物（塗った後の JPEG、付け足しなし）。読み直す前にもう一度同じ確かめを通す
    const checked = checkRedactedImage(bytes);
    if (!checked.ok) continue;
    files.push(checked.file);
    pageNumbers.push(page);
  }
  if (files.length === 0) return mappingError("not_found");

  try {
    const ctx = await deps.aiContext(scope.officeId);
    const read = await readForm(files, ctx, { concurrency: deps.readConcurrency, pageNumbers, pages: stored.mapping.pages });
    const mapping = mergeReread(stored.mapping, read.mapping, read.unread);
    const saved = await updateReadMapping(deps.db, { officeId: scope.officeId, id, version, mapping, at: deps.now?.() ?? new Date().toISOString() });
    if (!saved.ok) return mappingError(saved.error);
    return Response.json({ ok: true, version: saved.version, mapping, unread: mapping.unread ?? [] }, { headers: NO_STORE });
  } catch (e) {
    const res = mappingErrorOf(e);
    if (res) return res;
    console.error("様式の読み直しに失敗", e instanceof Error ? e.name : typeof e);
    return mappingError("ai_failed");
  }
}

/** 読み直した頁の欄を、今の対応表の後ろに足す（欄の id は続きの番号に振り直す）。まだ読めない頁は unread に残す */
export function mergeReread(cur: FormMapping, read: FormMapping, stillUnread: readonly number[]): FormMapping {
  const fields = [...cur.fields];
  for (const f of read.fields) fields.push({ ...f, id: nextFieldId(fields) });
  const { unread: _drop, ...rest } = cur;
  return {
    ...rest,
    title: cur.title || read.title,
    issuer: cur.issuer || read.issuer,
    fields,
    ...(stillUnread.length > 0 ? { unread: [...stillUnread] } : {}),
  };
}
