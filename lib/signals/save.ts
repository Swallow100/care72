// 本人・家族・支援者のスマホの信号と、本人の録音をサーバーで書く（docs/tasks/T10.md・T11.md）。
// D1 と R2 は引数で受け取る（テストで node:sqlite と偽の R2 を渡す）。
//
// 役の壁: 書けるのは役「本人のスマホ」と「家族のスマホ」だけ。ケアマネ・行政・医療班は save を持つが、ここでは断る（本人に成り代わらない）。
// - 本人は自分の信号しか書けない。本人の id と出どころ（self）はログインから決め、送られた物の中の id は読まない
// - 家族は自分の本人の信号しか書けない。本人の id と出どころはログインの連絡先の行から決める（家族→family、
//   支援者・民生委員→supporter。本人の電話・機関の連絡先は断る）。連絡先の行が本人のものでなければ見つからない
// - 録音は本人だけ（家族のスマホは録らない。本人の信号に家族が録音を添えないように）
//
// 信号は災害モードの間だけ受ける（平時は断る。通信が戻ったあとに平時へ戻っていた信号は端末が捨てる）。
// 色と順位はここで決めない。信号の表に入れれば、担当一覧・本人のページ・様式 9 がルールの表（lib/triage）で読み直す。
// 本人の報告を当てにしない印の人（案 4）も、ここでは区別しない。出どころを残せば、ルールの表が本人の緑だけを参考にする。
// 録音の分類（T12）はあとでサーバーが付けるので、classes・classified_by は空のまま。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows, type Need } from "../auth/roles.ts";
import type { AuthorRole, ContactKind, SignalSource } from "../db/types.ts";
import { loadDisasterState } from "../disaster/db.ts";
import { isDisaster } from "../disaster/state.ts";
import { bit, NO_ANSWERS, occurredAtOnServer, type AnySignalBody } from "./body.ts";
import { MEMO_TEXT_MAX, readMemo } from "./hearing.ts";
import {
  familyLogBody,
  isSignalWriterKind,
  memoEditLogBody,
  recordingLogBody,
  signalLogBody,
  type SignalWriterKind,
} from "./labels.ts";
import { legacyColumnsOf, type Answers, type HearingField } from "./questions.ts";

/** 書いた人。本人のスマホは本人、家族のスマホはログインの連絡先の行 */
export type SignalWriter = { kind: "self" } | { kind: "contact"; contactId: string };

/** 書く人。本人の id・事業所・経過の書き手（審査員は審査員のアカウント）・書いた人 */
export type SignalScope = { officeId: string; personId: string; authorId: string | null; writer: SignalWriter };

/**
 * 本人のスマホの役（信号は save、録音は recording）か、家族のスマホの役（信号だけ。連絡先の行が要る）のときだけ。
 * 家族の出どころ（家族・支援者）は連絡先の行を読んで決める（saveSignal）
 */
export function signalScope(p: Principal | null, need: Extract<Need, "save" | "recording"> = "save"): SignalScope | null {
  if (!p || !roleAllows(p.role, need) || !p.office || !p.personId) return null;
  const base = { officeId: p.office.id, personId: p.personId, authorId: p.accountId };
  if (p.role === "self") return { ...base, writer: { kind: "self" } };
  if (p.role === "family" && need === "save" && p.contactId) return { ...base, writer: { kind: "contact", contactId: p.contactId } };
  return null;
}

/** 経過の payload の出どころ。信号の行は phone、録音の行は recording */
export const SIGNAL_LOG_SOURCE = "phone";
export const RECORDING_LOG_SOURCE = "recording";

/** 信号の経過の payload。家族・支援者の信号は答えた連絡先の id も持つ（家族の画面で「あなた」と出すため。名前は持たない） */
export type SignalLogPayload = { source: typeof SIGNAL_LOG_SOURCE; contactId?: string };

export type SaveSignalResult =
  | { ok: true; id: string; duplicate: boolean; occurredAt: string }
  | { ok: false; error: "not_found" | "forbidden" | "invalid" | "normal" | "conflict" };

/** 連絡先の種類から出どころ（信号の表の source と経過の author_role は同じ言葉） */
export function sourceOfContact(kind: SignalWriterKind): Extract<SignalSource, "family" | "supporter"> {
  return kind === "family" ? "family" : "supporter";
}

type ResolvedWriter = {
  source: Extract<SignalSource, "self" | "family" | "supporter">;
  authorRole: Extract<AuthorRole, "self" | "family" | "supporter">;
  /** 家族・支援者の続柄と種類（経過の 1 行の「娘が」）。本人は null */
  who: { kind: SignalWriterKind; relation: string | null; contactId: string } | null;
};

