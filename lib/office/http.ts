// 利用者追加・ケアマネ追加・担当の割当の受け口（docs/tasks/T30.md）。route は同じ所からの要求かを見て、ここの結果を応答にするだけ。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// - 利用者追加（JSON）: 作ったら本人のページ（担当一覧の右の面 /?open=<id>）の URL を返す。画面が開いて入れる欄で続きを入れる
// - ケアマネ追加（JSON）: 管理者だけ。初期パスワードの平文は、この応答で 1 回だけ返す（URL・ログ・表には出さない。応答は no-store）
// - 担当の割当・一括変更（T60）・外す・戻す（フォームの POST）: 303 で画面へ戻す。一括変更は戻り先に変更と飛ばしの人数（moved・skipped）。誤りは URL の people_error（言葉の種類だけ。名前は載せない）
// 断り方: ログインしていなければ 401、ケアマネの役でなければ 403（lib/auth/guard.ts の denied と同じ形）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { caseloadHref } from "../caseload.ts";
import { OFFICE_PATH, type PostOutcome } from "../disaster/http.ts";
import type { FormLike } from "../disaster/state.ts";
import { parseDisplayName, parsePersonInput, parseStaffInput } from "./forms.ts";
import { OFFICE_ERROR_LABELS, PEOPLE_ACTION_ERRORS, type OfficeApiError, type PeopleActionError } from "./labels.ts";
import { ASSIGN_ANCHOR } from "./http-paths.ts";
import { assignMany, assignPerson, createPerson, MAX_ASSIGN_MANY, setUnlisted, type AssignManyItem } from "./people.ts";
import { officeActor } from "./scope.ts";
import {
  addCareManager,
  renameCareManager,
  resetCareManagerPassword,
  setCareManagerAdmin,
  setCareManagerDisabled,
  type StaffChangeResult,
} from "./staff.ts";

export type JsonOutcome = { status: number; body: Record<string, unknown> };

const STATUS: Record<OfficeApiError, number> = {
  name: 400,
  kana: 400,
  birth: 400,
  sex: 400,
  care_manager: 400,
  display_name: 400,
  login_id: 400,
  login_taken: 409,
  login_unavailable: 409,
  invalid: 400,
  forbidden: 403,
  login_required: 401,
  // ケアマネの変更（T61）
  fixed: 403,
  self: 400,
  last_admin: 409,
  has_people: 409,
  not_found: 404,
  conflict: 409,
};

function fail(error: OfficeApiError): JsonOutcome {
  return { status: STATUS[error], body: { ok: false, error, label: OFFICE_ERROR_LABELS[error] } };
}

/** JSON の応答に。キャッシュさせない（ケアマネ追加の応答に初期パスワードが入る） */
export function jsonResponse(o: JsonOutcome): Response {
  return Response.json(o.body, { status: o.status, headers: { "Cache-Control": "no-store" } });
}

/** 利用者追加。today は JST の日付（先の生年月日を断る） */
export async function createPersonRequest(
  db: D1Database,
  p: Principal | null,
  raw: unknown,
  now: { at: string; today: string },
): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  const actor = officeActor(p);
  if (!actor) return fail("forbidden");
  const parsed = parsePersonInput(raw, now.today);
  if (!parsed.ok) return fail(parsed.error);
  const r = await createPerson(db, actor, parsed.value, now.at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, id: r.id, href: caseloadHref({ open: r.id }) } };
}

/** ケアマネ追加。管理者だけ。初期パスワードの平文はこの応答にだけ入る */
export async function addCareManagerRequest(
  db: D1Database,
  p: Principal | null,
  raw: unknown,
  at: string,
  opts: { iterations?: number } = {},
): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  const actor = officeActor(p);
  if (!actor || !actor.admin) return fail("forbidden");
  const parsed = parseStaffInput(raw);
  if (!parsed.ok) return fail(parsed.error);
  const r = await addCareManager(db, actor, parsed.value, at, opts);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, account: r.account, password: r.password } };
}

// ---------- ケアマネの変更（T61、JSON） ----------

/** POST /api/office/care-managers/[id] の action */
export const CARE_MANAGER_ACTIONS = ["rename", "admin", "disable", "reset_password"] as const;
export type CareManagerAction = (typeof CARE_MANAGER_ACTIONS)[number];

type ParsedAction =
  | { action: "rename"; displayName: string }
  | { action: "admin"; admin: boolean }
  | { action: "disable"; disabled: boolean }
  | { action: "reset_password" };

/** 形を読む。名前が違えば display_name、ほかの形の違いは invalid */
function parseCareManagerAction(raw: unknown): ParsedAction | "invalid" | "display_name" {
  if (typeof raw !== "object" || raw === null) return "invalid";
  const o = raw as Record<string, unknown>;
  switch (o.action) {
    case "rename": {
      const displayName = parseDisplayName(o.displayName);
      return displayName === null ? "display_name" : { action: "rename", displayName };
    }
    case "admin":
      return typeof o.admin === "boolean" ? { action: "admin", admin: o.admin } : "invalid";
    case "disable":
      return typeof o.disabled === "boolean" ? { action: "disable", disabled: o.disabled } : "invalid";
    case "reset_password":
      return { action: "reset_password" };
    default:
      return "invalid";
  }
}

/**
 * ケアマネの改名・管理者の付け外し・停止と再開・パスワードの再発行。ログイン・管理者・形の順に断る（同じ所からかは route）。
 * 種のデモ事業所のアカウント（山本・審査員）は fixed で 403。再発行の平文はこの応答にだけ入る（no-store）
 */
