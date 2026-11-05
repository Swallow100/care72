// T146: 読み取れる頁の上限を 3 から 10 に。10 頁の PDF・様式・見直しが切れずに通り、11 頁目からは今どおり（PDF は頭の 10 頁だけを描く、
// 受け口は 11 枚・11 頁目を断る）。本物の API は呼ばない（偽の client）。
import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS, SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { parseReadMeta, PDF_PAGES_MAX, READ_CHOOSE_FROM } from "../intake/read-form.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { FORM_READ_CONCURRENCY, readForm, type FormFile } from "./form-read.ts";
import { pageReadReply, requestedPage, requestInput } from "./form-read-fake.ts";
import { komorebiReadResult } from "./komorebi-form.fixture.ts";
import { FORM_FILE_MAX_BYTES, type ReadResult } from "./mapping.ts";
import { getMapping } from "./mapping-db.ts";
import type { PageImageBucket } from "./page-images.ts";
import { formReadPost } from "./read-post.ts";
import {
  buildFormReadForm,
  FORM_READ_BODY_MAX_BYTES,
  FORM_READ_PAGES_MAX,
  FORM_READ_TOTAL_MAX_BYTES,
  formReadPageBytes,
  formReadPagesOf,
  type FormReadPage,
} from "./read-upload.ts";
import { REVIEW_PAGES_PER_CALL, reviewGroups, runAiReview, type ReviewListRow } from "./review-ai.ts";
import { REVIEW_PAGES_MAX } from "./review-post.ts";
import type { ReviewSubject } from "./review.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** 形だけの JPEG（付け足しなし。seed で中身を変える。lib/forms/t120-read.test.ts と同じ作り） */
function tinyJpeg(seed = 0): Uint8Array {
  const width = 1240;
  const height = 1754;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    seed & 0xff, (seed >> 8) & 0xff, 0x12, 0x34,
    0xff, 0xd9,
  ]);
}

function message(text: string, model = OPUS): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 3200, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** n 頁の架空の様式（こもれび市の 1 頁目の欄を頁ごとに写す） */
function pagesForm(n: number): ReadResult {
  const k = komorebiReadResult();
  const one = k.fields.filter((f) => f.page === 1);
  return { ...k, pages: n, fields: Array.from({ length: n }, (_, i) => one.map((f) => ({ ...f, page: i + 1, section: `${i + 1} ${f.section}` }))).flat() };
}

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

function ctxOf(create: (params: Params) => Promise<Message>): { ctx: AskJsonContext; calls: Params[] } {
  const calls: Params[] = [];
  const claude: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return create(params);
        },
      },
    },
  };
  return {
    calls,
    ctx: { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-06T00:00:00.000Z"), claude },
  };
}

const pdfPage = (page: number, bytes?: number): FormReadPage => ({
  blob: new Blob([(bytes ? new Uint8Array(bytes) : tinyJpeg(page)) as BlobPart], { type: "image/jpeg" }),
  meta: { source: "pdf", page, redacted: 1 },
  bare: false,
});

describe("上限の数", () => {
  it("1 回に送れる頁は 10。読み取り・様式の読み取りは同じ上限、見直しは枠の紙の分の余裕を見て 12", () => {
    expect(PDF_PAGES_MAX).toBe(10);
    expect(FORM_READ_PAGES_MAX).toBe(10);
    expect(REVIEW_PAGES_MAX).toBe(12);
    expect(READ_CHOOSE_FROM).toBe(4);
  });

  it("頁の印は 10 頁目まで通り、11 頁目からは断る（写真は 1 頁だけ）", () => {
    expect(parseReadMeta({ source: "pdf", page: "10", redacted: "1", bare: null })).toEqual({ source: "pdf", page: 10, redacted: 1 });
    expect(parseReadMeta({ source: "pdf", page: "11", redacted: "1", bare: null })).toBeNull();
    expect(parseReadMeta({ source: "excel", page: "11", redacted: "1", bare: null })).toBeNull();
    expect(parseReadMeta({ source: "photo", page: "2", redacted: "1", bare: null })).toBeNull();
  });
});

