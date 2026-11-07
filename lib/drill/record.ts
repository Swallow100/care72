// 訓練の採点と講評の保存（docs/tasks/T22.md）。D1 と範囲を引数で受け取る（テストで node:sqlite）。
//
// - 採点（lib/drill/score.ts の数字）は、終わった・中断した訓練を最初に開いたときに数えて drills.score に残す（score が空のときだけ書く。
//   同時に開いても 1 回）。様式 9 の空欄はその時の台帳で数えるので、残した物はあとで台帳を直しても変わらない（前回との比較に使う）
// - 講評（lib/drill/review.ts、Opus 1 回）は drills.score の review に残す。作る前に「作成中」を書いて重ねて呼ばない
//   （作成中が古ければ取り直す）。失敗も残す（再作成できる）。ケアマネが直した物は edited に別に残し、AI の元は消さない
// - 前回: 同じ事業所の、この訓練より前に始めて終わった訓練のうち、同じ災害（大雨と 10 分版は大雨）のいちばん新しい物
// - 進行中の訓練は数えない

import type { D1Database } from "@cloudflare/workers-types";
import { todayJst } from "../age.ts";
import { parseLedger } from "../db/ledger.ts";
import type { ContactRow, DrillScenario, DrillStatus, PersonRow } from "../db/types.ts";
import { buildForm9, type Form9PersonInput } from "../forms/form9.ts";
import { isSourceId } from "../sources/index.ts";
import { isDrillScenario, rowScenario, type DrillScope } from "./db.ts";
import { drillClocks } from "./director.ts";
import { withoutMemo } from "./engine.ts";
import { endingsAllowed } from "./fiction.ts";
import { outageForRuns } from "./outcome.ts";
import { inOutageOf, planOf, scorePlans } from "./person-facts.ts";
import { parsePersons, personDigests, type StoredPerson, type StoredPersons } from "./person-review.ts";
import { REVIEW_KINDS, REVIEW_TOPICS, type ReviewBody, type ReviewContext, type ReviewError, type ReviewFinding, type ReviewIncident, type ReviewTopic } from "./review.ts";
import { loadCallRecords, type CallRecord } from "./responses.ts";
import { isVirtual, scenarioOf } from "./scenarios.ts";
import {
  clockRuns,
  scoreDrill,
  scoreExtras,
  scoreNumbers,
  type ClockForRun,
  type DrillScore,
  type EndedScore,
  type ScoreInput,
  type ScoreNumbers,
} from "./score.ts";
import { loadDrillScreen, type DrillScreen } from "./view.ts";

// ---------- drills.score の形 ----------

export type StoredReview =
  | { state: "pending"; at: string }
  | { state: "failed"; error: ReviewError; at: string }
  | {
      state: "done";
      /** Claude（Opus）の元 */
      ai: ReviewBody & { model: string; at: string };
      /** ケアマネが直した物。直していなければ null */
      edited: (ReviewBody & { by: string | null; at: string }) | null;
    };

/**
 * drills.score の形。persons は人ごとの講評（T185）で、訓練の間から書く（採点の前は persons だけの殻。scoreOf が殻に採点を足す）
 */
export type StoredScore = { v: 1; at: string; score: DrillScore; review: StoredReview | null; persons?: StoredPersons };

/** 作成中が古い（取り直してよい）とみなす分。Opus の 1 回の待ち 180 秒 × 再試行 1 回より長く */
export const REVIEW_STALE_MINUTES = 8;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseBody(v: unknown): ReviewBody | null {
  if (!isObj(v) || typeof v.summary !== "string" || !Array.isArray(v.findings)) return null;
  const findings: ReviewFinding[] = [];
  for (const f of v.findings) {
    if (!isObj(f) || typeof f.text !== "string") continue;
    findings.push({
      person: typeof f.person === "string" ? f.person : null,
      kind: typeof f.kind === "string" && (REVIEW_KINDS as readonly string[]).includes(f.kind) ? (f.kind as ReviewFinding["kind"]) : "other",
      text: f.text,
      basis: typeof f.basis === "string" && isSourceId(f.basis) ? f.basis : null,
    });
  }
  // 項目ごとの文と良かった所（T185。前に保存した講評には無い）
  const sections = Array.isArray(v.sections)
    ? v.sections.flatMap((x) =>
        isObj(x) && typeof x.text === "string" && typeof x.topic === "string" && (REVIEW_TOPICS as readonly string[]).includes(x.topic)
          ? [{ topic: x.topic as ReviewTopic, text: x.text }]
          : [],
      )
    : [];
  const good = Array.isArray(v.good) ? v.good.filter((x): x is string => typeof x === "string") : [];
  return { summary: v.summary, findings, ...(sections.length > 0 ? { sections } : {}), ...(good.length > 0 ? { good } : {}) };
}

