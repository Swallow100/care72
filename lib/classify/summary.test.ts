// 録音のまとめ（docs/tasks/T69b.md の 4）。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 線: 本人の元の言葉と必ず並べる、色と連絡順に使わない、言った事の言い換えだけ（禁じる語を足さない）、AI の印、人が直せる、
// 仮名化の門を通す（伏せた文だけ。位置・避難先の名前は渡さない）、分類と並べて 1 回ずつ（片方が失敗してももう片方は残る）。

import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { Summary } from "../../components/list/Summary.tsx";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, PURPOSES, RECORDING_SUMMARY, SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { SignalRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import type { SignalForTriage } from "../disaster/triage.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { pseudonymize, pseudonymizeText, type ClaudePerson, type PseudonymInput } from "../pseudonym/index.ts";
import { NO_ANSWERS } from "../signals/body.ts";
import { locationPost, recordingPost, type AttachedRecording } from "../signals/http.ts";
import { saveAnswers, saveSignal, signalScope } from "../signals/save.ts";
import type { TriageSignal } from "../triage/index.ts";
import type { ClassifySource } from "./classify.ts";
import { CLASSIFY_SYSTEM } from "./prompt.ts";
import type { ClassifyDeps } from "./store.ts";
import { afterRecording, summaryPost } from "./summary-http.ts";
import {
  buildSummaryRequest,
  normalizeSummary,
  summarize,
  summarizeSignal,
  SUMMARY_MAX,
  SUMMARY_SYSTEM,
  type SummaryInput,
} from "./summary.ts";
import { summaryOf } from "./view.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type Options = { timeout?: number; maxRetries?: number };

// ---------- 偽の Claude ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

const isSummary = (p: Params) => JSON.stringify(p.system).includes("ケアマネが 5 秒で読める");

/** 用途で答えを分ける偽物。summary・classify の返事を渡す（関数なら呼ぶ） */
function fake(answers: { summary?: () => unknown; classify?: () => unknown }) {
  const calls: Array<{ params: Params; options: Options }> = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params, options) => {
          calls.push({ params, options: options as Options });
          const a = isSummary(params) ? answers.summary : answers.classify;
          const v = a ? await a() : { categories: ["unknown"], confidence: 0.9, quote: "" };
          if (v instanceof Error) throw v;
          return reply(v);
        },
      },
    },
  };
  return { client, calls };
}

// ---------- D1（node:sqlite に種の 10 人） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const QUAKE = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();

function aiCtx(claude?: ClaudeClient, env: AskJsonContext["env"] = { ANTHROPIC_API_KEY: "dummy" }): AskJsonContext {
  return { env, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind }, now: () => new Date(at(1.03)), claude };
}

function deps(claude?: ClaudeClient, env?: AskJsonContext["env"]): ClassifyDeps {
  return { ai: async () => aiCtx(claude, env), now: () => at(1.03) };
}

const self: Principal = {
  role: "self",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: "山田 ハナ",
  office: DEMO,
  caseloadOf: null,
  personId: "p-01",
  contactId: null,
};
const careManager: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};
const medical: Principal = { ...careManager, role: "medical", accountId: "acct-medical", caseloadOf: null };

const yamada = SEED_PEOPLE[0];
const yamadaInput: PseudonymInput = {
  person: yamada.person,
  ledger: yamada.ledger,
  contacts: yamada.contacts,
  clocks: yamada.clocks,
  consents: seedConsents(yamada),
};
const { key } = pseudonymize([yamadaInput], { on: "2026-11-04" });

async function earthquake() {
  const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
  expect(r).toMatchObject({ ok: true });
}

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** 赤を送り、録音と文字起こしを添える（添えたときの hook の引数を返す） */
async function redWithRecording(transcript: string | null): Promise<AttachedRecording> {
  const id = newId();
  const saved = await saveSignal(
    db,
    signalScope(self)!,
    { id, color: "red", whereNow: null, answers: { ...NO_ANSWERS }, occurredAt: at(1), sentAt: at(1) },
    at(1),
  );
  expect(saved.ok).toBe(true);
  const form = new FormData();
  form.set("signal", id);
  form.set("recordedAt", at(1.01));
  form.set("sentAt", at(1.01));
  form.set("durationSec", "60");
  if (transcript !== null) form.set("transcript", transcript);
  form.set("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
  const attached: AttachedRecording[] = [];
  const res = await recordingPost(db, { put: async () => ({}) }, self, form, at(1.02), { afterAttach: (a) => attached.push(a) });
  expect(res.status).toBe(200);
  return attached[0];
}

const target = (a: AttachedRecording) => ({ ...a, audio: { durationSec: a.durationSec, silenceRatio: null } });
const signalRow = (id: string) => sqlite.prepare("SELECT * FROM signals WHERE id = ?").get(id) as unknown as SignalRow;
const caseload = async () => (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, "2026-11-04", at(1.1)))!;

