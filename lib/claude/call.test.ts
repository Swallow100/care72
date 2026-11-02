// askJson のテスト。本物の API は呼ばない（偽の client を渡す）。
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import type { AiCallRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymize, pseudonymizeText, type PseudonymInput } from "../pseudonym/index.ts";
import { askJson, COMMON_SYSTEM, type AskJsonContext } from "./call.ts";
import { createClaudeClient, type ClaudeClient } from "./client.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "./errors.ts";
import { HAIKU, OPUS, SONNET } from "./models.ts";
import { d1UsageStore } from "./usage.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

const ON = "2026-11-02";
const yamada = SEED_PEOPLE[0];
const yamadaInput: PseudonymInput = {
  person: yamada.person,
  ledger: yamada.ledger,
  contacts: yamada.contacts,
  clocks: yamada.clocks,
  consents: seedConsents(yamada),
};
const { payload, key } = pseudonymize([yamadaInput], { on: ON });

const ClassSchema = z.object({
  classes: z.array(z.enum(["injury", "immobile", "water", "device_stopped", "unknown"])),
  note: z.string(),
});

function reply(over: Partial<Message> & { text?: string } = {}): Message {
  const { text = JSON.stringify({ classes: ["water"], note: "水が来た" }), ...rest } = over;
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...rest,
  } as unknown as Message;
}

function fake(answer: (p: Params) => Message | Promise<Message> = () => reply()) {
  const calls: Array<{ params: Params; options: unknown }> = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params, options) => {
          calls.push({ params, options });
          return answer(params);
        },
      },
    },
  };
  return { client, calls };
}

function setup(env: AskJsonContext["env"] = { ANTHROPIC_API_KEY: "dummy" }) {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  const ctx = (claude?: ClaudeClient): AskJsonContext => ({
    env,
    usage: d1UsageStore(d1FromSqlite(db)),
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-02T03:00:00.000Z"),
    claude,
  });
  const rows = () => db.prepare("SELECT * FROM ai_calls").all() as unknown as AiCallRow[];
  return { ctx, rows };
}

const classify = { purpose: "classify", system: "録音の書き起こしを 5 つに分ける。", schema: ClassSchema } as const;
const text = pseudonymizeText("山田さんの家に水が来た。090-0000-0001 に電話して", key);