function parseReview(v: unknown): StoredReview | null {
  if (!isObj(v)) return null;
  if (v.state === "pending" && typeof v.at === "string") return { state: "pending", at: v.at };
  if (v.state === "failed" && typeof v.at === "string") {
    return { state: "failed", error: (typeof v.error === "string" ? v.error : "failed") as ReviewError, at: v.at };
  }
  if (v.state === "done" && isObj(v.ai)) {
    const ai = parseBody(v.ai);
    if (!ai) return null;
    const edited = isObj(v.edited) ? parseBody(v.edited) : null;
    return {
      state: "done",
      ai: { ...ai, model: typeof v.ai.model === "string" ? v.ai.model : "", at: typeof v.ai.at === "string" ? v.ai.at : "" },
      edited:
        edited && isObj(v.edited)
          ? { ...edited, by: typeof v.edited.by === "string" ? v.edited.by : null, at: typeof v.edited.at === "string" ? v.edited.at : "" }
          : null,
    };
  }
  return null;
}

/** drills.score の文字を読む。形が違えば null（数え直す） */
export function parseStoredScore(text: string | null): StoredScore | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (!isObj(v) || v.v !== 1 || !isObj(v.score) || typeof v.at !== "string") return null;
    const s = v.score as Partial<DrillScore>;
    if (s.v !== 1 || !s.order || !s.report || !s.form9 || !Array.isArray(s.reached) || !s.calls || !Array.isArray(s.participants)) return null;
    return { v: 1, at: v.at, score: s as DrillScore, review: parseReview(v.review), persons: parsePersons(v.persons) };
  } catch {
    return null;
  }
}

/** 画面と紙面に出す講評（直した物があればそれ） */
export function shownReview(r: StoredReview | null): (ReviewBody & { edited: boolean; model: string }) | null {
  if (!r || r.state !== "done") return null;
  return r.edited ? { ...r.edited, edited: true, model: r.ai.model } : { ...r.ai, edited: false };
}

// ---------- 数える ----------

type PersonForScore = Pick<PersonRow, "id" | "name" | "kana" | "birth_date" | "self_report_unreliable" | "ledger" | "care_manager_id">;
type ContactForScore = Form9PersonInput["contacts"][number] & Pick<ContactRow, "person_id">;

/** 採点の終わりの上限（発災から 72 時間。最後の刻みのあとに 72 時間をまたぐ手を打っても、結末の刻みとそろえる） */
export const SCORE_END_MINUTE = 72 * 60;

/** 訓練の終わり（ケアマネの時計、発災からの分。72 時間で切る） */
export const endMinuteOf = (screen: Pick<DrillScreen, "state">) =>
  Math.min(SCORE_END_MINUTE, Math.max(screen.state.minute, screen.state.hour * 60));

/** 仮想モードの結末（世界が決めた。T53）。結末の状況（world-apply.ts）から、世界の ended の順に */
export function endedOf(screen: Pick<DrillScreen, "state" | "ticks">): EndedScore[] {
  const incidents = screen.ticks.flatMap((t) => t.incidents);
  return Object.entries(screen.state.world.ended ?? {}).map(([person, e]) => {
    const inc = incidents.find((x) => x.change.kind === "outcome" && x.person === person);
    const reason = inc && inc.change.kind === "outcome" ? (inc.change.reason ?? null) : (e.reason ?? null);
    return { person, at: e.at, text: inc?.text ?? "", reason };
  });
}

/**
 * 内訳の数（T94: 空振り・重複・頼み事の未対応・通話の往復）の元。刻みのあとの世界（手を打った時の電話・施設の休止）、
 * 状況（その人の新しい事）、終わりの世界（向かった人の到着・頼み事）。台帳を読まない
 */
