// 作り直し（tools/deploy/rebuild-remote.sh）の前の守り（docs/tasks/T73.md の 2）。tools/deploy/guard-remote.mjs が流す中身で、
// テストは問いの関数（wrangler の代わり）を差し替えて確かめる。
//
// 作り直しは survey_ のほかの表を全部落として種から入れ直すので、本物の事業所が使い始めたあとに流すと、その事業所の利用者が全部消える。
// drop の前に 4 つを数え、どれかが 0 でなければ「本物データあり 停止」で止める:
//   利用者（people）のうち種の事業所の外、アカウント（accounts）のうち種に無い行、事業所（offices）のうち種に無い行、訓練（drills）のうち種の事業所の外。
// 種の事業所はデモ事業所と確認用の事業所（T144。どちらも毎朝 4 時に種へ戻す）。
// ALLOW_DATA_LOSS=1 のときだけ、数を出したうえで続ける（作者が意図して消す形）。
// 数が読めない（wrangler が落ちた・JSON が読めない）ときは、ALLOW_DATA_LOSS=1 でも止める（消える物の数を出せないまま進めない）。
// 表がまだ無い D1（作ったばかり）は、無い表を 0 と数える（sqlite_master から先に表の名前を読む）。
// survey_ の表は作り直しで落とさない（KEEP）ので数えない。行の中身は読まない（数だけ。本番の行の写しを作らない）。
// 審査員の試用事業所（T115、offices.judge_sandbox = 1、migration 0027）とその利用者・アカウント・訓練は数えない（デモ事業所と同じく毎朝 4 時に消える物）。
// 0027 の前の D1 には列が無いので、sqlite_master の offices の CREATE の文に列の名前があるときだけ除く（無い列を読むと数が読めず止まるため）。
// 試用事業所があれば数を 1 行足す（作り直しで一緒に消える）。

import { SEED_OFFICE_IDS } from "../../lib/auth/demo.ts";
import { SEED_ACCOUNTS, SEED_OFFICES } from "../../seed/people.ts";
import { lit } from "../../seed/sql.ts";

export const GUARD_TABLES = ["people", "accounts", "offices", "drills"] as const;
export type GuardTable = (typeof GUARD_TABLES)[number];
export type GuardCounts = Record<GuardTable, number>;

const list = (ids: readonly string[]) => ids.map((id) => lit(id)).join(", ");

/** 表ごとの数え方（その表があるときだけ使う） */
export const COUNT_SQL: Record<GuardTable, string> = {
  people: `SELECT count(*) FROM people WHERE office_id NOT IN (${list(SEED_OFFICE_IDS)})`,
  accounts: `SELECT count(*) FROM accounts WHERE id NOT IN (${list(SEED_ACCOUNTS.map((a) => a.id))})`,
  offices: `SELECT count(*) FROM offices WHERE id NOT IN (${list(SEED_OFFICES.map((o) => o.id))})`,
  drills: `SELECT count(*) FROM drills WHERE office_id NOT IN (${list(SEED_OFFICE_IDS)})`,
};

/** 画面に出す言葉（標準出力） */
const LABELS: Record<GuardTable, string> = {
  people: "利用者（種の事業所の外）",
  accounts: "アカウント（種の外）",
  offices: "事業所（種の外）",
  drills: "訓練（種の事業所の外）",
};

/** 試用事業所の id（T115） */
const SANDBOX_OFFICES = "SELECT id FROM offices WHERE judge_sandbox = 1";

/** 試用事業所の列（0027）がある D1 での数え方。試用事業所とその中の行を除く（事業所の無いアカウント＝医療班・行政は数える） */
export const SANDBOX_COUNT_SQL: Record<GuardTable, string> = {
  people: `${COUNT_SQL.people} AND office_id NOT IN (${SANDBOX_OFFICES})`,
  accounts: `${COUNT_SQL.accounts} AND (office_id IS NULL OR office_id NOT IN (${SANDBOX_OFFICES}))`,
  offices: `${COUNT_SQL.offices} AND judge_sandbox = 0`,
  drills: `${COUNT_SQL.drills} AND office_id NOT IN (${SANDBOX_OFFICES})`,
};

/** 4 つの表のうち、ある物の名前と、offices に試用事業所の列（judge_sandbox、0027）があるか */
export const TABLES_SQL = `SELECT name, (name = 'offices' AND instr(sql, 'judge_sandbox') > 0) AS sandbox FROM sqlite_master WHERE type = 'table' AND name IN (${list(GUARD_TABLES)})`;

