// T76: AI が止まったとき（鍵なし・上限・失敗）の訓練の表示と、AI の状態の言葉を 1 か所に（docs/progress/qa-20261104.md の高 1・2、中 13）。
// - AI の状態（lib/claude/status.ts・status-read.ts）: 鍵が無ければ回数を読まずに「AI 未設定」、上限なら「AI 上限到達」、ほかは「AI 本日残り N / M 回」
// - 訓練の「AI 停止」の帯 1 本（lib/drill/ai-stop.ts・components/drill/AiStopBand）。刻みごとに積まない。固定の筋は「想定のみ」、仮想は「世界停止」
// - 講評は「AI 停止」と理由（数字はそのまま）、開始の欄は残りと見込みを並べる、印は中立（状態の 4 色を使わない）
// 本物の API は呼ばない（偽の client、node:sqlite）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiStopBand } from "../../components/drill/AiStopBand.tsx";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { ReviewBox } from "../../components/drill/ReviewBox.tsx";
import { Situation } from "../../components/drill/Situation.tsx";
import { StartButtons } from "../../components/drill/StartButtons.tsx";
import { AiStatusMark } from "../../components/ui/AiStatus.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { drillGate, gateUsage } from "../claude/gate.ts";
import { aiRemaining, aiStatusOf, aiStatusText, aiUsable, AI_FAILURE_LABELS, type AiStatus } from "../claude/status.ts";
import { readAiStatus } from "../claude/status-read.ts";
import { d1UsageStore, type AiContext } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { aiStopBand, aiStopParts, aiStopText, isStopIncident, tickStopReason } from "./ai-stop.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill } from "./db.ts";
import type { DrillIncident, Tick } from "./engine.ts";
import { drillHooks, drillStepHooks } from "./hooks.ts";
import { loadDrillRecord } from "./record.ts";
import { EMPTY_WORLD, SCENARIO_ORDER, SCENARIOS } from "./scenarios.ts";
import { REVIEW_ERROR_LABELS } from "./score-labels.ts";
import { loadDrillScreen } from "./view.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const START = "2026-11-05T01:00:00.000Z";
const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});

