// 訓練の採点（T22）の API の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。D1・Principal・env を引数で受け取る。
// 断り方は lib/drill/http.ts と同じ（drillError）: 未ログイン 401、ケアマネの役でない 403、形が違う 400、事業所の外・無い訓練 404、
// 進行中の訓練の講評 409（running）。
// - 着信の応答・拒否: POST /api/drill/<id>/call { signal, response: answer・decline }
// - 講評: POST /api/drill/<id>/review {}（作る。Opus 1 回と、まだ無い人ごとの講評を並べて）か { edit: { summary, findings: [{ text }] } }（ケアマネが直す）
// - 人ごとの講評（T185）: 刻みの応答のあと（app/api/drill/[id]/step の waitUntil）に personReviewsAfterStep。進める操作を待たせない

import type { D1Database } from "@cloudflare/workers-types";
import { todayJst } from "../age.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { hasAnthropicKey, type AiEnv, type ClaudeClient } from "../claude/client.ts";
import { d1UsageStore, usageToday } from "../claude/usage.ts";
import { maskReply, type PseudonymInput } from "../pseudonym/index.ts";
import { drillScope } from "./db.ts";
import { drillError, isDrillId } from "./http.ts";
import { loadPersonaSources } from "./persona.ts";
import {
  hasActivity,
  personPrint,
  personText,
  planPersons,
  PERSON_USAGE_RESERVE,
  PERSON_TICK_CALLS_MAX,
  PERSONS_AT_END,
  PERSONS_PER_CALL,
  PERSONS_PER_TICK,
  runPersonReviews,
  shownPersons,
  type StoredPersons,
} from "./person-review.ts";
import {
  claimPersons,
  claimReview,
  computeScore,
  editReview,
  liveReviewContext,
  loadDrillRecord,
  parseStoredScore,
  addTickCalls,
  readPersonsState,
  releasePersons,
  reviewContextOf,
  savePerson,
  saveSeen,
  settleReview,
  shownReview,
  type StoredReview,
} from "./record.ts";
import { isCallResponse, loadCallRecords, respondCall } from "./responses.ts";
import { createReview, FINDING_TEXT_MAX, reviewKeyOf, SUMMARY_MAX, type ReviewBody, type ReviewContext, type ReviewError } from "./review.ts";
import { loadDrillScreen } from "./view.ts";
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