export async function careManagerActionRequest(
  db: D1Database,
  p: Principal | null,
  accountId: string,
  raw: unknown,
  at: string,
  opts: { iterations?: number } = {},
): Promise<JsonOutcome> {
  if (!p) return fail("login_required");
  const actor = officeActor(p);
  if (!actor || !actor.admin) return fail("forbidden");
  if (!ID.test(accountId)) return fail("not_found");
  const parsed = parseCareManagerAction(raw);
  if (typeof parsed === "string") return fail(parsed);
  if (parsed.action === "reset_password") {
    const r = await resetCareManagerPassword(db, actor, accountId, at, opts);
    if (!r.ok) return fail(r.error);
    return { status: 200, body: { ok: true, account: r.account, password: r.password } };
  }
  let r: StaffChangeResult;
  if (parsed.action === "rename") r = await renameCareManager(db, actor, accountId, parsed.displayName, at);
  else if (parsed.action === "admin") r = await setCareManagerAdmin(db, actor, accountId, parsed.admin, at);
  else r = await setCareManagerDisabled(db, actor, accountId, parsed.disabled, at);
  if (!r.ok) return fail(r.error);
  return { status: 200, body: { ok: true, changed: r.changed } };
}

// ---------- 担当の割当・外す・戻す（フォームの POST） ----------

export const PEOPLE_ACTIONS = ["assign", "assign_many", "unlist", "relist"] as const;
export type PeopleAction = (typeof PEOPLE_ACTIONS)[number];

/** 戻る画面: 事業所（担当の表）か担当一覧（外した人の畳み） */
export type PeopleBack = "office" | "caseload";

export function peopleBackHref(back: PeopleBack, error: PeopleActionError | null = null): string {
  const base = back === "caseload" ? caseloadHref({}) : OFFICE_PATH;
  const q = error ? `${base}?people_error=${error}` : base;
  return back === "office" ? `${q}#${ASSIGN_ANCHOR}` : q;
}

export function parsePeopleError(v: unknown): PeopleActionError | null {
  return typeof v === "string" && (PEOPLE_ACTION_ERRORS as readonly string[]).includes(v) ? (v as PeopleActionError) : null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v: FormDataEntryValue | null | undefined): string | null => (typeof v === "string" ? v : null);

/** 一括変更のあとの戻り先（事業所の担当の表）。変更と飛ばしの人数だけを載せる（名前は載せない） */
export function assignManyHref(moved: number, skipped: number): string {
  return `${OFFICE_PATH}?moved=${moved}&skipped=${skipped}#${ASSIGN_ANCHOR}`;
}

/** 戻り先の moved・skipped を読む。形が違えば null（知らせを出さない） */
export function parseAssignedMany(q: { moved?: unknown; skipped?: unknown }): { moved: number; skipped: number } | null {
  const n = (v: unknown) => (typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : null);
  const moved = n(q.moved);
  const skipped = n(q.skipped ?? "0");
  return moved === null || skipped === null ? null : { moved, skipped };
}

/**
 * 一括変更のフォーム: person（複数）、人ごとの from.<person>（画面で読んだ担当、未割当は空）、to。
 * 選んでいない・多すぎる・形の違う id は bad、移動先の形が違えば care_manager
 */
function parseAssignMany(form: FormLike | null): { ok: true; items: AssignManyItem[]; to: string } | { ok: false; error: "bad" | "care_manager" } {
  const persons = (form?.getAll("person") ?? []).map((v) => str(v) ?? "");
  if (persons.length === 0 || persons.length > MAX_ASSIGN_MANY || persons.some((id) => !ID.test(id))) return { ok: false, error: "bad" };
  const items: AssignManyItem[] = [];
  for (const personId of persons) {
    const from = str(form?.get(`from.${personId}`)) ?? "";
    if (from !== "" && !ID.test(from)) return { ok: false, error: "bad" };
    items.push({ personId, from: from || null });
  }
  const to = str(form?.get("to")) ?? "";
  if (!ID.test(to)) return { ok: false, error: "care_manager" };
  return { ok: true, items, to };
}

/** 担当の割当（action=assign、person・from・to）、一括変更（assign_many、person を複数・from.<person>・to）、外す（unlist）、戻す（relist） */
export async function peoplePost(db: D1Database, p: Principal | null, form: FormLike | null, at: string): Promise<PostOutcome> {
  if (!p) return { status: 401 };
  const actor = officeActor(p);
  if (!actor) return { status: 403 };
  const back: PeopleBack = str(form?.get("back")) === "caseload" ? "caseload" : "office";
  const action = str(form?.get("action"));
  if (action === "assign_many") {
    const parsed = parseAssignMany(form);
    if (!parsed.ok) return { status: 303, location: peopleBackHref(back, parsed.error) };
    const r = await assignMany(db, actor, { items: parsed.items, to: parsed.to }, at);
    if (!r.ok) return { status: 303, location: peopleBackHref(back, r.error) };
    return { status: 303, location: back === "office" ? assignManyHref(r.changed, r.skipped) : peopleBackHref(back) };
  }
  const person = str(form?.get("person"));
  if (!person || !ID.test(person) || !(PEOPLE_ACTIONS as readonly string[]).includes(action ?? "")) {
    return { status: 303, location: peopleBackHref(back, "bad") };
  }

  let r;
  if (action === "assign") {
    const from = str(form?.get("from")) ?? "";
    const to = str(form?.get("to")) ?? "";
    if ((from !== "" && !ID.test(from)) || !ID.test(to)) return { status: 303, location: peopleBackHref(back, "care_manager") };
    r = await assignPerson(db, actor, { personId: person, from: from || null, to }, at);
  } else {
    r = await setUnlisted(db, actor, { personId: person, unlisted: action === "unlist" }, at);
  }
  return { status: 303, location: peopleBackHref(back, r.ok ? null : r.error) };
}
