// 受け持ちの受け口（docs/tasks/T23.md）。route は同じ所からの要求かを見て、ここの結果を応答にするだけ。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// 断り方: ログインしていなければ 401、行政・医療班でなければ 403（ケアマネ・本人・家族・役を選ぶ前の審査員）。
// 引受（事業所の画面）だけはケアマネの役（lib/office/scope.ts の officeActor）。
// 応答に住所・電話・漢字の氏名を入れない（検索・避難所の一覧のヒットはカナ・生年月日・年齢だけ。lib/custody/search.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { OFFICE_PATH, type PostOutcome } from "../disaster/http.ts";
import type { FormLike } from "../disaster/state.ts";
import { officeActor } from "../office/scope.ts";
import { resolveQrToken } from "../qr/store.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { isId, parseOnSite, parseRelease, parseSearch, parseShelter } from "./forms.ts";
import { CUSTODY_ERROR_LABELS, CUSTODY_ERROR_STATUS, type CustodyError } from "./labels.ts";
import { staffHref, UNAFFILIATED_ANCHOR } from "./paths.ts";
import { searchPeople, shelterPeople } from "./search.ts";
import { receive, registerOnSite, release } from "./store.ts";
import { takeOver } from "./takeover.ts";

export type JsonOutcome = { status: number; body: Record<string, unknown> };

export function fail(error: CustodyError): JsonOutcome {
  return { status: CUSTODY_ERROR_STATUS[error], body: { ok: false, error, label: CUSTODY_ERROR_LABELS[error] } };
}

/** JSON の応答に。キャッシュさせない（カナ・生年月日が入る） */
export function jsonResponse(o: JsonOutcome): Response {
  return Response.json(o.body, { status: o.status, headers: { "Cache-Control": "no-store" } });
}

function actorOf(p: Principal | null): StaffActor | CustodyError {
  if (!p) return "login_required";
  return staffActor(p) ?? "forbidden";
}

/** 氏名・カナ・生年月日の検索（事業所をまたぐ） */
export async function searchRequest(db: D1Database, p: Principal | null, raw: unknown, today: string): Promise<JsonOutcome> {
  const actor = actorOf(p);
  if (typeof actor === "string") return fail(actor);
  const q = parseSearch(raw, today);
  if (!q.ok) return fail(q.error);
  const r = await searchPeople(db, actor, q.value, today);
  return { status: 200, body: { ok: true, hits: r.hits, more: r.more } };
}

/** 避難所で受け入れられている人（誰が受け入れたかを問わない） */
export async function shelterRequest(db: D1Database, p: Principal | null, raw: unknown, today: string): Promise<JsonOutcome> {
  const actor = actorOf(p);
  if (typeof actor === "string") return fail(actor);
  const shelter = parseShelter((raw as { shelter?: unknown } | null)?.shelter);
  if (!shelter.ok) return fail(shelter.error);
  return { status: 200, body: { ok: true, hits: await shelterPeople(db, actor, shelter.value, today) } };
}

/** 受け入れ（検索・避難所の一覧から）。personId と避難所 */
export async function receiveRequest(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  const actor = actorOf(p);
  if (typeof actor === "string") return fail(actor);
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!isId(o.personId)) return fail("invalid");
  const via = o.via === "shelter" ? "shelter" : o.via === "search" ? "search" : null;
  if (!via) return fail("invalid");
  const shelter = parseShelter(o.shelter);
  if (!shelter.ok) return fail(shelter.error);
  const r = await receive(db, actor, { personId: o.personId, shelter: shelter.value, via }, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, personId: r.personId, custodyId: r.custodyId } };
}

/** 台帳に無い人をその場で登録して受け持ちに入れる */
export async function registerRequest(
  db: D1Database,
  p: Principal | null,
  raw: unknown,
  now: { at: string; today: string },
): Promise<JsonOutcome> {
  const actor = actorOf(p);
  if (typeof actor === "string") return fail(actor);
  const input = parseOnSite(raw, now.today);
  if (!input.ok) return fail(input.error);
  const r = await registerOnSite(db, actor, input.value, now.at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, personId: r.personId, custodyId: r.custodyId } };
}

/** 搬送・退所（受け持ちを閉じる） */
export async function releaseRequest(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  const actor = actorOf(p);
  if (typeof actor === "string") return fail(actor);
  const input = parseRelease(raw);
  if (!input.ok) return fail(input.error);
  const r = await release(db, actor, input.value, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, personId: r.personId } };
}

const str = (v: FormDataEntryValue | null | undefined): string | null => (typeof v === "string" ? v : null);

/**
 * QR の頁の「受入」（フォームの POST: token・shelter）。本人の id はフォームに載せず、サーバーがトークンを引き直す
 * （署名・期限・今の版。lib/qr/store.ts）。受け入れたら /staff へ、誤りは /staff?error=<種類>
 */
export async function qrReceivePost(
  db: D1Database,
  p: Principal | null,
  form: FormLike | null,
  opts: { secret: string; nowSec: number; at: string },
): Promise<PostOutcome> {
  if (!p) return { status: 401 };
  const actor = staffActor(p);
  if (!actor) return { status: 403 };
  const hit = await resolveQrToken(db, opts.secret, str(form?.get("token")), opts.nowSec);
  if (!hit) return { status: 303, location: staffHref("not_found") };
  const shelter = parseShelter(str(form?.get("shelter")));
  if (!shelter.ok) return { status: 303, location: staffHref(shelter.error) };
  const r = await receive(db, actor, { personId: hit.p, shelter: shelter.value, via: "qr" }, opts.at);
  // もう受け入れている人は受け持ちの一覧へ（誤りにしない）
  if (!r.ok && r.error !== "already") return { status: 303, location: staffHref(r.error) };
  return { status: 303, location: staffHref() };
}

export function takeBackHref(error: string | null = null): string {
  return `${OFFICE_PATH}${error ? `?people_error=${error}` : ""}#${UNAFFILIATED_ANCHOR}`;
}

/** 事業所の画面の「引受」（フォームの POST: person）。ケアマネの役だけ */
export async function takePost(db: D1Database, p: Principal | null, form: FormLike | null, at: string): Promise<PostOutcome> {
  if (!p) return { status: 401 };
  const actor = officeActor(p);
  if (!actor) return { status: 403 };
  const person = str(form?.get("person"));
  if (!isId(person)) return { status: 303, location: takeBackHref("bad") };
  const r = await takeOver(db, actor, person, at);
  return { status: 303, location: takeBackHref(r.ok ? null : r.error) };
}
