// 事業所の災害の状態を D1 から読む・書く。書くたびに事業所の経過（office_timeline_entries）に 1 行足す。
//
// 書き方: 画面で読んだ版（version、行が無ければ 0）のときだけ書く。重なった保存は片方だけ通り、もう片方は「競合」。
// 1 つの batch の中で、先に経過の行を「版が合うときだけ」入れ、状態の行はその経過の行があるときだけ書く（片方だけ残らない）。

import type { D1Database } from "@cloudflare/workers-types";
import { parseLedger } from "../db/ledger.ts";
import type { DisasterKind, OfficeTimelineEntryRow, OfficeTimelineKind } from "../db/types.ts";
import { AUTHOR_ROLE_LABELS } from "../labels.ts";
import type { DisasterScope } from "./scope.ts";
import {
  DISASTER_KIND_LABELS,
  fromRow,
  infoChanges,
  infoOf,
  normalState,
  OFFICE_TIMELINE_KIND_LABELS,
  shortJst,
  statePayload,
  toSituation,
  type DisasterInfo,
  type DisasterSituation,
  type DisasterState,
  type DisasterStateJoin,
} from "./state.ts";

/** 事業所の災害の状態。行が無ければ平時（版 0） */
export async function loadDisasterState(db: D1Database, officeId: string): Promise<DisasterState> {
  const row = await db
    .prepare(
      `SELECT d.*, s.display_name AS started_by_name, u.display_name AS updated_by_name
         FROM disaster_state d
         LEFT JOIN accounts s ON s.id = d.started_by
         LEFT JOIN accounts u ON u.id = d.updated_by
        WHERE d.office_id = ?1`,
    )
    .bind(officeId)
    .first<DisasterStateJoin>();
  return row ? fromRow(row) : normalState(officeId);
}

/**
 * ルールの表に渡す状況（今・発災・停電の始まり と停電の地区）。平時は null。
 * now は要求の時刻。1 分ごとの読み直し（画面の再読込）のたびに今が進み、色と並びが変わる
 */
export async function loadSituation(
  db: D1Database,
  officeId: string,
  now: string = new Date().toISOString(),
): Promise<DisasterSituation | null> {
  return toSituation(await loadDisasterState(db, officeId), now);
}

export type WriteResult = { ok: true; changed: boolean } | { ok: false; error: "conflict" | "normal" };

type NextRow = {
  kind: DisasterKind;
  startedAt: string | null;
  startedBy: string | null;
  info: Omit<DisasterInfo, "startedAt"> | null;
};

/**
 * 経過の行と状態の行を 1 つの batch で書く。経過の行は版が合うときだけ入り、状態の行はその経過の行があるときだけ書く。
 * 経過の行が入らなければ競合
 */
async function write(
  db: D1Database,
  scope: DisasterScope,
  version: number,
  at: string,
  next: NextRow,
  entry: { kind: OfficeTimelineKind; body: string | null; payload: string },
): Promise<boolean> {
  const id = crypto.randomUUID();
  const info = next.info;
  const outage = info?.outage ?? { scope: "none" as const, towns: [], startedAt: null };
  const [logged] = await db.batch([
    db
      .prepare(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ?1, o.id, ?3, ?4, ?5, ?6, ?7, ?8 FROM offices o
          WHERE o.id = ?2 AND COALESCE((SELECT version FROM disaster_state WHERE office_id = o.id), 0) = ?9`,
      )
      .bind(id, scope.officeId, scope.authorId, scope.authorRole, entry.kind, entry.body, entry.payload, at, version),
    db
      .prepare(
        `INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, outage_towns, outage_started_at,
                                     alert_level, water, road, version, updated_by, updated_at)
         SELECT t.office_id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13 FROM office_timeline_entries t WHERE t.id = ?1
         ON CONFLICT (office_id) DO UPDATE SET
           kind = excluded.kind, started_at = excluded.started_at, started_by = excluded.started_by,
           outage_scope = excluded.outage_scope, outage_towns = excluded.outage_towns,
           outage_started_at = excluded.outage_started_at, alert_level = excluded.alert_level,
           water = excluded.water, road = excluded.road, version = disaster_state.version + 1,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        next.kind,
        next.startedAt,
        next.startedBy,
        outage.scope,
        outage.scope === "area" ? JSON.stringify(outage.towns) : null,
        outage.scope === "none" ? null : outage.startedAt,
        info?.alertLevel ?? null,
        info?.water ?? null,
        info?.road ?? null,
        version + 1,
        scope.authorId,
        at,
      ),
  ]);
  return (logged.meta.changes ?? 0) > 0;
}

/**
 * 災害モードの切替（大雨・台風・土砂・地震・津波・その他・平時に戻す）。版が違えば競合。同じ状態を押しても何も書かない。
 * - 平時 → 災害の種類: 発災は押した時刻、押した人を残す。停電・レベル・断水・道路は空から
 * - 災害の種類どうし（大雨 ⇄ 台風 ⇄ 地震 など）: 種類だけ替える（発災・停電などはそのまま）
 * - → 平時: 全部を空に戻す（経過に履歴は残る）
 */