function fakeClaude(): ClaudeClient {
  return {
    beta: {
      messages: {
        create: async (params: { model: string }) =>
          ({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [{ type: "text", text: "{}", citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }) as unknown as Message,
      },
    },
  } as unknown as ClaudeClient;
}

const aiCtx = (env: AiContext["env"]): AiContext => ({
  env,
  usage: d1UsageStore(db),
  office: { id: DEMO.id, kind: "demo" },
  now: () => new Date(START),
});

async function run(scenario: "short" | "virtual", hooks: ReturnType<typeof drillHooks>, id: string, steps = SCENARIOS[scenario].hours.length - 1) {
  const scope = drillScope(careManager())!;
  expect(await startDrill(db, scope, scenario, START, hooks, () => id)).toEqual({ ok: true, id });
  for (let s = 0; s < steps; s++) expect((await advanceDrill(db, scope, id, s, START, hooks)).ok).toBe(true);
  return scope;
}

const note = (state: "off" | "down", at = 0): DrillIncident => ({ actor: "director", at, change: { kind: "world_note", state }, text: state === "off" ? "停止" : "代替", ai: false });
const stop = (at = 0): DrillIncident => ({ actor: "world", at, change: { kind: "ai_stop", stopped: ["persona"] }, text: "本人役 停止", ai: false });
const narration = (at = 0): DrillIncident => ({ actor: "director", at, change: { kind: "narration", room: "甲地区で増水", via: "oneshot" }, text: "かわなぎ町で増水", ai: true });
const tick = (step: number, hour: number, incidents: DrillIncident[] = []): Tick => ({ step, hour, incidents, turns: [], world: EMPTY_WORLD, finished: false });

// ---------- AI の状態（1 か所で読む） ----------

describe("AI の状態（lib/claude/status.ts）", () => {
  it("鍵なしは回数を読まずに未設定（「AI 残り 200 / 200」と出さない）。上限は 0 の上限も上限到達", async () => {
    expect(await readAiStatus(aiCtx({}))).toEqual({ kind: "unset" });
    expect(await readAiStatus(aiCtx({ ANTHROPIC_API_KEY: "  " }))).toEqual({ kind: "unset" });
    expect(await readAiStatus(aiCtx({ ANTHROPIC_API_KEY: "dummy" }))).toEqual({ kind: "ready", remaining: 200, limit: 200 });
    expect(await readAiStatus(aiCtx({ ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }))).toEqual({ kind: "limit", limit: 0 });
    sqlite.exec(`INSERT INTO ai_calls (id, office_id, purpose, model, day, status, started_at) VALUES
      ('a1', 'office-demo', 'persona', 'm', '2026-11-05', 'ok', '${START}'),
      ('a2', 'office-demo', 'persona', 'm', '2026-11-05', 'pending', '${START}')`);
    expect(await readAiStatus(aiCtx({ ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "5" }))).toEqual({ kind: "ready", remaining: 3, limit: 5 });
    expect(await readAiStatus(aiCtx({ ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2" }))).toEqual({ kind: "limit", limit: 2 });
  });

  it("回数が読めなければ使える（残りなし）。言葉はどの画面も同じ", async () => {
    const broken: AiContext = { ...aiCtx({ ANTHROPIC_API_KEY: "dummy" }), usage: { reserve: async () => true, finish: async () => {}, countDay: async () => Promise.reject(new Error("x")) } };
    expect(await readAiStatus(broken)).toEqual({ kind: "ready", remaining: null, limit: null });
    expect(aiStatusText({ kind: "unset" })).toBe("AI 未設定");
    expect(aiStatusText({ kind: "limit", limit: 200 })).toBe("AI 上限到達");
    expect(aiStatusText({ kind: "ready", remaining: 37, limit: 200 })).toBe("AI 本日残り 37 / 200 回");
    expect(aiStatusText({ kind: "ready", remaining: null, limit: null })).toBe("AI");
    expect(aiUsable({ kind: "limit", limit: 1 })).toBe(false);
    expect(aiRemaining({ kind: "unset" })).toBe(0);
    // 講評の理由も同じ言葉（未設定・上限到達・接続失敗・出力不良）
    expect(REVIEW_ERROR_LABELS).toBe(AI_FAILURE_LABELS);
    expect(new Set(Object.values(AI_FAILURE_LABELS))).toEqual(new Set(["未設定", "上限到達", "接続失敗", "出力不良"]));
  });

  it("開始の欄の切り替え（T26 のまま）: 未設定は開始（固定の筋は想定の表で進む）、上限到達は再生", () => {
    const items = [{ id: "d1", status: "finished" as const }];
    expect(drillGate(gateUsage({ kind: "unset" }), items)).toMatchObject({ kind: "start" });
    expect(drillGate(gateUsage(null), items)).toMatchObject({ kind: "start" });
    expect(drillGate(gateUsage({ kind: "ready", remaining: 37, limit: 200 }), items)).toEqual({ kind: "start", remaining: 37, limit: 200 });
    expect(drillGate(gateUsage({ kind: "limit", limit: 200 }), items)).toEqual({ kind: "limit", remaining: 0, limit: 200, replay: "d1" });
    expect(drillGate(gateUsage({ kind: "limit", limit: 0 }), items)).toMatchObject({ kind: "limit", replay: "d1" });
  });

  it("印は中立の地（状態の 4 色の塗りを使わない）。使えるときは本日残りの薄い文字", () => {
    const unset = renderToStaticMarkup(createElement(AiStatusMark, { status: { kind: "unset" } }));
    expect(unset).toContain("AI 未設定");
    expect(unset).not.toContain("data-tone");
    expect(unset).not.toMatch(/state-(check|urgent|ok|unknown)/);
    expect(renderToStaticMarkup(createElement(AiStatusMark, { status: { kind: "limit", limit: 200 } }))).toContain("AI 上限到達");
    const ready = renderToStaticMarkup(createElement(AiStatusMark, { status: { kind: "ready", remaining: 37, limit: 200 } }));
    expect(ready).toContain("AI 本日残り 37 / 200 回");
    expect(ready).toContain('data-ai-remaining="37"');
    expect(renderToStaticMarkup(createElement(AiStatusMark, { status: { kind: "ready", remaining: null, limit: null } }))).toBe("");
  });
});

// ---------- 開始の欄（残りと見込みを並べる） ----------

describe("開始の欄（components/drill/StartButtons）", () => {
  const people = [
    { id: "n-1", name: "架空 一", canPress: true },
    { id: "n-2", name: "架空 二", canPress: true },
  ];
  const draw = (ai: AiStatus | null) => renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people, ai }));

  it("今日の残りを見込みの行の頭に並べる（足りるかが 1 行で分かる）。超える想定は上限不足、開始は止めない", () => {
    const h = draw({ kind: "ready", remaining: 30, limit: 200 });
    const row = h.slice(h.indexOf("data-estimate"));
    expect(row.indexOf("AI 本日残り 30 / 200 回")).toBeGreaterThan(-1);
    expect(row.indexOf("AI 本日残り 30 / 200 回")).toBeLessThan(row.indexOf("見込み"));
    expect(h).toMatch(/data-estimate-scenario="heavy_rain" data-estimate-calls="\d+" data-over=""/);
    expect(h).toContain("上限不足");
    expect(h).not.toMatch(/data-scenario="[a-z_]+"[^>]*disabled/);
  });

  it("未設定: 「AI 未設定」と、想定ごとの進み方（固定の筋は想定のみ、仮想は世界停止）。回数は出さない。開始は止めない", () => {
    const h = draw({ kind: "unset" });
    expect(h).toContain("AI 未設定");
    expect(h).not.toContain("AI 本日残り");
    expect(h).not.toContain("data-estimate-calls");
    expect(h).not.toContain("上限不足");
    expect(h).toMatch(/data-estimate-scenario="short" data-ai-effect="fixed"[\s\S]*?想定のみ/);
    expect(h).toMatch(/data-estimate-scenario="virtual" data-ai-effect="virtual"[\s\S]*?世界停止/);
    expect(h).not.toMatch(/data-scenario="[a-z_]+"[^>]*disabled/);
    // 中立の印（黄の塗りでない）
    expect(h).not.toMatch(/state-check/);
  });

  it("参加者のいない事業所でも状態は出す", () => {
    const h = renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people: [], ai: { kind: "unset" } }));
    expect(h).toContain("AI 未設定");
  });
});

