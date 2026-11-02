// 訓練の API（app/api/drill/）の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
// 断り方: ログインしていなければ 401、ケアマネの役でなければ 403（行政・医療班・本人・家族・役を選ぶ前の審査員）、
// 形が違う 400、事業所の外・無い訓練 404、進行中があるのに開始 409、読んだ刻みと違う 409、終わった訓練を進める 409。
// 1 要求で進めるのは 1 刻みだけ（早送りもブラウザから 1 刻みずつ呼ぶ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { COLOR_LABELS } from "../labels.ts";
import {
  abandonDrill,
  advanceDrill,
  drillScope,
  isDrillScenario,
  listDrills,
  startDrill,
  type DrillScope,
} from "./db.ts";
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

/** 開始の POST（JSON）。{ scenario: heavy_rain・earthquake・short } */
export async function startPost(db: D1Database, p: Principal | null, json: unknown, now: string, hooks?: StepHooks): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const b = obj(json);
  if (!b || !isDrillScenario(b.scenario)) return drillError("invalid");
  const r = await startDrill(db, scope, b.scenario, now, hooks);
  if (!r.ok) return drillError(r.error === "running" ? "running" : "not_found");
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

/** 中断の POST */
export async function abandonPost(db: D1Database, p: Principal | null, id: string, now: string): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  if (!isDrillId(id)) return drillError("invalid");
  const r = await abandonDrill(db, scope, id, now);
  if (!r.ok) return drillError(r.error);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

/** 訓練記録の一覧の GET（事業所ごと） */
export async function listGet(db: D1Database, p: Principal | null): Promise<Response> {
  const scope = gate(p);
  if (scope instanceof Response) return scope;
  const items = await listDrills(db, scope.officeId);
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