/** 1 行で 4 つの数（試用事業所の列があれば試用事業所の数 sandboxes も）。無い表は 0 */
export function countSql(existing: ReadonlySet<string>, sandboxColumn = false): string {
  const sql = sandboxColumn ? SANDBOX_COUNT_SQL : COUNT_SQL;
  const cols = GUARD_TABLES.map((t) => `${existing.has(t) ? `(${sql[t]})` : "0"} AS ${t}`);
  if (sandboxColumn) cols.push(`(SELECT count(*) FROM offices WHERE judge_sandbox = 1) AS sandboxes`);
  return `SELECT ${cols.join(", ")}`;
}

/**
 * wrangler d1 execute --json の出力から最初の文の results。読めなければ null。
 * wrangler が JSON の前に知らせ（版の案内など）を出すことがあるので、[ の所から順に読めるまで試す（rebuild-remote.sh の node -e と同じ読み方）
 */
export function parseWranglerJson(text: string): Record<string, unknown>[] | null {
  for (let i = text.indexOf("["); i >= 0; i = text.indexOf("[", i + 1)) {
    let j: unknown;
    try {
      j = JSON.parse(text.slice(i));
    } catch {
      continue;
    }
    if (!Array.isArray(j) || j.length === 0) return null;
    const first = j[0] as { success?: unknown; results?: unknown };
    if (first?.success === false || !Array.isArray(first?.results)) return null;
    return first.results as Record<string, unknown>[];
  }
  return null;
}

export type GuardDecision = { ok: boolean; lines: string[] };

export function allowsDataLoss(env: Record<string, string | undefined>): boolean {
  return env.ALLOW_DATA_LOSS === "1";
}

/** 試用事業所の行（数えないが、あれば出す） */
const SANDBOX_LABEL = "試用事業所（数えない。消える）";

/** 数から止める・続ける。counts が null（読めない）なら、ALLOW_DATA_LOSS でも止める。sandboxes は試用事業所の数（T115。止める理由にしない） */
export function decideGuard(counts: GuardCounts | null, allowDataLoss: boolean, reason = "", sandboxes = 0): GuardDecision {
  if (!counts) return { ok: false, lines: ["数が読めない 停止", ...(reason ? [`  ${reason}`] : [])] };
  const total = GUARD_TABLES.reduce((n, t) => n + counts[t], 0);
  const detail = [...GUARD_TABLES.map((t) => `  ${LABELS[t]} ${counts[t]}`), ...(sandboxes > 0 ? [`  ${SANDBOX_LABEL} ${sandboxes}`] : [])];
  if (total === 0) return { ok: true, lines: ["本物データなし", ...detail] };
  if (allowDataLoss) return { ok: true, lines: ["本物データあり 続行（ALLOW_DATA_LOSS=1。消える）", ...detail] };
  return { ok: false, lines: ["本物データあり 停止", ...detail, "  消してよいときだけ ALLOW_DATA_LOSS=1。表を残す配信は migrate-remote.sh"] };
}

/** wrangler d1 execute --json を 1 回流して標準出力を返す。落ちたら投げる */
export type Query = (sql: string) => string | Promise<string>;

function toCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 表の名前 → 数 → 止める・続ける */
export async function runGuard(query: Query, env: Record<string, string | undefined>): Promise<GuardDecision> {
  const allow = allowsDataLoss(env);
  let tables: Record<string, unknown>[] | null;
  try {
    tables = parseWranglerJson(await query(TABLES_SQL));
  } catch (e) {
    return decideGuard(null, allow, errorLine(e));
  }
  if (!tables) return decideGuard(null, allow, "表の名前の JSON が読めない");
  const existing = new Set(tables.map((r) => r.name).filter((n): n is string => typeof n === "string"));
  const sandboxColumn = tables.some((r) => r.name === "offices" && toCount(r.sandbox) === 1);

  let rows: Record<string, unknown>[] | null;
  try {
    rows = parseWranglerJson(await query(countSql(existing, sandboxColumn)));
  } catch (e) {
    return decideGuard(null, allow, errorLine(e));
  }
  const row = rows?.[0];
  if (!row) return decideGuard(null, allow, "数の JSON が読めない");
  const counts = {} as GuardCounts;
  for (const t of GUARD_TABLES) {
    const n = toCount(row[t]);
    if (n === null) return decideGuard(null, allow, `数が読めない: ${t}`);
    counts[t] = n;
  }
  const sandboxes = sandboxColumn ? toCount(row.sandboxes) : 0;
  if (sandboxes === null) return decideGuard(null, allow, "数が読めない: sandboxes");
  return decideGuard(counts, allow, "", sandboxes);
}

function errorLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n").filter((l) => !/token/i.test(l)).slice(0, 5).join(" ");
}
