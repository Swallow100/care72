// 訓練の採点（T22）の API の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。D1・Principal・env を引数で受け取る。
// 断り方は lib/drill/http.ts と同じ（drillError）: 未ログイン 401、ケアマネの役でない 403、形が違う 400、事業所の外・無い訓練 404、
// 進行中の訓練の講評 409（running）。
// - 着信の応答・拒否: POST /api/drill/<id>/call { signal, response: answer・decline }
// - 講評: POST /api/drill/<id>/review {}（作る。Opus 1 回）か { edit: { summary, findings: [{ text }] } }（ケアマネが直す）

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { hasAnthropicKey, type AiEnv, type ClaudeClient } from "../claude/client.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { drillScope } from "./db.ts";
import { drillError, isDrillId } from "./http.ts";
import { loadPersonaSources } from "./persona.ts";
import {
  claimReview,
  editReview,
  loadDrillRecord,
  parseStoredScore,
  reviewContextOf,
  settleReview,
  shownReview,
  type StoredReview,
} from "./record.ts";
import { isCallResponse, respondCall } from "./responses.ts";
import { createReview, FINDING_TEXT_MAX, SUMMARY_MAX, type ReviewBody, type ReviewError } from "./review.ts";
import { REVIEW_ERROR_LABELS } from "./score-labels.ts";

const NO_STORE = { "Cache-Control": "no-store" };

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** 安否の signals の id（`<訓練>-<刻み>-s<n>`） */
const SIGNAL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** 着信の応答・拒否の POST。もう残っていれば recorded false（先の物のまま） */
export async function callPost(db: D1Database, p: Principal | null, id: string, json: unknown): Promise<Response> {
  if (!p) return drillError("login_required");
  const scope = drillScope(p);
  if (!scope) return drillError("forbidden");
  const b = obj(json);
  if (!isDrillId(id) || !b || typeof b.signal !== "string" || !SIGNAL_ID.test(b.signal) || !isCallResponse(b.response)) {
    return drillError("invalid");
  }
  const r = await respondCall(db, scope, id, b.signal, b.response);
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true, recorded: r.recorded }, { headers: NO_STORE });
}

/** 講評の API が呼ぶ物（テストで偽の client と時刻を渡す） */
export type ReviewApiEnv = AiEnv & { DB: D1Database };
export type ReviewApiOpts = { claude?: ClaudeClient; now?: () => Date };

function reviewError(error: ReviewError, status: number): Response {
  return Response.json({ ok: false, error, label: REVIEW_ERROR_LABELS[error] }, { status, headers: NO_STORE });
}

function reviewJson(review: StoredReview | null): Response {
  return Response.json({ ok: true, review, shown: shownReview(review) }, { headers: NO_STORE });
}

/** ケアマネが直した講評の形を読む。指摘は元の並びのまま文だけ（空にした指摘は外す）。形が違えば null */
export function parseEdit(v: unknown, base: ReviewBody): ReviewBody | null {
  const e = obj(v);
  if (!e || typeof e.summary !== "string" || !Array.isArray(e.findings) || e.findings.length !== base.findings.length) return null;
  const clip = (s: string, max: number) => Array.from(s.replace(/\r\n?/g, "\n").trim()).slice(0, max).join("");
  const findings: ReviewBody["findings"] = [];
  for (let i = 0; i < base.findings.length; i++) {
    const f = obj(e.findings[i]);
    if (!f || typeof f.text !== "string") return null;
    const text = clip(f.text, FINDING_TEXT_MAX * 2);
    if (text) findings.push({ ...base.findings[i], text });
  }
  return { summary: clip(e.summary, SUMMARY_MAX * 2), findings };
}

/**
 * 講評の POST。edit があればケアマネが直した物を残す。無ければ作る: できていればそれを返し、鍵が無ければ 503（未設定。画面は数字だけ）、
 * 作成中を取れなければ今の物を返す（ほかの画面が作っている）。取れたら Opus に 1 回、できた物か失敗を残して返す
 */
export async function reviewPost(
  env: ReviewApiEnv,
  p: Principal | null,
  id: string,
  json: unknown,
  opts: ReviewApiOpts = {},
): Promise<Response> {
  if (!p) return drillError("login_required");
  const scope = drillScope(p);
  if (!scope || !p.office) return drillError("forbidden");
  const b = obj(json) ?? {};
  if (!isDrillId(id)) return drillError("invalid");
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const db = env.DB;
  const rec = await loadDrillRecord(db, scope, id, now());
  if (rec === null) return drillError("not_found");
  if (rec === "running") return drillError("running");

  if (b.edit !== undefined) {
    const base = shownReview(rec.review);
    if (!base) return drillError("conflict");
    const body = parseEdit(b.edit, base);
    if (!body) return drillError("invalid");
    const ok = await editReview(db, scope.officeId, id, { ...body, by: p.displayName ?? null, at: now() });
    if (!ok) return drillError("conflict");
    const after = await db.prepare("SELECT score FROM drills WHERE id = ?1 AND office_id = ?2").bind(id, scope.officeId).first<{ score: string | null }>();
    return reviewJson(parseStoredScore(after?.score ?? null)?.review ?? null);
  }

  if (rec.review?.state === "done") return reviewJson(rec.review);
  if (!hasAnthropicKey(env)) return reviewError("not_configured", 503);
  const claimedAt = now();
  if (!(await claimReview(db, scope.officeId, id, claimedAt))) {
    // ほかの画面が作っている（か、今できた）。今の物を返す
    const cur = await db.prepare("SELECT score FROM drills WHERE id = ?1 AND office_id = ?2").bind(id, scope.officeId).first<{ score: string | null }>();
    return reviewJson(parseStoredScore(cur?.score ?? null)?.review ?? { state: "pending", at: claimedAt });
  }
  const ai: AskJsonContext = {
    env,
    usage: d1UsageStore(db),
    office: { id: p.office.id, kind: p.office.kind },
    ...(opts.claude ? { claude: opts.claude } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
  const out = await createReview(
    { sources: await loadPersonaSources(db, scope.officeId), ai, on: claimedAt.slice(0, 10) },
    reviewContextOf(rec),
  );
  const review: Extract<StoredReview, { state: "done" | "failed" }> = out.ok
    ? { state: "done", ai: { ...out.body, model: out.model, at: now() }, edited: null }
    : { state: "failed", error: out.error, at: now() };
  await settleReview(db, scope.officeId, id, claimedAt, review);
  if (!out.ok) return reviewError(out.error, out.error === "limit" ? 429 : 502);
  return reviewJson(review);
}
