// 本人・家族のスマホの API（app/api/signals・app/api/recordings）の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1・R2・Principal を引数で受け取る（テストで node:sqlite と偽の R2 を渡す）。
//
// 断り方: ログインしていなければ 401、本人・家族のスマホの役でなければ 403（ケアマネ・医療班も 403。録音は本人だけで、家族も 403）。
// 連絡先の行が本人の電話・機関の物 403、形が違う 400、本人・連絡先の行が見つからない・信号が自分の物でない 404、
// 平時・id の重なり 409、録音が大きすぎる 413。
// 端末は 400・403・404・409・413 を「送り直しても通らない」として捨て、ほか（通信・5xx・401・429）は残して送り直す。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { FamilySignalBodySchema, SignalBodySchema, UUID } from "./body.ts";
import {
  attachRecording,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_SEC,
  MAX_TRANSCRIPT_LENGTH,
  saveSignal,
  signalScope,
  type RecordingBucket,
  type RecordingInput,
} from "./save.ts";

export type SignalApiError = "login_required" | "forbidden" | "invalid" | "not_found" | "normal" | "conflict" | "too_large";

const STATUS: Record<SignalApiError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  normal: 409,
  conflict: 409,
  too_large: 413,
};

/** 応答の言葉（ケアマネの画面の言葉。本人の画面には出さない） */
export const SIGNAL_API_LABELS: Record<SignalApiError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  invalid: "入力不正",
  not_found: "対象なし",
  normal: "平時",
  conflict: "競合",
  too_large: "容量超過",
};

const NO_STORE = { "Cache-Control": "no-store" };

export function signalError(error: SignalApiError): Response {
  return Response.json({ ok: false, error, label: SIGNAL_API_LABELS[error] }, { status: STATUS[error], headers: NO_STORE });
}

function refuse(p: Principal | null): Response {
  return signalError(p === null ? "login_required" : "forbidden");
}

/**
 * 信号の POST（JSON）。本人のスマホは本人の形（緑・赤と答え）、家族のスマホは家族の形（緑・赤・未知）。
 * どちらの形かはログインの役で決める（送った物の中の欄では決めない）
 */
export async function signalPost(db: D1Database, p: Principal | null, json: unknown, now: string): Promise<Response> {
  const scope = signalScope(p, "save");
  if (!scope) return refuse(p);
  const body = scope.writer.kind === "self" ? SignalBodySchema.safeParse(json) : FamilySignalBodySchema.safeParse(json);
  if (!body.success) return signalError("invalid");
  const r = await saveSignal(db, scope, body.data, now);
  if (!r.ok) return signalError(r.error);
  return Response.json({ ok: true, id: r.id, duplicate: r.duplicate }, { headers: NO_STORE });
}

/** フォームの値（FormData の get の形） */
export type FormLike = { get(name: string): FormDataEntryValue | null };

const text = (v: FormDataEntryValue | null): string | null => (typeof v === "string" ? v : null);

function isBlob(v: unknown): v is Blob {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && typeof (v as Blob).size === "number";
}

function parseIso(v: FormDataEntryValue | null): string | null {
  const s = text(v);
  return s && s.length <= 40 && !Number.isNaN(Date.parse(s)) ? s : null;
}

/** 録音を信号に添えたあと（初めて添えたときだけ）。分類（T12）をここから走らせる */
export type AttachedRecording = { officeId: string; personId: string; signalId: string; durationSec: number | null };
export type RecordingHooks = { afterAttach?: (a: AttachedRecording) => void };

/**
 * 録音の POST（multipart）。欄は signal（信号の id）・audio（音声のファイル、無くてもよい）・transcript（文字起こし）・
 * durationSec・recordedAt・sentAt。音声も文字起こしも無ければ 400。
 * 初めて添えたときだけ hooks.afterAttach を呼ぶ（送り直し・重なりでは呼ばない）。応答は待たせない（呼ぶ側が waitUntil で走らせる）
 */
export async function recordingPost(
  db: D1Database,
  bucket: RecordingBucket,
  p: Principal | null,
  form: FormLike | null,
  now: string,
  hooks: RecordingHooks = {},
): Promise<Response> {
  const scope = signalScope(p, "recording");
  if (!scope) return refuse(p);
  if (!form) return signalError("invalid");

  const signalId = text(form.get("signal"));
  const recordedAt = parseIso(form.get("recordedAt"));
  const sentAt = parseIso(form.get("sentAt"));
  const transcript = text(form.get("transcript"));
  const durationRaw = text(form.get("durationSec"));
  const duration = durationRaw === null || durationRaw === "" ? null : Number(durationRaw);
  if (!signalId || !UUID.test(signalId) || !recordedAt || !sentAt) return signalError("invalid");
  if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > MAX_RECORDING_SEC)) {
    return signalError("invalid");
  }
  if (transcript !== null && transcript.length > MAX_TRANSCRIPT_LENGTH) return signalError("invalid");

  const file = form.get("audio");
  let audio: RecordingInput["audio"] = null;
  if (file !== null) {
    if (!isBlob(file)) return signalError("invalid");
    if (file.size > MAX_RECORDING_BYTES) return signalError("too_large");
    if (file.size > 0) audio = { bytes: await file.arrayBuffer(), type: file.type };
  }

  const r = await attachRecording(db, bucket, scope, { signalId, audio, transcript, durationSec: duration, recordedAt, sentAt }, now);
  if (!r.ok) return signalError(r.error);
  if (!r.duplicate) {
    hooks.afterAttach?.({ officeId: scope.officeId, personId: scope.personId, signalId, durationSec: duration });
  }
  return Response.json({ ok: true, duplicate: r.duplicate, recorded: r.key !== null }, { headers: NO_STORE });
}