describe("askJson", () => {
  it("仮名の入力を渡し、形を確かめた JSON と「AI」の印を返す", async () => {
    const { ctx, rows } = setup();
    const { client, calls } = fake();
    const r = await askJson({ ...classify, input: text }, ctx(client));
    expect(r).toEqual({ ai: true, model: HAIKU, purpose: "classify", value: { classes: ["water"], note: "水が来た" } });

    const [{ params, options }] = calls;
    expect(params.model).toBe(HAIKU);
    expect(params.output_config?.effort).toBe("low");
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.output_config?.format?.schema).toMatchObject({ type: "object", required: ["classes", "note"] });
    expect(params.system).toEqual([
      { type: "text", text: COMMON_SYSTEM },
      { type: "text", text: classify.system },
    ]);
    // 考える設定・温度は送らない（Opus 5.5 などで 400 になる）
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    // Haiku には fallback を送らない
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    // 分類は録音の応答のあとに走らせるので短く（T12）
    expect(options).toEqual({ timeout: 12_000, maxRetries: 1 });

    // 渡った物に氏名・電話が無く、仮名がある
    const sent = JSON.stringify(params.messages);
    expect(sent).toContain("A さん");
    expect(sent).not.toContain("山田");
    expect(sent).not.toContain("090-0000-0001");

    expect(rows()).toMatchObject([
      { purpose: "classify", model: HAIKU, status: "ok", error: null, input_tokens: 120, output_tokens: 30 },
    ]);
  });

  it("用途ごとのモデル。Opus と Sonnet には断られたときの fallback（default）を付け、印は答えたモデル", async () => {
    const { ctx } = setup();
    const { client, calls } = fake((p) => reply({ model: p.model === OPUS ? "claude-opus-5" : p.model }));
    const Out = z.object({ events: z.array(z.string()) });
    const r = await askJson({ purpose: "director", system: "監督", input: payload, schema: Out, }, ctx(client)).catch(
      (e: unknown) => e,
    );
    // 偽の返事は分類の形なので形が違う → 失敗。ここでは送った物を見る
    expect(r).toBeInstanceOf(AiBadOutput);
    expect(calls[0].params).toMatchObject({
      model: OPUS,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(calls[0].options).toEqual({ timeout: 120_000, maxRetries: 1 });

    const { client: c2 } = fake(() => reply({ model: "claude-opus-5", text: JSON.stringify({ events: ["停電"] }) }));
    const ok = await askJson({ purpose: "scoring", system: "採点", input: payload, schema: Out }, ctx(c2));
    expect(ok).toMatchObject({ ai: true, model: "claude-opus-5", purpose: "scoring", value: { events: ["停電"] } });

    const { client: c3, calls: k3 } = fake(() => reply({ model: SONNET, text: JSON.stringify({ events: [] }) }));
    await askJson({ purpose: "ledger_input", system: "入力", input: { 本人: payload, 話した文: text }, schema: Out }, ctx(c3));
    expect(k3[0].params).toMatchObject({ model: SONNET, fallbacks: "default", output_config: { effort: "medium" } });
    expect(JSON.parse(k3[0].params.messages[0].content as string)).toMatchObject({
      本人: [{ alias: "A さん" }],
      話した文: { text: expect.stringContaining("A さん") },
    });
  });

  it("鍵が無ければ AiNotConfigured。上限は減らさない", async () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: "" }, { ANTHROPIC_API_KEY: "   " }]) {
      const { ctx, rows } = setup(env);
      await expect(askJson({ ...classify, input: text }, ctx())).rejects.toBeInstanceOf(AiNotConfigured);
      expect(rows()).toHaveLength(0);
    }
    expect(() => createClaudeClient({})).toThrow(AiNotConfigured);
  });

  it("鍵があれば本物の client を作る（ここでは呼ばない）", () => {
    const c = createClaudeClient({ ANTHROPIC_API_KEY: "dummy" });
    expect(typeof c.beta.messages.create).toBe("function");
  });

  it("上限に達したら AiLimitReached で、Claude を呼ばない", async () => {
    const { ctx } = setup({ ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "1" });
    const { client, calls } = fake();
    await askJson({ ...classify, input: text }, ctx(client));
    await expect(askJson({ ...classify, input: text }, ctx(client))).rejects.toBeInstanceOf(AiLimitReached);
    expect(calls).toHaveLength(1);
  });

  it("schema に合わない返事は失敗（送り直さない）。形の違う場所だけを持ち、値は持たない", async () => {
    const { ctx, rows } = setup();
    const { client, calls } = fake(() => reply({ text: JSON.stringify({ classes: ["病気"], note: 3 }) }));
    const err = await askJson({ ...classify, input: text }, ctx(client)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiBadOutput);
    expect(err).toMatchObject({ reason: "schema", issues: ["classes.0", "note"] });
    expect((err as Error).message).not.toContain("病気");
    expect(calls).toHaveLength(1);
    expect(rows()).toMatchObject([{ status: "failed", error: "bad_output", input_tokens: 120 }]);
  });

  it("JSON でない・途中で切れた・空の返事も失敗", async () => {
    const cases: Array<[Partial<Message> & { text?: string }, string]> = [
      [{ text: "分類: 水" }, "not_json"],
      [{ stop_reason: "max_tokens" }, "max_tokens"],
      [{ text: "" }, "no_text"],
      [{ stop_reason: "pause_turn" }, "stop_reason"],
    ];
    for (const [over, reason] of cases) {
      const { ctx } = setup();
      const { client } = fake(() => reply(over));
      await expect(askJson({ ...classify, input: text }, ctx(client))).rejects.toMatchObject({ name: "AiBadOutput", reason });
    }
  });

  it("断られたら AiRefused（content を読まない）", async () => {
    const { ctx, rows } = setup();
    const { client } = fake(() =>
      reply({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "bio", explanation: null } as Message["stop_details"],
        content: [],
      }),
    );
    const err = await askJson({ ...classify, input: text }, ctx(client)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefused);
    expect(err).toMatchObject({ category: "bio" });
    expect(rows()).toMatchObject([{ status: "failed", error: "refused" }]);
  });

  it("API の失敗と時間切れは AiCallFailed（元の例外は cause）", async () => {
    const { ctx, rows } = setup();
    const timeout = new Anthropic.APIConnectionTimeoutError();
    const { client } = fake(() => Promise.reject(timeout));
    const err = await askJson({ ...classify, input: text }, ctx(client)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiCallFailed);
    expect(err).toMatchObject({ code: "timeout", cause: timeout });

    const { client: c2 } = fake(() => Promise.reject(new Error("つながらない")));
    await expect(askJson({ ...classify, input: text }, ctx(c2))).rejects.toMatchObject({ code: "api_error" });
    expect(rows().map((r) => r.error)).toEqual(["timeout", "api_error"]);
  });

  it("仮名化の層を通っていない物は、型で通らず、実行しても止まる", async () => {
    const { ctx, rows } = setup();
    const { client, calls } = fake();
    const raw = { name: yamada.person.name, phone: "090-0000-0001" };
    // @ts-expect-error 素の台帳・氏名は ClaudeInput にならない
    await expect(askJson({ ...classify, input: raw }, ctx(client))).rejects.toThrow("lib/pseudonym");
    // @ts-expect-error 名前を付けて並べても、中身が印付きでなければ通らない
    await expect(askJson({ ...classify, input: { 本人: payload, 元: yamadaInput } }, ctx(client))).rejects.toThrow(
      "lib/pseudonym",
    );
    // 印付きの物を広げて写した物は、型では印付きに見えるが、実行すると止まる（本当の確かめは lib/pseudonym の WeakSet）
    const copied = { ...text };
    await expect(askJson({ ...classify, input: copied }, ctx(client))).rejects.toThrow("lib/pseudonym");
    // 空の物も止まる
    await expect(askJson({ ...classify, input: {} }, ctx(client))).rejects.toThrow("lib/pseudonym");
    expect(calls).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });
});
