// 利用者の追加・担当の割当・一覧から外す・戻す（docs/tasks/T30.md）。D1 と OfficeActor を引数で受け取る（テストで node:sqlite を渡す）。
//
// 事業所の壁: 本人も担当のケアマネも、書く人の事業所の中だけ。どの書き込みも INSERT … SELECT … WHERE office_id = ? で縛り、
// 別の事業所の本人・ケアマネの id を渡されても書かない。
// 経過: 本人の経過（timeline_entries、kind note・source office。lib/office/timeline.ts）と事業所の経過（office_timeline_entries）に
// 1 行ずつ。データの行と経過の行は 1 つの batch で、片方だけ残らないように書く（lib/disaster/db.ts の write と同じ作り）。
// 利用者の削除はしない。一覧から外す印（people.unlisted_at）だけで、戻せる。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "../age.ts";
import { ROLE_LABELS } from "../auth/roles.ts";
import type { Ledger, PersonRow, PlanStatus, Sex } from "../db/types.ts";
import type { PersonInput } from "./forms.ts";
import type { OfficeActor } from "./scope.ts";
import { officePayload, type OfficeAction } from "./timeline.ts";

export type CareManagerItem = {
  id: string;
  name: string;
  loginId: string | null;
  admin: boolean;
  /** 一覧にいる担当の人数（外した人は数えない） */
  people: number;
};

/** 事業所のケアマネ（足した順）。担当の人数つき */
export async function listCareManagers(db: D1Database, officeId: string): Promise<CareManagerItem[]> {
  const res = await db
    .prepare(
      `SELECT a.id, a.display_name, a.login_id, a.is_office_admin,
              (SELECT count(*) FROM people p
                WHERE p.care_manager_id = a.id AND p.office_id = a.office_id AND p.unlisted_at IS NULL) AS people
         FROM accounts a
        WHERE a.office_id = ?1 AND a.role = 'care_manager'
        ORDER BY a.created_at, a.id`,
    )
    .bind(officeId)
    .all<{ id: string; display_name: string; login_id: string | null; is_office_admin: 0 | 1; people: number }>();
  return res.results.map((r) => ({
    id: r.id,
    name: careManagerName(r.display_name),
    loginId: r.login_id,
    admin: r.is_office_admin === 1,
    people: Number(r.people),
  }));
}

/** ケアマネの名前。空（協力事業所の枠）は役の名前 */
export function careManagerName(displayName: string | null | undefined): string {
  return displayName?.trim() || ROLE_LABELS.care_manager;
}

export type OfficePersonItem = {
  id: string;
  name: string;
  kana: string;
  age: number | null;
  plan: PlanStatus;
  careManagerId: string | null;
  /** 一覧から外した時刻。一覧にいれば null */
  unlistedAt: string | null;
  /** 登録と最後の更新の時刻（行の詳細に出す） */
  createdAt: string;
  updatedAt: string;
};