// ---------- テスト ----------

describe("まとめの本体（summarize）", () => {
  it("Haiku・high・4000・20 秒・再試行なし（waitUntil の 30 秒に収める）。用途 summary の既定（Sonnet、アンケートの集計）と分類は変えない", async () => {
    expect(RECORDING_SUMMARY).toEqual({ model: HAIKU, effort: "high", maxTokens: 4000, timeoutMs: 20_000, maxRetries: 0 });
    expect(PURPOSES.summary).toEqual({ model: SONNET, effort: "high", maxTokens: 16000, timeoutMs: 180_000 });
    expect(PURPOSES.classify).toMatchObject({ model: HAIKU, effort: "low", timeoutMs: 12_000 });
    const { client, calls } = fake({ summary: () => ({ summary: "足が痛く、動けないと話している。" }) });
    const r = await summarize({ text: pseudonymizeText("あしが いたい うごけない", key) }, aiCtx(client));
    expect(r).toEqual({ ok: true, model: HAIKU, summary: "足が痛く、動けないと話している。" });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({ model: HAIKU, max_tokens: 4000, output_config: { effort: "high" } });
    expect(calls[0].options).toEqual({ timeout: 20_000, maxRetries: 0 });
    const rows = sqlite.prepare("SELECT purpose, model, status FROM ai_calls").all();
    expect(rows).toEqual([{ purpose: "summary", model: HAIKU, status: "ok" }]);
  });

  it("指示: 言い換えだけ・重さ・急ぐか・病名・医療の言葉・助言を足さない・伏せ字はそのまま・80 字", () => {
    for (const w of ["言い換えだけ", "重さ", "急ぐかどうか", "病名", "医療の言葉", "助言", "伏せ字", `${SUMMARY_MAX} 字`]) {
      expect(SUMMARY_SYSTEM).toContain(w);
    }
    // 指示に氏名・町名・電話は無い
    expect(SUMMARY_SYSTEM).not.toMatch(/山田|かわなぎ|090-/);
  });

  it("80 字で切る。かぎ括弧と改行を外す。空は形の違い。文字起こしに無い禁じる語（診断・判定・重症・緊急度）は捨てる", async () => {
    const long = "あ".repeat(120);
    expect(normalizeSummary(long, "x")).toBe("あ".repeat(SUMMARY_MAX));
    expect(normalizeSummary("「水が床まで来て\n動けない」", "x")).toBe("水が床まで来て 動けない");
    expect(normalizeSummary("  ", "x")).toBeNull();
    expect(normalizeSummary("重症の可能性。", "いたい")).toBeNull();
    // 本人がその言葉を言ったなら言い換えに残ってよい
    expect(normalizeSummary("診断書を探していると話す。", "しんだんしょ 診断書 が ない")).toBe("診断書を探していると話す。");
    const { client } = fake({ summary: () => ({ summary: "緊急度は高い。" }) });
    expect(await summarize({ text: pseudonymizeText("たすけて", key) }, aiCtx(client))).toEqual({ ok: false, error: "bad_output" });
  });

  it("文字が無ければ呼ばない。未設定・上限・断られた・形の違いは投げずに理由", async () => {
    const { client, calls } = fake({ summary: () => ({ summary: "x" }) });
    expect(await summarize({ text: null }, aiCtx(client))).toEqual({ ok: false, error: "no_text" });
    expect(calls).toEqual([]);
    expect(await summarize({ text: pseudonymizeText("いたい", key) }, aiCtx(undefined, {}))).toEqual({ ok: false, error: "not_configured" });
    expect(
      await summarize({ text: pseudonymizeText("いたい", key) }, aiCtx(client, { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" })),
    ).toEqual({ ok: false, error: "limit" });
    const bad = fake({ summary: () => ({ wrong: 1 }) });
    expect(await summarize({ text: pseudonymizeText("いたい", key) }, aiCtx(bad.client))).toEqual({ ok: false, error: "bad_output" });
  });

  it("仮名化の門: 入力は伏せた文だけ（型で通らず、実行時にも止まる）。位置・避難先の名前の欄は入力の型に無い", async () => {
    // @ts-expect-error 伏せていない文は渡せない
    buildSummaryRequest({ text: { text: "山田 ハナ" } });
    const { client } = fake({ summary: () => ({ summary: "x" }) });
    await expect(summarize({ text: { text: "山田 ハナ" } } as unknown as SummaryInput, aiCtx(client))).rejects.toThrow();
    type Place = "reported" | "reported_lat" | "reported_lng" | "lat" | "lng" | "location" | "shelters" | "destination1";
    expectTypeOf<Extract<keyof SummaryInput, Place>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof ClassifySource, Place>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof ClaudePerson, "reported" | "reportedLocation" | "location">>().toEqualTypeOf<never>();
    // @ts-expect-error 分類の元に位置の欄は無い
    const src: ClassifySource = { transcript: "x", answers: null, audio: null, reported: { lat: 33.8, lng: 132.7 } };
    expect(src).toBeTruthy();
  });

  it("送った物に氏名・町名・電話が無い（伏せた文だけ）", async () => {
    const { client, calls } = fake({ summary: () => ({ summary: "（氏名）さんに電話してほしいと話す。" }) });
    const text = pseudonymizeText("山田 ハナです。森 恵子に 090-0000-0012 で でんわして。かわなぎ町", key);
    await summarize({ text }, aiCtx(client));
    const sent = JSON.stringify(calls[0].params.messages);
    expect(sent).not.toMatch(/山田|ハナ|森 恵子|090-0000-0012|かわなぎ/);
  });
});

describe("信号の行に書く（分類と並べて）", () => {
  it("録音のあと: 分類とまとめを並べて呼ぶ（片方の返事を待たずにもう片方を呼ぶ）。両方書く", async () => {
    await earthquake();
    const a = await redWithRecording("あしが いたい うごけない");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { client, calls } = fake({
      classify: async () => {
        await gate;
        return { categories: ["immobile"], confidence: 0.9, quote: "うごけない" };
      },
      summary: () => ({ summary: "足が痛く動けないと話す。" }),
    });
    const run = afterRecording(db, target(a), deps(client));
    for (let i = 0; i < 50 && calls.length < 2; i++) await new Promise((r) => setTimeout(r, 0));
    // 分類の返事を待っている間に、まとめも呼んでいる
    expect(calls.map((c) => (isSummary(c.params) ? "summary" : "classify")).sort()).toEqual(["classify", "summary"]);
    release();
    const out = await run;
    expect(out.classify).toMatchObject({ status: "classified" });
    expect(out.summary).toMatchObject({ status: "summarized", result: { ok: true } });
    expect(signalRow(a.signalId)).toMatchObject({
      classes: '["immobile"]',
      ai_summary: "足が痛く動けないと話す。",
      ai_summary_model: HAIKU,
      ai_summary_error: null,
      ai_summary_at: at(1.03),
      summary: null,
    });
  });

  it("まとめが失敗しても分類は残る（逆も）。失敗は ai_summary_error", async () => {
    await earthquake();
    const a = await redWithRecording("みずが きてる");
    const { client } = fake({
      classify: () => ({ categories: ["water"], confidence: 0.9, quote: "みずが" }),
      summary: () => new Anthropic.APIConnectionError({ message: "x" }),
    });
    await afterRecording(db, target(a), deps(client));
    expect(signalRow(a.signalId)).toMatchObject({ classes: '["water"]', ai_summary: null, ai_summary_error: "failed" });

    const b = await redWithRecording("でられない");
    const both = fake({ classify: () => ({ wrong: 1 }), summary: () => ({ summary: "出られないと話す。" }) });
    await afterRecording(db, target(b), deps(both.client));
    expect(signalRow(b.signalId)).toMatchObject({ classes: null, ai_error: "bad_output", ai_summary: "出られないと話す。" });
  });

  it("2 回目は呼ばない。文字が無ければ呼ばずに「文字なし」。上限に当たれば limit", async () => {
    await earthquake();
    const a = await redWithRecording("いたい");
    const { client, calls } = fake({ summary: () => ({ summary: "痛いと話す。" }) });
    await summarizeSignal(db, target(a), deps(client));
    expect(await summarizeSignal(db, target(a), deps(client))).toMatchObject({ status: "skipped" });
    expect(calls).toHaveLength(1);

    const silent = await redWithRecording(null);
    await summarizeSignal(db, target(silent), deps(client));
    expect(calls).toHaveLength(1);
    expect(signalRow(silent.signalId)).toMatchObject({ ai_summary: null, ai_summary_error: "no_text" });

    const c = await redWithRecording("たすけて");
    await summarizeSignal(db, target(c), deps(client, { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }));
    expect(signalRow(c.signalId)).toMatchObject({ ai_summary: null, ai_summary_error: "limit" });
  });

  it("位置・避難先の名前・答えは Claude に渡らない（信号に入っていても、送るのは伏せた文字起こしだけ）", async () => {
    await earthquake();
    const a = await redWithRecording("くるまの なかに いる");
    await saveAnswers(db, signalScope(self)!, a.signalId, {
      atHome: { choice: "no", via: "press" },
      place: { choice: "shelter", via: "press" },
      shelterWhich: { choice: "d1", via: "press" },
    });
    expect((await locationPost(db, self, a.signalId, { lat: 33.83017, lng: 132.76123, accuracyM: 48, at: at(1.01) })).status).toBe(200);
    const { client, calls } = fake({
      classify: () => ({ categories: ["other"], confidence: 0.9, quote: "" }),
      summary: () => ({ summary: "車の中にいると話す。" }),
    });
    await afterRecording(db, target(a), deps(client));
    expect(calls).toHaveLength(2);
    const sent = JSON.stringify(calls.map((c) => c.params));
    expect(sent).not.toMatch(/33\.83|132\.76|かわなぎ小学校|shelterWhich|"d1"/);
  });
});

describe("画面の形・直し・生成", () => {
  it("形: 直した文 → Claude の文 → なし（理由）", () => {
    expect(summaryOf({ ai_summary: "AI の文", summary: null })).toEqual({ text: "AI の文", by: "ai", error: null });
    expect(summaryOf({ ai_summary: "AI の文", summary: "人の文" })).toEqual({ text: "人の文", by: "human", error: null });
    expect(summaryOf({ ai_summary: null, ai_summary_error: "limit" })).toEqual({ text: null, by: null, error: "limit" });
  });

  it("部品: まとめ（AI の印）と本人の言葉を並べる。人の文は AI の印を外す。無ければ「なし」と「生成」。文字起こしが無ければ出さない", () => {
    const words = "あしが いたい うごけない";
    const ai = renderToStaticMarkup(
      createElement(Summary, { signalId: "s1", summary: { text: "足が痛く動けないと話す。", by: "ai", error: null }, transcript: words, editable: true }),
    );
    expect(ai).toContain("まとめ");
    expect(ai).toContain('data-ai=""');
    expect(ai).toContain("本人の言葉");
    expect(ai).toContain(`「${words}」`);
    expect(ai).toContain("修正");
    expect(ai).not.toMatch(/state-|tone-/);
    const human = renderToStaticMarkup(
      createElement(Summary, { signalId: "s1", summary: { text: "人の文", by: "human", error: null }, transcript: words }),
    );
    expect(human).not.toContain("data-ai");
    expect(human).toContain("修正済");
    expect(human).not.toContain(">修正<");
    const none = renderToStaticMarkup(
      createElement(Summary, { signalId: "s1", summary: { text: null, by: null, error: "limit" }, transcript: words, editable: true }),
    );
    expect(none).toContain("なし（上限到達）");
    expect(none).toContain("生成");
    expect(renderToStaticMarkup(createElement(Summary, { signalId: "s1", summary: summaryOf({}), transcript: null }))).toBe("");
  });

  it("直す: ケアマネだけ。人の文になり AI の印が外れ、経過に「まとめ修正」。Claude の文は残る。色と順は変わらない", async () => {
    await earthquake();
    const a = await redWithRecording("あしが いたい");
    const { client } = fake({ summary: () => ({ summary: "足が痛いと話す。" }) });
    await summarizeSignal(db, target(a), deps(client));
    const before = await caseload();

    const res = await summaryPost(db, careManager, a.signalId, { text: "右足が痛いと話す" }, at(1.05), { ai: async () => aiCtx(client) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, changed: true, view: { text: "右足が痛いと話す", by: "human" } });
    expect(signalRow(a.signalId)).toMatchObject({ summary: "右足が痛いと話す", ai_summary: "足が痛いと話す。" });
    const items = timelineItems((await loadPersonPage(db, careManager, "p-01"))!);
    expect(items.some((t) => t.body === "まとめ修正「右足が痛いと話す」")).toBe(true);

    const after = await caseload();
    expect(after.rows.map((r) => [r.id, r.rank, r.triage])).toEqual(before.rows.map((r) => [r.id, r.rank, r.triage]));
    const sig = after.rows.find((r) => r.id === "p-01")!.detail!.signals.find((s) => s.id === a.signalId)!;
    expect(sig.summary).toEqual({ text: "右足が痛いと話す", by: "human", error: null });

    // 断り: 本人・医療班は 403、ログインなしは 401、事業所の外・知らない信号は 404、空・長すぎは 400
    const ai = { ai: async () => aiCtx(client) };
    expect((await summaryPost(db, self, a.signalId, { text: "x" }, at(1.05), ai)).status).toBe(403);
    expect((await summaryPost(db, medical, a.signalId, { text: "x" }, at(1.05), ai)).status).toBe(403);
    expect((await summaryPost(db, null, a.signalId, { text: "x" }, at(1.05), ai)).status).toBe(401);
    expect((await summaryPost(db, careManager, "nope", { text: "x" }, at(1.05), ai)).status).toBe(404);
    expect((await summaryPost(db, careManager, a.signalId, { text: "  " }, at(1.05), ai)).status).toBe(400);
    expect((await summaryPost(db, careManager, a.signalId, { text: "あ".repeat(400) }, at(1.05), ai)).status).toBe(400);
  });

  it("生成: まとめが無い信号でもう一度 Claude を呼ぶ（失敗の理由を消す）。まとめがあれば呼ばない", async () => {
    await earthquake();
    const a = await redWithRecording("でられない");
    const down = fake({ summary: () => new Anthropic.APIConnectionError({ message: "x" }) });
    await summarizeSignal(db, target(a), deps(down.client));
    expect(signalRow(a.signalId)).toMatchObject({ ai_summary: null, ai_summary_error: "failed" });

    const up = fake({ summary: () => ({ summary: "出られないと話す。" }) });
    const res = await summaryPost(db, careManager, a.signalId, {}, at(1.2), { ai: async () => aiCtx(up.client) });
    expect(await res.json()).toMatchObject({ ok: true, changed: true, view: { text: "出られないと話す。", by: "ai", error: null } });
    expect(signalRow(a.signalId)).toMatchObject({ ai_summary: "出られないと話す。", ai_summary_error: null });
    expect(up.calls).toHaveLength(1);
    // もうあれば呼ばない
    await summaryPost(db, careManager, a.signalId, null, at(1.3), { ai: async () => aiCtx(up.client) });
    expect(up.calls).toHaveLength(1);
  });
});

describe("色と連絡順に使わない", () => {
  it("lib/triage のどのファイルも summary・ai_summary を読まない。表の入力の型にも無い", () => {
    const dir = join(__dirname, "..", "triage");
    const hits = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => /\bai_summary\b|\.summary\b|\bsummary:|aiSummary/.test(readFileSync(join(dir, f), "utf8")));
    expect(hits).toEqual([]);
    type S = "ai_summary" | "summary" | "ai_summary_error" | "aiSummary";
    expectTypeOf<Extract<keyof SignalForTriage, S>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof TriageSignal, S>>().toEqualTypeOf<never>();
  });

  it("分類の指示は「要約しない」のまま（聞き取りメモは写すだけ。まとめは別の呼び出し）", () => {
    expect(CLASSIFY_SYSTEM).toContain("要約しない");
  });
});
