// Web Push の購読を D1 で持つ（migrations/0035 の push_subscriptions、T149）。D1 を引数で受ける（テストで node:sqlite を渡す）。
// 送る先として数えるのは、今も通る購読だけ:
// - 本人が一覧にいる（people.unlisted_at IS NULL）
// - 家族用なら、連絡先の行がその本人の物で、答えられる種類（家族・支援者・民生委員。lib/signals/labels.ts の SIGNAL_WRITER_KINDS）
// - リンク・ID で開いた端末の購読は、作った時の版と時刻が本人の行の今の版と時刻と同じ（再発行・一覧から外すと届かない）。
//   審査員・役を替えた山本の本人・家族の役の購読は版を持たない（NULL）ので、本人が一覧にいる間は届く（毎朝 4 時に消える）
// 名前・病名は表に入れない（通知の文は固定）。

import type { D1Database } from "@cloudflare/workers-types";
import type { PushSubscriptionRow } from "../db/types.ts";
import { SIGNAL_WRITER_KINDS } from "../signals/labels.ts";
import type { PushSubscriptionInput } from "./subscription.ts";

/** 購読を受けた本人・連絡先と、リンクの版（審査員の役は null） */
export type PushOwner = {
  personId: string;
  contactId: string | null;
  link: { generation: number; issuedAt: string } | null;
};

const WRITER_KINDS = SIGNAL_WRITER_KINDS.map((k) => `'${k}'`).join(", ");

/** 今も通る購読の条件（s は push_subscriptions、p は people） */
export const LIVE_SUBSCRIPTION_SQL = `p.unlisted_at IS NULL
  AND (s.link_generation IS NULL OR (s.link_generation = p.phone_link_generation AND s.link_issued_at = p.phone_link_issued_at))
  AND (s.contact_id IS NULL OR EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = s.contact_id AND c.person_id = s.person_id AND c.kind IN (${WRITER_KINDS})))`;

/** 購読を入れる（同じ endpoint は後勝ちで持ち主と鍵を書き換える。1 つの端末で審査員が本人と家族の役を替えたときなど） */
export async function saveSubscription(db: D1Database, owner: PushOwner, sub: PushSubscriptionInput, nowIso: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, person_id, contact_id, endpoint, p256dh, auth, link_generation, link_issued_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT (endpoint) DO UPDATE SET
         person_id = excluded.person_id, contact_id = excluded.contact_id, p256dh = excluded.p256dh, auth = excluded.auth,
         link_generation = excluded.link_generation, link_issued_at = excluded.link_issued_at, updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      owner.personId,
      owner.contactId,
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      owner.link?.generation ?? null,
      owner.link?.issuedAt ?? null,
      nowIso,
    )
    .run();
}

/** 購読を外す（通知を止めた端末）。持ち主の本人の物だけ */
export async function deleteSubscription(db: D1Database, personId: string, endpoint: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1 AND person_id = ?2").bind(endpoint, personId).run();
  return (r.meta.changes ?? 0) > 0;
}

/** 今も通る購読（本人 1 人） */
export async function liveSubscriptionsOf(db: D1Database, personId: string): Promise<PushSubscriptionRow[]> {
  const r = await db
    .prepare(
      `SELECT s.* FROM push_subscriptions s JOIN people p ON p.id = s.person_id
        WHERE s.person_id = ?1 AND ${LIVE_SUBSCRIPTION_SQL} ORDER BY s.created_at, s.id`,
    )
    .bind(personId)
    .all<PushSubscriptionRow>();
  return r.results ?? [];
}

/** 今も通る購読（事業所の全員） */
export async function liveSubscriptionsOfOffice(db: D1Database, officeId: string): Promise<PushSubscriptionRow[]> {
  const r = await db
    .prepare(
      `SELECT s.* FROM push_subscriptions s JOIN people p ON p.id = s.person_id
        WHERE p.office_id = ?1 AND ${LIVE_SUBSCRIPTION_SQL} ORDER BY s.person_id, s.created_at, s.id`,
    )
    .bind(officeId)
    .all<PushSubscriptionRow>();
  return r.results ?? [];
}

/** 本人ごと・連絡先ごとの、今も通る購読の数（本人のページのスマホの面。本人用の鍵は "self"） */
export async function liveSubscriptionCounts(db: D1Database, personId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const s of await liveSubscriptionsOf(db, personId)) {
    const k = s.contact_id ?? "self";
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** 送ったあと: 届いた物に時刻、無くなった物（404・410）は消す */
export async function recordOutcomes(
  db: D1Database,
  outcomes: ReadonlyArray<{ id: string; result: "sent" | "gone" | "failed" }>,
  nowIso: string,
): Promise<void> {
  const stmts = outcomes.flatMap((o) => {
    if (o.result === "sent") return [db.prepare("UPDATE push_subscriptions SET last_sent_at = ?2 WHERE id = ?1").bind(o.id, nowIso)];
    if (o.result === "gone") return [db.prepare("DELETE FROM push_subscriptions WHERE id = ?1").bind(o.id)];
    return [];
  });
  if (stmts.length > 0) await db.batch(stmts);
}
