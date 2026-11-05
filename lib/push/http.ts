// 通知の API の中身（T149）。D1・鍵・fetch・Principal を引数で受ける（テストで node:sqlite と偽の送り先を渡す）。route は app/api/push と
// app/api/people/[id]/push で、ここの結果を応答にするだけ。Claude は呼ばない。
//
// - 購読（subscribePost・unsubscribe）: 本人・家族の役だけ（リンク・ID・審査員と山本の本人・家族の役）。本人・連絡先はセッションから決まり、
//   端末から来た本人の id は使わない（ほかの人の購読を作らせない）
// - 安否確認（safetyPost）: ケアマネの役だけ、壁（personInScope）の中の本人だけ、事業所が災害モードの間だけ。本人と家族の今も通る購読へ送る。
//   1 分の間に同じ人へ 2 度は送らない。送ったら本人の経過に「安否確認 通知」（kind note、payload の source push）
// - 災害モードに入った時（officeSafety）: 事業所の全員の今も通る購読へ送る（app/office/mode/route.ts が応答のあとに走らせる）
// 通知の文は固定（lib/push/message.ts）。色と連絡順には触れない（通知は聞くだけ。答えは本人・家族の頁から今の信号の道で届く）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import { canChooseRole } from "../auth/wall.ts";
import { loadDisasterState } from "../disaster/db.ts";
import { isDisaster } from "../disaster/state.ts";
import { PUSH_LOG } from "./labels.ts";
import { audienceOf, pushMessage } from "./message.ts";
import { sendAll, type PushFetch, type PushOutcome } from "./send.ts";
import {
  deleteSubscription,
  liveSubscriptionsOf,
  liveSubscriptionsOfOffice,
  recordOutcomes,
  saveSubscription,
  type PushOwner,
} from "./store.ts";
import { parseSubscription } from "./subscription.ts";
import type { Vapid } from "./vapid.ts";

/** 同じ人へ安否確認を続けて送らない間（秒） */
export const SAFETY_INTERVAL_SEC = 60;

export type PushError = "login_required" | "forbidden" | "invalid" | "not_found";
export const PUSH_ERROR_STATUS: Record<PushError | "not_configured" | "normal" | "wait", number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  not_configured: 503,
  normal: 409,
  wait: 429,
};

/** 購読できる人（本人・家族の役で、本人の行がある）。違えば断りの理由 */
function phoneOwner(p: Principal | null): { personId: string; contactId: string | null } | PushError {
  if (!p) return "login_required";
  if ((p.role !== "self" && p.role !== "family") || !p.personId || !roleAllows(p.role, "save")) return "forbidden";
  if (p.role === "family" && !p.contactId) return "forbidden";
  return { personId: p.personId, contactId: p.role === "family" ? p.contactId : null };
}

/** 購読を入れる。リンク・ID の端末は本人の行の今の版と時刻を一緒に持つ（審査員・山本の役は持たない） */
export async function subscribePost(
  db: D1Database,
  p: Principal | null,
  body: unknown,
  nowIso: string,
): Promise<{ ok: true } | { ok: false; error: PushError }> {
  const who = phoneOwner(p);
  if (typeof who === "string") return { ok: false, error: who };
  const sub = parseSubscription(body);
  if (!sub) return { ok: false, error: "invalid" };
  let link: PushOwner["link"] = null;
  if (!canChooseRole(p!)) {
    const row = await db
      .prepare("SELECT phone_link_generation, phone_link_issued_at FROM people WHERE id = ?1 AND unlisted_at IS NULL")
      .bind(who.personId)
      .first<{ phone_link_generation: number; phone_link_issued_at: string | null }>();
    if (!row || row.phone_link_generation < 1 || !row.phone_link_issued_at) return { ok: false, error: "not_found" };
    link = { generation: row.phone_link_generation, issuedAt: row.phone_link_issued_at };
  }
  await saveSubscription(db, { ...who, link }, sub, nowIso);
  return { ok: true };
}

