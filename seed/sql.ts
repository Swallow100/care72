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

export type SqlValue = string | number | boolean | null | undefined;

export function lit(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`数でない値: ${v}`);
    return String(v);
  }
  return `'${v.replaceAll("'", "''")}'`;
}

export function insert(table: string, row: Record<string, SqlValue>): string {
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
  // 気象庁の写し（T72）。子（警報・地震・観測点）が電文を指すので子から。事業所ごとでないのでデモの戻しでは消さない（lib/seed/reset.ts）
  "jma_quake_points",
  "jma_quakes",
  "jma_warnings",
  "jma_entries",
  "jma_fetch_state",
  // アンケートの共有のリンクと答え（T65）。答えがリンクを指すので答えから
  "survey_responses",
  "survey_shares",
  // アンケートの Web 版（T42）。答えがリンクを指すので答えから
  "survey_answers",
  "survey_links",
  "survey_attempts",
  "timeline_entries",
  "office_timeline_entries",
  // 受け持ちと第三者提供の記録（T23）。記録が受け持ちを指すので記録から
  "third_party_provisions",
  "custody",
  "form9_rank_edits",
  // 書類の紙の見直し（T136）。人・事業所・アカウントを指すので先に
  "form_reviews",
  "form_mappings",
  "disaster_state",
  "ai_calls",
  // 仮想モードの世界の部屋（T50）の Agent・Environment の ID。事業所ごとでなく 1 回だけ作る物なので種では消さない（KEEP_ON_SEED）
  "ai_agents",
  // ログインの回数の制限（T41）。手元の入れ直しでは消す（配信の毎日 4 時・最初に戻すでは消さない。lib/seed/reset.ts）
  "login_attempts",
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

export function personStatements(p: SeedPerson): string[] {
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

/** 種で消さない表: 世界の部屋の ID（T50。消すと次の仮想の訓練で Agent を作り直し、前の Agent が残る）と、アンケートの Web 版（T42）。本物のケアマネの答えが入るので、配信の作り直し（tools/deploy/rebuild-remote.sh の seed）でも残す。
 *  事業所の行は消して入れ直す（事業所の id は種で同じ）。答えのリンクの office_id は 0021 から外部キーでない（T73a）。外部キーは取引の終わりまで後回しにする（PRAGMA defer_foreign_keys） */
export const KEEP_ON_SEED: ReadonlySet<string> = new Set(["survey_responses", "survey_shares", "survey_answers", "survey_links", "survey_attempts", "ai_agents"]);

export function seedStatements(opts: SeedOptions = {}): string[] {
  const hashes = opts.passwordHashes ?? {};
  for (const id of Object.keys(hashes)) {
    if (!SEED_ACCOUNTS.some((a) => a.id === id)) throw new Error(`種に無いアカウント: ${id}`);
  }
  const out: string[] = ["PRAGMA defer_foreign_keys = true;", ...CLEAR_ORDER.filter((t) => !KEEP_ON_SEED.has(t)).map((t) => `DELETE FROM ${t};`)];
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