/** 事業所の利用者（担当の割当の表）。カナの順。外した人も含む（unlistedAt で分ける） */
export async function listOfficePeople(db: D1Database, officeId: string, today: string): Promise<OfficePersonItem[]> {
  const res = await db
    .prepare(
      `SELECT id, name, kana, birth_date, plan_status, care_manager_id, unlisted_at, reported_age, created_at, updated_at FROM people
        WHERE office_id = ?1 ORDER BY kana, id`,
    )
    .bind(officeId)
    .all<
      Pick<PersonRow, "id" | "name" | "kana" | "birth_date" | "plan_status" | "care_manager_id" | "created_at" | "updated_at"> & {
        unlisted_at: string | null;
        reported_age: number | null;
      }
    >();
  return res.results.map((r) => ({
    id: r.id,
    name: r.name,
    kana: r.kana,
    // 生年月日が無ければ申告の年齢（医療班・行政がその場で登録して引き受けた人、T23）
    age: r.birth_date ? ageOn(r.birth_date, today) : r.reported_age,
    plan: r.plan_status,
    careManagerId: r.care_manager_id,
    unlistedAt: r.unlisted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** 事業所の中のケアマネの名前。違う事業所・ケアマネでない（審査員の行・医療班）なら null */
async function careManagerIn(db: D1Database, officeId: string, id: string): Promise<{ name: string } | null> {
  const row = await db
    .prepare("SELECT display_name FROM accounts WHERE id = ?1 AND office_id = ?2 AND role = 'care_manager'")
    .bind(id, officeId)
    .first<{ display_name: string }>();
  return row ? { name: careManagerName(row.display_name) } : null;
}

/** 新しい人の台帳。性別だけ入れ、ほかは空（入れる欄で続きを入れる） */
export function newLedger(sex: Sex): Ledger {
  return {
    basic: { sex },
    care: {},
    medical: { devices: [], medications: [] },
    evacuation: { hazards: [] },
    notes: [],
    pending: [],
  };
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: "care_manager" };

/**
 * 利用者を 1 人足す。計画は未作成、出どころはケアマネ。担当は事業所の中のケアマネだけ。
 * 本人の経過に「利用者追加 担当 山本」、事業所の経過に「利用者追加」（本人の名前は表に書かず、読むときに引く）
 */
export async function createPerson(
  db: D1Database,
  actor: OfficeActor,
  input: PersonInput,
  at: string,
  id: string = `p-${crypto.randomUUID()}`,
): Promise<CreateResult> {
  const cm = await careManagerIn(db, actor.officeId, input.careManagerId);
  if (!cm) return { ok: false, error: "care_manager" };
  const body = `担当 ${cm.name}`;
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, plan_status, origin, ledger,
                             version, created_at, updated_at)
         SELECT ?1, a.office_id, a.id, ?3, ?4, ?5, 'none', 'care_manager', ?6, 1, ?7, ?7
           FROM accounts a WHERE a.id = ?2 AND a.office_id = ?8 AND a.role = 'care_manager'`,
      )
      .bind(id, input.careManagerId, input.name, input.kana, input.birthDate, JSON.stringify(newLedger(input.sex)), at, actor.officeId),
    personEntry(db, actor, id, body, officePayload("added", { to: input.careManagerId }), at),
    officeEntry(db, actor, "person_added", id, body, JSON.stringify({ personId: id, to: input.careManagerId }), at),
  ]);
  return (inserted.meta.changes ?? 0) > 0 ? { ok: true, id } : { ok: false, error: "care_manager" };
}

/** 本人の経過の 1 行（本人がその事業所にいるときだけ入る） */
function personEntry(
  db: D1Database,
  actor: OfficeActor,
  personId: string,
  body: string | null,
  payload: string,
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
       SELECT ?1, p.id, ?3, ?4, 'note', ?5, ?6, ?7 FROM people p WHERE p.id = ?2 AND p.office_id = ?8`,
    )
    .bind(crypto.randomUUID(), personId, actor.authorId, actor.authorRole, body, payload, at, actor.officeId);
}

/** 事業所の経過の 1 行（本人がその事業所にいるときだけ入る） */
function officeEntry(
  db: D1Database,
  actor: OfficeActor,
  kind: "person_added",
  personId: string,
  body: string | null,
  payload: string,
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
       SELECT ?1, p.office_id, ?3, ?4, ?5, ?6, ?7, ?8 FROM people p WHERE p.id = ?2 AND p.office_id = ?9`,
    )
    .bind(crypto.randomUUID(), personId, actor.authorId, actor.authorRole, kind, body, payload, at, actor.officeId);
}

export type ActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: "not_found" | "care_manager" | "conflict" };

type PersonState = { care_manager_id: string | null; unlisted_at: string | null };

async function personState(db: D1Database, officeId: string, personId: string): Promise<PersonState | null> {
  return db
    .prepare("SELECT care_manager_id, unlisted_at FROM people WHERE id = ?1 AND office_id = ?2")
    .bind(personId, officeId)
    .first<PersonState>();
}

/**
 * 経過の行（事業所）を「本人が読んだときの状態のままなら」入れ、本人の経過と本人の行の書き換えは、その経過の行があるときだけ。
 * 読んだあとにほかの人が変えていれば何も書かない（競合）
 */
async function guardedWrite(
  db: D1Database,
  actor: OfficeActor,
  input: {
    personId: string;
    kind: "person_assigned" | "person_unlisted" | "person_relisted";
    /** 本人の行がこの状態のときだけ書く（SQL の条件。?9 と ?10 を使える） */
    guard: string;
    guardArgs: [unknown, unknown];
    /** 本人の行の書き換え（SET の中。?3 を使える） */
    set: string;
    setArg: unknown;
    body: string | null;
    officePayload: string;
    personPayload: string;
    at: string;
  },
): Promise<boolean> {
  const logId = crypto.randomUUID();
  const [logged] = await db.batch([
    db
      .prepare(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ?1, p.office_id, ?3, ?4, ?5, ?6, ?7, ?8 FROM people p
          WHERE p.id = ?2 AND p.office_id = ?11 AND ${input.guard}`,
      )
      .bind(
        logId,
        input.personId,
        actor.authorId,
        actor.authorRole,
        input.kind,
        input.body,
        input.officePayload,
        input.at,
        input.guardArgs[0],
        input.guardArgs[1],
        actor.officeId,
      ),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ?1, ?2, t.author_id, t.author_role, 'note', t.body, ?3, t.occurred_at
           FROM office_timeline_entries t WHERE t.id = ?4`,
      )
      .bind(crypto.randomUUID(), input.personId, input.personPayload, logId),
    db
      .prepare(
        `UPDATE people SET ${input.set}
          WHERE id = ?1 AND office_id = ?2 AND EXISTS (SELECT 1 FROM office_timeline_entries WHERE id = ?4)`,
      )
      .bind(input.personId, actor.officeId, input.setArg, logId),
  ]);
  return (logged.meta.changes ?? 0) > 0;
}

/**
 * 担当を変える。from は画面で読んだときの担当（未割当は null）。今の担当が from と違えば競合。
 * 新しい担当は事業所の中のケアマネだけ。同じ担当なら何も書かない
 */
export async function assignPerson(
  db: D1Database,
  actor: OfficeActor,
  input: { personId: string; from: string | null; to: string },
  at: string,
): Promise<ActionResult> {
  const now = await personState(db, actor.officeId, input.personId);
  if (!now) return { ok: false, error: "not_found" };
  if (now.care_manager_id !== input.from) return { ok: false, error: "conflict" };
  if (input.to === input.from) return { ok: true, changed: false };
  const to = await careManagerIn(db, actor.officeId, input.to);
  if (!to) return { ok: false, error: "care_manager" };
  const from = input.from ? await careManagerIn(db, actor.officeId, input.from) : null;

  const body = `担当 ${from?.name ?? "未割当"} → ${to.name}`;
  const ok = await guardedWrite(db, actor, {
    personId: input.personId,
    kind: "person_assigned",
    guard: `p.care_manager_id IS ?9 AND EXISTS (SELECT 1 FROM accounts a
              WHERE a.id = ?10 AND a.office_id = p.office_id AND a.role = 'care_manager')`,
    guardArgs: [input.from, input.to],
    set: "care_manager_id = ?3",
    setArg: input.to,
    body,
    officePayload: JSON.stringify({ personId: input.personId, from: input.from, to: input.to }),
    personPayload: officePayload("assigned", { from: input.from, to: input.to }),
    at,
  });
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

/** 一覧から外す（unlisted: true）・戻す（false）。もうその状態なら何も書かない */
export async function setUnlisted(
  db: D1Database,
  actor: OfficeActor,
  input: { personId: string; unlisted: boolean },
  at: string,
): Promise<ActionResult> {
  const now = await personState(db, actor.officeId, input.personId);
  if (!now) return { ok: false, error: "not_found" };
  if ((now.unlisted_at !== null) === input.unlisted) return { ok: true, changed: false };
  const action: OfficeAction = input.unlisted ? "unlisted" : "relisted";
  const ok = await guardedWrite(db, actor, {
    personId: input.personId,
    kind: input.unlisted ? "person_unlisted" : "person_relisted",
    // ?9・?10 は使わない（番号をそろえるために null を渡し、条件に置く）
    guard: `p.unlisted_at IS ${input.unlisted ? "" : "NOT "}NULL AND ?9 IS NULL AND ?10 IS NULL`,
    guardArgs: [null, null],
    set: "unlisted_at = ?3",
    setArg: input.unlisted ? at : null,
    body: null,
    officePayload: JSON.stringify({ personId: input.personId }),
    personPayload: officePayload(action),
    at,
  });
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

// ---------- 担当の一括変更（T60） ----------

/** 一括変更で 1 回に送れる人数（事業所の利用者の上限の目安。多すぎる要求は断る） */
export const MAX_ASSIGN_MANY = 200;

/** 一括変更の 1 人: 本人と、画面で読んだときの担当（未割当は null） */
export type AssignManyItem = { personId: string; from: string | null };

export type AssignManyResult = { ok: true; changed: number; skipped: number } | { ok: false; error: "care_manager" };

/**
 * 担当の一括変更。人ごとに assignPerson と同じ検査（本人が事業所の中・移動先が事業所の中のケアマネ・今の担当が from と同じ）をし、
 * 通らない人（事業所の外・無い・画面を読んだあとに変わった・もう移動先）は飛ばして数える。移動先が通らなければ何も書かない。
 * 書くのは 1 つの batch で、文の数は人数で増えない（人ごとの値は JSON の配列で渡し、json_each で 1 行ずつ当てる）:
 * 事業所の経過（person_assigned を人数ぶん）→ 本人の経過（事業所の経過の行がある人だけ）→ 本人の行（同じ）。
 * 経過の行の条件で今の担当をもう一度確かめるので、読んだあとに変わった人は batch の中でも飛ばす
 */
export async function assignMany(
  db: D1Database,
  actor: OfficeActor,
  input: { items: ReadonlyArray<AssignManyItem>; to: string },
  at: string,
): Promise<AssignManyResult> {
  const to = await careManagerIn(db, actor.officeId, input.to);
  if (!to) return { ok: false, error: "care_manager" };

  // 同じ人は 1 回だけ（先に来た物）
  const items = [...new Map(input.items.map((i) => [i.personId, i])).values()];
  if (items.length === 0) return { ok: true, changed: 0, skipped: 0 };

  // 事業所の中の本人の今の担当（1 回で読む）
  const found = await db
    .prepare(
      `SELECT p.id, p.care_manager_id FROM people p
        WHERE p.office_id = ?1 AND p.id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(actor.officeId, JSON.stringify(items.map((i) => i.personId)))
    .all<{ id: string; care_manager_id: string | null }>();
  const now = new Map(found.results.map((r) => [r.id, r.care_manager_id]));
  const targets = items.filter((i) => now.has(i.personId) && now.get(i.personId) === i.from && i.from !== input.to);
  if (targets.length === 0) return { ok: true, changed: 0, skipped: items.length };

  // 前の担当の名前（事業所の中のケアマネだけ。ほかは未割当と同じ言い方）
  const names = new Map<string, string>();
  for (const from of new Set(targets.map((t) => t.from).filter((f): f is string => f !== null))) {
    const cm = await careManagerIn(db, actor.officeId, from);
    if (cm) names.set(from, cm.name);
  }

  const rows = targets.map((t) => ({
    logId: crypto.randomUUID(),
    noteId: crypto.randomUUID(),
    personId: t.personId,
    from: t.from,
    body: `担当 ${(t.from && names.get(t.from)) ?? "未割当"} → ${to.name}`,
    officePayload: JSON.stringify({ personId: t.personId, from: t.from, to: input.to }),
    personPayload: officePayload("assigned", { from: t.from, to: input.to }),
  }));
  const json = JSON.stringify(rows);
  const v = (key: keyof (typeof rows)[number]) => `json_extract(j.value, '$.${key}')`;

  const [logged] = await db.batch([
    db
      .prepare(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ${v("logId")}, p.office_id, ?2, ?3, 'person_assigned', ${v("body")}, ${v("officePayload")}, ?4
           FROM json_each(?1) j JOIN people p ON p.id = ${v("personId")}
          WHERE p.office_id = ?5 AND p.care_manager_id IS ${v("from")}
            AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = ?6 AND a.office_id = p.office_id AND a.role = 'care_manager')`,
      )
      .bind(json, actor.authorId, actor.authorRole, at, actor.officeId, input.to),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ${v("noteId")}, ${v("personId")}, t.author_id, t.author_role, 'note', t.body, ${v("personPayload")}, t.occurred_at
           FROM json_each(?1) j JOIN office_timeline_entries t ON t.id = ${v("logId")}`,
      )
      .bind(json),
    db
      .prepare(
        `UPDATE people SET care_manager_id = ?3
          WHERE office_id = ?2 AND id IN (
            SELECT ${v("personId")} FROM json_each(?1) j
             WHERE EXISTS (SELECT 1 FROM office_timeline_entries t WHERE t.id = ${v("logId")}))`,
      )
      .bind(json, actor.officeId, input.to),
  ]);
  const changed = logged.meta.changes ?? 0;
  return { ok: true, changed, skipped: items.length - changed };
}
