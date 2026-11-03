// 受け持ちの書き込み（docs/tasks/T23.md）: 受け入れ・搬送・退所・その場で登録。D1 と StaffActor を引数で受け取る（テストで node:sqlite）。
//
// - 受け入れ: 受け持ちの行（custody）・本人の経過（received、書き手は受け持つ人、body は避難所）・第三者提供の記録（相手・範囲・時刻）を
//   1 つの batch で書く。同じ人の開いた受け持ちはアカウントごとに 1 つ（表の一意の索引でも止まる）
// - 搬送・退所: 自分の開いた受け持ちだけ閉じる。本人の経過（transported・released）を足し、提供の記録を閉じる
// - その場で登録: 台帳に無い人を最小の項目（氏名・カナ・年齢か生年月日・薬・機器・連絡先）で作る。事業所は所属なし、出どころは on_site。
//   作った人の受け持ちにそのまま入れる（提供の記録は作らない。受け持つ人が自分で聞いた物）
// 受け入れの前に本人のページは開けない（lib/auth/scope.ts）。住所・電話はここから画面に返さない。

import type { D1Database } from "@cloudflare/workers-types";
import { JUDGE_LABEL } from "../auth/roles.ts";
import { unconfirmedConsents } from "../consent/unconfirmed.ts";
import type { ConsentStatus, CustodyVia, Ledger, PersonOrigin, ReleaseKind } from "../db/types.ts";
import { UNAFFILIATED_OFFICE_ID, type StaffActor } from "./actor.ts";
import type { CustodyError } from "./labels.ts";
import { RELEASE_LABELS } from "./labels.ts";
import { provisionOf } from "./provision.ts";
import { custodyPayload } from "./timeline.ts";
import type { OnSiteInput } from "./forms.ts";

export type ReceiveResult = { ok: true; custodyId: string; personId: string } | { ok: false; error: CustodyError };

/** 受け入れる。personId は検索・避難所の一覧・QR（トークンを引き直した物）から */
export async function receive(
  db: D1Database,
  actor: StaffActor,
  input: { personId: string; shelter: string; via: Exclude<CustodyVia, "on_site"> },
  at: string,
  id: string = `cu-${crypto.randomUUID()}`,
): Promise<ReceiveResult> {
  const person = await db
    .prepare(
      `SELECT p.id, p.origin,
              (SELECT c.status FROM consents c WHERE c.person_id = p.id AND c.kind = 'medical') AS medical,
              (SELECT c.scope FROM consents c WHERE c.person_id = p.id AND c.kind = 'medical') AS medical_scope,
              (SELECT cu.id FROM custody cu WHERE cu.person_id = p.id AND cu.holder_id = ?2 AND cu.released_at IS NULL) AS open_id
         FROM people p WHERE p.id = ?1`,
    )
    .bind(input.personId, actor.accountId)
    .first<{ id: string; origin: PersonOrigin; medical: ConsentStatus | null; medical_scope: string | null; open_id: string | null }>();
  if (!person) return { ok: false, error: "not_found" };
  if (person.open_id) return { ok: false, error: "already" };

  const consent: ConsentStatus = person.medical ?? "unconfirmed";
  // 範囲と根拠は本人のページの出し分けと同じ所（lib/consent/scope.ts）から
  const provided = provisionOf({
    consents: [{ kind: "medical", status: consent, scope: person.medical_scope }],
    origin: person.origin,
  });
  try {
    await db.batch([
      custodyInsert(db, actor, { id, personId: person.id, shelter: input.shelter, via: input.via }, at),
      receivedEntry(db, actor, { custodyId: id, personId: person.id, shelter: input.shelter, via: input.via }, at),
      db
        .prepare(
          `INSERT INTO third_party_provisions (id, person_id, custody_id, recipient_id, recipient_role, recipient_name, recipient_judge,
                                               basis, medical_consent, scope, shelter, provided_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          `tp-${crypto.randomUUID()}`,
          person.id,
          id,
          actor.accountId,
          actor.role,
          actor.name ?? (actor.judge ? JUDGE_LABEL : null),
          actor.judge ? 1 : 0,
          provided.basis,
          consent,
          JSON.stringify(provided.sections),
          input.shelter,
          at,
        ),
    ]);
  } catch (e) {
    // 同じ人の開いた受け持ち（一意の索引）に同時に当たったとき
    if (/UNIQUE/i.test(String(e))) return { ok: false, error: "already" };
    throw e;
  }
  return { ok: true, custodyId: id, personId: person.id };
}

function custodyInsert(
  db: D1Database,
  actor: StaffActor,
  c: { id: string; personId: string; shelter: string; via: CustodyVia },
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO custody (id, person_id, holder_id, holder_role, shelter, via, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(c.id, c.personId, actor.accountId, actor.role, c.shelter, c.via, at);
}

function receivedEntry(
  db: D1Database,
  actor: StaffActor,
  c: { custodyId: string; personId: string; shelter: string; via: CustodyVia },
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 'received', ?5, ?6, NULL, ?7, ?7)`,
    )
    .bind(
      `tl-cu-${crypto.randomUUID()}`,
      c.personId,
      actor.accountId,
      actor.role,
      c.shelter,
      custodyPayload({ custodyId: c.custodyId, shelter: c.shelter, via: c.via }),
      at,
    );
}

export type ReleaseResult = { ok: true; personId: string } | { ok: false; error: CustodyError };

/** 搬送・退所。自分の開いた受け持ちだけ。note は搬送の行き先など（人の名前・電話を入れない） */
export async function release(
  db: D1Database,
  actor: StaffActor,
  input: { custodyId: string; kind: ReleaseKind; note: string | null },
  at: string,
): Promise<ReleaseResult> {
  const row = await db
    .prepare("SELECT person_id, shelter, released_at FROM custody WHERE id = ?1 AND holder_id = ?2")
    .bind(input.custodyId, actor.accountId)
    .first<{ person_id: string; shelter: string; released_at: string | null }>();
  if (!row) return { ok: false, error: "not_found" };
  if (row.released_at) return { ok: false, error: "released" };

  const kind = input.kind === "transported" ? "transported" : "released";
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE custody SET released_at = ?3, release_kind = ?4, release_note = ?5, released_by = ?2
          WHERE id = ?1 AND holder_id = ?2 AND released_at IS NULL`,
      )
      .bind(input.custodyId, actor.accountId, at, input.kind, input.note),
    // 閉じたときだけ経過と記録に書く（同じ時刻・同じ人で閉じた行があるときだけ）
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at, created_at)
         SELECT ?1, c.person_id, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7 FROM custody c
          WHERE c.id = ?8 AND c.released_at = ?7 AND c.released_by = ?2`,
      )
      .bind(
        `tl-cu-${crypto.randomUUID()}`,
        actor.accountId,
        actor.role,
        kind,
        input.note ?? (input.kind === "discharged" ? RELEASE_LABELS.discharged : null),
        custodyPayload({ custodyId: input.custodyId, shelter: row.shelter, release: input.kind }),
        at,
        input.custodyId,
      ),
    db
      .prepare(
        `UPDATE third_party_provisions SET closed_at = ?2
          WHERE custody_id = ?1 AND closed_at IS NULL
            AND EXISTS (SELECT 1 FROM custody c WHERE c.id = ?1 AND c.released_at = ?2)`,
      )
      .bind(input.custodyId, at),
  ]);
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  return { ok: true, personId: row.person_id };
}

