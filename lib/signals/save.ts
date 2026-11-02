// 本人のスマホの信号と録音をサーバーで書く（docs/tasks/T10.md）。D1 と R2 は引数で受け取る（テストで node:sqlite と偽の R2 を渡す）。
//
// 役の壁: 書けるのは役「本人のスマホ」だけで、本人は自分の信号しか書けない。本人の id と出どころ（self）はログインから決め、
// 送られた物の中の id は読まない。ケアマネ・行政・医療班は save を持つが、ここでは断る（本人に成り代わらない）。
// 家族のスマホ（T11）はここに足す。
//
// 信号は災害モードの間だけ受ける（平時は断る。通信が戻ったあとに平時へ戻っていた信号は端末が捨てる）。
// 色と順位はここで決めない。信号の表に入れれば、担当一覧・本人のページ・様式 9 がルールの表（lib/triage）で読み直す。
// 録音の分類（T12）はあとでサーバーが付けるので、classes・classified_by は空のまま。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows, type Need } from "../auth/roles.ts";
import { loadDisasterState } from "../disaster/db.ts";
import { isDisaster } from "../disaster/state.ts";
import { bit, occurredAtOnServer, type SignalBody } from "./body.ts";
import { recordingLogBody, signalLogBody } from "./labels.ts";

/** 書く人。本人の id・事業所・経過の書き手（審査員は審査員のアカウント） */
export type SignalScope = { officeId: string; personId: string; authorId: string | null };

/** 本人のスマホの役で、need（信号は save、録音は recording）を持つときだけ */
export function signalScope(p: Principal | null, need: Extract<Need, "save" | "recording"> = "save"): SignalScope | null {
  if (!p || p.role !== "self" || !roleAllows(p.role, need) || !p.office || !p.personId) return null;
  return { officeId: p.office.id, personId: p.personId, authorId: p.accountId };
}

/** 経過の payload の出どころ。信号の行は phone、録音の行は recording */
export const SIGNAL_LOG_SOURCE = "phone";
export const RECORDING_LOG_SOURCE = "recording";

export type SaveSignalResult =
  | { ok: true; id: string; duplicate: boolean; occurredAt: string }
  | { ok: false; error: "not_found" | "normal" | "conflict" };

async function ownPerson(db: D1Database, s: SignalScope): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM people WHERE id = ?1 AND office_id = ?2")
    .bind(s.personId, s.officeId)
    .first<{ id: string }>();
  return row !== null;
}

/**
 * 信号を 1 つ書き、経過に 1 行足す（1 つの batch）。同じ id の信号がもうあれば何も足さない（送り直し）。
 * 同じ id が別の人の信号なら競合
 */
export async function saveSignal(db: D1Database, s: SignalScope, body: SignalBody, now: string): Promise<SaveSignalResult> {
  if (!(await ownPerson(db, s))) return { ok: false, error: "not_found" };
  if (!isDisaster(await loadDisasterState(db, s.officeId))) return { ok: false, error: "normal" };

  const occurredAt = occurredAtOnServer(body, now);
  const a = body.answers;
  const [inserted, , owner] = await db.batch([
    db
      .prepare(
        `INSERT INTO signals (id, person_id, drill_id, color, source, where_now, injured, at_home, can_move, has_medicine, occurred_at)
         VALUES (?1, ?2, NULL, ?3, 'self', ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(
        body.id,
        s.personId,
        body.color,
        body.whereNow,
        bit(a.injured),
        bit(a.atHome),
        bit(a.canMove),
        bit(a.hasMedicine),
        occurredAt,
      ),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         SELECT ?1, s.person_id, ?3, 'self', 'signal', ?4, ?5, s.id, s.occurred_at FROM signals s
          WHERE s.id = ?2 AND s.person_id = ?6 AND NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t.signal_id = s.id)`,
      )
      .bind(
        crypto.randomUUID(),
        body.id,
        s.authorId,
        signalLogBody(body),
        JSON.stringify({ source: SIGNAL_LOG_SOURCE }),
        s.personId,
      ),
    db.prepare("SELECT person_id, occurred_at FROM signals WHERE id = ?1").bind(body.id),
  ]);
  const row = (owner.results as Array<{ person_id: string; occurred_at: string }>)[0];
  if (!row || row.person_id !== s.personId) return { ok: false, error: "conflict" };
  return { ok: true, id: body.id, duplicate: (inserted.meta.changes ?? 0) === 0, occurredAt: row.occurred_at };
}

// ---------- 録音 ----------

