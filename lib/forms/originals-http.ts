// 元の様式の原本（T101、lib/forms/originals.ts）の受け口。サーバーだけ。
//
// - GET  /api/forms/originals/<id>/source: 公式の URL（ORIGINALS の url だけ。ほかの URL は取らない）から PDF を取り、
//   版のハッシュを確かめて返す（ブラウザから公式の頁へは CORS で取れないため）。事業所に置かない
// - POST /api/forms/originals/<id>: 原本の PDF と、ブラウザが刷る解像度で描いた頁の PNG を受け、PDF のハッシュ・PNG の形を確かめて
//   R2 の forms/<事業所>/originals/<id>/ に置く（PDF は置かない）。manifest.json に版と頁の大きさ
// - GET  /api/forms/originals/<id>/pages/<頁>: 置いた頁の PNG を返す（紙面の下に敷く）
// 壁: ケアマネの役で事業所のある人（formsScope）。ログインなし 401、役の外 403、無い原本・無い頁は 404。
// 中身は白紙の公式の様式で人の値は入らないが、事業所の物なので手元に残さない（private, no-store）。Claude は呼ばない。

import type { Principal } from "../auth/principal.ts";
import { formsScope } from "./mapping-db.ts";
import {
  isOriginalId,
  ORIGINAL_ERROR_LABELS,
  ORIGINALS,
  originalManifestKey,
  originalPageKey,
  parseManifest,
  pngFitsPage,
  pngSize,
  RASTER_MAX_BYTES,
  sha256Hex,
  type OriginalError,
  type OriginalId,
  type OriginalManifest,
  type OriginalPage,
} from "./originals.ts";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
/** 公式の PDF の大きさの上限（今の版は 0.7MB） */
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;

/** R2 のうち使う所（配信は env.RECORDINGS、テストは偽物） */
export type OriginalBucket = {
  put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: unknown; size: number; text(): Promise<string> } | null>;
};


const STATUS: Record<OriginalError, number> = {
  login_required: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  version: 409,
  source_failed: 502,
  store_failed: 500,
};

export function originalError(e: OriginalError): Response {
  return Response.json({ ok: false, error: e, label: ORIGINAL_ERROR_LABELS[e] }, { status: STATUS[e], headers: HEADERS });
}

/** 壁を通った事業所と原本の id。通らなければ断りの Response */
function gate(p: Principal | null, idRaw: string): { officeId: string; id: OriginalId } | Response {
  if (!p) return originalError("login_required");
  const scope = formsScope(p);
  if (!scope) return originalError("forbidden");
  if (!isOriginalId(idRaw)) return originalError("not_found");
  return { officeId: scope.officeId, id: idRaw };
}

/** 取り込んだ原本の記録を読む。無い・版が違う・壊れていれば null（前からの紙面で出す） */
export async function loadOriginal(bucket: Pick<OriginalBucket, "get">, officeId: string, id: OriginalId): Promise<OriginalManifest | null> {
  try {
    const obj = await bucket.get(originalManifestKey(officeId, id));
    return obj ? parseManifest(id, await obj.text()) : null;
  } catch (e) {
    console.error("原本の記録を読めない", e instanceof Error ? e.name : typeof e);
    return null;
  }
}

/** GET 頁の PNG */
export async function originalPageGet(bucket: Pick<OriginalBucket, "get">, p: Principal | null, idRaw: string, pageRaw: string): Promise<Response> {
  const g = gate(p, idRaw);
  if (g instanceof Response) return g;
  if (!/^[1-9]$/.test(pageRaw)) return originalError("not_found");
  const page = Number(pageRaw);
  const manifest = await loadOriginal(bucket, g.officeId, g.id);
  if (!manifest || !manifest.pages.some((x) => x.page === page)) return originalError("not_found");
  const obj = await bucket.get(originalPageKey(g.officeId, g.id, page));
  if (!obj) return originalError("not_found");
  return new Response(obj.body as BodyInit, { status: 200, headers: { ...HEADERS, "Content-Type": "image/png", "Content-Length": String(obj.size) } });
}

/** 公式の URL から取る道（テストは偽物） */
export type SourceFetch = (url: string) => Promise<Response>;

/** GET 公式の PDF（版を確かめて返す） */
export async function originalSourceGet(fetcher: SourceFetch, p: Principal | null, idRaw: string): Promise<Response> {
  const g = gate(p, idRaw);
  if (g instanceof Response) return g;
  const spec = ORIGINALS[g.id];
  let bytes: Uint8Array;
  try {
    const res = await fetcher(spec.url);
    if (!res.ok) return originalError("source_failed");
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > SOURCE_MAX_BYTES) return originalError("source_failed");
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.error("公式の様式を取れない", e instanceof Error ? e.name : typeof e);
    return originalError("source_failed");
  }
  if (bytes.length > SOURCE_MAX_BYTES) return originalError("source_failed");
  if ((await sha256Hex(bytes)) !== spec.sha256) return originalError("version");
  return new Response(bytes as BodyInit, { status: 200, headers: { ...HEADERS, "Content-Type": "application/pdf" } });
}

/** POST の大きさの上限（PDF ＋ 頁の PNG ＋ multipart の枠） */
export const IMPORT_MAX_BYTES = SOURCE_MAX_BYTES + RASTER_MAX_BYTES * 2 + 64 * 1024;

/** POST 原本の取り込み。form: pdf（原本の PDF）、page<N>（usePages の頁の PNG） */
export async function originalImportPost(
  bucket: OriginalBucket,
  p: Principal | null,
  idRaw: string,
  form: FormData,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const g = gate(p, idRaw);
  if (g instanceof Response) return g;
  const spec = ORIGINALS[g.id];
  const pdf = form.get("pdf");
  if (!(pdf instanceof Blob) || pdf.size === 0 || pdf.size > SOURCE_MAX_BYTES) return originalError("invalid");
  if ((await sha256Hex(new Uint8Array(await pdf.arrayBuffer()))) !== spec.sha256) return originalError("version");
  const pages: Array<OriginalPage & { data: Uint8Array }> = [];
  for (const n of spec.usePages) {
    const f = form.get(`page${n}`);
    if (!(f instanceof Blob) || f.size === 0 || f.size > RASTER_MAX_BYTES) return originalError("invalid");
    const data = new Uint8Array(await f.arrayBuffer());
    const size = pngSize(data);
    if (!size || !pngFitsPage(size, spec.pageMm)) return originalError("invalid");
    pages.push({ page: n, ...size, bytes: data.length, data });
  }
  const manifest: OriginalManifest = {
    id: g.id,
    sha256: spec.sha256,
    pages: pages.map(({ data: _data, ...x }) => x),
    importedAt: now().toISOString(),
  };
  try {
    for (const x of pages) await bucket.put(originalPageKey(g.officeId, g.id, x.page), x.data, { httpMetadata: { contentType: "image/png" } });
    // 頁を置き終えてから記録（途中で失敗しても記録の無い原本は使わない）
    await bucket.put(originalManifestKey(g.officeId, g.id), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    console.error("原本を置けない", e instanceof Error ? e.name : typeof e);
    return originalError("store_failed");
  }
  return Response.json({ ok: true, pages: manifest.pages.length }, { headers: HEADERS });
}
