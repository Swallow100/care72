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

/**
 * 子の表から消す（外部キーの順）。migrations の表を全部並べる（表を足したらここにも。seed.test.ts が全部あるかと順を確かめる）。
 * ai_calls も消すので、事業所の 1 日の上限の数えも種に戻る（デモ事業所は毎日戻す決まり。docs/tasks/T26.md）。
 * 災害モード（disaster_state）は平時に、事業所の経過・様式 9 の手直し・様式の対応表は空に戻る
 */
export const CLEAR_ORDER = [
  "timeline_entries",
  "office_timeline_entries",
  "form9_rank_edits",
  "form_mappings",
  "disaster_state",
  "ai_calls",
  "signals",
  "drill_events",
  "drills",
  "clocks",
  "consents",
  "contacts",
  "people",
  "accounts",
  "offices",
] as const;

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

export type SeedOptions = {
  /** アカウントの id → パスワードのハッシュ（lib/auth/password.ts の形）。平文は受けない。無ければ null のまま（ログインできない） */
  passwordHashes?: Readonly<Record<string, string>>;
};

export function seedStatements(opts: SeedOptions = {}): string[] {
  const hashes = opts.passwordHashes ?? {};
  for (const id of Object.keys(hashes)) {
    if (!SEED_ACCOUNTS.some((a) => a.id === id)) throw new Error(`種に無いアカウント: ${id}`);
  }
  const out: string[] = CLEAR_ORDER.map((t) => `DELETE FROM ${t};`);
  for (const o of SEED_OFFICES) out.push(insert("offices", { ...o, created_at: SEED_AT }));
  for (const a of SEED_ACCOUNTS) {
    out.push(insert("accounts", { ...a, password_hash: hashes[a.id] ?? a.password_hash, created_at: SEED_AT }));
  }
  for (const p of SEED_PEOPLE) out.push(...personStatements(p));
  return out;
}

export function seedSql(opts: SeedOptions = {}): string {
  return `-- npm run db:seed が seed/people.ts から作る。手で直さない。git に入れない（ハッシュが入ることがある）。\n${seedStatements(opts).join("\n")}\n`;
}
