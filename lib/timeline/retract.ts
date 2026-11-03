// 経過の撤回（docs/tasks/T63.md）。人を間違えた安否確認・打ち違えた避難所・取り違えた電話の相手を、消さずに取り消し線で残す。
// 行は消さず、本文・payload・時刻も変えない。UPDATE は撤回の 3 列（いつ・誰が・理由）だけ。直したければ撤回して書き直す（「編集」は作らない）。
//
// 撤回できる行（retractableRow。字で固定）:
// - 書き足しの 6 種類（lib/consent/scope.ts の WRITABLE_KINDS: 安否確認・診察・配薬・搬送・到着・記録）で payload が無い行。
//   payload が無いのは lib/timeline/write.ts の書き足しだけ。入れる欄・事業所・受け持ち・QR 閲覧の記録（note）と、
//   受け持ちの閉じで書く搬送（transported、payload は custody）は撤回できない（元の表の状態と食い違うため）
// - 電話の記録（called、payload の source が call。lib/list/calls.ts）
// - 書き手が人（ケアマネ・医療班・行政）の行だけ。分類の記録（system）・本人・家族の行は撤回できない
// 色と連絡順に効く行（信号・順番変更・時計の確認・本人の報告の印・同意）は撤回できない。
//
// 撤回できる人（canRetract。画面のボタンも同じ述語）:
// - 書いた本人（author_id が自分で、同じ役で書いた行。審査員は役ごとに別の書き手として扱う）
// - ケアマネの役は、事業所の人（lib/auth/scope.ts の personInScope の壁の中）のケアマネが書いた行も
// 医療班・行政の書いた行は書いた本人だけ（医療班の記録はそのまま）。医療班・行政は受け持ちの間だけ（壁が受け持ちを見る）。
//
// 断り方は書き足し（lib/timeline/write.ts）と同じ: ログインなし 401、役 403、壁の外 404（在っても無くても）、撤回できない行・撤回済み 409。
// 理由（40 字、任意）は D1 に入れるだけで、Claude にも声にも渡さない。この作業は Claude を呼ばない。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import { WRITABLE_KINDS } from "../consent/scope.ts";
import type { AuthorRole, TimelineEntryRow } from "../db/types.ts";
import { RETRACT_ERROR_LABELS, RETRACT_ERROR_STATUS, type RetractError } from "./labels.ts";
import { RETRACT_NOTE_MAX } from "./paths.ts";
import type { JsonOutcome } from "./write.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** 制御文字（改行も。理由は 1 行） */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * 電話の記録の payload の source（lib/list/calls.ts の CALL_SOURCE と同じ字。テストで一致を確かめる）。
 * calls.ts は本人のページ（lib/person.ts）を読むので、ここから読むと輪になる
 */
export const CALL_PAYLOAD_SOURCE = "call";

/** 撤回できる書き手の役（人の役） */
const HUMAN_AUTHORS: ReadonlySet<AuthorRole> = new Set(["care_manager", "medical", "government"]);

type RetractRowShape = Pick<TimelineEntryRow, "kind" | "payload" | "author_role" | "retracted_at">;

function isCallPayload(text: string | null): boolean {
  if (!text) return false;
  try {
    const v = JSON.parse(text) as { source?: unknown };
    return typeof v === "object" && v !== null && v.source === CALL_PAYLOAD_SOURCE;
  } catch {
    return false;
  }
}

/** 行の形として撤回できるか（誰が撤回するかは見ない）。撤回済みの行は false */
export function retractableRow(row: RetractRowShape): boolean {
  if (row.retracted_at) return false;
  if (!HUMAN_AUTHORS.has(row.author_role)) return false;
  if (row.kind === "called") return isCallPayload(row.payload);
  return (WRITABLE_KINDS as readonly string[]).includes(row.kind) && row.payload === null;
}

/** 撤回する人（Principal のうち見る所） */
export type Retracter = Pick<Principal, "role" | "accountId">;

/** 撤回する役（書き足せる役と同じ） */
function retracterRole(p: Retracter): AuthorRole | null {
  return p.role === "care_manager" || p.role === "medical" || p.role === "government" ? p.role : null;
}

/**
 * この人がこの行を撤回できるか。壁（事業所・受け持ち）は呼ぶ側が先に通す（retractTimeline は personInScope、
 * 本人のページは loadPersonPage が通したあと）。画面の撤回のボタンもこれで出す
 */
export function canRetract(p: Retracter, row: RetractRowShape & Pick<TimelineEntryRow, "author_id">): boolean {
  const role = retracterRole(p);
  if (!role || !roleAllows(p.role, "save") || !p.accountId) return false;
  if (!retractableRow(row)) return false;
  if (row.author_id === p.accountId && row.author_role === role) return true;
  return role === "care_manager" && row.author_role === "care_manager";
}

