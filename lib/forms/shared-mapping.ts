// 様式の対応表の共有（T134、migration 0031 の form_shared_mappings）。サーバーだけ。
//
// 一覧（lib/forms/municipal-forms.ts）の公式の様式は、版（サーバーが公式の URL から取ったファイルの SHA-256）と送った頁の組
// （元のファイルの頁の番号）が同じなら、欄の位置（頁の画像の比 0〜1）と台帳の項目の当てが事業所をまたいで同じになる。
// 対応表は様式の欄の名前・場所・項目だけで、人の値は入らない（白紙の公式の様式を読んだ物）。
// - 入れる: AI が全部の頁を読めた（読めなかった頁・出力の上限で切れた頁が無い）ときだけ、AI の答えそのもの（事業所が直す前）
// - 写す: 事業所の下書きの対応表にする（form_mappings。確かめ・手直しは事業所ごと）。人が確かめた印・保留の選びは写さない
// - 先に入った物を残す（ON CONFLICT DO NOTHING）。事業所の手直しはここを変えない

import type { D1Database } from "@cloudflare/workers-types";
import { fitPages, type FormMapping } from "./mapping.ts";
import { readStoredMapping } from "./mapping-db.ts";

export type SharedKey = { catalogId: string; sha256: string; pages: string };

/** 送った頁の組の形（元のファイルの頁の番号を , で）。1〜200 の数が 1〜3 個 */
export function pagesKeyOf(origins: readonly number[]): string | null {
  if (origins.length === 0 || origins.length > 3) return null;
  if (origins.some((n) => !Number.isInteger(n) || n < 1 || n > 200)) return null;
  return origins.join(",");
}

export type SharedMapping = { mapping: FormMapping; aiModel: string };

/** 共有の対応表を読む。無い・壊れていれば null */
export async function getSharedMapping(db: D1Database, k: SharedKey): Promise<SharedMapping | null> {
  const r = await db
    .prepare("SELECT mapping, ai_model FROM form_shared_mappings WHERE catalog_id = ?1 AND sha256 = ?2 AND pages = ?3")
    .bind(k.catalogId, k.sha256, k.pages)
    .first<{ mapping: string; ai_model: string }>();
  if (!r) return null;
  const mapping = readStoredMapping(r.mapping);
  return mapping ? { mapping, aiModel: r.ai_model } : null;
}

/** 共有に入れる形（事業所の確かめの印・保留の選びを外す。欄は外していない AI の答えのまま） */
export function sharedForm(m: FormMapping): FormMapping {
  const { holdRisky: _hold, ...rest } = m;
  return { ...rest, fields: m.fields.map(({ confirmed: _c, ...f }) => ({ ...f })) };
}

/** 事業所の下書きに写す形（頁の数を送った頁の数に合わせる） */
export function copyShared(m: FormMapping, pages: number): FormMapping {
  return fitPages(sharedForm(m), pages);
}

/** 共有に入れる（先に入った物があれば入れない）。入れたら true */
export async function putSharedMapping(
  db: D1Database,
  s: SharedKey & { mapping: FormMapping; aiModel: string; sourceOffice: string; at: string },
): Promise<boolean> {
  if (s.mapping.unread && s.mapping.unread.length > 0) return false;
  const r = await db
    .prepare(
      `INSERT INTO form_shared_mappings (catalog_id, sha256, pages, mapping, ai_model, source_office, created_at, uses)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
       ON CONFLICT (catalog_id, sha256, pages) DO NOTHING`,
    )
    .bind(s.catalogId, s.sha256, s.pages, JSON.stringify(sharedForm(s.mapping)), s.aiModel, s.sourceOffice, s.at)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** 写した回数を 1 つ足す */
export async function countSharedUse(db: D1Database, k: SharedKey): Promise<void> {
  await db
    .prepare("UPDATE form_shared_mappings SET uses = uses + 1 WHERE catalog_id = ?1 AND sha256 = ?2 AND pages = ?3")
    .bind(k.catalogId, k.sha256, k.pages)
    .run();
}

/** 共有の対応表がある一覧の様式（一覧の版と同じ版の物だけ）。画面の「共有済」の印 */
export async function sharedCatalogIds(db: D1Database, current: ReadonlyArray<{ id: string; sha256: string }>): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT DISTINCT catalog_id, sha256 FROM form_shared_mappings").all<{ catalog_id: string; sha256: string }>();
  const want = new Map(current.map((c) => [c.id, c.sha256]));
  return new Set(results.filter((r) => want.get(r.catalog_id) === r.sha256).map((r) => r.catalog_id));
}

/** 事業所が一覧の様式から作った対応表（様式の id → 新しい物 1 つ） */
export async function officeCatalogMappings(
  db: D1Database,
  officeId: string,
): Promise<Record<string, { id: string; status: "draft" | "checked"; sha256: string }>> {
  const { results } = await db
    .prepare(
      `SELECT id, status, catalog_id, catalog_sha256 FROM form_mappings
        WHERE office_id = ?1 AND catalog_id IS NOT NULL ORDER BY updated_at DESC, id`,
    )
    .bind(officeId)
    .all<{ id: string; status: "draft" | "checked"; catalog_id: string; catalog_sha256: string }>();
  const out: Record<string, { id: string; status: "draft" | "checked"; sha256: string }> = {};
  for (const r of results) if (!out[r.catalog_id]) out[r.catalog_id] = { id: r.id, status: r.status, sha256: r.catalog_sha256 };
  return out;
}