/**
 * その場で登録した人の台帳。薬は名前だけ（区分はその他）、機器は種類と、その他だけ名前（T64。T57 の detail と同じ所）。
 * ほかは空（あとでケアマネが入れる）
 */
export function onSiteLedger(input: Pick<OnSiteInput, "medications" | "devices">): Ledger {
  return {
    basic: {},
    care: {},
    medical: {
      devices: input.devices.map((d) => (d.kind === "other" && d.detail ? { kind: d.kind, detail: d.detail } : { kind: d.kind })),
      medications: input.medications.map((name) => ({ name, category: "other" as const })),
    },
    evacuation: { hazards: [] },
    notes: [],
    pending: [],
  };
}

export type RegisterResult = { ok: true; personId: string; custodyId: string } | { ok: false; error: CustodyError };

/**
 * 台帳に無い人をその場で登録し、作った人の受け持ちに入れる。事業所は所属なし、担当なし、出どころ on_site。
 * 本人の経過は「受入 避難所」（作ったことは経過の「入力 台帳作成 医療班」に出る。lib/person.ts の timelineItems）
 */
export async function registerOnSite(
  db: D1Database,
  actor: StaffActor,
  input: OnSiteInput,
  at: string,
  ids: { personId?: string; custodyId?: string } = {},
): Promise<RegisterResult> {
  const personId = ids.personId ?? `p-${crypto.randomUUID()}`;
  const custodyId = ids.custodyId ?? `cu-${crypto.randomUUID()}`;
  const statements = [
    db
      .prepare(
        `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date, plan_status, origin, ledger,
                             version, created_at, updated_at, reported_age)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'none', 'on_site', ?6, 1, ?7, ?7, ?8)`,
      )
      .bind(
        personId,
        UNAFFILIATED_OFFICE_ID,
        input.name,
        input.kana,
        input.birthDate,
        JSON.stringify(onSiteLedger(input)),
        at,
        input.birthDate ? null : input.age,
      ),
    // 同意の行を全部「未確認」で（T69a。利用者追加と同じ。記録した人は作った医療班・行政）
    unconfirmedConsents(db, personId, actor.accountId, at, UNAFFILIATED_OFFICE_ID),
  ];
  if (input.contact) {
    statements.push(
      db
        .prepare(
          `INSERT INTO contacts (id, person_id, kind, relation, name, phone, emergency_order, sort, created_at)
           VALUES (?1, ?2, 'family', ?3, ?4, ?5, 1, 0, ?6)`,
        )
        .bind(`c-${crypto.randomUUID()}`, personId, input.contact.relation, input.contact.name, input.contact.phone, at),
    );
  }
  statements.push(
    custodyInsert(db, actor, { id: custodyId, personId, shelter: input.shelter, via: "on_site" }, at),
    receivedEntry(db, actor, { custodyId, personId, shelter: input.shelter, via: "on_site" }, at),
  );
  await db.batch(statements);
  return { ok: true, personId, custodyId };
}

/** 自分がいちばん最近に受け入れた避難所（入力の既定）。無ければ null */
export async function lastShelter(db: D1Database, actor: StaffActor): Promise<string | null> {
  const row = await db
    .prepare("SELECT shelter FROM custody WHERE holder_id = ?1 ORDER BY received_at DESC, id DESC LIMIT 1")
    .bind(actor.accountId)
    .first<{ shelter: string }>();
  return row?.shelter ?? null;
}
