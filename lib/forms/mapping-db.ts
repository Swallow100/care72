// 様式の対応表を D1 に読み書きする（表 form_mappings）。範囲は事業所（事業所の壁）。
// 開けるのはケアマネの役（管理者・審査員のケアマネの役を含む）。行政・医療班・本人・家族は開けない（formsScope が null）。
// 差し込み（lib/forms/mapped-sheet.ts）に使うのは確かめた物（checked）だけ（loadCheckedMapping）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { canViewPage } from "../auth/roles.ts";
import type { FormMappingRow, FormMappingStatus, FormSourceKind } from "../db/types.ts";
import { isLedgerItemKey, mappingStats, parseMappingInput, type FormMapping, type MappingStats } from "./mapping.ts";
import { parsePageImages, type PageImage } from "./page-images.ts";

export type FormsScope = { officeId: string; accountId: string | null };

/** 対応表を開ける人と範囲。ケアマネの役で、事業所があること。範囲は事業所の対応表 */
export function formsScope(p: Principal | null): FormsScope | null {
  if (!p || !canViewPage(p.role, "caseload") || !p.office) return null;
  return { officeId: p.office.id, accountId: p.accountId };
}

// ---------- 読む ----------

/** 保存した JSON を対応表に。項目の一覧から消えた key は対応なし（null）にして読む。壊れていれば null */
export function readStoredMapping(json: string): FormMapping | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { fields?: unknown }).fields)) {
    for (const f of (raw as { fields: Array<Record<string, unknown>> }).fields) {
      if (f && typeof f === "object") {
        if (f.item !== null && !isLedgerItemKey(f.item)) f.item = null;
        const ai = f.ai as Record<string, unknown> | null | undefined;
        if (ai && typeof ai === "object" && ai.item !== null && !isLedgerItemKey(ai.item)) ai.item = null;
      }
    }
  }
  const parsed = parseMappingInput(raw);
  return parsed.ok ? parsed.mapping : null;
}

export type StoredMapping = Omit<FormMappingRow, "mapping"> & {
  mapping: FormMapping;
  /** 様式の頁の画像（T86）。無い・壊れていれば null */
  pageImages: PageImage[] | null;
  checked_by_name: string | null;
  created_by_name: string | null;
};

const SELECT = `SELECT m.id, m.office_id, m.title, m.form_hash, m.source_kind, m.mapping, m.status, m.ai_model,
       m.created_by, m.created_at, m.checked_by, m.checked_at, m.version, m.updated_at, m.page_images,
       c.display_name AS checked_by_name, b.display_name AS created_by_name
  FROM form_mappings m
  LEFT JOIN accounts c ON c.id = m.checked_by
  LEFT JOIN accounts b ON b.id = m.created_by`;

type Joined = FormMappingRow & { checked_by_name: string | null; created_by_name: string | null };

function toStored(r: Joined): StoredMapping | null {
  const mapping = readStoredMapping(r.mapping);
  return mapping ? { ...r, mapping, pageImages: parsePageImages(r.page_images) } : null;
}

/** 事業所の対応表 1 つ。範囲の外・壊れた物は null */
export async function getMapping(db: D1Database, officeId: string, id: string): Promise<StoredMapping | null> {
  const r = await db.prepare(`${SELECT} WHERE m.id = ?1 AND m.office_id = ?2`).bind(id, officeId).first<Joined>();
  return r ? toStored(r) : null;
}

/** 差し込みに使う対応表（確かめた物だけ）。下書き・範囲の外は null */
export async function loadCheckedMapping(db: D1Database, officeId: string, id: string): Promise<StoredMapping | null> {
  const m = await getMapping(db, officeId, id);
  return m && m.status === "checked" ? m : null;
}

export type MappingSummary = {
  id: string;
  title: string;
  issuer: string;
  status: FormMappingStatus;
  sourceKind: FormSourceKind;
  stats: MappingStats;
  checkedAt: string | null;
  checkedByName: string | null;
  updatedAt: string;
};

/** 事業所の対応表の一覧（新しく直した順） */
export async function listMappings(db: D1Database, officeId: string): Promise<MappingSummary[]> {
  const { results } = await db.prepare(`${SELECT} WHERE m.office_id = ?1 ORDER BY m.updated_at DESC, m.id`).bind(officeId).all<Joined>();
  const out: MappingSummary[] = [];
  for (const r of results) {
    const s = toStored(r);
    if (!s) continue;
    out.push({
      id: s.id,
      title: s.title,
      issuer: s.mapping.issuer,
      status: s.status,
      sourceKind: s.source_kind,
      stats: mappingStats(s.mapping),
      checkedAt: s.checked_at,
      checkedByName: s.checked_by_name,
      updatedAt: s.updated_at,
    });
  }
  return out;
}

/** 同じ写真・PDF から作った対応表（読み直さないため）。無ければ null。page_images は頁の画像を置いたか（T86） */
export async function findMappingByHash(
  db: D1Database,
  officeId: string,
  hash: string,
): Promise<{ id: string; status: FormMappingStatus; page_images: string | null } | null> {
  return db
    .prepare("SELECT id, status, page_images FROM form_mappings WHERE office_id = ?1 AND form_hash = ?2")
    .bind(officeId, hash)
    .first<{ id: string; status: FormMappingStatus; page_images: string | null }>();
}