/** 書いた人を D1 で確かめる。本人は事業所の本人か、家族は本人の連絡先の行か */
async function resolveWriter(db: D1Database, s: SignalScope): Promise<ResolvedWriter | "not_found" | "forbidden"> {
  if (s.writer.kind === "self") {
    const row = await db
      .prepare("SELECT id FROM people WHERE id = ?1 AND office_id = ?2")
      .bind(s.personId, s.officeId)
      .first<{ id: string }>();
    return row ? { source: "self", authorRole: "self", who: null } : "not_found";
  }
  const contactId = s.writer.contactId;
  const row = await db
    .prepare(
      `SELECT c.kind, c.relation FROM contacts c JOIN people p ON p.id = c.person_id
        WHERE c.id = ?1 AND c.person_id = ?2 AND p.office_id = ?3`,
    )
    .bind(contactId, s.personId, s.officeId)
    .first<{ kind: ContactKind; relation: string | null }>();
  if (!row) return "not_found";
  if (!isSignalWriterKind(row.kind)) return "forbidden";
  const source = sourceOfContact(row.kind);
  return { source, authorRole: source, who: { kind: row.kind, relation: row.relation, contactId } };
}

/**
 * 信号を 1 つ書き、経過に 1 行足す（1 つの batch）。同じ id の信号がもうあれば何も足さない（送り直し）。
 * 同じ id が別の人の信号なら競合。本人の形（緑・赤と答え）は本人だけ、家族の形（緑・赤・未知）は家族だけ
 */
