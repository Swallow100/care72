// 種のデータを SQL の文にする。手元の D1 に入れる（npm run db:seed）ときと、テストで使う。
// 入れる前に全部の表を空にするので、何度流しても同じ状態になる。

import {
  SEED_ACCOUNTS,
  SEED_AT,
  SEED_OFFICES,
  SEED_PEOPLE,
  seedConsents,
  type SeedPerson,
} from "./people.ts";

type SqlValue = string | number | boolean | null | undefined;

function lit(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`数でない値: ${v}`);
    return String(v);
  }
  return `'${v.replaceAll("'", "''")}'`;
}

function insert(table: string, row: Record<string, SqlValue>): string {
  const cols = Object.keys(row);
  const vals = cols.map((c) => lit(row[c]));
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
}

/** 子の表から消す（外部キーの順） */
const CLEAR_ORDER = [
  "timeline_entries",
  "signals",
  "drill_events",
  "drills",
  "clocks",
  "consents",
  "contacts",
  "people",
  "accounts",
  "offices",
];

function personStatements(p: SeedPerson): string[] {
  const out: string[] = [];
  out.push(
    insert("people", {
      ...p.person,
      ledger: JSON.stringify(p.ledger),
      version: 1,
      created_at: SEED_AT,
      updated_at: SEED_AT,
    }),
  );
  p.contacts.forEach((c, i) => {
    out.push(insert("contacts", { ...c, person_id: p.person.id, sort: i, created_at: SEED_AT }));
  });
  for (const c of seedConsents(p)) out.push(insert("consents", c));
  p.clocks.forEach((k, i) => {
    out.push(insert("clocks", { ...k, person_id: p.person.id, sort: i }));
  });
  return out;
}

export function seedStatements(): string[] {
  const out: string[] = CLEAR_ORDER.map((t) => `DELETE FROM ${t};`);
  for (const o of SEED_OFFICES) out.push(insert("offices", { ...o, created_at: SEED_AT }));
  for (const a of SEED_ACCOUNTS) out.push(insert("accounts", { ...a, created_at: SEED_AT }));
  for (const p of SEED_PEOPLE) out.push(...personStatements(p));
  return out;
}

export function seedSql(): string {
  return `-- npm run db:seed が seed/people.ts から作る。手で直さない。\n${seedStatements().join("\n")}\n`;
}
