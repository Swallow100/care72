// テストのための D1 の代わり。node:sqlite の DB を、D1 の prepare・bind・first・all・run の形で包む。
// 本物の D1（SQLite）と同じ SQL を手元で流して確かめるために使う。配信のコードからは使わない。

import type { D1Database } from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** migrations の *.sql を名前の順に全部流した空の DB（外部キーを効かせる）。wrangler の migrations apply と同じ順 */
export function migratedSqlite(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(name, dir), "utf8"));
  }
  return db;
}

export function d1FromSqlite(db: DatabaseSync): D1Database {
  const statement = (sql: string, params: SQLInputValue[]) => ({
    bind: (...args: unknown[]) => statement(sql, args as SQLInputValue[]),
    first: async (column?: string) => {
      const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
      if (!row) return null;
      return column ? row[column] : row;
    },
    all: async () => ({ success: true, results: db.prepare(sql).all(...params), meta: {} }),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql: string) => statement(sql, []),
    // D1 の batch は 1 つの取引で順に流す。ここでは順に all を呼ぶだけ（読むだけのテストに使う）
    batch: async (stmts: Array<ReturnType<typeof statement>>) => {
      const out = [];
      for (const s of stmts) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database;
}