/** 購読を外す（端末で通知を止めた）。本人の物だけ */
export async function unsubscribePost(
  db: D1Database,
  p: Principal | null,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: PushError }> {
  const who = phoneOwner(p);
  if (typeof who === "string") return { ok: false, error: who };
  const endpoint = body && typeof body === "object" ? (body as { endpoint?: unknown }).endpoint : null;
  if (typeof endpoint !== "string" || endpoint.length > 1024) return { ok: false, error: "invalid" };
  await deleteSubscription(db, who.personId, endpoint);
  return { ok: true };
}

export type SafetyResult =
  | { ok: true; sent: number; total: number }
  | { ok: false; error: PushError | "not_configured" | "normal" | "wait" };

/** 送って、結果を表に（届いた物に時刻、無くなった物は消す） */
async function deliver(
  db: D1Database,
  vapid: Vapid,
  fetchFn: PushFetch,
  subs: ReadonlyArray<{ id: string; endpoint: string; p256dh: string; auth: string; contact_id: string | null }>,
  now: number,
): Promise<PushOutcome[]> {
  const outcomes = await sendAll(
    fetchFn,
    vapid,
    subs.map((s) => ({ ...s, message: pushMessage(audienceOf(s.contact_id)) })),
    now,
  );
  await recordOutcomes(db, outcomes, new Date(now * 1000).toISOString());
  return outcomes;
}

/** 担当一覧の行の「安否確認」。now は秒。vapid が null（鍵が無い）なら送らない */
export async function safetyPost(
  db: D1Database,
  vapid: Vapid | null,
  fetchFn: PushFetch,
  p: Principal | null,
  personId: string,
  now: number,
): Promise<SafetyResult> {
  if (!p) return { ok: false, error: "login_required" };
  if (p.role !== "care_manager" || !p.office || !roleAllows(p.role, "save")) return { ok: false, error: "forbidden" };
  const brief = await personInScope(db, p, personId);
  if (!brief) return { ok: false, error: "not_found" };
  if (!isDisaster(await loadDisasterState(db, brief.office_id))) return { ok: false, error: "normal" };
  if (!vapid) return { ok: false, error: "not_configured" };
  const subs = await liveSubscriptionsOf(db, brief.id);
  if (subs.length === 0) return { ok: true, sent: 0, total: 0 };
  const last = Math.max(...subs.map((s) => (s.last_sent_at ? Date.parse(s.last_sent_at) / 1000 : 0)));
  if (now - last < SAFETY_INTERVAL_SEC) return { ok: false, error: "wait" };
  const outcomes = await deliver(db, vapid, fetchFn, subs, now);
  const sent = outcomes.filter((o) => o.result === "sent").length;
  // 経過に 1 行（送った数だけ。名前・端末は書かない）。種類は note（timeline_entries の CHECK を広げない。スマホ入口の発行と同じ作り）
  await db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
       VALUES (?1, ?2, ?3, 'care_manager', 'note', ?4, json_object('source', 'push', 'sent', ?5, 'total', ?6), ?7)`,
    )
    .bind(crypto.randomUUID(), brief.id, p.accountId, PUSH_LOG.safety, sent, subs.length, new Date(now * 1000).toISOString())
    .run();
  return { ok: true, sent, total: subs.length };
}

/** 事業所が災害モードに入った時: 全員の今も通る購読へ送る。送った数を返す（鍵が無ければ 0） */
export async function officeSafety(
  db: D1Database,
  vapid: Vapid | null,
  fetchFn: PushFetch,
  officeId: string,
  now: number,
): Promise<{ sent: number; total: number }> {
  if (!vapid) return { sent: 0, total: 0 };
  const subs = await liveSubscriptionsOfOffice(db, officeId);
  if (subs.length === 0) return { sent: 0, total: 0 };
  const outcomes = await deliver(db, vapid, fetchFn, subs, now);
  return { sent: outcomes.filter((o) => o.result === "sent").length, total: subs.length };
}