export function extrasSourceOf(screen: Pick<DrillScreen, "ticks" | "state">): Pick<ScoreInput, "ticks" | "incidents" | "world"> {
  return {
    ticks: screen.ticks.map((t) => ({ step: t.step, world: t.world })),
    incidents: screen.ticks.flatMap((t) => t.incidents.map((e) => ({ at: e.at, person: e.person ?? null }))),
    world: screen.state.world,
  };
}

/**
 * T94 より前に残した採点（内訳の数の欄が無い）には、訓練の記録から内訳の数を数えて足す（書き戻さない）。
 * 内訳の数は様式 9 と台帳を読まないので、あとで台帳を直しても変わらない。4 つの数字は残した物のまま
 */
export function withExtras(score: DrillScore, screen: Pick<DrillScreen, "ticks" | "state">, calls: ReadonlyArray<CallRecord>): DrillScore {
  const whole =
    Array.isArray(score.wasted?.rows) && Array.isArray(score.repeat?.rows) && Array.isArray(score.asks?.rows) && typeof score.talks?.turns === "number";
  if (whole) return score;
  const extras = scoreExtras({ participants: score.participants, actions: screen.state.actions, calls, endMinute: score.endMinute, ...extrasSourceOf(screen) });
  return { ...score, ...extras };
}

