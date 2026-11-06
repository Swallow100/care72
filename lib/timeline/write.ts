// 経過の書き足し（docs/tasks/T24.md、docs/SPEC.md「画面 2」「画面 6」）。本人のページの経過に、定型（安否確認・診察・配薬・搬送・到着）と
// 自由文を 1 行足す。誰が（書き手のアカウント）・いつ（サーバーの時刻）・どの役（ケアマネ・医療班・行政）はここで付ける。
// 行政の書いた行はケアマネの経過にも出る（同じ timeline_entries）。医療班の役は今は書けない（T172、lib/consent/relay.ts）。
//
// 断り方: ログインしていなければ 401、保存できない役は 403、壁（lib/auth/scope.ts の personInScope）の外は 404、
// 範囲（lib/consent/scope.ts の writes）に無い種類は 403。行政は受け持ちの間だけ（壁が受け持ちを見る）。
// 自由文はそのまま D1 に入れるだけで、Claude にも声にも渡さない（要約・分類もしない）。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import { TIMELINE_ERROR_LABELS, TIMELINE_ERROR_STATUS, type TimelineError } from "../consent/labels.ts";
import { canWrite, viewScope, WRITABLE_KINDS, type WritableKind } from "../consent/scope.ts";
import type { AuthorRole, ConsentKind, ConsentStatus, PersonOrigin } from "../db/types.ts";
import { BODY_MAX } from "./paths.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** 改行のほかの制御文字 */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export type WriteInput = { personId: string; kind: WritableKind; body: string | null };

type Parsed = { ok: true; value: WriteInput } | { ok: false; error: TimelineError };

/** 画面から来た値を読む。kind は書き足せる種類、body は前後の空白を落として 400 字まで（記録は本文が要る） */
export function parseWrite(raw: unknown): Parsed {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof o.personId !== "string" || !ID.test(o.personId)) return { ok: false, error: "invalid" };
  if (typeof o.kind !== "string" || !(WRITABLE_KINDS as readonly string[]).includes(o.kind)) return { ok: false, error: "invalid" };
  if (o.body !== undefined && o.body !== null && typeof o.body !== "string") return { ok: false, error: "invalid" };
  const body = typeof o.body === "string" ? o.body.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
  if (CONTROL.test(body)) return { ok: false, error: "invalid" };
  if (body.length > BODY_MAX) return { ok: false, error: "too_long" };
  const kind = o.kind as WritableKind;
  if (kind === "note" && body === "") return { ok: false, error: "empty" };
  return { ok: true, value: { personId: o.personId, kind, body: body === "" ? null : body } };
}

/** 書き手の役（経過の author_role）。書き足せる役だけ */
function authorRoleOf(p: Principal): AuthorRole | null {
  switch (p.role) {
    case "care_manager":
    case "medical":
    case "government":
      return p.role;
    default:
      return null;
  }
}

export type WriteResult = { ok: true; id: string; at: string } | { ok: false; error: TimelineError };

/** 1 行足す。at はサーバーの時刻（ISO） */
export async function writeTimeline(
  db: D1Database,
  p: Principal | null,
  input: WriteInput,
  at: string,
  id: string = `tl-w-${crypto.randomUUID()}`,
): Promise<WriteResult> {
  if (!p) return { ok: false, error: "login_required" };
  const role = authorRoleOf(p);
  if (!role || !roleAllows(p.role, "save") || !p.accountId) return { ok: false, error: "forbidden" };
  const person = await personInScope(db, p, input.personId);
  if (!person) return { ok: false, error: "not_found" };

  // 書ける種類は役と同意から（lib/consent/scope.ts。画面の欄と同じ所）
  const [origin, consents] = await db.batch([
    db.prepare("SELECT origin FROM people WHERE id = ?1").bind(person.id),
    db.prepare("SELECT kind, status, scope FROM consents WHERE person_id = ?1").bind(person.id),
  ]);
  const scope = viewScope(p.role, {
    consents: consents.results as Array<{ kind: ConsentKind; status: ConsentStatus; scope: string | null }>,
    origin: (origin.results[0] as { origin: PersonOrigin } | undefined)?.origin ?? "care_manager",
  });
  if (!canWrite(scope, input.kind)) return { ok: false, error: "forbidden" };

  await db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?7)`,
    )
    .bind(id, person.id, p.accountId, role, input.kind, input.body, at)
    .run();
  return { ok: true, id, at };
}

export type JsonOutcome = { status: number; body: Record<string, unknown> };

export function fail(error: TimelineError): JsonOutcome {
  return { status: TIMELINE_ERROR_STATUS[error], body: { ok: false, error, label: TIMELINE_ERROR_LABELS[error] } };
}

/** POST /api/timeline の中身。ログインと役を先に見る（入力の誤りより先に 401・403） */
export async function writeTimelineRequest(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  if (!authorRoleOf(p) || !roleAllows(p.role, "save")) return fail("forbidden");
  const input = parseWrite(raw);
  if (!input.ok) return fail(input.error);
  const r = await writeTimeline(db, p, input.value, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, id: r.id, at: r.at } };
}

export function jsonResponse(o: JsonOutcome): Response {
  return Response.json(o.body, { status: o.status, headers: { "Cache-Control": "no-store" } });
}