/** 差し込みの宛先（事業所の本人。カナの順） */
export async function officePeople(db: D1Database, officeId: string): Promise<Array<{ id: string; name: string; kana: string }>> {
  const { results } = await db
    .prepare("SELECT id, name, kana FROM people WHERE office_id = ?1 ORDER BY kana, id")
    .bind(officeId)
    .all<{ id: string; name: string; kana: string }>();
  return results;
}

// ---------- 書く ----------

export type NewReadMapping = {
  id: string;
  officeId: string;
  hash: string;
  kind: Exclude<FormSourceKind, "manual">;
  mapping: FormMapping;
  model: string;
  by: string | null;
  at: string;
  /** 一覧の公式の様式から作った物（T134。様式の id とサーバーが取った版） */
  catalog?: { id: string; sha256: string } | null;
};

/**
 * AI が読んだ対応表を下書きで足す（T134: 一覧の様式の共有の対応表を写した物も）。同じ写真・PDF が同じ事業所に既にあれば足さずにその id を返す（同時に読んだときも 1 つ）
 */
export async function insertReadMapping(db: D1Database, m: NewReadMapping): Promise<{ id: string; reused: boolean }> {
  const r = await db
    .prepare(
      `INSERT INTO form_mappings (id, office_id, title, form_hash, source_kind, mapping, status, ai_model, created_by, created_at, version, updated_at, catalog_id, catalog_sha256)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?9, 1, ?9, ?10, ?11)
       ON CONFLICT (office_id, form_hash) DO NOTHING`,
    )
    .bind(m.id, m.officeId, m.mapping.title, m.hash, m.kind, JSON.stringify(m.mapping), m.model, m.by, m.at, m.catalog?.id ?? null, m.catalog?.sha256 ?? null)
    .run();
  if ((r.meta.changes ?? 0) > 0) return { id: m.id, reused: false };
  const found = await findMappingByHash(db, m.officeId, m.hash);
  if (!found) throw new Error("対応表を足せない");
  return { id: found.id, reused: true };
}

/** 手で作る対応表（AI 未設定のときの道。欄は確かめる画面で足す） */
export async function insertManualMapping(
  db: D1Database,
  m: { id: string; officeId: string; title: string; by: string | null; at: string },
): Promise<string> {
  const mapping: FormMapping = { title: m.title, issuer: "", pages: 1, fields: [] };
  await db
    .prepare(
      `INSERT INTO form_mappings (id, office_id, title, form_hash, source_kind, mapping, status, ai_model, created_by, created_at, version, updated_at)
       VALUES (?1, ?2, ?3, NULL, 'manual', ?4, 'draft', NULL, ?5, ?6, 1, ?6)`,
    )
    .bind(m.id, m.officeId, mapping.title, JSON.stringify(mapping), m.by, m.at)
    .run();
  return m.id;
}

export type SaveResult = { ok: true; version: number } | { ok: false; error: "conflict" | "not_found" };

/**
 * 確かめた対応表を保存する（確認済にする）。版が違えば conflict（ほかの人が先に保存した）。範囲の外は not_found
 */
export async function saveCheckedMapping(
  db: D1Database,
  s: { officeId: string; id: string; version: number; mapping: FormMapping; by: string | null; at: string },
): Promise<SaveResult> {
  const r = await db
    .prepare(
      `UPDATE form_mappings
          SET title = ?1, mapping = ?2, status = 'checked', checked_by = ?3, checked_at = ?4, version = version + 1, updated_at = ?4
        WHERE id = ?5 AND office_id = ?6 AND version = ?7`,
    )
    .bind(s.mapping.title, JSON.stringify(s.mapping), s.by, s.at, s.id, s.officeId, s.version)
    .run();
  if ((r.meta.changes ?? 0) > 0) return { ok: true, version: s.version + 1 };
  const exists = await db.prepare("SELECT version FROM form_mappings WHERE id = ?1 AND office_id = ?2").bind(s.id, s.officeId).first<{ version: number }>();
  return { ok: false, error: exists ? "conflict" : "not_found" };
}

/**
 * 読み直した対応表を書く（T120。読めなかった頁を読み直したとき）。AI の読んだ欄が足されるので、確認済でも下書きに戻し
 * （確かめた人と時を外す。差し込みに使うのは人が確かめた物だけ）、版を 1 つ上げる。
 * 版が違えば conflict。範囲の外は not_found
 */
export async function updateReadMapping(
  db: D1Database,
  s: { officeId: string; id: string; version: number; mapping: FormMapping; at: string },
): Promise<SaveResult> {
  const r = await db
    .prepare(
      `UPDATE form_mappings
          SET title = ?1, mapping = ?2, status = 'draft', checked_by = NULL, checked_at = NULL, version = version + 1, updated_at = ?3
        WHERE id = ?4 AND office_id = ?5 AND version = ?6`,
    )
    .bind(s.mapping.title, JSON.stringify(s.mapping), s.at, s.id, s.officeId, s.version)
    .run();
  if ((r.meta.changes ?? 0) > 0) return { ok: true, version: s.version + 1 };
  const exists = await db.prepare("SELECT version FROM form_mappings WHERE id = ?1 AND office_id = ?2").bind(s.id, s.officeId).first<{ version: number }>();
  return { ok: false, error: exists ? "conflict" : "not_found" };
}