function reviewJson(review: StoredReview | null, persons?: StoredPersons): Response {
  return Response.json({ ok: true, review, shown: shownReview(review), persons: shownPersons(persons) }, { headers: NO_STORE });
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
  // 項目ごとの文と良かった所（T185）は直す欄が無いので元のまま残す
  return {
    summary: clip(e.summary, SUMMARY_MAX * 2),
    findings,
    ...(base.sections ? { sections: base.sections } : {}),
    ...(base.good ? { good: base.good } : {}),
  };
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
    const stored = parseStoredScore(after?.score ?? null);
    return reviewJson(stored?.review ?? null, stored?.persons);
  }

  if (rec.review?.state === "done") return reviewJson(rec.review, rec.persons);
  if (!hasAnthropicKey(env)) return reviewError("not_configured", 503);
  const claimedAt = now();
  if (!(await claimReview(db, scope.officeId, id, claimedAt))) {
    // ほかの画面が作っている（か、今できた）。今の物を返す
    const cur = await db.prepare("SELECT score FROM drills WHERE id = ?1 AND office_id = ?2").bind(id, scope.officeId).first<{ score: string | null }>();
    const stored = parseStoredScore(cur?.score ?? null);
    return reviewJson(stored?.review ?? { state: "pending", at: claimedAt }, stored?.persons ?? rec.persons);
  }
  const ai: AskJsonContext = {
    env,
    usage: d1UsageStore(db),
    office: { id: p.office.id, kind: p.office.kind },
    ...(opts.claude ? { claude: opts.claude } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
  const sources = await loadPersonaSources(db, scope.officeId);
  const ctx = reviewContextOf(rec);
  const on = claimedAt.slice(0, 10);
  // 全体の講評（Opus）と、まだ無い・流れの変わった人ごとの講評（Haiku、T185）を並べて呼ぶ。全体はその時にできている人ごとの講評の要旨を使う
  const [out, persons] = await Promise.all([
    createReview({ sources, ai, on }, ctx),
    makePersonReviews(db, scope.officeId, id, "end", { ai, sources, ctx, now, on }),
  ]);
  const review: Extract<StoredReview, { state: "done" | "failed" }> = out.ok
    ? { state: "done", ai: { ...out.body, model: out.model, at: now() }, edited: null }
    : { state: "failed", error: out.error, at: now() };
  await settleReview(db, scope.officeId, id, claimedAt, review);
  if (!out.ok) return reviewError(out.error, out.error === "limit" ? 429 : 502);
  return reviewJson(review, persons ?? rec.persons);
}

/**
 * 人ごとの講評を作る（T185。投げない）。tick は刻みの裏（落ち着いた人を PERSONS_PER_TICK 人まで）、end は終わり（印の変わった人を
 * PERSONS_AT_END 人まで）。作る印（claimPersons）を取れなければ何もしない（ほかの刻みの裏か終わりの講評が作っている）。
 * 1 日の上限の残りが PERSON_USAGE_RESERVE を割るなら作らない。返すのは保存した後の人ごとの講評（作る印を取れなかったら null）
 */
export async function makePersonReviews(
  db: D1Database,
  officeId: string,
  id: string,
  mode: "tick" | "end",
  deps: { ai: AskJsonContext; sources?: ReadonlyMap<string, PseudonymInput>; ctx?: ReviewContext; now: () => string; on?: string },
): Promise<StoredPersons | null> {
  const claimedAt = deps.now();
  try {
    if (!(await claimPersons(db, officeId, id, claimedAt))) return null;
  } catch (e) {
    console.error("人ごとの講評の印を取れない", e instanceof Error ? e.name : typeof e);
    return null;
  }
  try {
    let ctx = deps.ctx;
    if (!ctx) {
      const screen = await loadDrillScreen(db, { officeId }, id, null);
      if (!screen) return null;
      const calls = await loadCallRecords(db, id);
      const score = await computeScore(db, { officeId }, screen, calls, todayJst(new Date(claimedAt)));
      ctx = liveReviewContext(screen, score, calls);
    }
    const live = ctx;
    const sources = deps.sources ?? (await loadPersonaSources(db, officeId));
    const usage = await usageToday(deps.ai);
    const room = Math.min(mode === "tick" ? PERSONS_PER_TICK : PERSONS_AT_END, usage.limit - usage.used - PERSON_USAGE_RESERVE);
    const { key, members, aliasOf } = reviewKeyOf({ sources, ai: deps.ai, ...(deps.on ? { on: deps.on } : {}) }, live.score.participants);
    const words = (t: string) => maskReply(t, key);
    const prints = members.map((person) => ({
      person,
      print: personPrint(personText(live, person, aliasOf, { words })),
      active: hasActivity(live, person),
    }));
    const { persons: stored, tickCalls } = await readPersonsState(db, officeId, id);
    // 刻みの裏で呼ぶのは 1 回の訓練に PERSON_TICK_CALLS_MAX 回まで（残りは終わりにまとめて）
    const plan = planPersons(prints, stored, mode, mode === "tick" && tickCalls >= PERSON_TICK_CALLS_MAX ? 0 : room);
    const make = new Set(plan.make);
    await saveSeen(db, officeId, id, Object.fromEntries(Object.entries(plan.seen).filter(([p]) => !make.has(p))));
    if (plan.make.length === 0) return { ...stored };
    if (mode === "tick") await addTickCalls(db, officeId, id, Math.ceil(plan.make.length / PERSONS_PER_CALL));
    const made = await runPersonReviews(
      { ai: deps.ai, key, aliasOf, now: deps.now },
      live,
      { make: plan.make, prints: new Map(prints.map((x) => [x.person, x.print])) },
      stored,
      (person, rec) => savePerson(db, officeId, id, person, rec),
    );
    return { ...stored, ...made };
  } catch (e) {
    console.error("人ごとの講評を作れない", e instanceof Error ? e.name : typeof e);
    return null;
  } finally {
    await releasePersons(db, officeId, id, claimedAt).catch(() => undefined);
  }
}

/** 刻みの応答のあと（waitUntil）に呼ぶ（T185）。鍵が無い・範囲の外は何もしない。投げない */
export async function personReviewsAfterStep(env: ReviewApiEnv, p: Principal | null, id: string, opts: ReviewApiOpts = {}): Promise<void> {
  if (!p || !p.office || !isDrillId(id) || !hasAnthropicKey(env)) return;
  const scope = drillScope(p);
  if (!scope) return;
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const ai: AskJsonContext = {
    env,
    usage: d1UsageStore(env.DB),
    office: { id: p.office.id, kind: p.office.kind },
    ...(opts.claude ? { claude: opts.claude } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
  await makePersonReviews(env.DB, scope.officeId, id, "tick", { ai, now, on: now().slice(0, 10) });
}
