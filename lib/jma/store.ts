// 気象庁の写しを D1 に書く・読む（T72、migrations/0020_jma.sql）。cron（lib/jma/cron.ts）と手元の道具（tools/jma/local.ts）が書き、
// 事業所の画面（lib/jma/alerts.ts）が読む。D1 は引数で受ける（テストは node:sqlite）。
// D1 の 1 回の要求の数と 1 日の書き込みの行数を抑えるため、行は JSON の配列 1 つを json_each で入れる（電文の数によらず数文）。

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { JmaEntryRow, JmaFeed, JmaFetchStateRow, JmaQuakePointRow, JmaQuakeRow, JmaWarningRow } from "../db/types.ts";

/** 電文を残す日数。取るたびにこれより古い電文（と子の行）を消す */
export const RETAIN_DAYS = 7;

/** 1 つの文に入れる行の数の上限（JSON の大きさを抑える） */
const CHUNK = 400;

/** 写す電文 1 通（記録の行と、警報・地震・観測点の行） */
export type StoredEntry = {
  entry: JmaEntryRow;
  warnings: JmaWarningRow[];
  quake: JmaQuakeRow | null;
  points: JmaQuakePointRow[];
};

function chunks<T>(rows: ReadonlyArray<T>): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** RETAIN_DAYS より古い電文と、その子の行を消す */
export async function pruneOld(db: D1Database, now: string): Promise<void> {
  const cutoff = new Date(Date.parse(now) - RETAIN_DAYS * 86_400_000).toISOString();
  const old = "SELECT id FROM jma_entries WHERE updated_at < ?1";
  await db.batch([
    db.prepare(`DELETE FROM jma_quake_points WHERE entry_id IN (${old})`).bind(cutoff),
    db.prepare(`DELETE FROM jma_quakes WHERE entry_id IN (${old})`).bind(cutoff),
    db.prepare(`DELETE FROM jma_warnings WHERE entry_id IN (${old})`).bind(cutoff),
    db.prepare("DELETE FROM jma_entries WHERE updated_at < ?1").bind(cutoff),
  ]);
}

/** もう取った電文の id */
export async function knownIds(db: D1Database, ids: ReadonlyArray<string>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks(ids)) {
    const res = await db
      .prepare("SELECT id FROM jma_entries WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(part))
      .all<{ id: string }>();
    for (const r of res.results) out.add(r.id);
  }
  return out;
}

/**
 * 写す市（事業所の地域の市〔主な市と周りの市、T148〕と、一覧から外していない利用者の住所の市）。全国の行を写さず、ここに当たる市町村の行だけを写す。
 * 利用者の市は台帳の basic.address.city（T68 で画面から入れられる）。周りの市は offices.region_cities（JSON の配列、migration 0035）
 */
export async function relevantCities(db: D1Database): Promise<string[]> {
  const [offices, people] = await db.batch<{ city: string | null }>([
    db.prepare(
      `SELECT city FROM offices
       UNION ALL SELECT j.value FROM offices o, json_each(CASE WHEN json_valid(o.region_cities) THEN o.region_cities ELSE '[]' END) j`,
    ),
    db.prepare("SELECT DISTINCT json_extract(ledger, '$.basic.address.city') AS city FROM people WHERE unlisted_at IS NULL"),
  ]);
  const all = [...offices.results, ...people.results].map((r) => (typeof r.city === "string" ? r.city.trim() : ""));
  return [...new Set(all.filter(Boolean))];
}

export async function loadFetchState(db: D1Database, feed: JmaFeed): Promise<JmaFetchStateRow | null> {
  return db.prepare("SELECT * FROM jma_fetch_state WHERE feed = ?1").bind(feed).first<JmaFetchStateRow>();
}

export async function loadFetchStates(db: D1Database): Promise<JmaFetchStateRow[]> {
  const res = await db.prepare("SELECT * FROM jma_fetch_state ORDER BY feed").all<JmaFetchStateRow>();
  return res.results;
}