export type RetractInput = { id: string; note: string | null };

type Parsed = { ok: true; value: RetractInput } | { ok: false; error: RetractError };

/** 画面から来た値を読む。理由は前後の空白を落として 40 字まで、空は null */
export function parseRetract(raw: unknown): Parsed {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID.test(o.id)) return { ok: false, error: "invalid" };
  if (o.note !== undefined && o.note !== null && typeof o.note !== "string") return { ok: false, error: "invalid" };
  const note = typeof o.note === "string" ? o.note.normalize("NFC").trim() : "";
  if (CONTROL.test(note)) return { ok: false, error: "invalid" };
  if (note.length > RETRACT_NOTE_MAX) return { ok: false, error: "too_long" };
  return { ok: true, value: { id: o.id, note: note === "" ? null : note } };
}

export type RetractResult = { ok: true; id: string; at: string } | { ok: false; error: RetractError };

type StoredRow = Pick<TimelineEntryRow, "id" | "person_id" | "author_id" | "author_role" | "kind" | "payload" | "signal_id" | "retracted_at">;

/** 1 行を撤回する。at はサーバーの時刻（ISO） */
export async function retractTimeline(db: D1Database, p: Principal | null, input: RetractInput, at: string): Promise<RetractResult> {
  if (!p) return { ok: false, error: "login_required" };
  if (!retracterRole(p) || !roleAllows(p.role, "save") || !p.accountId) return { ok: false, error: "forbidden" };
  const row = await db
    .prepare(
      `SELECT id, person_id, author_id, author_role, kind, payload, signal_id, retracted_at
         FROM timeline_entries WHERE id = ?1`,
    )
    .bind(input.id)
    .first<StoredRow>();
  if (!row) return { ok: false, error: "not_found" };
  // 壁の外は、行が在っても無くても同じ 404
  const person = await personInScope(db, p, row.person_id);
  if (!person) return { ok: false, error: "not_found" };
  if (row.retracted_at) return { ok: false, error: "already" };
  if (!retractableRow(row)) return { ok: false, error: "not_retractable" };
  if (!canRetract(p, row)) return { ok: false, error: "forbidden" };

  const [updated] = await db.batch([
    // 同時の撤回で 1 回だけ（撤回していない行だけ）。撤回の 3 列のほかは触らない
    db
      .prepare(
        `UPDATE timeline_entries SET retracted_at = ?2, retracted_by = ?3, retracted_note = ?4
          WHERE id = ?1 AND person_id = ?5 AND retracted_at IS NULL`,
      )
      .bind(row.id, at, p.accountId, input.note, person.id),
    // 通話で聞いた安否（T58）: 電話の記録に結んだ信号（出どころ care_manager、訓練でない）も表から外す。
    // 上の UPDATE がこの撤回で入ったときだけ（同じ時刻・同じ人の撤回の行がある）。本人・家族・支援者・訓練の信号は外さない。
    // 行は消さず retracted_at だけ。ルールの表を読む所（lib/disaster/triage.ts・lib/caseload.ts・lib/custody/board.ts・
    // lib/forms/form9-db.ts）が retracted_at IS NULL で外し、色と連絡順は残りの事実から表が出し直す
    db
      .prepare(
        `UPDATE signals SET retracted_at = ?2
          WHERE id = (SELECT t.signal_id FROM timeline_entries t
                       WHERE t.id = ?1 AND t.kind = 'called' AND t.retracted_at = ?2 AND t.retracted_by = ?3)
            AND person_id = ?4 AND source = 'care_manager' AND drill_id IS NULL AND retracted_at IS NULL`,
      )
      .bind(row.id, at, p.accountId, person.id),
  ]);
  if (!updated.meta.changes) return { ok: false, error: "already" };
  return { ok: true, id: row.id, at };
}

export function retractFail(error: RetractError): JsonOutcome {
  return { status: RETRACT_ERROR_STATUS[error], body: { ok: false, error, label: RETRACT_ERROR_LABELS[error] } };
}

/** POST /api/timeline/retract の中身。ログインと役を先に見る（入力の誤りより先に 401・403） */
export async function retractTimelineRequest(db: D1Database, p: Principal | null, raw: unknown, at: string): Promise<JsonOutcome> {
  if (!p) return retractFail("login_required");
  if (!retracterRole(p) || !roleAllows(p.role, "save")) return retractFail("forbidden");
  const input = parseRetract(raw);
  if (!input.ok) return retractFail(input.error);
  const r = await retractTimeline(db, p, input.value, at);
  if (!r.ok) return retractFail(r.error);
  return { status: 200, body: { ok: true, id: r.id, at: r.at } };
}