export async function switchDisasterMode(
  db: D1Database,
  scope: DisasterScope,
  input: { kind: DisasterKind; version: number; at: string },
): Promise<WriteResult> {
  const now = await loadDisasterState(db, scope.officeId);
  if (now.version !== input.version) return { ok: false, error: "conflict" };
  if (now.kind === input.kind) return { ok: true, changed: false };

  let next: NextRow;
  if (input.kind === "normal") {
    next = { kind: "normal", startedAt: null, startedBy: null, info: null };
  } else if (now.kind === "normal" || now.startedAt === null) {
    next = { kind: input.kind, startedAt: input.at, startedBy: scope.authorId, info: null };
  } else {
    const info = infoOf(now);
    next = {
      kind: input.kind,
      startedAt: now.startedAt,
      startedBy: now.startedBy,
      info: info ? { outage: info.outage, alertLevel: info.alertLevel, water: info.water, road: info.road } : null,
    };
  }

  const entry =
    input.kind === "normal"
      ? { kind: "disaster_off" as const, body: null, payload: statePayload({ kind: "normal" }) }
      : {
          kind: "disaster_on" as const,
          body: DISASTER_KIND_LABELS[input.kind],
          payload: statePayload({ kind: input.kind, startedAt: next.startedAt ?? undefined, ...(next.info ?? {}) }),
        };
  const ok = await write(db, scope, input.version, input.at, next, entry);
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

/** 災害の情報の保存。災害モードの間だけ。変わった所だけを経過の 1 行に。何も変わらなければ書かない */
export async function saveDisasterInfo(
  db: D1Database,
  scope: DisasterScope,
  input: { info: DisasterInfo; version: number; at: string },
): Promise<WriteResult> {
  const now = await loadDisasterState(db, scope.officeId);
  if (now.version !== input.version) return { ok: false, error: "conflict" };
  const before = infoOf(now);
  if (!before) return { ok: false, error: "normal" };
  const changes = infoChanges(before, input.info);
  if (changes.length === 0) return { ok: true, changed: false };

  const { startedAt, ...rest } = input.info;
  const ok = await write(
    db,
    scope,
    input.version,
    input.at,
    { kind: now.kind, startedAt, startedBy: now.startedBy, info: rest },
    { kind: "disaster_info", body: changes.join("・"), payload: statePayload({ kind: now.kind, ...input.info }) },
  );
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

export type OfficeLogItem = {
  id: string;
  kind: OfficeTimelineKind;
  /** 種類の言葉（災害モード・平時・災害情報・利用者追加・担当変更 など） */
  label: string;
  /**
   * 本人の名前（利用者追加・担当変更・一覧除外・一覧復帰、T30）。表には id だけを持ち、読むときに people から引く。
   * 本人が事業所にいなければ null
   */
  person: string | null;
  body: string | null;
  /** 誰が（名前。無ければ役） */
  who: string;
  /** 11/4 10:42 */
  when: string;
  at: string;
};

/** 経過の 1 行の文字「災害モード 大雨 山本 11/4 10:42」「利用者追加 架空 一郎 担当 山本 山本 11/3 10:00」 */
export function logLine(i: Pick<OfficeLogItem, "label" | "body" | "who" | "when"> & { person?: string | null }): string {
  return [i.label, i.person, i.body, i.who, i.when].filter((x) => x).join(" ");
}

/** 事業所の経過。新しい順に limit 件。本人の名前は payload の personId から引く（同じ事業所の人だけ） */
export async function loadOfficeLog(db: D1Database, officeId: string, limit = 50): Promise<OfficeLogItem[]> {
  const res = await db
    .prepare(
      `SELECT t.id, t.kind, t.body, t.author_role, t.occurred_at, a.display_name AS author_name, pe.name AS person_name
         FROM office_timeline_entries t
         LEFT JOIN accounts a ON a.id = t.author_id
         LEFT JOIN people pe ON pe.id = json_extract(t.payload, '$.personId') AND pe.office_id = t.office_id
        WHERE t.office_id = ?1 ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC LIMIT ?2`,
    )
    .bind(officeId, limit)
    .all<
      Pick<OfficeTimelineEntryRow, "id" | "kind" | "body" | "author_role" | "occurred_at"> & {
        author_name: string | null;
        person_name: string | null;
      }
    >();
  return res.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: OFFICE_TIMELINE_KIND_LABELS[r.kind],
    person: r.person_name,
    body: r.body,
    who: r.author_name || AUTHOR_ROLE_LABELS[r.author_role],
    when: shortJst(r.occurred_at),
    at: r.occurred_at,
  }));
}

export type TownCount = { town: string | null; count: number };

/** 事業所の利用者の町名と人数（停電の地区を選ぶ欄）。町名の無い人は town が null。町名の順。一覧から外した人（T30）は数えない */
export async function loadOfficeTowns(db: D1Database, officeId: string): Promise<TownCount[]> {
  const res = await db
    .prepare("SELECT ledger FROM people WHERE office_id = ?1 AND unlisted_at IS NULL")
    .bind(officeId)
    .all<{ ledger: string }>();
  const counts = new Map<string | null, number>();
  for (const r of res.results) {
    const town = townOfLedger(r.ledger);
    counts.set(town, (counts.get(town) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([town, count]) => ({ town, count }))
    .sort((a, b) => (a.town === null ? 1 : b.town === null ? -1 : a.town.localeCompare(b.town, "ja")));
}

/** 台帳の町名。無ければ null */
export function townOfLedger(ledger: string): string | null {
  return parseLedger(ledger).basic.address?.town?.trim() || null;
}