// ---------- 帯 1 本（刻みの跡と今の状態から） ----------

describe("AI 停止の帯（lib/drill/ai-stop.ts）", () => {
  it("止まった刻みの理由: 上限の印 → 上限到達、世界の停止 → 未設定、世界の失敗（世界の 1 文なし）→ 接続失敗。1 回呼びで動いた代替は止まりでない", () => {
    expect(tickStopReason(tick(0, 0, [stop(), note("down")]))).toBe("limit");
    expect(tickStopReason(tick(0, 0, [note("off")]))).toBe("unset");
    expect(tickStopReason(tick(0, 0, [note("down")]))).toBe("failed");
    expect(tickStopReason(tick(0, 0, [note("down"), narration()]))).toBeNull();
    expect(tickStopReason(tick(0, 0, []))).toBeNull();
    const t = tick(0, 0, [note("down"), narration()]);
    expect(isStopIncident(t.incidents[0], t)).toBe(false);
    expect(isStopIncident(note("off"), tick(0, 0, [note("off")]))).toBe(true);
  });

  it("仮想・鍵なし: 刻みごとに積まず 1 本。最初から止まっているので経過は言わない。戻らない（未設定）", () => {
    const ticks = [0, 1, 3].map((h, i) => tick(i, h, [note("off", h)]));
    const b = aiStopBand(ticks, { virtual: true, running: true, now: { kind: "unset" } })!;
    expect(b).toMatchObject({ reason: "unset", from: 0, to: null, resume: null, whole: true });
    expect(aiStopText(b)).toBe("AI 停止 未設定 世界停止");
  });

  it("固定の筋・鍵なし: 刻みに跡が無くても、進行中は今の状態で帯。「想定のみ」で進む", () => {
    const ticks = [tick(0, 0), tick(1, 3)];
    const b = aiStopBand(ticks, { virtual: false, running: true, now: { kind: "unset" } })!;
    expect(aiStopText(b)).toBe("AI 停止 未設定 想定のみ");
    // 使えるなら帯なし
    expect(aiStopBand(ticks, { virtual: false, running: true, now: { kind: "ready", remaining: 3, limit: 9 } })).toBeNull();
    // 再生（終わった訓練）は今の状態を見ない
    expect(aiStopBand(ticks, { virtual: false, running: false, now: { kind: "unset" } })).toBeNull();
  });

  it("途中で上限: 止まった刻みから「経過 6 時間〜」、日が替われば戻る（翌日再開）。まだ止まった刻みが無ければ「次から」", () => {
    const ticks = [tick(0, 0), tick(1, 3), tick(2, 6, [stop(6)]), tick(3, 9, [stop(9)])];
    const b = aiStopBand(ticks, { virtual: false, running: true, now: { kind: "limit", limit: 200 } })!;
    expect(aiStopText(b)).toBe("AI 停止 上限到達 経過 6 時間〜 想定のみ 翌日再開");
    const next = aiStopBand(ticks.slice(0, 2), { virtual: false, running: true, now: { kind: "limit", limit: 200 } })!;
    expect(aiStopText(next)).toBe("AI 停止 上限到達 次から 想定のみ 翌日再開");
    // 再生は戻り方を言わない
    expect(aiStopText(aiStopBand(ticks, { virtual: false, running: false, now: null })!)).toBe("AI 停止 上限到達 経過 6 時間〜 想定のみ");
  });

  it("仮想・失敗: 次の「進める」で呼び直す（自動再試行）。戻ったら止まった間と「再開済」", () => {
    const ticks = [tick(0, 0, [note("down"), narration()]), tick(1, 1, [note("down", 1)]), tick(2, 3, [note("down", 3)])];
    const b = aiStopBand(ticks, { virtual: true, running: true, now: { kind: "ready", remaining: 50, limit: 200 } })!;
    expect(aiStopText(b)).toBe("AI 停止 接続失敗 経過 1 時間〜 世界停止 自動再試行");
    const back = aiStopBand([...ticks, tick(3, 6, [narration(6)])], { virtual: true, running: true, now: { kind: "ready", remaining: 40, limit: 200 } })!;
    expect(aiStopText(back)).toBe("AI 停止 接続失敗 経過 1〜3 時間 世界停止 再開済");
    expect(aiStopParts(back).effectTitle).toContain("街");
  });

  it("帯の部品: 1 本、色なし（状態の 4 色の塗り・文字を使わない）。無ければ何も描かない", () => {
    const b = aiStopBand([tick(0, 0, [note("off")])], { virtual: true, running: true, now: { kind: "unset" } });
    const h = renderToStaticMarkup(createElement(AiStopBand, { band: b }));
    expect(h.match(/data-ai-stop=/g)).toHaveLength(1);
    expect(h).toContain("AI 停止");
    expect(h).toContain("未設定");
    expect(h).toContain("世界停止");
    expect(h).not.toMatch(/state-|text-danger|data-tone/);
    expect(renderToStaticMarkup(createElement(AiStopBand, { band: null }))).toBe("");
  });
});

