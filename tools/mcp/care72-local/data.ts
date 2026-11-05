// 手元の MCP（care72-local）が読む物。手元の D1（wrangler の --local が作る SQLite のファイル）を読むだけで、書かない。
//
// - 人のデータは仮名化の層（lib/pseudonym）を通してから返す。MCP の返事も Claude に渡る物なので、アプリの中と同じ決まり（CLAUDE.md）。
//   本人は A さん・B さん（people の id の順）、連絡先は役割名（A さんの娘）。訓練の出来事の payload も置き換えてから返す。
// - 置き換える前の payload に元の氏名・電話・町名があれば、何が漏れたか（「A さんの電話」）だけを leaks に入れる。値は返さない。
//   ペルソナの出力の確かめ（.claude/agents/persona-tester.md）はこれを使い、Claude は本名を見ないまま漏れを数えられる。
// - 元に戻す鍵（PseudonymKey）はこの処理の中だけに置き、返事に入れない。

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CHECK_OFFICE_ID } from "../../../lib/auth/demo.ts";
import { parseLedger } from "../../../lib/db/ledger.ts";
import { CLOCK_UNIT_LABELS } from "../../../lib/labels.ts";
import type {
  ClockRow,
  ConsentKind,
  ConsentStatus,
  ContactRow,
  DrillActor,
  DrillEventKind,
  DrillScenario,
  DrillStatus,
} from "../../../lib/db/types.ts";
import {
  findLeaks,
  PseudonymLeakError,
  pseudonymize,
  pseudonymizeText,
  type ClaudePerson,
  type PseudonymInput,
  type PseudonymKey,
} from "../../../lib/pseudonym/index.ts";

/** wrangler の --local が D1 を置く場所（リポジトリの中） */
export const LOCAL_D1_DIR = [".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject"] as const;

export class LocalD1Missing extends Error {
  constructor(where: string) {
    super(`手元の D1 が無い（${where}）。先に npm run db:reset（--local だけ）で表と種を入れる`);
    this.name = "LocalD1Missing";
  }
}