export async function saveSignal(db: D1Database, s: SignalScope, body: AnySignalBody, now: string): Promise<SaveSignalResult> {
  const w = await resolveWriter(db, s);
  if (w === "not_found" || w === "forbidden") return { ok: false, error: w };
  const selfShape = "answers" in body;
  if (selfShape !== (w.who === null)) return { ok: false, error: "invalid" };
  if (!isDisaster(await loadDisasterState(db, s.officeId))) return { ok: false, error: "normal" };

  const occurredAt = occurredAtOnServer(body, now);
  const a = selfShape ? body.answers : NO_ANSWERS;
  const whereNow = selfShape ? body.whereNow : null;
  const logBody = selfShape ? signalLogBody(body) : familyLogBody(w.who!, body.color);
  const payload: SignalLogPayload = w.who ? { source: SIGNAL_LOG_SOURCE, contactId: w.who.contactId } : { source: SIGNAL_LOG_SOURCE };
  const [inserted, , owner] = await db.batch([
    db
      .prepare(
        `INSERT INTO signals (id, person_id, drill_id, color, source, where_now, injured, at_home, can_move, has_medicine, occurred_at)
         VALUES (?1, ?2, NULL, ?3, ?10, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(
        body.id,
        s.personId,
        body.color,
        whereNow,
        bit(a.injured),
        bit(a.atHome),
        bit(a.canMove),
        bit(a.hasMedicine),
        occurredAt,
        w.source,
      ),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         SELECT ?1, s.person_id, ?3, ?7, 'signal', ?4, ?5, s.id, s.occurred_at FROM signals s
          WHERE s.id = ?2 AND s.person_id = ?6 AND NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t.signal_id = s.id)`,
      )
      .bind(crypto.randomUUID(), body.id, s.authorId, logBody, JSON.stringify(payload), s.personId, w.authorRole),
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
  // 録音は本人だけ（家族のスマホは録らない）。添えるのも本人が送った信号だけ
  if (s.writer.kind !== "self") return { ok: false, error: "not_found" };
  const transcript = input.transcript?.trim() || null;
  if (!input.audio && !transcript) return { ok: false, error: "invalid" };
  const type = input.audio ? audioTypeOf(input.audio.type) : null;
  if (input.audio && !type) return { ok: false, error: "invalid" };

  const row = await db
    .prepare(
      `SELECT s.id, s.occurred_at, s.recording_key, s.transcript FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND s.person_id = ?2 AND p.office_id = ?3 AND s.drill_id IS NULL AND s.source = 'self'`,
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

// ---------- 赤のあとの聞き取りの答え（T49） ----------

/** 経過の payload の出どころ（ケアマネが聞き取りの欄を直した） */
export const MEMO_EDIT_LOG_SOURCE = "memo_edit";

export type SaveAnswersResult = { ok: true; changed: boolean } | { ok: false; error: "not_found" | "forbidden" | "invalid" | "normal" };

/**
 * 赤の信号に聞き取りの答えを書く（押すたびに、それまでの答えの全部を送る。後勝ち）。answers の JSON と、今の 4 問の列に同じ値
 * （legacyColumnsOf。ルールの表と採点が読むのは 4 つの列だけ）。本人の信号は経過の 1 行（「無事じゃない けが あり・…」）も書き直す。
 * 書けるのは信号を送った人だけ: 本人は本人の信号、家族・支援者は自分が答えた信号（経過の payload の contactId）
 */
export async function saveAnswers(
  db: D1Database,
  s: SignalScope,
  signalId: string,
  answers: Answers,
): Promise<SaveAnswersResult> {
  const w = await resolveWriter(db, s);
  if (w === "not_found" || w === "forbidden") return { ok: false, error: w };
  if (!isDisaster(await loadDisasterState(db, s.officeId))) return { ok: false, error: "normal" };
  const row = await db
    .prepare(
      `SELECT s.id, s.color, s.source, s.answers,
              (SELECT json_extract(t.payload, '$.contactId') FROM timeline_entries t
                WHERE t.signal_id = s.id AND t.payload IS NOT NULL AND json_extract(t.payload, '$.source') = ?4 LIMIT 1) AS contact_id
         FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND s.person_id = ?2 AND p.office_id = ?3 AND s.drill_id IS NULL`,
    )
    .bind(signalId, s.personId, s.officeId, SIGNAL_LOG_SOURCE)
    .first<{ id: string; color: string; source: string; answers: string | null; contact_id: string | null }>();
  if (!row || row.source !== w.source) return { ok: false, error: "not_found" };
  if (w.who && row.contact_id !== w.who.contactId) return { ok: false, error: "not_found" };
  if (row.color !== "red") return { ok: false, error: "invalid" };

  const json = JSON.stringify(answers);
  if (row.answers === json) return { ok: true, changed: false };
  const legacy = legacyColumnsOf(answers);
  const stmts = [
    db
      .prepare(
        `UPDATE signals SET answers = ?3, injured = ?4, at_home = ?5, can_move = ?6, has_medicine = ?7
          WHERE id = ?1 AND person_id = ?2`,
      )
      .bind(row.id, s.personId, json, bit(legacy.injured), bit(legacy.atHome), bit(legacy.canMove), bit(legacy.hasMedicine)),
  ];
  if (!w.who) {
    stmts.push(
      db
        .prepare(
          `UPDATE timeline_entries SET body = ?3
            WHERE signal_id = ?1 AND person_id = ?2 AND payload IS NOT NULL AND json_extract(payload, '$.source') = ?4`,
        )
        .bind(row.id, s.personId, signalLogBody({ color: "red", whereNow: null, answers: legacy }), SIGNAL_LOG_SOURCE),
    );
  }
  await db.batch(stmts);
  return { ok: true, changed: true };
}

/** 直す人（ケアマネの役だけ。事業所の壁を通したあと） */
export type MemoEditor = { officeId: string; accountId: string | null };

export type MemoEditResult = { ok: true; changed: boolean; memo: string } | { ok: false; error: "not_found" | "invalid" };

/**
 * ケアマネが聞き取りの欄を 1 つ直す（空にするのも直し）。memo に欄を書き、経過に「聞き取り修正 体の訴え「…」」。
 * Claude の写し（ai_memo）と押した答え（answers）は残す。色と順は変わらない（どれもルールの表に渡さない）
 */
export async function saveMemoEdit(
  db: D1Database,
  editor: MemoEditor,
  signalId: string,
  field: HearingField,
  text: string | null,
  now: string,
): Promise<MemoEditResult> {
  const value = text === null ? null : Array.from(text.trim()).slice(0, MEMO_TEXT_MAX).join("") || null;
  const row = await db
    .prepare(
      `SELECT s.id, s.person_id, s.memo FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND p.office_id = ?2 AND s.drill_id IS NULL`,
    )
    .bind(signalId, editor.officeId)
    .first<{ id: string; person_id: string; memo: string | null }>();
  if (!row) return { ok: false, error: "not_found" };
  const memo = readMemo(row.memo);
  if (field in memo && memo[field] === value) return { ok: true, changed: false, memo: JSON.stringify(memo) };
  const next = { ...memo, [field]: value };
  const json = JSON.stringify(next);
  await db.batch([
    db.prepare(`UPDATE signals SET memo = ?2 WHERE id = ?1`).bind(row.id, json),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         VALUES (?1, ?2, ?3, 'care_manager', 'note', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        crypto.randomUUID(),
        row.person_id,
        editor.accountId,
        memoEditLogBody(field, value),
        JSON.stringify({ source: MEMO_EDIT_LOG_SOURCE, field }),
        row.id,
        now,
      ),
  ]);
  return { ok: true, changed: true, memo: json };
}