describe("様式の読み取り: 1 要求の大きさ", () => {
  it("10 頁は通り、11 頁は「入力不備」", () => {
    const ten = formReadPagesOf(buildFormReadForm(Array.from({ length: 10 }, (_, i) => pdfPage(i + 1))));
    expect(ten.ok && ten.pages.map((p) => p.meta.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const eleven = formReadPagesOf(buildFormReadForm(Array.from({ length: 11 }, (_, i) => pdfPage(i + 1))));
    expect(eleven).toEqual({ ok: false, error: "invalid" });
  });

  it("頁の画像の合計は 16 MB まで。3 頁までは 1 枚 5 MB のまま、10 頁は 1 頁 1.6 MB に収めて送る", () => {
    expect(formReadPageBytes(1)).toBe(FORM_FILE_MAX_BYTES);
    expect(formReadPageBytes(3)).toBe(FORM_FILE_MAX_BYTES);
    expect(formReadPageBytes(10)).toBe(Math.floor(FORM_READ_TOTAL_MAX_BYTES / 10));
    expect(formReadPageBytes(10) * 10).toBeLessThanOrEqual(FORM_READ_TOTAL_MAX_BYTES);
    // 合計が上限を超える要求は読む前に「大きすぎ」
    const big = Math.floor(FORM_READ_TOTAL_MAX_BYTES / 3) + 1024;
    expect(formReadPagesOf(buildFormReadForm([pdfPage(1, big), pdfPage(2, big), pdfPage(3, big)]))).toEqual({ ok: false, error: "file_large" });
    // 要求の本文の上限は、画像の合計・頁の印刷の字の位置・multipart の枠。Workers の要求の上限（100 MB）より十分小さい
    expect(FORM_READ_BODY_MAX_BYTES).toBeGreaterThan(FORM_READ_TOTAL_MAX_BYTES);
    expect(FORM_READ_BODY_MAX_BYTES).toBeLessThan(20 * 1024 * 1024);
  });
});

describe("様式の読み取り: 10 頁を頁ごとに 1 回、同時に 5 頁まで", () => {
  const image = (seed: number): FormFile => ({ kind: "image", attachment: { kind: "image", mediaType: "image/jpeg", data: Buffer.from(tinyJpeg(seed)).toString("base64") }, bytes: 60 });

  it("10 頁は 10 回。どの回も画像 1 枚と頁の番号、同時に呼ぶのは 5 本まで（Workers の外への接続 6 本の中）", async () => {
    const answer = pagesForm(10);
    let open = 0;
    let most = 0;
    const { ctx, calls } = ctxOf(async (p) => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 10));
      open--;
      return message(pageReadReply(answer, p));
    });
    const out = await readForm(
      Array.from({ length: 10 }, (_, i) => image(i + 1)),
      ctx,
      { optionAi: false },
    );
    expect(FORM_READ_CONCURRENCY).toBe(5);
    expect(most).toBe(5);
    expect(calls).toHaveLength(10);
    for (const p of calls) expect((p.messages[0].content as Array<{ type: string }>).filter((b) => b.type === "image")).toHaveLength(1);
    expect(calls.map(requestedPage).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(calls.every((p) => (requestInput(p)?.頁 as { of: number }).of === 10)).toBe(true);
    expect(out.unread).toEqual([]);
    expect(out.mapping.pages).toBe(10);
    expect(new Set(out.mapping.fields.map((f) => f.page))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("受け口: 10 頁の様式を 1 要求で受けて下書きにし、頁の画像を 10 枚置く", async () => {
    const answer = pagesForm(10);
    const { ctx, calls } = ctxOf(async (p) => message(pageReadReply(answer, p)));
    const objects = new Map<string, Uint8Array>();
    const bucket: PageImageBucket = {
      put: async (key, value) => {
        objects.set(key, value);
      },
      get: async (key) => {
        const o = objects.get(key);
        return o ? { body: o, size: o.length } : null;
      },
    };
    const res = await formReadPost(
      { db, bucket, aiContext: async () => ctx, newId: () => "fm-t146", optionAi: false },
      { officeId: "office-demo", accountId: "acct-yamamoto" },
      buildFormReadForm(Array.from({ length: 10 }, (_, i) => pdfPage(i + 1))),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "fm-t146", unread: [], partial: [] });
    expect(calls).toHaveLength(10);
    const saved = (await getMapping(db, "office-demo", "fm-t146"))!;
    expect(saved.mapping.pages).toBe(10);
    expect([...objects.keys()].filter((k) => k.endsWith(".jpg"))).toHaveLength(10);
  });
});

describe("見直し: 5 頁からは 4 頁ずつに分けて呼ぶ", () => {
  const key = pseudonymize([], { on: "2026-11-06" }).key;
  /** n 頁の紙の形だけ（頁ごとに欄 2 つ） */
  function paper(n: number): { subject: ReviewSubject; rows: ReviewListRow[]; images: Uint8Array[] } {
    const fields = Array.from({ length: n }, (_, i) => [1, 2].map((j) => ({ id: `f${i + 1}-${j}`, label: `欄${i + 1}-${j}`, page: i + 1, box: null }))).flat();
    const rows = fields.map((f, i): ReviewListRow => ({ rid: `r${i + 1}`, field: f.id, page: f.page, label: f.label, value: "値", box: null, painted: false }));
    const subject = { sheet: { pages: Array.from({ length: n }, (_, i) => ({ page: i + 1 })) }, fields, fieldOf: () => null, redoable: false } as unknown as ReviewSubject;
    return { subject, rows, images: Array.from({ length: n }, (_, i) => tinyJpeg(i + 1)) };
  }

  it("分け方: 4 頁までは 1 回、10 頁は 4・4・2 の 3 回", () => {
    expect(REVIEW_PAGES_PER_CALL).toBe(4);
    expect(reviewGroups(4)).toEqual([[0, 1, 2, 3]]);
    expect(reviewGroups(10).map((g) => g.length)).toEqual([4, 4, 2]);
    expect(reviewGroups(0)).toEqual([]);
  });

  it("4 頁は今までどおり 1 回（頁の番号は渡さない）", async () => {
    const p = paper(4);
    const { ctx, calls } = ctxOf(async (params) => message(JSON.stringify({ findings: [] }), SONNET));
    const got = await runAiReview(ctx, { ...p, key });
    expect(got.calls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(requestInput(calls[0])?.頁).toBeUndefined();
    expect((calls[0].messages[0].content as Array<{ type: string }>).filter((b) => b.type === "image")).toHaveLength(4);
  });

  it("10 頁は 3 回。どの回も絵は 4 枚まで、一覧はその頁の欄だけ、頁の番号を渡す。指摘は結んで、ほかの頁の行の id は使わない", async () => {
    const p = paper(10);
    const { ctx, calls } = ctxOf(async (params) => {
      const pages = requestInput(params)?.頁 as number[];
      // それぞれの回は、自分の頁の最初の行と、ほかの頁の行（r1）を挙げる。ほかの頁の行は捨てる
      const first = p.rows.find((r) => r.page === pages[0])!;
      return message(JSON.stringify({ findings: [{ id: first.rid, kind: "misplaced", where: "右へずれ", why: "隣の欄" }, { id: "r1", kind: "mismatch", where: "", why: "" }] }), SONNET);
    });
    const got = await runAiReview(ctx, { ...p, key });
    expect(got.calls).toBe(3);
    expect(calls).toHaveLength(3);
    const seen = calls.map((c) => requestInput(c)?.頁 as number[]).sort((a, b) => a[0] - b[0]);
    expect(seen).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
    for (const c of calls) {
      const pages = requestInput(c)?.頁 as number[];
      expect((c.messages[0].content as Array<{ type: string }>).filter((b) => b.type === "image")).toHaveLength(pages.length);
      const list = (requestInput(c)?.一覧 as { text: string }).text;
      for (const line of list.split("\n")) expect(pages).toContain(Number(line.split("｜")[1].replace("頁", "")));
    }
    // 1 回目は r1（自分の頁の行）、2・3 回目の r1 はほかの頁の行なので捨てる
    expect(got.findings.map((f) => [f.field, f.kind]).sort()).toEqual([
      ["f1-1", "mismatch"],
      ["f1-1", "misplaced"],
      ["f5-1", "misplaced"],
      ["f9-1", "misplaced"],
    ]);
  });

  it("どれかの回が失敗したら全体を失敗にする（人が押し直す）", async () => {
    const p = paper(10);
    let n = 0;
    const { ctx } = ctxOf(async () => {
      n++;
      if (n === 2) throw new Anthropic.APIConnectionTimeoutError();
      return message(JSON.stringify({ findings: [] }), SONNET);
    });
    await expect(runAiReview(ctx, { ...p, key })).rejects.toBeTruthy();
  });
});