export async function saveFetchState(db: D1Database, s: JmaFetchStateRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jma_fetch_state (feed, last_modified, fetched_at, ok, ok_at, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (feed) DO UPDATE SET last_modified = excluded.last_modified, fetched_at = excluded.fetched_at,
         ok = excluded.ok, ok_at = excluded.ok_at, note = excluded.note`,
    )
    .bind(s.feed, s.last_modified, s.fetched_at, s.ok, s.ok_at, s.note)
    .run();
}

/**
 * 電文を写す（1 つの batch。D1 の batch は 1 つの取引）。同じ id が先にあれば消してから入れ直す
 * （cron が重なって同じ電文を 2 回写しても行が二重にならない）
 */
export function storeStatements(db: D1Database, items: ReadonlyArray<StoredEntry>): D1PreparedStatement[] {
  if (items.length === 0) return [];
  const ids = JSON.stringify(items.map((i) => i.entry.id));
  const these = "SELECT value FROM json_each(?1)";
  const out: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM jma_quake_points WHERE entry_id IN (${these})`).bind(ids),
    db.prepare(`DELETE FROM jma_quakes WHERE entry_id IN (${these})`).bind(ids),
    db.prepare(`DELETE FROM jma_warnings WHERE entry_id IN (${these})`).bind(ids),
    db.prepare(`DELETE FROM jma_entries WHERE id IN (${these})`).bind(ids),
    db
      .prepare(
        `INSERT INTO jma_entries (id, feed, type_code, title, updated_at, fetched_at, note)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.feed'), json_extract(value, '$.type_code'), json_extract(value, '$.title'),
                json_extract(value, '$.updated_at'), json_extract(value, '$.fetched_at'), json_extract(value, '$.note')
           FROM json_each(?1)`,
      )
      .bind(JSON.stringify(items.map((i) => i.entry))),
  ];
  for (const part of chunks(items.flatMap((i) => i.warnings))) {
    out.push(
      db
        .prepare(
          `INSERT INTO jma_warnings (entry_id, type_code, area_code, area_name, kind, status, issued_at, office_name, sort)
           SELECT json_extract(value, '$.entry_id'), json_extract(value, '$.type_code'), json_extract(value, '$.area_code'),
                  json_extract(value, '$.area_name'), json_extract(value, '$.kind'), json_extract(value, '$.status'),
                  json_extract(value, '$.issued_at'), json_extract(value, '$.office_name'), json_extract(value, '$.sort')
             FROM json_each(?1)`,
        )
        .bind(JSON.stringify(part)),
    );
  }
  const quakes = items.flatMap((i) => (i.quake ? [i.quake] : []));
  if (quakes.length > 0) {
    out.push(
      db
        .prepare(
          `INSERT INTO jma_quakes (entry_id, type_code, event_id, info_type, report_at, origin_at, hypocenter, magnitude, max_intensity)
           SELECT json_extract(value, '$.entry_id'), json_extract(value, '$.type_code'), json_extract(value, '$.event_id'),
                  json_extract(value, '$.info_type'), json_extract(value, '$.report_at'), json_extract(value, '$.origin_at'),
                  json_extract(value, '$.hypocenter'), json_extract(value, '$.magnitude'), json_extract(value, '$.max_intensity')
             FROM json_each(?1)`,
        )
        .bind(JSON.stringify(quakes)),
    );
  }
  for (const part of chunks(items.flatMap((i) => i.points))) {
    out.push(
      db
        .prepare(
          `INSERT INTO jma_quake_points (entry_id, area_name, point_name, intensity)
           SELECT json_extract(value, '$.entry_id'), json_extract(value, '$.area_name'), json_extract(value, '$.point_name'),
                  json_extract(value, '$.intensity')
             FROM json_each(?1)`,
        )
        .bind(JSON.stringify(part)),
    );
  }
  return out;
}

export async function storeEntries(db: D1Database, items: ReadonlyArray<StoredEntry>): Promise<void> {
  const stmts = storeStatements(db, items);
  if (stmts.length > 0) await db.batch(stmts);
}
