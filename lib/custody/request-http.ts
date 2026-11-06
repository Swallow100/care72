// 受入依頼の受け口（docs/tasks/T163.md）。route は同じ所からの要求かを見て、ここの結果を応答にするだけ（lib/custody/http.ts と同じ形）。
// 送る・下げるはケアマネの役（lib/office/scope.ts の officeActor）、返事は医療班の役（staffActor のうち medical）。
// 断り方: ログインしていなければ 401、役が違えば 403。応答に人の物（氏名・カナ）を入れない（id と言葉だけ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { officeActor } from "../office/scope.ts";
import { staffActor } from "./actor.ts";
import { isId, parseShelter } from "./forms.ts";
import { fail, type JsonOutcome } from "./http.ts";
import { acceptRequest, declineRequest, seesRequests, sendRequest, withdrawRequest } from "./requests.ts";

function body(raw: unknown): Record<string, unknown> {
  return (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
}

/** 依頼を送る（ケアマネの役）。personId と行き先 */
export async function sendRequestPost(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  const actor = officeActor(p);
  if (!actor) return fail("forbidden");
  const o = body(raw);
  if (!isId(o.personId)) return fail("invalid");
  const shelter = parseShelter(o.shelter);
  if (!shelter.ok) return fail(shelter.error);
  const r = await sendRequest(db, actor, { personId: o.personId, shelter: shelter.value }, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, requestId: r.requestId } };
}

/** 依頼を下げる（ケアマネの役） */
export async function withdrawRequestPost(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  const actor = officeActor(p);
  if (!actor) return fail("forbidden");
  const o = body(raw);
  if (!isId(o.requestId)) return fail("invalid");
  const r = await withdrawRequest(db, actor, o.requestId, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true } };
}

/** 医療班の返事（answer は accept か decline）。受け入れたら受け持ちの id を返す（受入一覧の ?received=） */
export async function replyRequestPost(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  const actor = staffActor(p);
  if (!actor || !seesRequests(actor)) return fail("forbidden");
  const o = body(raw);
  if (!isId(o.requestId)) return fail("invalid");
  if (o.answer !== "accept" && o.answer !== "decline") return fail("invalid");
  const r = o.answer === "accept" ? await acceptRequest(db, actor, o.requestId, at) : await declineRequest(db, actor, o.requestId, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, custodyId: r.custodyId } };
}
