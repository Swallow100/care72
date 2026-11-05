// 本人のページの「スマホ」の面の形（T149）。スマホ入口（T69a）は書類でなく本人と家族のスマホの入口なので、書類の行から外し、
// 同意の面のすぐ後に置く（components/person/PersonView.tsx の phone）。ケアマネの役だけ（入れる欄と同じ人。components/person/PersonWithIntake.tsx）。
// 出す物: 入口の状態（未発行・有効・期限切れ、一覧外）と期限、本人用と家族用（家族・同居・緊急連絡先）の行ごとの ID の有無と通知の端末の数、
// 同意の決まり（lib/phone/consent.ts）に合わない人は「同意なし」で、詳しい画面（発行）へ進めない。
// D1 を自分で読む（本人のページの組み立て lib/person.ts には足さない）。Claude は呼ばない。

import type { D1Database } from "@cloudflare/workers-types";
import type { ConsentKind, ConsentStatus, ContactKind, ContactReach } from "../db/types.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import type { PersonPageRows } from "../person.ts";
import { liveSubscriptionCounts } from "../push/store.ts";
import { phoneLinkState, type PhoneLinkStatus } from "../qr/phone-link-store.ts";
import { familyLinkContacts } from "../qr/phone-link-view.ts";
import { livePhoneAccountKeys } from "./account.ts";
import { phoneEntryAllowed } from "./consent.ts";

export type PhoneSummaryRow = {
  /** "self" か連絡先の id */
  key: string;
  kind: "self" | "family";
  /** 家族用の名前（本人用は null。面の上に本人の名前がある） */
  name: string | null;
  relation: string | null;
  /** 今も通る ID がある */
  account: boolean;
  /** 今も通る通知の端末の数 */
  notify: number;
};

export type PhoneSummary = {
  personId: string;
  /** 詳しい画面（リンクと QR・発行・再発行。app/people/[id]/phone） */
  href: string;
  status: PhoneLinkStatus;
  unlisted: boolean;
  expiresAt: string | null;
  /** 同意の決まりに合う（作れる） */
  allowed: boolean;
  rows: PhoneSummaryRow[];
};

type PersonRow = { id: string; phone_link_generation: number; phone_link_issued_at: string | null; unlisted_at: string | null };
type ContactRow = Pick<
  PersonPageRows["contacts"][number],
  "id" | "person_id" | "kind" | "relation" | "name" | "reach" | "emergency_order" | "has_smartphone" | "sort"
>;

export function phonePagePath(personId: string): string {
  return `/people/${encodeURIComponent(personId)}/phone`;
}

/** 面の形を組む（D1 を読んだあとの純な部分。テストで直接呼ぶ） */
export function buildPhoneSummary(input: {
  person: PersonRow;
  contacts: readonly ContactRow[];
  consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>;
  accounts: ReadonlySet<string>;
  notify: ReadonlyMap<string, number>;
  now: number;
}): PhoneSummary {
  const { person } = input;
  const state = phoneLinkState(person, input.now);
  const family = familyLinkContacts({
    person: { id: person.id } as PersonPageRows["person"],
    contacts: input.contacts as PersonPageRows["contacts"],
  });
  const row = (key: string, kind: "self" | "family", name: string | null, relation: string | null): PhoneSummaryRow => ({
    key,
    kind,
    name,
    relation,
    account: input.accounts.has(key),
    notify: input.notify.get(key) ?? 0,
  });
  return {
    personId: person.id,
    href: phonePagePath(person.id),
    status: state.status,
    unlisted: person.unlisted_at !== null,
    expiresAt: state.expiresAt,
    allowed: phoneEntryAllowed(input.consents),
    rows: [
      row("self", "self", null, null),
      ...family.map((c) =>
        row(c.id, "family", c.name?.trim() || CONTACT_KIND_LABELS[c.kind as ContactKind], c.relation?.trim() || CONTACT_KIND_LABELS[c.kind as ContactKind]),
      ),
    ],
  };
}

/** 本人 1 人の面の形。本人が無ければ null。now は秒 */
export async function loadPhoneSummary(db: D1Database, personId: string, now: number): Promise<PhoneSummary | null> {
  const person = await db
    .prepare("SELECT id, phone_link_generation, phone_link_issued_at, unlisted_at FROM people WHERE id = ?1")
    .bind(personId)
    .first<PersonRow>();
  if (!person) return null;
  const [contacts, consents, accounts, notify] = await Promise.all([
    db
      .prepare(
        `SELECT id, person_id, kind, relation, name, reach, emergency_order, has_smartphone, sort FROM contacts WHERE person_id = ?1`,
      )
      .bind(personId)
      .all<ContactRow & { kind: ContactKind; reach: ContactReach | null }>(),
    db.prepare("SELECT kind, status FROM consents WHERE person_id = ?1").bind(personId).all<{ kind: ConsentKind; status: ConsentStatus }>(),
    livePhoneAccountKeys(db, personId),
    liveSubscriptionCounts(db, personId),
  ]);
  return buildPhoneSummary({ person, contacts: contacts.results ?? [], consents: consents.results ?? [], accounts, notify, now });
}
