// 根拠の一覧を Claude に渡す口のテスト。本物の API は呼ばない（偽の client を渡す）。
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { askJson, COMMON_SYSTEM, type AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { AiCallRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymizeText } from "../pseudonym/index.ts";
import { SOURCES, type SourceId } from "./index.ts";
import { basisSchema, NO_BASIS, sourcesSystem } from "./prompt.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

function reply(text: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function setup(answer: string) {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(answer);
        },
      },
    },
  };
  const ctx: AskJsonContext = {
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage: d1UsageStore(d1FromSqlite(db)),
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-02T03:00:00.000Z"),
    claude: client,
  };
  const rows = () => db.prepare("SELECT * FROM ai_calls").all() as unknown as AiCallRow[];
  return { ctx, calls, rows };
}

const ids = ["jadp-dialysis-2023", "jrs-respiratory-2012"] as const satisfies ReadonlyArray<SourceId>;
const Out = z.object({ note: z.string(), basis: basisSchema(ids) });
// 人の名前の無い文なので、置き換えの表が空の鍵で仮名化の層を通す
const input = pseudonymizeText("透析の日が近い", { people: [], contacts: [], rules: [], secrets: [] });

describe("sourcesSystem", () => {
  it("決まりの文と、渡した id ごとに発行元・題名・年・要旨。URL は渡さない", () => {
    const text = sourcesSystem(ids);
    expect(text).toContain("根拠は次の一覧の id だけを使う");
    expect(text).toContain(`当てはまる物が無ければ「${NO_BASIS}」と書く`);
    for (const id of ids) {
      const s = SOURCES.find((x) => x.id === id)!;
      expect(text).toContain(`- ${id}: ${s.publisher}「${s.title}」${s.year}。`);
      expect(text).not.toContain(s.url);
    }
    // 渡していない出典は載らない
    expect(text).not.toContain("jcs-disaster-2014");
  });

  it("同じ id は 1 回。空・登録簿に無い id は投げる", () => {
    expect(sourcesSystem(["jadp-dialysis-2023", "jadp-dialysis-2023"]).match(/jadp-dialysis-2023/g)).toHaveLength(1);
    expect(() => sourcesSystem([])).toThrow("空");
    expect(() => sourcesSystem(["made-up-2026"])).toThrow("出典の登録簿に無い id: made-up-2026");
  });
});

describe("basisSchema", () => {
  it("渡した id と「根拠なし」だけを通す", () => {
    const b = basisSchema(ids);
    expect(b.parse("jadp-dialysis-2023")).toBe("jadp-dialysis-2023");
    expect(b.parse(NO_BASIS)).toBe(NO_BASIS);
    expect(b.safeParse("jcs-disaster-2014").success).toBe(false);
    expect(b.safeParse("厚労省の資料").success).toBe(false);
    expect(() => basisSchema([])).toThrow();
    expect(() => basisSchema(["made-up-2026" as SourceId])).toThrow("made-up-2026");
  });
});

describe("askJson の sources", () => {
  it("渡すと system の 3 つ目に根拠の一覧。返事の根拠の欄は一覧の id か「根拠なし」", async () => {
    const { ctx, calls } = setup(JSON.stringify({ note: "透析先を確かめる", basis: "jadp-dialysis-2023" }));
    const r = await askJson({ purpose: "classify", system: "分ける。", input, schema: Out, sources: ids }, ctx);
    expect(r.value).toEqual({ note: "透析先を確かめる", basis: "jadp-dialysis-2023" });
    expect(calls[0].system).toEqual([
      { type: "text", text: COMMON_SYSTEM },
      { type: "text", text: "分ける。" },
      { type: "text", text: sourcesSystem(ids) },
    ]);
    // 構造化出力の形にも一覧が enum で入る
    expect(JSON.stringify(calls[0].output_config?.format?.schema)).toContain("jadp-dialysis-2023");
  });

  it("渡さなければ今まで通り 2 つ", async () => {
    const { ctx, calls } = setup(JSON.stringify({ note: "x" }));
    await askJson({ purpose: "classify", system: "分ける。", input, schema: z.object({ note: z.string() }) }, ctx);
    expect(calls[0].system).toHaveLength(2);
  });

  it("一覧に無い id を返したら形の違いで失敗（作った根拠を通さない）", async () => {
    const { ctx } = setup(JSON.stringify({ note: "x", basis: "厚労省の資料" }));
    await expect(
      askJson({ purpose: "classify", system: "分ける。", input, schema: Out, sources: ids }, ctx),
    ).rejects.toMatchObject({ name: "AiBadOutput", reason: "schema" });
  });

  it("登録簿に無い id を渡したら呼ぶ前に止まり、上限も減らさない", async () => {
    const { ctx, calls, rows } = setup("{}");
    await expect(
      askJson(
        {
          purpose: "classify",
          system: "分ける。",
          input,
          schema: Out,
          // @ts-expect-error 登録簿に無い id は型で通らない
          sources: ["made-up-2026"],
        },
        ctx,
      ),
    ).rejects.toThrow("出典の登録簿に無い id");
    expect(calls).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });
});
