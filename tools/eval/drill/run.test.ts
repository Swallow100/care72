// 評価の台（docs/tasks/T108.md）の通しのテスト。偽の client と偽の部屋で数回回し、記録・まとめ・差の 1 行・md を確かめる。
// 本物の API は呼ばない。手元の D1（node:sqlite）だけ。記録は一時のフォルダに書いて消す。

import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";
import { afterAll, describe, expect, it } from "vitest";
import { askJson } from "../../../lib/claude/call.ts";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { PERSONA_SYSTEM } from "../../../lib/drill/persona.ts";
import { pseudonymizeText, pseudonymize } from "../../../lib/pseudonym/index.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { checkRun } from "./checks.ts";
import { caseloadOf, runDrill, seededSqlite } from "./drive.ts";
import { fakeClaude, fakeRoom, NOISE_WORDS } from "./fake.ts";
import { memoryUsage } from "./judge.ts";
import { planRun, type RunPlan } from "./plan.ts";
import { recordClaude, recordRoom, runLog, type AiRecord } from "./record.ts";
import { rngOf } from "./rng.ts";
import { checkContext, parseArgs, runEval, SEED_SOURCES, type EvalConfig } from "./run.ts";

const tmp = mkdtempSync(join(tmpdir(), "t108-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** 訓練を最後まで回すテストの待ち（PC が混んでいると既定の 20 秒を超える） */
const SLOW = 240_000;

const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

/** 人の値（氏名・カナ・町名・電話・避難先）。md に出てはいけない */
const PERSONAL = [
  ...SEED_PEOPLE.flatMap((p) => [p.person.name, p.person.kana, p.ledger.basic.address?.town ?? ""]),
  ...SEED_PEOPLE.flatMap((p) => p.contacts.flatMap((c) => [c.name ?? "", c.phone ?? ""])),
].filter((x) => x.trim().length >= 2);

const config = (over: Partial<EvalConfig>): EvalConfig => ({
  runs: 3,
  seed: "unit",
  real: false,
  key: "fake-key-not-used",
  world: "session",
  scenarios: ["short", "virtual"],
  judge: 1,
  review: false,
  maxAdvances: 8,
  out: join(tmp, "out"),
  md: join(tmp, "md"),
  noise: 0,
  maxUsd: null,
  terms: true,
  say: () => {},
  ...over,
});

describe("通し（偽の client）", () => {
  it("回ごとに JSON Lines（起きた順）とまとめを外に書き、md は数だけ。同じ種でもう一度回すと差の 1 行が前回比になり、選び方が同じ", async () => {
    const first = await runEval(config({ stamp: "20261105-000000-fake" }));
    const files = readdirSync(first.dir).sort();
    expect(files).toEqual(["run-01.jsonl", "run-02.jsonl", "run-03.jsonl", "summary.json"]);
    const recs = lines(join(first.dir, "run-01.jsonl"));
    expect(recs.map((r) => r.seq)).toEqual(recs.map((_, i) => i + 1));
    const types = new Set(recs.map((r) => r.type));
    for (const t of ["run", "op", "state", "ai", "end", "numbers", "judge"]) expect(types).toContain(t);
    // AI の 1 回: 役・モデル・effort・送った中身の全文・返った中身の全文・時間・token・費用・再試行
    const call = recs.find((r) => r.type === "ai" && r.role === "persona") as unknown as AiRecord;
    expect(call).toMatchObject({ model: "claude-haiku-5-5", effort: "medium", retries: 0, error: null, parsed: true });
    expect(call.sent.system.length).toBeGreaterThan(1);
    expect(call.sent.user).toContain("本人役");
    expect(call.returned!.text.startsWith("{")).toBe(true);
    expect(call.usage!.input).toBeGreaterThan(0);
    expect(call.costUsd).toBeGreaterThan(0);
    // 刻みの記録: 時刻・世界・左の表・新しい刻み（出来事と安否）
    const state = recs.find((r) => r.type === "state" && Array.isArray(r.ticks) && (r.ticks as unknown[]).length > 0)!;
    expect(state).toHaveProperty("minute");
    expect(state).toHaveProperty("staff");
    expect(state).toHaveProperty("world");
    expect(state).toHaveProperty("rows");

    const summary = JSON.parse(readFileSync(join(first.dir, "summary.json"), "utf8"));
    expect(summary).toMatchObject({ version: 1, client: "fake", seed: "unit" });
    expect(summary.runs).toHaveLength(3);
    expect(first.line.startsWith("初回（偽")).toBe(true);
    expect(summary.judge[0].scores.realism).toBeGreaterThanOrEqual(1);

    const md = readFileSync(first.mdPath!, "utf8");
    expect(md).toContain("| 項目 | 前回 | 今回 | 差 |");
    expect(md).toContain("偽の client");
    for (const x of PERSONAL) expect(md).not.toContain(x);

    const second = await runEval(config({ stamp: "20261105-000100-fake" }));
    expect(second.line).toMatch(/^前回比（偽、20261105-000000-fake→20261105-000100-fake）/);
    expect(second.summary.runs.map((r) => [r.scenario, r.participants, r.scale])).toEqual(first.summary.runs.map((r) => [r.scenario, r.participants, r.scale]));
    expect(second.summary.diversity.kinds.byKind).toEqual(first.summary.diversity.kinds.byKind);
    expect(readFileSync(second.mdPath!, "utf8")).toContain("20261105-000000-fake（3 回）");

    // 種が違えば選び方が変わる（種は回ごとに変える）
    const other = await runEval(config({ seed: "unit-2", stamp: "20261105-000200-fake", md: null, judge: 0, maxAdvances: 2 }));
    expect(other.summary.runs.map((r) => r.seed)).not.toEqual(first.summary.runs.map((r) => r.seed));
  }, SLOW);

  it("世界の部屋の Agent と Environment は最初の回で作り、あとの回は同じ物を使う", async () => {
    const r = await runEval(config({ runs: 2, scenarios: ["virtual"], stamp: "20261105-000400-fake", out: join(tmp, "out-room"), md: null, judge: 0, maxAdvances: 3 }));
    const ops = (n: number) => lines(join(r.dir, `run-0${n}.jsonl`)).filter((x) => x.type === "room_agent").map((x) => x.op);
    expect(ops(1)).toEqual(["create"]);
    expect(ops(2)).toEqual(["reuse"]);
    // 使い回した回の部屋の行にも、モデルと effort が残る（その回の記録だけで読める）
    const room = lines(join(r.dir, "run-02.jsonl")).find((x) => x.type === "ai" && x.role === "world_room")!;
    expect(room).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
    const reuse = lines(join(r.dir, "run-02.jsonl")).find((x) => x.type === "room_agent")!;
    expect(String(reuse.system)).toContain("世界");
  }, SLOW);

  it("本物の client（--real）と偽の回は比べない", async () => {
    const r = await runEval(config({ runs: 1, scenarios: ["short"], stamp: "20261105-000300-fake", out: join(tmp, "out-cmp"), md: null, judge: 0 }));
    expect(r.line.startsWith("初回")).toBe(true);
  }, SLOW);
});

/** 手と通話が多い回の選び方（決まった種で） */
function busyPlan(over: Partial<RunPlan>): RunPlan {
  const s = seededSqlite();
  const caseload = caseloadOf(s);
  s.close();
  return { ...planRun("busy", 1, caseload, ["heavy_rain"]), actRate: 1, actMax: 3, freeRate: 0, talkRate: 1, probeRate: 0, followRank: 0.5, ...over };
}

async function drive(plan: RunPlan, noise = 0) {
  const log = runLog();
  const claude = recordClaude(fakeClaude({ rng: rngOf(`${plan.seed}/fake`), noise }), log);
  const room = recordRoom(fakeRoom({ rng: rngOf(`${plan.seed}/room`), noise }), log);
  const outcome = await runDrill(plan, { client: claude, room, log, key: "fake-key-not-used", world: "session", real: false, maxAdvances: 6, review: false });
  room.finish();
  return { log, outcome, ...checkRun(log.records, outcome, checkContext()) };
}

describe("手・往復・仮名化の門の試し", () => {
  it("通話に出たら往復し（本人役の往復の呼び出し）、切る", async () => {
    const { log, outcome } = await drive(busyPlan({}));
    expect(outcome.ops.some((o) => o.op === "talk" && o.ok)).toBe(true);
    expect(outcome.ops.some((o) => o.op === "talk_end" && o.ok)).toBe(true);
    expect(log.records.some((r) => r.type === "ai" && r.role === "persona_talk")).toBe(true);
  }, SLOW);

  it("自由文に本人の氏名を混ぜても、送った中身に氏名は無い（門が伏せる）", async () => {
    const { log, outcome, numbers, hits } = await drive(busyPlan({ freeRate: 1, probeRate: 1, talkRate: 0, scenario: "short" }));
    const probes = outcome.ops.filter((o) => o.op === "act_probe");
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((o) => o.ok)).toBe(true);
    expect(log.records.some((r) => r.type === "ai" && r.role === "free")).toBe(true);
    expect(numbers.leaks).toBe(0);
    expect(hits.filter((h) => h.check === "leak")).toEqual([]);
    const sent = log.records.filter((r) => r.type === "ai").map((r) => (r as AiRecord).sent.user).join("\n");
    for (const name of Object.values(outcome.names)) expect(sent).not.toContain(name);
  }, SLOW);

  it("偽の返事に決まりを破る言葉を混ぜると、生の返事の禁じた中身と形の失敗を拾う", async () => {
    const { numbers, hits } = await drive(busyPlan({ scenario: "short", talkRate: 0 }), 1);
    expect(numbers.banned.raw).toBeGreaterThan(0);
    expect(hits.some((h) => h.check === "banned" && h.where === "raw" && NOISE_WORDS.some((w) => h.evidence.includes(Array.from(w).slice(0, 4).join(""))))).toBe(true);
  }, SLOW);
});

describe("記録の層", () => {
  const params = (system: string) =>
    ({
      model: "claude-haiku-5-5",
      max_tokens: 100,
      system: [{ type: "text", text: "共通" }, { type: "text", text: system }],
      messages: [{ role: "user", content: '{"x":1}' }],
      output_config: { effort: "medium" },
    }) as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
  const ok = (text: string) =>
    ({
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text, citations: null }],
      stop_reason: "end_turn",
      stop_details: null,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }) as unknown as Anthropic.Beta.Messages.BetaMessage;

  it("つながらない失敗は要求の回数だけ送り直して数え、成功を 1 行に。送り直さない失敗は記録して投げ直す", async () => {
    let n = 0;
    const inner: ClaudeClient = {
      beta: {
        messages: {
          create: async () => {
            n += 1;
            if (n === 1) throw new Anthropic.APIConnectionError({ message: "切れた" });
            if (n === 3) throw new Error("知らない");
            return ok('{"speech":"はい"}');
          },
        },
      },
    };
    const log = runLog();
    const c = recordClaude(inner, log, { sleep: async () => {} });
    await c.beta.messages.create(params(PERSONA_SYSTEM), { maxRetries: 1 });
    await expect(c.beta.messages.create(params(PERSONA_SYSTEM), { maxRetries: 1 })).rejects.toThrow("知らない");
    const [a, b] = log.records as AiRecord[];
    expect(a).toMatchObject({ role: "persona", retries: 1, error: null, parsed: true, effort: "medium", usage: { input: 1000, output: 200 } });
    expect(a.attempts.map((x) => x.error)).toEqual(["APIConnectionError", null]);
    expect(a.costUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / 1e6);
    expect(b).toMatchObject({ role: "persona", error: "Error", returned: null });
  });

  it("askJson を通した物は仮名化のあとの中身が残る（台帳の名前は無い）", async () => {
    const log = runLog();
    const claude = recordClaude(fakeClaude({ rng: rngOf("x") }), log);
    const { key } = pseudonymize(SEED_SOURCES);
    const text = pseudonymizeText(`${SEED_PEOPLE[0].person.name}が電話した`, key);
    await askJson(
      { purpose: "persona", system: PERSONA_SYSTEM, input: { 本人役: text, この刻み: text }, schema: z.object({ speech: z.string() }) },
      { env: { ANTHROPIC_API_KEY: "x" }, usage: memoryUsage(), office: { id: "office-demo", kind: "demo" }, claude },
    );
    const r = log.records[0] as AiRecord;
    expect(r.role).toBe("persona");
    expect(r.sent.user).toContain("A さん");
    expect(r.sent.user).not.toContain(SEED_PEOPLE[0].person.name);
  });

  it("世界の部屋: 刻みの文 1 つと返った world_step を 1 行に", async () => {
    const log = runLog();
    const room = recordRoom(fakeRoom({ rng: rngOf("room") }), log);
    await room.agents.create({ model: { id: "claude-opus-5-5", effort: "high" }, system: "部屋" });
    const s = await room.sessions.create({});
    const sent = await room.sessions.send(s.id, [{ type: "user.message", content: [{ type: "text", text: "地区（1）:\n- 甲地区: 低い土地\n時刻: 発災から 0 時間" }] }]);
    const evs = await room.sessions.list(s.id, new Date().toISOString());
    const tool = evs.find((e) => e.type === "agent.custom_tool_use" && !sent.ids.includes(e.id))!;
    await room.sessions.send(s.id, [{ type: "user.custom_tool_result", custom_tool_use_id: tool.id, content: [{ type: "text", text: "受け取った" }] }]);
    await room.sessions.list(s.id, new Date().toISOString());
    const rec = log.records.find((r) => r.type === "ai") as AiRecord;
    expect(rec).toMatchObject({ role: "world_room", model: "claude-opus-5-5", effort: "high", error: null, costUsd: null });
    expect(rec.sent.user).toContain("甲地区");
    expect(JSON.parse(rec.returned!.text)[0]).toHaveProperty("narration");
  });
});