/** 採点に要る台帳（参加者の本人・連絡先・時計・担当の名前）を読み、数える。D1 には書かない */
export async function computeScore(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  screen: DrillScreen,
  calls: ReadonlyArray<CallRecord>,
  today: string,
): Promise<DrillScore> {
  const participants = screen.state.participants;
  const ids = JSON.stringify(participants);
  const mine = "SELECT id FROM people WHERE office_id = ?1 AND id IN (SELECT value FROM json_each(?2))";
  const [people, contacts, clocks, accounts] = await db.batch([
    db
      .prepare(
        `SELECT id, name, kana, birth_date, self_report_unreliable, ledger, care_manager_id FROM people
          WHERE id IN (${mine}) ORDER BY kana, id`,
      )
      .bind(scope.officeId, ids),
    db
      .prepare(
        `SELECT person_id, kind, relation, name, phone, emergency_order, supporter_order, has_smartphone FROM contacts
          WHERE person_id IN (${mine}) ORDER BY person_id, sort, id`,
      )
      .bind(scope.officeId, ids),
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check FROM clocks
          WHERE person_id IN (${mine}) ORDER BY person_id, sort, id`,
      )
      .bind(scope.officeId, ids),
    db.prepare("SELECT id, display_name FROM accounts WHERE office_id = ?1").bind(scope.officeId),
  ]);
  const peopleRows = people.results as PersonForScore[];
  const contactRows = contacts.results as ContactForScore[];
  const clockRows = clocks.results as ClockForRun[];
  const names = new Map((accounts.results as Array<{ id: string; display_name: string }>).map((a) => [a.id, a.display_name]));
  const ledgers = new Map(peopleRows.map((p) => [p.id, parseLedger(p.ledger)]));

  // 様式 9（平時の並び。色なし）
  const form9 = buildForm9(
    peopleRows.map((p) => ({
      person: p,
      careManager: p.care_manager_id ? names.get(p.care_manager_id) || null : null,
      contacts: contactRows.filter((c) => c.person_id === p.id),
      clocks: clockRows.filter((c) => c.person_id === p.id),
    })),
    { today },
  );

  // 時計の走り方（訓練の世界の頼り先の写しを当てた時計。停電の地区は本人の町名）
  const world = screen.state.world;
  // 停電の地区と始まり（町ごとの始まりも。仮想モードの結末 lib/drill/outcome.ts と同じ物）
  const outage = outageForRuns(world, [...ledgers.values()]);
  const towns = new Map([...ledgers].map(([id, l]) => [id, l.basic.address?.town ?? null]));
  const runs = clockRuns(drillClocks(clockRows, world), towns, outage);
  // 計画で動けた人と、計画が無く手が要った人（T130。台帳の計画と、訓練の世界・終わりの前の連絡から。Claude を呼ばない）
  const plans = new Map(
    peopleRows.map((p) => [
      p.id,
      planOf({ ledger: ledgers.get(p.id)!, clocks: clockRows.filter((c) => c.person_id === p.id), contacts: contactRows.filter((c) => c.person_id === p.id) }),
    ]),
  );
  const planScore = scorePlans({
    participants,
    plans,
    world,
    people: screen.state.people,
    actions: screen.state.actions,
    endMinute: endMinuteOf(screen),
    inOutage: (id) => {
      const l = ledgers.get(id);
      return !!world.outage && !!l && inOutageOf(world.outage.area, l.evacuation.hazards, l.basic.address?.town ?? null);
    },
  });

  return scoreDrill({
    participants,
    actions: screen.state.actions,
    calls,
    runs,
    form9: form9.rows,
    endMinute: endMinuteOf(screen),
    ...extrasSourceOf(screen),
    // 結末（AI の筋書き）はデモ事業所の仮想の訓練だけ（T70 の続き。デモ以外は実在の人の仮名に結末を付けない。条件に達した人の数は出す）
    ...(isVirtual(screen.drill.scenario) && endingsAllowed(scope.officeId) ? { ended: endedOf(screen) } : {}),
    plans: planScore,
  });
}

/** 前回の訓練（比べる物） */
export type PreviousRecord = { id: string; scenario: DrillScenario; startedAt: string; numbers: ScoreNumbers };

export type DrillRecord = {
  screen: DrillScreen;
  score: DrillScore;
  review: StoredReview | null;
  /** 人ごとの講評（T185。無ければ空） */
  persons: StoredPersons;
  calls: CallRecord[];
  previous: PreviousRecord | null;
  /** 残した時刻（数えた時刻） */
  scoredAt: string;
};

async function readStored(db: D1Database, officeId: string, id: string): Promise<{ text: string | null } | null> {
  const r = await db.prepare("SELECT score FROM drills WHERE id = ?1 AND office_id = ?2").bind(id, officeId).first<{ score: string | null }>();
  return r ? { text: r.score } : null;
}

/** 採点を読み、無ければ数えて残す（score が空のときだけ書く）。進行中・無い訓練は null */
async function scoreOf(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  screen: DrillScreen,
  calls: ReadonlyArray<CallRecord>,
  now: string,
): Promise<StoredScore | null> {
  if (screen.drill.status === "running") return null;
  const id = screen.drill.id;
  const stored = parseStoredScore((await readStored(db, scope.officeId, id))?.text ?? null);
  if (stored) return stored;
  const score = await computeScore(db, scope, screen, calls, todayJst(new Date(now)));
  const persons = parsePersons(safeJson((await readStored(db, scope.officeId, id))?.text ?? null)?.persons);
  const body: StoredScore = { v: 1, at: now, score, review: null, persons };
  // 人ごとの講評（T185）が訓練の間に書いた殻（persons だけ）には、persons を残したまま採点を足す
  const r = await db
    .prepare(
      `UPDATE drills SET score = json_set(COALESCE(score, '{}'), '$.v', 1, '$.at', ?4, '$.score', json(?3), '$.review', json('null'))
        WHERE id = ?1 AND office_id = ?2 AND status <> 'running' AND (score IS NULL OR json_type(score, '$.score') IS NULL)`,
    )
    .bind(id, scope.officeId, JSON.stringify(score), now)
    .run();
  if ((r.meta.changes ?? 0) > 0) return body;
  // ほかの要求が先に残した（か、形の崩れた物が残っている）。残っている物を読み直し、読めなければ数えた物を使う（書かない）
  return parseStoredScore((await readStored(db, scope.officeId, id))?.text ?? null) ?? body;
}

/** 前回（同じ事業所・同じ災害・この訓練より前に始めて終わった物）。採点が無ければ数えて残す */
async function previousOf(db: D1Database, scope: Pick<DrillScope, "officeId">, screen: DrillScreen, now: string): Promise<PreviousRecord | null> {
  const kind = scenarioOf(screen.drill.scenario).kind;
  const res = await db
    .prepare(
      `SELECT id, scenario, mode, started_at FROM drills
        WHERE office_id = ?1 AND id <> ?2 AND status = 'finished' AND started_at < ?3 ORDER BY started_at DESC, id LIMIT 20`,
    )
    .bind(scope.officeId, screen.drill.id, screen.drill.started_at)
    .all<{ id: string; scenario: DrillScenario; mode: string | null; started_at: string }>();
  // 仮想（T50）は仮想とだけ比べる（固定の筋とは出来事が違う）
  const virtual = isVirtual(screen.drill.scenario);
  const hit = res.results
    .map(rowScenario)
    .find((r) => isDrillScenario(r.scenario) && isVirtual(r.scenario) === virtual && scenarioOf(r.scenario).kind === kind);
  if (!hit) return null;
  const prev = await loadDrillScreen(db, scope, hit.id, null);
  if (!prev) return null;
  const stored = await scoreOf(db, scope, prev, await loadCallRecords(db, hit.id), now);
  if (!stored) return null;
  return { id: hit.id, scenario: hit.scenario, startedAt: hit.started_at, numbers: scoreNumbers(stored.score) };
}

/**
 * 訓練記録（採点・講評・前回）を読む。終わった・中断した訓練だけ（進行中は "running"）。範囲の外・無い訓練は null。
 * 採点がまだ無ければ数えて残す
 */
export async function loadDrillRecord(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  id: string,
  now: string,
): Promise<DrillRecord | "running" | null> {
  const screen = await loadDrillScreen(db, scope, id, null);
  if (!screen) return null;
  if (screen.drill.status === "running") return "running";
  const calls = await loadCallRecords(db, id);
  const stored = await scoreOf(db, scope, screen, calls, now);
  if (!stored) return "running";
  const previous = await previousOf(db, scope, screen, now);
  return { screen, score: withExtras(stored.score, screen, calls), review: stored.review, persons: stored.persons ?? {}, calls, previous, scoredAt: stored.at };
}

// ---------- 講評の保存 ----------

/**
 * 講評の作成中を書く（取れたら true）。まだ無い・失敗した・作成中が古いときだけ。採点が残っていなければ取れない
 */
export async function claimReview(db: D1Database, officeId: string, id: string, now: string): Promise<boolean> {
  const stale = new Date(Date.parse(now) - REVIEW_STALE_MINUTES * 60_000).toISOString();
  const pending: StoredReview = { state: "pending", at: now };
  const r = await db
    .prepare(
      `UPDATE drills SET score = json_set(score, '$.review', json(?3))
        WHERE id = ?1 AND office_id = ?2 AND score IS NOT NULL AND status <> 'running'
          AND (json_type(score, '$.review') IS NULL OR json_type(score, '$.review') = 'null'
               OR json_extract(score, '$.review.state') = 'failed'
               OR (json_extract(score, '$.review.state') = 'pending' AND json_extract(score, '$.review.at') < ?4))`,
    )
    .bind(id, officeId, JSON.stringify(pending), stale)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** 作成中（claimedAt に取った物）を、できた講評か失敗で置き換える。ほかの要求に取り直されていれば書かない */
export async function settleReview(
  db: D1Database,
  officeId: string,
  id: string,
  claimedAt: string,
  review: Extract<StoredReview, { state: "done" | "failed" }>,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE drills SET score = json_set(score, '$.review', json(?3))
        WHERE id = ?1 AND office_id = ?2 AND json_extract(score, '$.review.state') = 'pending' AND json_extract(score, '$.review.at') = ?4`,
    )
    .bind(id, officeId, JSON.stringify(review), claimedAt)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** ケアマネが直した講評を残す（できた講評があるときだけ。AI の元は残す） */
export async function editReview(
  db: D1Database,
  officeId: string,
  id: string,
  edited: ReviewBody & { by: string | null; at: string },
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE drills SET score = json_set(score, '$.review.edited', json(?3))
        WHERE id = ?1 AND office_id = ?2 AND json_extract(score, '$.review.state') = 'done'`,
    )
    .bind(id, officeId, JSON.stringify(edited))
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** 講評の入力（訓練記録から。状況は刻みの状況を時刻の順に）。人ごとの講評（T185）ができていれば、その要旨も */
export function reviewContextOf(rec: DrillRecord): ReviewContext {
  const digests = personDigests(rec.persons, rec.score.participants);
  return {
    ...liveReviewContext(rec.screen, rec.score, rec.calls),
    previous: rec.previous ? { ...rec.previous.numbers, scenario: rec.previous.scenario } : null,
    ...(digests.length > 0 ? { persons: digests } : {}),
  };
}

/** 講評の入力（訓練の間でも。人ごとの講評〔T185〕が刻みの裏で使う。前回は入れない） */
export function liveReviewContext(screen: DrillScreen, score: DrillScore, calls: ReadonlyArray<CallRecord>): ReviewContext {
  const incidents: ReviewIncident[] = screen.ticks.flatMap((t) => t.incidents.map((e) => ({ at: e.at, text: e.text, person: e.person ?? null })));
  return {
    scenario: screen.drill.scenario,
    status: screen.drill.status as DrillStatus,
    score,
    // ケアマネのメモ（T59）は講評（Opus）に渡さない
    actions: withoutMemo(screen.state.actions),
    calls,
    incidents,
    previous: null,
    // T94: 手を打った時の世界（電話・施設の休止）と、通話の往復で頼まれた事
    ticks: screen.ticks.map((t) => ({ step: t.step, world: t.world })),
    ...(screen.state.world.asks ? { asks: screen.state.world.asks } : {}),
  };
}

// ---------- 人ごとの講評の保存（T185） ----------

/** JSON の文を読む（読めなければ null） */
function safeJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** 人ごとの講評を作っている印（訓練 1 つに 1 つ）が古いとみなす分（Haiku 20 秒 × 並べた数より長く） */
export const PERSONS_STALE_MINUTES = 2;

/** 本人の id（json の path に入れる前に確かめる） */
const PERSON_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 今の人ごとの講評（訓練の間でも読む。採点の前の殻も） */
export async function readPersons(db: D1Database, officeId: string, id: string): Promise<StoredPersons> {
  return parsePersons(safeJson((await readStored(db, officeId, id))?.text ?? null)?.persons);
}

/**
 * 人ごとの講評を作る印を取る（取れたら true）。無い・古いときだけ。刻みの裏（waitUntil）が重なっても、終わりの講評と重なっても 1 つだけ作る
 */
export async function claimPersons(db: D1Database, officeId: string, id: string, now: string): Promise<boolean> {
  const stale = new Date(Date.parse(now) - PERSONS_STALE_MINUTES * 60_000).toISOString();
  const r = await db
    .prepare(
      `UPDATE drills SET score = json_set(COALESCE(score, '{}'), '$.personsAt', ?3)
        WHERE id = ?1 AND office_id = ?2
          AND (score IS NULL OR json_extract(score, '$.personsAt') IS NULL OR json_extract(score, '$.personsAt') < ?4)`,
    )
    .bind(id, officeId, now, stale)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** 印を外す（claimedAt に取った物だけ） */
export async function releasePersons(db: D1Database, officeId: string, id: string, claimedAt: string): Promise<void> {
  await db
    .prepare(`UPDATE drills SET score = json_remove(score, '$.personsAt') WHERE id = ?1 AND office_id = ?2 AND json_extract(score, '$.personsAt') = ?3`)
    .bind(id, officeId, claimedAt)
    .run();
}

/** 1 人分を書く（ほかの人と講評は残す） */
export async function savePerson(db: D1Database, officeId: string, id: string, person: string, rec: StoredPerson): Promise<void> {
  if (!PERSON_ID.test(person)) return;
  await db
    .prepare(`UPDATE drills SET score = json_set(COALESCE(score, '{}'), '$.persons."${person}"', json(?3)) WHERE id = ?1 AND office_id = ?2`)
    .bind(id, officeId, JSON.stringify(rec))
    .run();
}

/** 前の刻みで見た印を書く（1 文で全員分） */
export async function saveSeen(db: D1Database, officeId: string, id: string, seen: Readonly<Record<string, string>>): Promise<void> {
  const ids = Object.keys(seen).filter((p) => PERSON_ID.test(p));
  if (ids.length === 0) return;
  const paths = ids.map((p, i) => `'$.persons."${p}".seen', ?${i + 3}`).join(", ");
  await db
    .prepare(`UPDATE drills SET score = json_set(COALESCE(score, '{}'), ${paths}) WHERE id = ?1 AND office_id = ?2`)
    .bind(id, officeId, ...ids.map((p) => seen[p]))
    .run();
}
