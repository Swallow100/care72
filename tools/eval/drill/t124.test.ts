// T124（docs/tasks/T124.md）: 評価の台の想定の組から 10 分版を外し、既定の組を大雨・地震・仮想に。人の組は既定で種の 10 人全員
// （人数を変える回は --people vary で残す）。偽の client だけ。本物の API は呼ばない。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { caseloadOf, runDrill, seededSqlite } from "./drive.ts";
import { fakeClaude, fakeRoom } from "./fake.ts";
import { planRun, SCENARIOS, type RunPlan } from "./plan.ts";
import { recordClaude, recordRoom, runLog } from "./record.ts";
import { rngOf } from "./rng.ts";
import { parseArgs } from "./run.ts";

const caseload = (() => {
  const s = seededSqlite();
  const c = caseloadOf(s);
  s.close();
  return c;
})();

describe("台の既定の組", () => {
  it("想定の既定は大雨・地震・仮想（10 分版は無く、--scenario short は断る）", () => {
    expect(SCENARIOS).toEqual(["heavy_rain", "earthquake", "virtual"]);
    expect(parseArgs([], {})).toMatchObject({ scenarios: ["heavy_rain", "earthquake", "virtual"], people: "all" });
    expect("error" in parseArgs(["--scenario", "short"], {})).toBe(true);
    expect("error" in parseArgs(["--scenario", "heavy_rain,short"], {})).toBe(true);
  });

  it("人の組の既定は種の 10 人全員。どの種・どの回でも同じ", () => {
    expect(caseload).toHaveLength(SEED_PEOPLE.length);
    expect(SEED_PEOPLE).toHaveLength(10);
    for (const base of ["a", "b", "c"]) {
      for (let i = 1; i <= 8; i++) {
        const plan = planRun(base, i, caseload);
        expect(plan.participants).toEqual(caseload);
        expect(SCENARIOS).toContain(plan.scenario);
      }
    }
  });

  it("--people vary で回ごとに人数を変えられる（既定にはしない）。人の組のほかは同じ種なら同じ回", () => {
    expect(parseArgs(["--people", "vary"], {})).toMatchObject({ people: "vary" });
    expect("error" in parseArgs(["--people", "some"], {})).toBe(true);
    const sizes = new Set<number>();
    for (let i = 1; i <= 12; i++) {
      const all = planRun("vary", i, caseload, SCENARIOS, "all");
      const vary = planRun("vary", i, caseload, SCENARIOS, "vary");
      sizes.add(vary.participants.length);
      expect(vary.participants.every((p) => caseload.includes(p))).toBe(true);
      const { participants: _a, ...restAll } = all;
      const { participants: _v, ...restVary } = vary;
      expect(restVary).toEqual(restAll);
    }
    expect([...sizes].some((n) => n < caseload.length)).toBe(true);
  });
});

describe("台の開始", () => {
  /** 決まった種の回を数回だけ進める */
  async function drive(plan: RunPlan) {
    const log = runLog();
    const claude = recordClaude(fakeClaude({ rng: rngOf(`${plan.seed}/fake`) }), log);
    const room = recordRoom(fakeRoom({ rng: rngOf(`${plan.seed}/room`) }), log);
    const outcome = await runDrill(plan, { client: claude, room, log, key: "fake-key-not-used", world: "session", real: false, maxAdvances: 2, review: false });
    room.finish();
    return { log, outcome };
  }

  it("既定の組の回は連続の時計と手の決まりで始まる（開始の画面と同じ送り方）", async () => {
    const plan = planRun("start", 1, caseload, ["earthquake"]);
    const { log, outcome } = await drive(plan);
    expect(outcome.status).toBe("running");
    const start = log.records.find((r) => r.type === "op" && r.op === "start" && r.phase !== "end") as { req?: { options?: Record<string, unknown> } } | undefined;
    expect(start?.req?.options).toMatchObject({ participants: caseload, clock: true, terms: true });
    expect(outcome.terms).toBe(true);
  });

  it("10 分版を無理に渡しても開始の API が断り、訓練は始まらない", async () => {
    const plan = { ...planRun("start", 2, caseload, ["heavy_rain"]), scenario: "short" } as unknown as RunPlan;
    const { outcome } = await drive(plan);
    expect(outcome.status).toBe("not_started");
    expect(outcome.ops.find((o) => o.op === "start")).toMatchObject({ status: 400, ok: false });
  });
});
