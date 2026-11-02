// 様式の読み取り（T08）: 受け取る写真・PDF の検査、Claude への頼みの形（写真・PDF は文の前、台帳の値は渡さない）、
// 固定の返事（内閣府の様式例から手で起こした物）で通す。本物の API は呼ばない（偽の client を渡す）。
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { buildParams, type AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { AiNotConfigured } from "../claude/errors.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { AiCallRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { isForClaude } from "../pseudonym/index.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { buildReadRequest, FORM_FILE_MAX_BYTES, formHash, readForm, sniffFormFile, toFormFile } from "./form-read.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

const PDF = new TextEncoder().encode("%PDF-1.7\n空の様式\n%%EOF");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function reply(text: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 3200, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function setup(env: AskJsonContext["env"] = { ANTHROPIC_API_KEY: "dummy" }) {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  const calls: Params[] = [];
  const claude: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(JSON.stringify(CAO_FORM_READ));
        },
      },
    },
  };
  const ctx: AskJsonContext = {
    env,
    usage: d1UsageStore(d1FromSqlite(db)),
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-02T03:00:00.000Z"),
    claude,
  };
  const rows = () => db.prepare("SELECT * FROM ai_calls").all() as unknown as AiCallRow[];
  return { ctx, calls, rows };
}

describe("受け取る写真・PDF", () => {
  it("中身の頭で JPEG・PNG・PDF を見分け、ほかは断る", () => {
    expect(sniffFormFile(PDF)).toEqual({ kind: "pdf" });
    expect(sniffFormFile(PNG)).toEqual({ kind: "image", mediaType: "image/png" });
    expect(sniffFormFile(JPEG)).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(sniffFormFile(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(toFormFile(new TextEncoder().encode("<html>"))).toEqual({ ok: false, error: "type" });
    expect(toFormFile(new Uint8Array())).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(FORM_FILE_MAX_BYTES + 1);
    big.set(PDF);
    expect(toFormFile(big)).toEqual({ ok: false, error: "too_large" });
  });

  it("Claude に添える形は base64。同じ物は同じ印（SHA-256）", async () => {
    const r = toFormFile(PDF);
    expect(r.ok && r.file.attachment).toEqual({ kind: "pdf", data: Buffer.from(PDF).toString("base64") });
    const png = toFormFile(PNG);
    expect(png.ok && png.file.attachment).toMatchObject({ kind: "image", mediaType: "image/png" });
    const h = await formHash(new Uint8Array(PDF));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await formHash(new Uint8Array(PDF))).toBe(h);
    expect(await formHash(new Uint8Array(PNG))).not.toBe(h);
  });
});

describe("Claude への頼み", () => {
  it("用途は form_read（Opus・effort high）。PDF は文の前、文は台帳の項目表だけ（値は無い）", () => {
    const r = toFormFile(PDF);
    if (!r.ok) throw new Error("PDF");
    const req = buildReadRequest(r.file);
    expect(isForClaude(req.input)).toBe(true);
    const p = buildParams(req, OPUS);
    expect(p).toMatchObject({ model: OPUS, max_tokens: 16000, output_config: { effort: "high", format: { type: "json_schema" } } });
    const content = p.messages[0].content as Anthropic.Beta.Messages.BetaContentBlockParam[];
    expect(content.map((b) => b.type)).toEqual(["document", "text"]);
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    const text = (content[1] as { text: string }).text;
    expect(JSON.parse(text).items[0]).toEqual({ key: "person.name", group: "本人", label: "氏名" });
    for (const person of SEED_PEOPLE) expect(text).not.toContain(person.person.name);
    expect(text).not.toMatch(/090-0000/);
    // 指示（system）にも人の値が無い
    const system = JSON.stringify(p.system);
    for (const person of SEED_PEOPLE) {
      expect(system).not.toContain(person.person.name);
      for (const c of person.contacts) if (c.name) expect(system).not.toContain(c.name);
    }
    expect(system).not.toMatch(/0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}/);
  });

  it("写真は image の塊", () => {
    const r = toFormFile(JPEG);
    if (!r.ok) throw new Error("JPEG");
    const content = buildParams(buildReadRequest(r.file), OPUS).messages[0].content as Anthropic.Beta.Messages.BetaContentBlockParam[];
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
  });
});

describe("読み取り（固定の返事）", () => {
  it("内閣府の様式例: 対応表（下書き）と AI の印。呼び出しは 1 回、記録に本文は残らない", async () => {
    const { ctx, calls, rows } = setup();
    const r = toFormFile(PDF);
    if (!r.ok) throw new Error("PDF");
    const out = await readForm(r.file, ctx);
    expect(calls).toHaveLength(1);
    expect(out.mark).toEqual({ ai: true, model: OPUS, purpose: "form_read" });
    expect(out.rejected).toEqual([]);
    expect(out.mapping.fields).toHaveLength(41);
    expect(out.mapping.fields.every((f) => f.ai !== null)).toBe(true);
    expect(rows()).toMatchObject([{ purpose: "form_read", model: OPUS, status: "ok", input_tokens: 3200, output_tokens: 2400 }]);
  });

  it("鍵が無ければ AiNotConfigured（呼ばない・上限を減らさない）", async () => {
    const { ctx, calls, rows } = setup({});
    const r = toFormFile(PDF);
    if (!r.ok) throw new Error("PDF");
    await expect(readForm(r.file, { ...ctx, claude: undefined })).rejects.toBeInstanceOf(AiNotConfigured);
    expect(calls).toHaveLength(0);
    expect(rows()).toEqual([]);
  });
});