// ---------- 本物の engine を通す（偽の client・node:sqlite） ----------

describe("engine を通した訓練（鍵なし・上限）", () => {
  it("仮想・鍵なし: 状況の欄に「世界 停止」を刻みごとに積まず、帯 1 本で「AI 停止 未設定 世界停止」", async () => {
    const hooks = drillStepHooks({ DB: db }, careManager());
    await run("virtual", hooks, "v0", 3);
    const screen = (await loadDrillScreen(db, drillScope(careManager())!, "v0", null))!;
    expect(screen.ticks.length).toBe(4);
    const situation = renderToStaticMarkup(createElement(Situation, { ticks: screen.ticks, names: screen.names, startedAt: START }));
    expect(situation).not.toContain('data-incident="world_note"');
    expect(situation).not.toContain("停止");
    const band = aiStopBand(screen.ticks, { virtual: true, running: true, now: { kind: "unset" } })!;
    expect(aiStopText(band)).toBe("AI 停止 未設定 世界停止");
  });

  it("10 分版・上限 0: 想定の表で最後まで進み、帯は「上限到達 想定のみ」。紙面は刻みごとの「停止」を積まず概要に 1 行、講評は「AI 停止（上限到達）」", async () => {
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }, careManager(), { claude: fakeClaude(), now: () => new Date(START) })!;
    const scope = await run("short", hooks, "s0");
    const row = (await loadDrillRow(db, DEMO.id, "s0"))!;
    expect(row.status).toBe("finished");
    const screen = (await loadDrillScreen(db, scope, "s0", null))!;
    // 表の安否は届いている（固定の筋で進んだ）
    expect(screen.ticks.flatMap((t) => t.turns).length).toBeGreaterThan(0);
    const band = aiStopBand(screen.ticks, { virtual: false, running: false, now: null })!;
    expect(aiStopText(band)).toBe("AI 停止 上限到達 想定のみ");
    const situation = renderToStaticMarkup(createElement(Situation, { ticks: screen.ticks, names: screen.names, startedAt: START }));
    expect(situation).not.toContain("本人役 停止");
    expect(situation).not.toContain("監督 停止");

    const rec = await loadDrillRecord(db, scope, "s0", "2026-11-06T00:00:00.000Z");
    if (!rec || rec === "running") throw new Error("記録が無い");
    const paper = (review: typeof rec.review, ai: AiStatus | null = null) =>
      renderToStaticMarkup(createElement(DrillPaper, { record: { ...rec, review }, office: "デモ事業所", today: "2026-11-06", ai }));
    const m = paper({ state: "failed", error: "limit", at: START });
    expect(m).toMatch(/data-ai-stop="limit"[^>]*>停止 上限到達 想定のみ/);
    expect(m).not.toContain("本人役 停止");
    expect(m).not.toMatch(/状況 0時間 停止/);
    expect(m).toContain("AI 停止（上限到達）");
    // 作っていない講評: 今が未設定なら「AI 停止（未設定）」、わからなければ「講評なし」
    expect(paper(null, { kind: "unset" })).toContain("AI 停止（未設定）");
    expect(paper(null)).toContain('data-review-none="true">講評なし');
  });
});

// ---------- 講評 ----------

describe("講評（components/drill/ReviewBox）", () => {
  const draw = (initial: Parameters<typeof ReviewBox>[0]["initial"], canReview: boolean) =>
    renderToStaticMarkup(createElement(ReviewBox, { drillId: "d1", initial, canReview, names: {} }));

  it("未設定: 呼ばずに「AI 停止」と「未設定」（「講評なし 未設定」でない）。色なし", () => {
    const h = draw(null, false);
    expect(h).toContain("AI 停止");
    expect(h).toContain("未設定");
    expect(h).not.toContain("講評なし");
    expect(h).not.toMatch(/data-tone|state-/);
    expect(h).not.toContain('data-review-action="retry"');
  });

  it("上限・失敗: 「AI 停止」と理由と再作成", () => {
    const limit = draw({ state: "failed", error: "limit", at: START }, true);
    expect(limit).toContain("AI 停止");
    expect(limit).toContain("上限到達");
    expect(limit).toContain('data-review-action="retry"');
    expect(draw({ state: "failed", error: "failed", at: START }, true)).toContain("接続失敗");
    expect(draw({ state: "failed", error: "bad_output", at: START }, true)).toContain("出力不良");
  });
});
