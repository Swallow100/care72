// 担当一覧の行の詳細の API（app/api/caseload/override・app/api/caseload/call）の中身。route は同じ所からの POST かを見て、
// ここの応答を返すだけ。D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
// 断り方: ログインしていなければ 401、ケアマネの役でなければ 403、形が違う 400、範囲の外の本人・連絡先 404、
// 平時の上書き 409、今と同じ色への上書き 409。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { isColor } from "../disaster/override.ts";
import { isCallResult, saveCall } from "./calls.ts";
import { saveOverride } from "./override.ts";

export type ListApiError = "login_required" | "forbidden" | "invalid" | "not_found" | "normal" | "same";

const STATUS: Record<ListApiError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  normal: 409,
  same: 409,
};

/** 応答の言葉（画面の短い漢語。行の詳細に出す） */
export const LIST_API_LABELS: Record<ListApiError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  invalid: "入力不正",
  not_found: "対象なし",
  normal: "平時",
  same: "変更なし",
};

const NO_STORE = { "Cache-Control": "no-store" };

export function listError(error: ListApiError): Response {
  return Response.json({ ok: false, error, label: LIST_API_LABELS[error] }, { status: STATUS[error], headers: NO_STORE });
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** 上書きの POST（JSON）。{ person, to: 色 か null（解除）, reason } */
export async function overridePost(db: D1Database, p: Principal | null, json: unknown, now: string): Promise<Response> {
  if (!p) return listError("login_required");
  if (p.role !== "care_manager") return listError("forbidden");
  const b = obj(json);
  if (!b || !isId(b.person) || !(b.to === null || isColor(b.to)) || typeof b.reason !== "string") return listError("invalid");
  const r = await saveOverride(db, p, { personId: b.person, to: b.to, reason: b.reason }, now);
  if (!r.ok) return listError(r.error);
  return Response.json({ ok: true, from: r.from, to: r.to }, { headers: NO_STORE });
}

/** 電話の記録の POST（JSON）。{ person, contact, result: dialed か no_answer } */
export async function callPost(db: D1Database, p: Principal | null, json: unknown, now: string): Promise<Response> {
  if (!p) return listError("login_required");
  if (p.role !== "care_manager") return listError("forbidden");
  const b = obj(json);
  if (!b || !isId(b.person) || !isId(b.contact) || !isCallResult(b.result)) return listError("invalid");
  const r = await saveCall(db, p, { personId: b.person, contactId: b.contact, result: b.result }, now);
  if (!r.ok) return listError(r.error);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
