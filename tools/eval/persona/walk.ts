// 1 筋を歩く（docs/tasks/T156.md）。読む → 目標の印を確かめる → 門 → 使う人の AI に次の 1 手を聞く → 打つ → 読み直す、を手の上限まで。
// 目標は順に 1 つずつ。今の目標の印が立てば次へ（手を打つ前に立っていれば 0 手で済み）。あきらめた・目標の手の上限で次へ。

import { join } from "node:path";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { nextMove } from "./actor.ts";
import { isDone } from "./check.ts";
import { screenGate } from "./guard.ts";
import type { GoalResult } from "./judge.ts";
import { lostOf } from "./lost.ts";
import { shortestOf, type Persona } from "./personas.ts";
import type { Secrets, Surface } from "./surface.ts";
import type { LostEvent, Move, Snapshot, StepRecord } from "./types.ts";

export type WalkLimits = {
  /** 1 筋の手の上限 */
  maxSteps: number;
  /** 1 つの目標の手の上限 */
  goalSteps: number;
  /** 1 筋の時間の上限（ミリ秒） */
  maxMs: number;
};

export const DEFAULT_LIMITS: WalkLimits = { maxSteps: 40, goalSteps: 15, maxMs: 15 * 60_000 };

export type WalkDeps = {
  surface: Surface;
  client: ClaudeClient;
  secrets: Secrets;
  loginId: string;
  limits: WalkLimits;
  /** 手ごとの写真の置き場（null なら撮らない） */
  shots: string | null;
  /** 次の手を打ってよいか（費用の上限） */
  budgetOk: () => boolean;
  clock?: () => number;
  say?: (line: string) => void;
};

export type StopReason = "all" | "steps" | "time" | "budget" | "gate" | "ai" | "open";

export type WalkOutcome = {
  persona: Persona["id"];
  goals: GoalResult[];
  steps: StepRecord[];
  lost: LostEvent[];
  stop: StopReason;
  /** 止めた理由の短い文（門・AI の失敗） */
  note: string | null;
  /** 筋の forbid に当たった物（出てはいけない物が画面に出た。T172）。同じ物は 1 回 */
  forbidden: string[];
  ms: number;
};

/**
 * 今の画面が筋の forbid に当たる物の why（T172）。押せる物は名前の頭で、文は画面の文で見る。
 * near（T173）は読みの頭に無い物。開いた窓の間は読みが窓の中だけなので見ない
 */
export function forbiddenOf(persona: Pick<Persona, "forbid" | "near">, snap: Pick<Snapshot, "path" | "text" | "items">): string[] {
  const hit = (persona.forbid ?? []).flatMap((f) => {
    if (!new RegExp(f.path).test(snap.path)) return [];
    const byItem = f.item !== undefined && snap.items.some((i) => i.name.startsWith(f.item as string));
    const byText = f.text !== undefined && snap.text.includes(f.text);
    return byItem || byText ? [f.why] : [];
  });
  const windowOpen = snap.items.some((i) => i.zone?.startsWith("窓"));
  const far = windowOpen
    ? []
    : (persona.near ?? []).flatMap((f) => {
        if (!new RegExp(f.path).test(snap.path)) return [];
        return snap.items.slice(0, f.within).some((i) => i.name.startsWith(f.item)) ? [] : [f.why];
      });
  return [...hit, ...far];
}

