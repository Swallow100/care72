import { describe, expect, it } from "vitest";
import type { AiCallRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { AiLimitReached } from "./errors.ts";
import { beginCall, d1UsageStore, dailyLimit, DEFAULT_DAILY_LIMIT, usageToday, type AiContext } from "./usage.ts";

function setup(env: AiContext["env"] = {}) {
  const db = migratedSqlite();
  db.exec(`INSERT INTO offices (id, name, kind, city) VALUES
    ('office-demo', 'デモ事業所', 'demo', '松山市'),
    ('office-b', '協力事業所', 'regular', '松山市')`);
  let now = new Date("2026-11-02T03:00:00.000Z"); // JST 11/2 12:00
  const ctx = (officeId: string, kind: "demo" | "regular" = "demo"): AiContext => ({
    env,
    usage: d1UsageStore(d1FromSqlite(db)),
    office: { id: officeId, kind },
    now: () => now,
  });
  const rows = () => db.prepare("SELECT * FROM ai_calls ORDER BY started_at, id").all() as unknown as AiCallRow[];
  return { db, ctx, rows, setNow: (d: string) => (now = new Date(d)) };
}

describe("1 日の上限", () => {
  it("既定は 200 回。デモ事業所だけ AI_DAILY_LIMIT で変えられる", () => {
    expect(DEFAULT_DAILY_LIMIT).toBe(200);
    expect(dailyLimit({ kind: "demo" }, {})).toBe(200);
    expect(dailyLimit({ kind: "demo" }, { AI_DAILY_LIMIT: "30" })).toBe(30);
    expect(dailyLimit({ kind: "demo" }, { AI_DAILY_LIMIT: " 0 " })).toBe(0);
    expect(dailyLimit({ kind: "regular" }, { AI_DAILY_LIMIT: "30" })).toBe(200);
  });

  it("整数でない値は既定のまま", () => {
    for (const v of ["", "abc", "-1", "1.5", "1e3"]) expect(dailyLimit({ kind: "demo" }, { AI_DAILY_LIMIT: v })).toBe(200);
  });

  it("上限まで呼べて、超えると AiLimitReached。行は足さない", async () => {
    const { ctx, rows } = setup({ AI_DAILY_LIMIT: "2" });
    const c = ctx("office-demo");
    await (await beginCall(c, "classify", "claude-haiku-5-5")).ok({ model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 3 });
    await (await beginCall(c, "persona", "claude-haiku-5-5")).fail("api_error");
    const err = await beginCall(c, "classify", "claude-haiku-5-5").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiLimitReached);
    expect(err).toMatchObject({ officeId: "office-demo", limit: 2, day: "2026-11-02" });
    expect(rows()).toHaveLength(2);
  });

  it("上限が 0 なら 1 回目から止まる", async () => {
    const { ctx, rows } = setup({ AI_DAILY_LIMIT: "0" });
    await expect(beginCall(ctx("office-demo"), "classify", "claude-haiku-5-5")).rejects.toBeInstanceOf(AiLimitReached);
    expect(rows()).toHaveLength(0);
  });

  it("事業所ごと・JST の日ごとに数える", async () => {
    const { ctx, setNow } = setup({ AI_DAILY_LIMIT: "1" });
    await beginCall(ctx("office-demo"), "classify", "claude-haiku-5-5");
    // 協力事業所は既定の 200 で、デモの分は数えない
    await beginCall(ctx("office-b", "regular"), "classify", "claude-haiku-5-5");
    await expect(beginCall(ctx("office-demo"), "classify", "claude-haiku-5-5")).rejects.toBeInstanceOf(AiLimitReached);
    // UTC では 11/2 だが JST では 11/3 になる時刻
    setNow("2026-11-02T15:00:00.000Z");
    await expect(beginCall(ctx("office-demo"), "classify", "claude-haiku-5-5")).resolves.toMatchObject({ day: "2026-11-03" });
    expect(await usageToday(ctx("office-demo"))).toEqual({ day: "2026-11-03", used: 1, limit: 1 });
  });
});

describe("ai_calls の行", () => {
  it("事業所・用途・モデル・日・状態・token・時刻だけを残す（本文の列は無い）", async () => {
    const { ctx, rows, setNow } = setup();
    const t = await beginCall(ctx("office-demo"), "director", "claude-opus-5-5");
    expect(rows()[0]).toMatchObject({ status: "pending", model: "claude-opus-5-5", finished_at: null });
    setNow("2026-11-02T03:00:05.000Z");
    await t.ok({ model: "claude-opus-5", inputTokens: 1200, outputTokens: 340 });
    expect(rows()).toEqual([
      {
        id: t.id,
        office_id: "office-demo",
        purpose: "director",
        model: "claude-opus-5", // 答えたモデル（fallback に回った先）
        day: "2026-11-02",
        status: "ok",
        error: null,
        input_tokens: 1200,
        output_tokens: 340,
        started_at: "2026-11-02T03:00:00.000Z",
        finished_at: "2026-11-02T03:00:05.000Z",
      },
    ]);
  });

  it("失敗は理由の分け方だけ残す", async () => {
    const { ctx, rows } = setup();
    const t = await beginCall(ctx("office-demo"), "classify", "claude-haiku-5-5");
    await t.fail("bad_output", { model: "claude-haiku-5-5", inputTokens: 50, outputTokens: 20 });
    expect(rows()[0]).toMatchObject({ status: "failed", error: "bad_output", input_tokens: 50, output_tokens: 20 });
  });

  it("終わりを書けなくても、呼び出しの結果は捨てない", async () => {
    const { ctx } = setup();
    const c = ctx("office-demo");
    const broken: AiContext = {
      ...c,
      usage: { ...c.usage, finish: async () => Promise.reject(new Error("D1 が落ちた")) },
    };
    const t = await beginCall(broken, "classify", "claude-haiku-5-5");
    await expect(t.ok({ model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 1 })).resolves.toBeUndefined();
  });
});
