// アンケートの送信の受け口（docs/tasks/T42.md）。ログインなしで呼べる API はこれだけ。
// route は要求から値を取り出して渡し、ここの結果を応答にするだけ（D1 と時刻を引数で受ける。テストは node:sqlite）。
//
// ボットの守り（上から順に見る）:
// 1. 同じ送信元（CF-Connecting-IP の鍵付きハッシュ）は 1 時間に 20 回まで。断った送信も数える → 429
// 2. Content-Type が application/json でなければ 415、本文が 8 KB を超えれば 413、JSON でなければ 400
// 3. token が無い・使用済み・期限切れ → 404
// 4. 見えない欄（honeypot。人には見えず、ボットが埋める）に何か入っていれば、200 を返して何も残さない
// 5. 頁を開いてから 15 秒未満の送信は断る（頁を開かずに送った物も）→ 400
// 6. Turnstile の鍵があるときだけ、その確かめ → 400
// 7. 答えの形（知らない記号・長すぎる文・何も答えていない）→ 400
// 保存は 1 つの取引で、答えを入れてから token を使用済みにする（同じ token の 2 度目は入らない）。

import type { D1Database } from "@cloudflare/workers-types";
import { utf8 } from "../auth/bytes.ts";
import { answerColumns, parseSurveyAnswers } from "./answer.ts";
import { BODY_MAX_BYTES, HONEYPOT_FIELD } from "./form.ts";
import { liveSurveyLink } from "./store.ts";
import { SURVEY_LABELS } from "./text.ts";
import { MIN_FILL_SEC, RATE_LIMIT_PER_HOUR, sourceHash } from "./token.ts";
import type { TurnstileKeys, TurnstileVerify } from "./turnstile.ts";

export { HONEYPOT_FIELD };

export type SubmitError = "limited" | "content_type" | "too_large" | "invalid" | "gone" | "too_fast" | "turnstile" | "empty";

const STATUS: Record<SubmitError, number> = {
  limited: 429,
  content_type: 415,
  too_large: 413,
  invalid: 400,
  gone: 404,
  too_fast: 400,
  turnstile: 400,
  empty: 400,
};

const LABEL: Record<SubmitError, string> = {
  limited: SURVEY_LABELS.limited,
  content_type: SURVEY_LABELS.failed,
  too_large: SURVEY_LABELS.failed,
  invalid: SURVEY_LABELS.failed,
  gone: SURVEY_LABELS.gone,
  too_fast: SURVEY_LABELS.tooFast,
  turnstile: SURVEY_LABELS.turnstile,
  empty: SURVEY_LABELS.empty,
};

export type SubmitOutcome = { status: number; body: { ok: boolean; error?: SubmitError; label?: string } };

function fail(error: SubmitError): SubmitOutcome {
  return { status: STATUS[error], body: { ok: false, error, label: LABEL[error] } };
}

const OK: SubmitOutcome = { status: 200, body: { ok: true } };

export type SubmitInput = {
  token: unknown;
  contentType: string | null;
  body: string;
  ip: string;
  now: Date;
  /** 送信元のハッシュの鍵（SESSION_SECRET） */
  secret: string;
  /** Turnstile の鍵が両方あるときだけ */
  turnstile: { keys: TurnstileKeys; verify: TurnstileVerify } | null;
};

const HOUR_MS = 60 * 60 * 1000;

/** 送信元の回数を数え、上限の内なら 1 回足す。1 時間より古い数えは消す */
async function countAttempt(db: D1Database, hash: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  await db.prepare("DELETE FROM survey_attempts WHERE at <= ?1").bind(since).run();
  const n = await db
    .prepare("SELECT count(*) AS n FROM survey_attempts WHERE source_hash = ?1 AND at > ?2")
    .bind(hash, since)
    .first<number>("n");
  if ((n ?? 0) >= RATE_LIMIT_PER_HOUR) return false;
  await db.prepare("INSERT INTO survey_attempts (source_hash, at) VALUES (?1, ?2)").bind(hash, nowIso).run();
  return true;
}

export async function submitSurvey(db: D1Database, input: SubmitInput): Promise<SubmitOutcome> {
  const hash = await sourceHash(input.ip, input.secret);
  if (!(await countAttempt(db, hash, input.now))) return fail("limited");

  if (!/^application\/json\s*(;|$)/i.test(input.contentType ?? "")) return fail("content_type");
  if (utf8(input.body).length > BODY_MAX_BYTES) return fail("too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(input.body);
  } catch {
    return fail("invalid");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("invalid");
  const body = raw as Record<string, unknown>;

  const nowIso = input.now.toISOString();
  const link = await liveSurveyLink(db, input.token, nowIso);
  if (!link) return fail("gone");

  // 見えない欄に何か入っていれば、ボット。断ったと気づかせないよう 200 を返し、答えも token の状態も残さない
  const trap = body[HONEYPOT_FIELD];
  if (trap !== undefined && trap !== null && trap !== "") return OK;

  if (link.opened_at === null || input.now.getTime() - Date.parse(link.opened_at) < MIN_FILL_SEC * 1000) return fail("too_fast");

  if (input.turnstile) {
    const response = body.turnstile;
    if (typeof response !== "string" || response === "" || response.length > 2048) return fail("turnstile");
    if (!(await input.turnstile.verify(input.turnstile.keys.secretKey, response, input.ip))) return fail("turnstile");
  }

  const parsed = parseSurveyAnswers(body.answers);
  if (!parsed.ok) return fail(parsed.error);
  const c = answerColumns(parsed.value);

  // 答えを入れるのは、token がまだ使えるときだけ。入れたら使用済みに（1 つの取引。2 度目は答えの token の重なりでも止まる）
  try {
    const [inserted] = await db.batch([
      db
        .prepare(
          `INSERT INTO survey_answers (token, role, experience, q1, q2, q3, q4, q5, q6, q7, q7_reason, quote, source_hash, submitted_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
            WHERE EXISTS (SELECT 1 FROM survey_links WHERE token = ?1 AND used_at IS NULL AND expires_at > ?14)`,
        )
        .bind(link.token, c.role, c.experience, c.q1, c.q2, c.q3, c.q4, c.q5, c.q6, c.q7, c.q7_reason, c.quote, hash, nowIso),
      db
        .prepare(
          `UPDATE survey_links SET used_at = ?2
            WHERE token = ?1 AND used_at IS NULL AND EXISTS (SELECT 1 FROM survey_answers WHERE token = ?1)`,
        )
        .bind(link.token, nowIso),
    ]);
    if ((inserted?.meta?.changes ?? 0) !== 1) return fail("gone");
  } catch (e) {
    // 同じ token の答えが先に入った（重なり）か、D1 の失敗。答えの中身はログに出さない
    console.error("アンケートの答えを保存できない", e instanceof Error ? e.name : "unknown");
    return fail("gone");
  }
  return OK;
}
