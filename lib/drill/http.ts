// 訓練の API（app/api/drill/）の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
// 断り方: ログインしていなければ 401、ケアマネの役でなければ 403（行政・医療班・本人・家族・役を選ぶ前の審査員）、
// 形が違う 400、事業所の外・無い訓練 404、同じケアマネの進行中があるのに開始 409（T70。24 時間たった進行中は先に中断）、読んだ刻みと違う 409、終わった訓練を進める 409。
// 1 要求で進めるのは 1 刻みだけ（早送りもブラウザから 1 刻みずつ呼ぶ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { DRILL_ACTIONS, type DrillAction } from "../db/types.ts";
import { COLOR_LABELS } from "../labels.ts";
import type { ActionHooks } from "./actions.ts";
import {
  abandonDrill,
  actDrill,
  advanceDrill,
  drillScope,
  isDrillScenario,
  listDrills,
  MEMO_MAX,
  startDrill,
  undoDrill,
  type DrillScope,
  type StartOptions,
} from "./db.ts";
import { isStaffCount } from "./engine.ts";
import type { StepHooks } from "./engine.ts";
import { DRILL_API_LABELS, type DrillApiError } from "./labels.ts";
import { lastHour, scenarioOf } from "./scenarios.ts";
import { loadDrillScreen } from "./view.ts";

const STATUS: Record<DrillApiError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  running: 409,
  conflict: 409,
  ended: 409,
  locked: 409,
};

const NO_STORE = { "Cache-Control": "no-store" };

export function drillError(error: DrillApiError): Response {
  return Response.json({ ok: false, error, label: DRILL_API_LABELS[error] }, { status: STATUS[error], headers: NO_STORE });
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isDrillId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isStep = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;

function gate(p: Principal | null): DrillScope | Response {
  if (!p) return drillError("login_required");
  const scope = drillScope(p);
  return scope ?? drillError("forbidden");
}

/** 参加者の id の数の上限（担当一覧の人数より十分多く） */
const PARTICIPANTS_MAX = 200;

/**
 * 開始の前に選んだ物（T59）の形を見る。無ければ {}（今と同じ）。形が違えば null。
 * { participants?: 本人の id の配列（1 人以上）, staff?: 0〜9, night?: 真偽 }。担当一覧の中かは startDrill が見る
 */
export function parseStartOptions(v: unknown): StartOptions | null {
  if (v === undefined || v === null) return {};
  const o = obj(v);
  if (!o) return null;
  const out: { participants?: string[]; staff?: number; night?: boolean } = {};
  if (o.participants !== undefined) {
    const ps = o.participants;
    if (!Array.isArray(ps) || ps.length === 0 || ps.length > PARTICIPANTS_MAX || !ps.every(isDrillId)) return null;
    out.participants = ps;
  }
  if (o.staff !== undefined) {
    if (!isStaffCount(o.staff)) return null;
    out.staff = o.staff;
  }
  if (o.night !== undefined) {
    if (typeof o.night !== "boolean") return null;
    if (o.night) out.night = true;
  }
  return out;
}

/**
 * 開始の POST（JSON）。{ scenario: heavy_rain・earthquake・short・virtual, options?: { participants?, staff?, night? } }（options は T59。
 * 無ければ担当一覧の全員・想定の表の職員・昼の発災で今と同じ）
 */
export async function startPost(db: D1Database, p: Principal | null, json: unknown, now: string, hooks?: StepHooks): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!b || !isDrillScenario(b.scenario)) return drillError("invalid");
  const options = parseStartOptions(b.options);
  if (!options) return drillError("invalid");
  const r = await startDrill(db, scope, b.scenario, now, hooks, undefined, options);
  if (!r.ok) return drillError(r.error === "running" ? "running" : r.error === "invalid" ? "invalid" : "not_found");
  return Response.json({ ok: true, id: r.id }, { headers: NO_STORE });
}

/** 1 刻み進める POST（JSON）。{ step: 画面で読んだ今の刻み } */
export async function stepPost(
  db: D1Database,
  p: Principal | null,
  id: string,
  json: unknown,
  now: string,
  hooks?: StepHooks,
): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step)) return drillError("invalid");
  const r = await advanceDrill(db, scope, id, b.step, now, hooks);
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true, step: r.step, hour: r.hour, status: r.status }, { headers: NO_STORE });
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000;
const isRef = (v: unknown): v is string | null => v === null || v === undefined || (typeof v === "string" && ID.test(v));

/**
 * ケアマネの手の POST（JSON、T20）。{ step: 読んだ今の刻み, actions: 読んだ手の数, kind: 7 つの手, person: 本人の id か null, target: 連絡先の id か null }。
 * 相手は台帳の連絡先から決める（lib/drill/db.ts）。手の前の左の表は画面と同じ道（loadDrillScreen）で作って手の記録に残す
 */
