// アンケートの送信の受け口（docs/tasks/T42.md、T65 で共有のリンクに）。ログインなしで呼べる API はこれだけ。
// route は要求から値を取り出して渡し、ここの結果を応答にするだけ（D1 と時刻を引数で受ける。テストは node:sqlite）。
//
// ボットの守り（上から順に見る）:
// 1. 同じ送信元（CF-Connecting-IP の鍵付きハッシュ）は 1 時間に 20 回まで。断った送信も数える → 429
// 2. Content-Type が application/json でなければ 415、本文が 8 KB を超えれば 413、JSON でなければ 400
// 3. token が無い → 404。受付終了（期限を過ぎた・30 件に届いた・T42 の 1 人 1 本のリンク）→ 410
// 4. 見えない欄（honeypot。人には見えず、ボットが埋める）に何か入っていれば、200 を返して何も残さない
// 5. 頁を開いてから 15 秒未満の送信は断る。開いた時刻は頁に埋めた署名つきの印（opened）で見る（印の無い・合わない物も）→ 400。
//    印は 2 時間で切れる（T81）→ 400 stale（頁を開き直す）
// 6. Turnstile の鍵があるときだけ、その確かめ → 400
// 7. 答えの形（知らない記号・長すぎる文・何も答えていない）→ 400
// 保存は 1 文で、受付中（期限の前・件数が上限の下）のときだけ入れる（同時に送られても 31 件目は入らない）。
// IP ごとの件数の上限は付けない（同じ職場の Wi-Fi で何人も答える）。同じ端末の 2 回目は頁の側の印（cookie と localStorage）で止める。

import type { D1Database } from "@cloudflare/workers-types";
import { utf8 } from "../auth/bytes.ts";
import { answerColumns, parseSurveyAnswers, RESPONSE_COLUMNS } from "./answer.ts";
import { BODY_MAX_BYTES, HONEYPOT_FIELD } from "./form.ts";
import { lookupSurveyShare } from "./store.ts";
import { SURVEY_LABELS } from "./text.ts";
import { checkStamp, RATE_LIMIT_PER_HOUR, sourceHash } from "./token.ts";
import type { TurnstileKeys, TurnstileVerify } from "./turnstile.ts";

export { HONEYPOT_FIELD };

export type SubmitError =
  | "limited"
  | "content_type"
  | "too_large"
  | "invalid"
  | "gone"
  | "closed"
  | "too_fast"
  | "stale"
  | "turnstile"
  | "empty";

const STATUS: Record<SubmitError, number> = {
  limited: 429,
  content_type: 415,
  too_large: 413,
  invalid: 400,
  gone: 404,
  closed: 410,
  too_fast: 400,
  stale: 400,
  turnstile: 400,
  empty: 400,
};

const LABEL: Record<SubmitError, string> = {
  limited: SURVEY_LABELS.limited,
  content_type: SURVEY_LABELS.failed,
  too_large: SURVEY_LABELS.failed,
  invalid: SURVEY_LABELS.failed,
  gone: SURVEY_LABELS.gone,
  closed: SURVEY_LABELS.closed,
  too_fast: SURVEY_LABELS.tooFast,
  stale: SURVEY_LABELS.stale,
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
  const found = await lookupSurveyShare(db, input.token, nowIso);
  if (found.kind === "missing") return fail("gone");
  if (found.kind === "closed") return fail("closed");
  const token = found.share.token;

  // 見えない欄に何か入っていれば、ボット。断ったと気づかせないよう 200 を返し、答えを残さない
  const trap = body[HONEYPOT_FIELD];
  if (trap !== undefined && trap !== null && trap !== "") return OK;

  const stamp = await checkStamp(body.opened, token, input.now, input.secret);
  if (!stamp.ok) return fail(stamp.error);

  if (input.turnstile) {
    const response = body.turnstile;
    if (typeof response !== "string" || response === "" || response.length > 2048) return fail("turnstile");
    if (!(await input.turnstile.verify(input.turnstile.keys.secretKey, response, input.ip))) return fail("turnstile");
  }

  const parsed = parseSurveyAnswers(body.answers);
  if (!parsed.ok) return fail(parsed.error);
  const c = answerColumns(parsed.value);

  // 受付中のときだけ入れる（期限の前で、件数が上限の下）。1 文なので、同時に送られても上限を超えない
  const cols = ["token", ...RESPONSE_COLUMNS, "source_hash", "submitted_at"];
  const values = [token, ...RESPONSE_COLUMNS.map((k) => c[k]), hash, nowIso];
  const marks = values.map((_, i) => `?${i + 1}`);
  const tokenMark = "?1";
  const nowMark = `?${values.length}`;
  try {
    const result = await db
      .prepare(
        `INSERT INTO survey_responses (${cols.join(", ")})
         SELECT ${marks.join(", ")}
          WHERE EXISTS (
            SELECT 1 FROM survey_shares s
             WHERE s.token = ${tokenMark} AND s.expires_at > ${nowMark}
               AND (SELECT count(*) FROM survey_responses r WHERE r.token = s.token) < s.max_answers)`,
      )
      .bind(...values)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) return fail("closed");
  } catch (e) {
    // D1 の失敗。答えの中身はログに出さない
    console.error("アンケートの答えを保存できない", e instanceof Error ? e.name : "unknown");
    return fail("invalid");
  }
  return OK;
}