export async function walkPersona(persona: Persona, deps: WalkDeps): Promise<WalkOutcome> {
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const say = deps.say ?? (() => {});
  const maxSteps = persona.maxSteps ?? deps.limits.maxSteps;
  const goals: GoalResult[] = persona.goals.map((g) => ({ id: g.id, text: g.text, reached: false, reachedAt: null, steps: 0, shortest: shortestOf(g), gaveUp: false, timedOut: false }));
  const steps: StepRecord[] = [];
  const timeouts: LostEvent[] = [];
  let stop: StopReason = "steps";
  let note: string | null = null;
  let gi = 0;

  if (persona.prelogin) {
    const ok = await deps.surface.login(deps.loginId, deps.secrets);
    if (!ok) {
      return { persona: persona.id, goals, steps, lost: [], stop: "open", note: "ログインできない（CARE72_PASSWORD と種のハッシュ）", forbidden: [], ms: clock() - t0 };
    }
  }
  // 筋の前の下ごしらえ（T163）: 医療班の筋は事業所の「発災開始」で種の受入依頼が入った形から
  if (persona.setup === "disaster" && !(await deps.surface.startDisaster())) {
    return { persona: persona.id, goals, steps, lost: [], stop: "open", note: "発災開始を流せない（種の事業所・ケアマネの役で入る）", forbidden: [], ms: clock() - t0 };
  }
  await deps.surface.open(persona.start);
  let snap: Snapshot = await deps.surface.snapshot();
  const forbidden = new Set<string>(forbiddenOf(persona, snap));

  /** 今の目標の印が立っている間、次の目標へ */
  const advance = (at: number): string[] => {
    const hit: string[] = [];
    while (gi < goals.length && isDone(persona.goals[gi].done, snap)) {
      goals[gi].reached = true;
      goals[gi].reachedAt = at;
      hit.push(goals[gi].id);
      gi += 1;
    }
    return hit;
  };
  advance(0);

  for (let n = 1; n <= maxSteps; n++) {
    if (gi >= goals.length) {
      stop = "all";
      break;
    }
    if (clock() - t0 > deps.limits.maxMs) {
      stop = "time";
      break;
    }
    if (!deps.budgetOk()) {
      stop = "budget";
      break;
    }
    const gate = screenGate(snap);
    if (!gate.ok) {
      stop = "gate";
      note = `門で止めた（${gate.why}、${snap.path}）`;
      break;
    }
    const g = goals[gi];
    if (g.steps >= deps.limits.goalSteps) {
      g.timedOut = true;
      const last = steps[steps.length - 1];
      timeouts.push({ kind: "timeout", step: last?.n ?? n, goal: g.id, path: snap.path, target: null, thought: null, note: `目標の手の上限 ${deps.limits.goalSteps}` });
      gi += 1;
      continue;
    }

    let move: Move;
    try {
      move = await nextMove(deps.client, { persona, goal: persona.goals[gi], reached: goals.filter((x) => x.reached).map((x) => x.text), left: goals.length - gi - 1, steps, page: snap });
    } catch (e) {
      stop = "ai";
      note = `使う人の AI が答えない（${e instanceof Error ? e.name : "Error"}）`;
      break;
    }
    const t1 = clock();
    const item = move.ref !== null ? (snap.items.find((i) => i.ref === move.ref) ?? null) : null;
    const before = { path: snap.path, hash: snap.hash, look: snap.look, title: snap.title, alerts: snap.alerts };
    const needsRef = move.action === "click" || move.action === "type" || move.action === "select";
    const result = needsRef && !item ? { ok: false, error: `番号 ${move.ref ?? "なし"} は画面に無い` } : await deps.surface.act(move, deps.secrets);
    snap = await deps.surface.snapshot();
    for (const why of forbiddenOf(persona, snap)) forbidden.add(why);
    g.steps += 1;
    let shot: string | null = null;
    if (deps.shots) {
      const file = join(deps.shots, `step-${String(n).padStart(2, "0")}.png`);
      if (await deps.surface.shot(file)) shot = file;
    }
    const reached = advance(n);
    const rec: StepRecord = {
      n,
      goal: g.id,
      before,
      move,
      target: item ? { name: item.name, role: item.role, ...(item.zone ? { zone: item.zone } : {}) } : null,
      result,
      after: { path: snap.path, hash: snap.hash, look: snap.look, title: snap.title, alerts: snap.alerts, errors: snap.errors },
      reached,
      shot,
      ms: clock() - t1,
    };
    steps.push(rec);
    say(`  ${String(n).padStart(2)} ${g.id} ${move.action}${item ? ` 「${item.name}」` : ""} → ${snap.path}${reached.length ? `（達成 ${reached.join("・")}）` : ""}`);
    if (move.action === "give_up" && !reached.includes(g.id) && gi < goals.length && goals[gi].id === g.id) {
      g.gaveUp = true;
      gi += 1;
    }
  }
  if (gi >= goals.length) stop = "all";
  if (stop !== "all" && gi < goals.length && !goals[gi].reached && !goals[gi].gaveUp) {
    goals[gi].timedOut = true;
    const last = steps[steps.length - 1];
    timeouts.push({ kind: "timeout", step: last?.n ?? 0, goal: goals[gi].id, path: snap.path, target: null, thought: null, note: stop === "steps" ? `筋の手の上限 ${maxSteps}` : stop === "time" ? "筋の時間の上限" : stop === "budget" ? "費用の上限" : (note ?? stop) });
  }
  await deps.surface.end();
  return { persona: persona.id, goals, steps, lost: [...lostOf(steps), ...timeouts].sort((a, b) => a.step - b.step), stop, note, forbidden: [...forbidden], ms: clock() - t0 };
}
