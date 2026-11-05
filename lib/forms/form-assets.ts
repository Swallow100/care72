// 事業所が紙に置く画像（地図・写真・図。T135、migrations/0033_form_entries.sql の form_assets）。サーバーだけ。
// - GET /api/forms/assets: 事業所の画像の一覧（外した物を除く、新しい順）
// - POST /api/forms/assets: 取り込む（JPEG・PNG。ブラウザが長い辺 2000px まで縮めた物。中身の頭の字で形を確かめる）
// - GET /api/forms/assets/<id>: 画像を返す（紙の <img> と印刷）
// 本体は R2 の RECORDINGS の forms/<事業所>/assets/<id>.<jpg|png>（デモ事業所の戻しと試用事業所の掃除は forms/<事業所>/ の下を消す）。
// 壁: ケアマネの役で事業所があること（formsScope）。ほかの事業所の画像は 404。private, no-store。
// 画像は紙に置くだけで、Claude に送らない（様式の読み取り・入れる欄の読み取りの受け口とは別の道。読み取りの道からここを読まない）。
// 人の顔写真や名前の入った画像も置けるが、置いた紙と同じく事業所の中だけに留まる。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { FORM_FILE_MAX_BYTES } from "./mapping.ts";
import { formsScope } from "./mapping-db.ts";
import { pageImagePrefix, type PageImageBucket } from "./page-images.ts";
import { ASSET_KINDS, type AssetInfo, type AssetKind } from "./paper-fill.ts";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
const ID = /^as-[a-f0-9]{16}$/;
/** 1 事業所の画像の数の上限 */
export const ASSET_MAX = 100;

export const assetKey = (officeId: string, id: string, type: "image/jpeg" | "image/png") => `${pageImagePrefix(officeId)}assets/${id}.${type === "image/png" ? "png" : "jpg"}`;
export const assetSrc = (id: string) => `/api/forms/assets/${encodeURIComponent(id)}`;

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413, label: string) => Response.json({ ok: false, label }, { status, headers: HEADERS });

/** 頭の字で JPEG・PNG を見分ける */
export function sniffImage(head: Uint8Array): "image/jpeg" | "image/png" | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  return null;
}

type AssetRow = { id: string; name: string; kind: AssetKind; width: number; height: number };

/** 事業所の画像（外した物を除く） */
export async function listAssets(db: D1Database, officeId: string): Promise<AssetInfo[]> {
  const r = await db
    .prepare("SELECT id, name, kind, width, height FROM form_assets WHERE office_id = ?1 AND removed_at IS NULL ORDER BY created_at DESC, id LIMIT ?2")
    .bind(officeId, ASSET_MAX)
    .all<AssetRow>();
  return (r.results ?? []).map((a) => ({ ...a, src: assetSrc(a.id) }));
}

/** 紙に置いた画像の元（外した画像も、置いた紙には残す） */
export async function assetsByIds(db: D1Database, officeId: string, ids: readonly string[]): Promise<Map<string, { id: string; name: string; src: string }>> {
  const out = new Map<string, { id: string; name: string; src: string }>();
  const want = [...new Set(ids)].filter((x) => ID.test(x));
  if (want.length === 0) return out;
  const r = await db
    .prepare(`SELECT id, name FROM form_assets WHERE office_id = ?1 AND id IN (${want.map((_, i) => `?${i + 2}`).join(", ")})`)
    .bind(officeId, ...want)
    .all<{ id: string; name: string }>();
  for (const a of r.results ?? []) out.set(a.id, { id: a.id, name: a.name, src: assetSrc(a.id) });
  return out;
}

export async function assetsGet(db: D1Database, p: Principal | null): Promise<Response> {
  if (!p) return fail(401, "ログイン要");
  const scope = formsScope(p);
  if (!scope) return fail(403, "権限なし");
  return Response.json({ ok: true, assets: await listAssets(db, scope.officeId) }, { headers: HEADERS });
}

/**
 * 取り込む。form は file（JPEG・PNG、5MB まで）・name（40 字まで）・kind（地図・写真・図）・width・height（ブラウザが読んだ大きさ）
 */
export async function assetsPost(
  db: D1Database,
  bucket: Pick<PageImageBucket, "put">,
  p: Principal | null,
  form: FormData,
  now = new Date(),
): Promise<Response> {
  if (!p) return fail(401, "ログイン要");
  const scope = formsScope(p);
  if (!scope || p.role !== "care_manager") return fail(403, "権限なし");
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  if (!(file instanceof Blob) || !name || [...name].length > 40 || !(ASSET_KINDS as readonly string[]).includes(kind)) return fail(400, "形式不正");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8000 || height > 8000) return fail(400, "形式不正");
  if (file.size < 1 || file.size > FORM_FILE_MAX_BYTES) return fail(413, "容量超過");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes.subarray(0, 8));
  if (!type) return fail(400, "形式不正");
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM form_assets WHERE office_id = ?1 AND removed_at IS NULL")
    .bind(scope.officeId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= ASSET_MAX) return fail(409, "上限超過");
  const id = `as-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await bucket.put(assetKey(scope.officeId, id, type), bytes, { httpMetadata: { contentType: type } });
  await db
    .prepare(
      `INSERT INTO form_assets (id, office_id, kind, name, content_type, width, height, bytes, author_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(id, scope.officeId, kind, name, type, width, height, bytes.length, scope.accountId, now.toISOString())
    .run();
  const asset: AssetInfo = { id, name, kind: kind as AssetKind, width, height, src: assetSrc(id) };
  return Response.json({ ok: true, asset }, { headers: HEADERS });
}

export async function assetGet(db: D1Database, bucket: Pick<PageImageBucket, "get">, p: Principal | null, id: string): Promise<Response> {
  if (!p) return fail(401, "ログイン要");
  const scope = formsScope(p);
  if (!scope) return fail(403, "権限なし");
  if (!ID.test(id)) return fail(404, "該当なし");
  const row = await db
    .prepare("SELECT content_type FROM form_assets WHERE id = ?1 AND office_id = ?2")
    .bind(id, scope.officeId)
    .first<{ content_type: "image/jpeg" | "image/png" }>();
  if (!row) return fail(404, "該当なし");
  const obj = await bucket.get(assetKey(scope.officeId, id, row.content_type));
  if (!obj) return fail(404, "該当なし");
  return new Response(obj.body as BodyInit, { status: 200, headers: { ...HEADERS, "Content-Type": row.content_type, "Content-Length": String(obj.size) } });
}