/** 録音の上限（字・秒・大きさ） */
export const MAX_TRANSCRIPT_LENGTH = 2000;
export const MAX_RECORDING_SEC = 600;
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;

/** 受ける音声の形と拡張子。Chrome・Edge は webm、Safari は mp4（m4a）、Firefox は ogg のことがある */
const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

/** 音声の形（codecs などを落とした物）と拡張子。受けない形なら null */
export function audioTypeOf(type: string): { contentType: string; ext: string } | null {
  const t = type.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = AUDIO_TYPES[t];
  return ext ? { contentType: t, ext } : null;
}

/** 時刻を鍵の名前に（2026-11-04T01:23:45.678Z → 20261104T012345678Z） */
export function keyTime(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().replace(/[-:.]/g, "");
}

/** R2 の鍵 recordings/<事業所>/<本人>/<時刻>.webm。時刻は信号の時刻（送り直しても同じ鍵） */
export function recordingKey(officeId: string, personId: string, occurredAt: string, ext = "webm"): string {
  return `recordings/${officeId}/${personId}/${keyTime(occurredAt)}.${ext}`;
}

export type RecordingInput = {
  signalId: string;
  audio: { bytes: ArrayBuffer | Uint8Array; type: string } | null;
  transcript: string | null;
  durationSec: number | null;
  /** 録り終えた時刻と送った時刻（端末の時計）。経過の時刻は信号と同じく差だけを使う */
  recordedAt: string;
  sentAt: string;
};

/** R2 のうち録音で使う所（配信は env.RECORDINGS、テストは偽物） */
export type RecordingBucket = {
  put(key: string, value: ArrayBuffer | Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
};

export type AttachResult =
  | { ok: true; key: string | null; duplicate: boolean }
  | { ok: false; error: "not_found" | "invalid" };

/**
 * 信号に録音と文字起こしを添える。録音は R2 に置き、信号の行に鍵と文字起こしを書き、経過に「録音」の 1 行。
 * 1 つの信号に 1 回だけ（もう添えてあれば何もしない）。分類（T12）はここでしない
 */
export async function attachRecording(
  db: D1Database,
  bucket: RecordingBucket,
  s: SignalScope,
  input: RecordingInput,
  now: string,
): Promise<AttachResult> {
  const transcript = input.transcript?.trim() || null;
  if (!input.audio && !transcript) return { ok: false, error: "invalid" };
  const type = input.audio ? audioTypeOf(input.audio.type) : null;
  if (input.audio && !type) return { ok: false, error: "invalid" };

  const row = await db
    .prepare(
      `SELECT s.id, s.occurred_at, s.recording_key, s.transcript FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND s.person_id = ?2 AND p.office_id = ?3 AND s.drill_id IS NULL`,
    )
    .bind(input.signalId, s.personId, s.officeId)
    .first<{ id: string; occurred_at: string; recording_key: string | null; transcript: string | null }>();
  if (!row) return { ok: false, error: "not_found" };
  if (row.recording_key !== null || row.transcript !== null) return { ok: true, key: row.recording_key, duplicate: true };

  let key: string | null = null;
  if (input.audio && type) {
    key = recordingKey(s.officeId, s.personId, row.occurred_at, type.ext);
    await bucket.put(key, input.audio.bytes, { httpMetadata: { contentType: type.contentType } });
  }
  const at = occurredAtOnServer({ occurredAt: input.recordedAt, sentAt: input.sentAt }, now);
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE signals SET recording_key = ?3, transcript = ?4
          WHERE id = ?1 AND person_id = ?2 AND recording_key IS NULL AND transcript IS NULL`,
      )
      .bind(row.id, s.personId, key, transcript),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         SELECT ?1, s.person_id, ?3, 'self', 'signal', ?4, ?5, s.id, ?6 FROM signals s
          WHERE s.id = ?2 AND s.person_id = ?7 AND NOT EXISTS (
            SELECT 1 FROM timeline_entries t
             WHERE t.signal_id = s.id AND t.payload IS NOT NULL AND json_extract(t.payload, '$.source') = ?8)`,
      )
      .bind(
        crypto.randomUUID(),
        row.id,
        s.authorId,
        recordingLogBody({ hasAudio: key !== null, durationSec: input.durationSec, transcript }),
        JSON.stringify({ source: RECORDING_LOG_SOURCE, durationSec: input.durationSec }),
        at,
        s.personId,
        RECORDING_LOG_SOURCE,
      ),
  ]);
  return { ok: true, key, duplicate: (updated.meta.changes ?? 0) === 0 };
}