function hasPeopleTable(file: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'people'").get() !== undefined;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** リポジトリの手元の D1 のファイル。people の表がある .sqlite のうち新しい物。無ければ null */
export function findLocalD1(projectDir: string): string | null {
  const dir = join(projectDir, ...LOCAL_D1_DIR);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
    .map((f) => join(dir, f))
    .filter(hasPeopleTable)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/** 読むだけで開く。書く文は SQLite が断る */
export function openReadOnly(file: string): DatabaseSync {
  if (!existsSync(file)) throw new LocalD1Missing(file);
  return new DatabaseSync(file, { readOnly: true });
}

type Row = Record<string, unknown>;
const all = (db: DatabaseSync, sql: string, ...params: Array<string | number | null>): Row[] =>
  db.prepare(sql).all(...params) as Row[];

// ---------- 名簿（仮名にした全員と、元に戻す鍵） ----------

export type Roster = {
  /** 仮名にした本人（people の id の順）。Claude に返してよい形 */
  people: ReadonlyArray<ClaudePerson>;
  /** 仮名 → people の id */
  ids: ReadonlyArray<{ alias: string; id: string; officeId: string }>;
  /** 元に戻す鍵。返事に入れない */
  key: PseudonymKey;
};

/**
 * 手元の D1 の本人を全員読み、仮名化の層を通す。on は年齢を数える日（既定は今日）。
 * 確認用の事業所（T144）の 10 人はデモ事業所の 10 人の写しなので読まない（同じ氏名が 2 人ずつ並び、仮名がずれるため）
 */
export function loadRoster(db: DatabaseSync, on?: string): Roster {
  const people = all(db, "SELECT id, office_id, name, kana, birth_date, ledger FROM people WHERE office_id <> ? ORDER BY id", CHECK_OFFICE_ID);
  const contacts = all(db, "SELECT * FROM contacts ORDER BY person_id, sort, id") as unknown as ContactRow[];
  const clocks = all(db, "SELECT * FROM clocks ORDER BY person_id, sort, id") as unknown as ClockRow[];
  const consents = all(db, "SELECT person_id, kind, status FROM consents") as Array<{
    person_id: string;
    kind: ConsentKind;
    status: ConsentStatus;
  }>;

  const inputs: PseudonymInput[] = people.map((p) => ({
    person: {
      id: String(p.id),
      name: String(p.name),
      kana: String(p.kana),
      birth_date: (p.birth_date as string | null) ?? null,
    },
    ledger: parseLedger(String(p.ledger)),
    contacts: contacts.filter((c) => c.person_id === p.id),
    clocks: clocks.filter((k) => k.person_id === p.id),
    consents: consents.filter((c) => c.person_id === p.id).map(({ kind, status }) => ({ kind, status })),
  }));
  const { payload, key } = pseudonymize(inputs, on ? { on } : {});
  return {
    people: payload,
    ids: payload.map((x, i) => ({ alias: x.alias, id: String(people[i].id), officeId: String(people[i].office_id) })),
    key,
  };
}

/** 「A さん」「Aさん」「A」か people の id から、名簿の何番目か。無ければ -1 */
function indexOf(roster: Roster, ref: string): number {
  const r = ref.trim();
  const byId = roster.ids.findIndex((x) => x.id === r);
  if (byId >= 0) return byId;
  const letters = r.replace(/[ 　]*さん$/, "").toUpperCase();
  return roster.ids.findIndex((x) => x.alias === `${letters} さん`);
}

function aliasOfId(roster: Roster, personId: unknown): string | null {
  if (typeof personId !== "string") return null;
  return roster.ids.find((x) => x.id === personId)?.alias ?? null;
}

// ---------- 本人 ----------

export type PersonSummary = {
  alias: string;
  id: string;
  age: number | null;
  household: ClaudePerson["household"];
  careLevel: ClaudePerson["care"]["careLevel"];
  smartphone: ClaudePerson["smartphone"];
  devices: string[];
  clocks: string[];
  contacts: string[];
};

/** 担当の本人の一覧（仮名）。訓練のペルソナに誰がいるかを見る */
export function listPeople(roster: Roster): PersonSummary[] {
  return roster.people.map((p, i) => ({
    alias: p.alias,
    id: roster.ids[i].id,
    age: p.age,
    household: p.household,
    careLevel: p.care.careLevel,
    smartphone: p.smartphone,
    devices: p.medical.devices.map((d) => d.kind),
    clocks: p.clocks.map((k) =>
      k.value == null || k.unit == null ? `${k.label} 未確認` : `${k.label} ${k.value} ${CLOCK_UNIT_LABELS[k.unit]}`,
    ),
    contacts: p.contacts.map((c) => c.role),
  }));
}

/** 1 人の仮名の台帳。ペルソナ（Haiku）に渡るのと同じ形 */
export function getPerson(roster: Roster, ref: string): ClaudePerson | null {
  const i = indexOf(roster, ref);
  return i >= 0 ? roster.people[i] : null;
}

// ---------- 置き換えと漏れ ----------

/** 文の中の元の氏名・電話・町名。何が漏れたかだけを返す（値は返さない） */
export function checkLeaks(roster: Roster, text: string): string[] {
  return findLeaks(text, roster.key);
}

type Scrubbed = { value: unknown; leaks: string[]; withheld?: true };

/** JSON の文字列を仮名に置き換えて読む。置き換えたあとも残るなら値を返さない */
function scrubJson(raw: unknown, roster: Roster): Scrubbed {
  if (typeof raw !== "string") return { value: null, leaks: [] };
  const leaks = findLeaks(raw, roster.key);
  let text: string;
  try {
    text = pseudonymizeText(raw, roster.key).text;
  } catch (e) {
    if (e instanceof PseudonymLeakError) return { value: null, leaks, withheld: true };
    throw e;
  }
  try {
    return { value: JSON.parse(text), leaks };
  } catch {
    return { value: text, leaks };
  }
}

// ---------- 訓練 ----------

export type DrillSummary = {
  id: string;
  officeId: string;
  scenario: DrillScenario;
  status: DrillStatus;
  step: number;
  simHour: number;
  startedAt: string;
  finishedAt: string | null;
  scored: boolean;
  events: number;
};

export function listDrills(db: DatabaseSync, limit = 20): DrillSummary[] {
  return all(
    db,
    `SELECT d.id, d.office_id, d.scenario, d.status, d.step, d.sim_hour, d.started_at, d.finished_at,
            d.score IS NOT NULL AS scored,
            (SELECT COUNT(*) FROM drill_events e WHERE e.drill_id = d.id) AS events
       FROM drills d ORDER BY d.started_at DESC, d.id LIMIT ?`,
    limit,
  ).map((r) => ({
    id: String(r.id),
    officeId: String(r.office_id),
    scenario: r.scenario as DrillScenario,
    status: r.status as DrillStatus,
    step: Number(r.step),
    simHour: Number(r.sim_hour),
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
    scored: Number(r.scored) === 1,
    events: Number(r.events),
  }));
}

export type DrillEventView = {
  seq: number;
  step: number;
  simHour: number;
  alias: string | null;
  actor: DrillActor;
  kind: DrillEventKind;
  payload: unknown;
  /** 置き換える前の payload にあった漏れ（何が、だけ） */
  leaks: string[];
  /** 置き換えたあとも漏れが残ったので payload を返さなかった */
  withheld?: true;
};

export type EventFilter = {
  drillId: string;
  kind?: DrillEventKind;
  /** 仮名か people の id */
  person?: string;
  fromStep?: number;
  toStep?: number;
  limit?: number;
};

export const EVENT_LIMIT = { default: 200, max: 1000 } as const;

export function drillEvents(db: DatabaseSync, roster: Roster, f: EventFilter): DrillEventView[] {
  const where = ["drill_id = ?"];
  const params: Array<string | number | null> = [f.drillId];
  if (f.kind) {
    where.push("kind = ?");
    params.push(f.kind);
  }
  if (f.person) {
    const i = indexOf(roster, f.person);
    where.push("person_id = ?");
    params.push(i >= 0 ? roster.ids[i].id : "（該当なし）");
  }
  if (f.fromStep != null) {
    where.push("step >= ?");
    params.push(f.fromStep);
  }
  if (f.toStep != null) {
    where.push("step <= ?");
    params.push(f.toStep);
  }
  const limit = Math.min(Math.max(1, f.limit ?? EVENT_LIMIT.default), EVENT_LIMIT.max);
  params.push(limit);
  return all(
    db,
    `SELECT seq, step, sim_hour, person_id, actor, kind, payload FROM drill_events
      WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ?`,
    ...params,
  ).map((r) => {
    const s = scrubJson(r.payload, roster);
    return {
      seq: Number(r.seq),
      step: Number(r.step),
      simHour: Number(r.sim_hour),
      alias: aliasOfId(roster, r.person_id),
      actor: r.actor as DrillActor,
      kind: r.kind as DrillEventKind,
      payload: s.value,
      leaks: s.leaks,
      ...(s.withheld ? { withheld: true as const } : {}),
    };
  });
}

export type DrillDetail = DrillSummary & {
  world: unknown;
  score: unknown;
  leaks: string[];
  byKind: Partial<Record<DrillEventKind, number>>;
  /** 仮名ごと・種類ごとの数と、最初の時刻（発災からの時間）。採点の確かめ（連絡の順と抜け）に使う */
  byPerson: Record<string, Partial<Record<DrillEventKind, { count: number; firstSimHour: number }>>>;
};

export function drillDetail(db: DatabaseSync, roster: Roster, drillId: string): DrillDetail | null {
  const summary = listDrills(db, 10_000).find((d) => d.id === drillId);
  if (!summary) return null;
  const row = all(db, "SELECT world, score FROM drills WHERE id = ?", drillId)[0];
  const world = scrubJson(row.world, roster);
  const score = scrubJson(row.score, roster);
  const byKind: DrillDetail["byKind"] = {};
  const byPerson: DrillDetail["byPerson"] = {};
  for (const r of all(db, "SELECT person_id, kind, sim_hour FROM drill_events WHERE drill_id = ? ORDER BY seq", drillId)) {
    const kind = r.kind as DrillEventKind;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const alias = aliasOfId(roster, r.person_id);
    if (!alias) continue;
    const mine = (byPerson[alias] ??= {});
    const hour = Number(r.sim_hour);
    const cur = mine[kind];
    mine[kind] = cur ? { count: cur.count + 1, firstSimHour: Math.min(cur.firstSimHour, hour) } : { count: 1, firstSimHour: hour };
  }
  return {
    ...summary,
    world: world.value,
    score: score.value,
    leaks: [...new Set([...world.leaks, ...score.leaks])],
    byKind,
    byPerson,
  };
}

// ---------- AI の呼び出しの数 ----------

export type AiUsageRow = {
  day: string;
  officeId: string;
  purpose: string;
  model: string;
  status: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
};

/** ai_calls を日・事業所・用途・モデル・状態ごとに数える（表に本文は無い）。訓練を回したあとの回数と token を見る */
export function aiUsage(db: DatabaseSync, day?: string): AiUsageRow[] {
  const where = day ? "WHERE day = ?" : "";
  return all(
    db,
    `SELECT day, office_id, purpose, model, status, COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM ai_calls ${where}
      GROUP BY day, office_id, purpose, model, status
      ORDER BY day DESC, office_id, purpose, model, status`,
    ...(day ? [day] : []),
  ).map((r) => ({
    day: String(r.day),
    officeId: String(r.office_id),
    purpose: String(r.purpose),
    model: String(r.model),
    status: String(r.status),
    calls: Number(r.calls),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
  }));
}