describe("引数", () => {
  it("既定は偽の client・4 回・部屋。--real は環境変数の鍵が無ければ断る", () => {
    const d = parseArgs([], {});
    expect(d).toMatchObject({ runs: 4, real: false, world: "session", judge: 2, review: false, maxUsd: null });
    expect("error" in parseArgs(["--real"], {})).toBe(true);
    expect(parseArgs(["--real", "--runs", "2"], { ANTHROPIC_API_KEY: "k" })).toMatchObject({ real: true, runs: 2, maxUsd: 10, key: "k" });
    expect(parseArgs(["--scenario", "virtual,short", "--seed", "abc", "--no-md"], {})).toMatchObject({ scenarios: ["virtual", "short"], seed: "abc", md: null });
    expect("error" in parseArgs(["--scenario", "fire"], {})).toBe(true);
    expect("error" in parseArgs(["--noise", "2"], {})).toBe(true);
  });
});

describe("T118: 台が見つけた穴が直っていることを、台で確かめる", () => {
  it("偽の返事に決まりを破る言葉を混ぜても、画面に出た物（刻み・通話・往復・訪問）には残らない", async () => {
    const { numbers, hits } = await drive(busyPlan({ talkRate: 1 }), 1);
    expect(numbers.banned.raw).toBeGreaterThan(0);
    const shown = hits.filter((h) => h.check === "banned" && h.where === "shown" && !h.rule.startsWith("personal:避難先"));
    expect(shown.map((h) => `${h.rule} ${h.evidence}`)).toEqual([]);
  }, SLOW);

  it("通話の最初の言葉と訪問の本人役も 1 訓練の数えに入り、ai_calls と同じ数（数えに入らない呼び出し 0）", async () => {
    const { log, numbers, hits } = await drive(busyPlan({ actMax: 3, talkRate: 0 }));
    const roles = new Set(log.records.filter((r) => r.type === "ai").map((r) => (r as AiRecord).role));
    expect(roles.has("persona_call")).toBe(true);
    expect(numbers.budget.uncounted).toBe(0);
    expect(hits.filter((h) => h.check === "budget")).toEqual([]);
  }, SLOW);

  it("門の試しに和暦の生年月日（T107 の入力と同じ形）を混ぜても、送った中身に残らない", async () => {
    const { log, outcome, numbers } = await drive(busyPlan({ freeRate: 1, probeRate: 1, talkRate: 0, scenario: "short" }));
    const probes = outcome.ops.filter((o) => o.op === "act_probe");
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((o) => o.ok)).toBe(true);
    const sent = log.records.filter((r) => r.type === "ai").map((r) => (r as AiRecord).sent.user).join("\n");
    expect(sent).toContain("（生年月日）");
    expect(sent).not.toMatch(/昭和[0-9]+年[0-9]+月[0-9]+日/);
    expect(numbers.leaks).toBe(0);
  }, SLOW);
});