export async function actionPost(
  db: D1Database,
  p: Principal | null,
  id: string,
  json: unknown,
  now: string,
  opts: { hooks?: ActionHooks; roll?: () => number } = {},
): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions)) return drillError("invalid");
  if (typeof b.kind !== "string" || !(DRILL_ACTIONS as readonly string[]).includes(b.kind)) return drillError("invalid");
  if (!isRef(b.person) || !isRef(b.target)) return drillError("invalid");
  // 手のメモ（T59、任意、100 字まで）。記録に残すだけで Claude には渡さない
  if (b.memo !== undefined && b.memo !== null && (typeof b.memo !== "string" || [...b.memo.trim()].length > MEMO_MAX)) return drillError("invalid");
  const memo = typeof b.memo === "string" ? b.memo.trim() : "";
  const screen = await loadDrillScreen(db, scope, id, null);
  if (!screen) return drillError("not_found");
  const ranked = screen.rows.filter((r) => r.rank !== null).sort((x, y) => x.rank! - y.rank!);
  const triage = {
    rows: new Map(
      screen.rows.map((r) => [r.id, { color: r.triage?.color ?? "gray", rank: r.rank, reason: r.triage?.reason ?? "" }] as const),
    ),
    ranking: ranked.map((r) => r.id),
  };
  const r = await actDrill(
    db,
    scope,
    id,
    { step: b.step, actions: b.actions },
    {
      kind: b.kind as DrillAction,
      person: (b.person as string | null | undefined) ?? null,
      target: (b.target as string | null | undefined) ?? null,
      ...(memo ? { memo } : {}),
    },
    now,
    { ...(opts.hooks ? { hooks: opts.hooks } : {}), ...(opts.roll ? { roll: opts.roll } : {}), triage },
  );
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true, id: r.record.id, step: r.step, hour: r.hour, minute: r.minute, status: r.status }, { headers: NO_STORE });
}

/**
 * 手の取消の POST（JSON、T59）。{ step: 読んだ今の刻み, actions: 読んだ手の数 }。最後の手 1 つだけ、刻みを越えなかった手だけ。
 * 断り方は stepPost と同じ（読んだ刻み・手の数と違えば 409、終わった訓練は 409）。刻みを越えた手は 409（取消不可）、手が無ければ 400
 */
export async function undoPost(db: D1Database, p: Principal | null, id: string, json: unknown): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions)) return drillError("invalid");
  const r = await undoDrill(db, scope, id, { step: b.step, actions: b.actions });
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true, id: r.id, step: r.step, hour: r.hour, minute: r.minute }, { headers: NO_STORE });
}

/** 中断の POST */
export async function abandonPost(db: D1Database, p: Principal | null, id: string, now: string): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  if (!isDrillId(id)) return drillError("invalid");
  const r = await abandonDrill(db, scope, id, now);
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

/** 訓練記録の一覧の GET（事業所ごと）。now を渡すと先に 24 時間たった進行中を中断にする（T70） */
export async function listGet(db: D1Database, p: Principal | null, now?: string): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const items = await listDrills(db, scope.officeId, 50, now);
  return Response.json(
    {
      ok: true,
      drills: items.map((d) => ({
        id: d.id,
        scenario: d.scenario,
        status: d.status,
        step: d.step,
        hour: d.sim_hour,
        last: lastHour(scenarioOf(d.scenario)),
        startedAt: d.started_at,
        finishedAt: d.finished_at,
        startedBy: d.started_by_name,
        ...(d.abandon_reason ? { abandonReason: d.abandon_reason } : {}),
      })),
    },
    { headers: NO_STORE },
  );
}

/** 再生の読みの GET。step は見る刻み（無ければ今の刻み）。保存した物を読むだけで Claude を呼ばない */
export async function replayGet(db: D1Database, p: Principal | null, id: string, stepParam: string | null): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  if (!isDrillId(id)) return drillError("invalid");
  let want: number | null = null;
  if (stepParam !== null) {
    if (!/^\d{1,3}$/.test(stepParam)) return drillError("invalid");
    want = Number(stepParam);
  }
  const s = await loadDrillScreen(db, scope, id, want);
  if (!s) return drillError("not_found");
  return Response.json(
    {
      ok: true,
      drill: { id: s.drill.id, scenario: s.drill.scenario, status: s.drill.status, step: s.drill.step },
      shown: s.shown,
      hour: s.state.hour,
      minute: s.state.minute,
      actions: s.state.actions,
      hours: s.hours,
      world: s.state.world,
      ticks: s.ticks.map((t) => ({ step: t.step, hour: t.hour, incidents: t.incidents, turns: t.turns })),
      rows: s.rows.map((r) => ({
        person: r.id,
        rank: r.rank,
        color: r.triage?.color ?? null,
        state: r.triage ? COLOR_LABELS[r.triage.color] : null,
        reason: r.triage?.reason ?? null,
      })),
    },
    { headers: NO_STORE },
  );
}
