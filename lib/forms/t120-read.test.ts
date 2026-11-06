// T120 の 1: 様式の読み取りを 1 頁 1 回で読む・短い答えの形・切れた答えから読めた欄を拾って続きを頼む・読めた頁から見せる・読めなかった頁の読み直し。
// 本物の API は呼ばない（偽の client が架空の自治体の様式の返事を、頼まれた頁の分だけ返す）。
import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { AiCallFailed, AiTruncated } from "../claude/errors.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { AiCallRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { doneFieldsOf, joinPageReads, readForm, salvagePageRead, toPageRead, type FormFile, type PageRead } from "./form-read.ts";
import { pageReadReply, requestedDone, requestedPage, requestInput } from "./form-read-fake.ts";
import { komorebiReadResult } from "./komorebi-form.fixture.ts";
import { checkReadResult, type ReadResult } from "./mapping.ts";
import { getMapping, saveCheckedMapping } from "./mapping-db.ts";
import type { PageImageBucket } from "./page-images.ts";
import { formReadPost, formRereadPost, mergeReread } from "./read-post.ts";
import { packInk } from "./ink.ts";
import { buildFormReadForm } from "./read-upload.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** 形だけの JPEG（SOF0 に幅と高さ。付け足しなし）。seed で中身を変える */
function tinyJpeg(width: number, height: number, seed = 0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    seed & 0xff, 0x00, 0x12, 0x34,
    0xff, 0xd9,
  ]);
}

function message(text: string, stop: Message["stop_reason"] = "end_turn", out = 2400): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 3200, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** 3 頁の架空の様式（こもれび市の 2 頁に、1 頁目の欄を写した 3 頁目を足す）。欄の多い様式の代わり */
function threePages(): ReadResult {
  const k = komorebiReadResult();
  const p3 = k.fields.filter((f) => f.page === 1).map((f) => ({ ...f, page: 3, section: `続き ${f.section}` }));
  return { ...k, pages: 3, fields: [...k.fields, ...p3] };
}

const image = (seed: number): FormFile => ({ kind: "image", attachment: { kind: "image", mediaType: "image/jpeg", data: Buffer.from(tinyJpeg(1240, 1754, seed)).toString("base64") }, bytes: 60 });

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
    ctx: { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-05T00:00:00.000Z"), claude },
  };
}

const aiRows = () => sqlite.prepare("SELECT * FROM ai_calls ORDER BY started_at, rowid").all() as unknown as AiCallRow[];

describe("1 頁 1 回で読む", () => {
  it("3 頁の様式は 3 回。頁ごとに 1 枚の画像と「頁」の番号を渡し、欄の頁は呼んだ頁。題名と書体は 1 頁目から", async () => {
    const answer = threePages();
    const { ctx, calls } = ctxOf(async (p) => message(pageReadReply(answer, p)));
    const out = await readForm([image(1), image(2), image(3)], ctx);
    expect(calls).toHaveLength(3);
    for (const p of calls) {
      const content = p.messages[0].content as Array<{ type: string }>;
      expect(content.map((b) => b.type)).toEqual(["image", "text"]);
    }
    expect(calls.map(requestedPage).sort()).toEqual([1, 2, 3]);
    expect(calls.every((p) => (requestInput(p)?.頁 as { of: number }).of === 3)).toBe(true);
    expect(out.unread).toEqual([]);
    expect(out.mapping.pages).toBe(3);
    expect(out.mapping.title).toBe(answer.title);
    expect(out.mapping.typeface).toBe("mincho");
    const want = checkReadResult(answer).mapping.fields.map((f) => [f.page, f.section, f.label, f.item]);
    expect(out.mapping.fields.map((f) => [f.page, f.section, f.label, f.item])).toEqual(want);
    expect(aiRows()).toHaveLength(3);
  });

  it("頁は並べて呼ぶ（既定）。concurrency 1 なら 1 頁ずつ", async () => {
    const answer = threePages();
    let open = 0;
    let most = 0;
    const slow = async (p: Params) => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 15));
      open--;
      return message(pageReadReply(answer, p));
    };
    await readForm([image(1), image(2), image(3)], ctxOf(slow).ctx);
    expect(most).toBe(3);
    most = 0;
    await readForm([image(1), image(2), image(3)], ctxOf(slow).ctx, { concurrency: 1 });
    expect(most).toBe(1);
  });

  it("答えの形は前より短い（頁・位置の説明を返させない、段の見出しは段ごとに 1 回、場所は数の並び）", () => {
    const k = komorebiReadResult();
    const before = JSON.stringify(k).length;
    const after = JSON.stringify(toPageRead(k, 1)).length + JSON.stringify(toPageRead(k, 2)).length;
    // 評価の 1 回目の本物の答え（65〜71 欄）で 18〜22% 短い。小さな架空の様式は位置の説明が短いので 1 割ほど
    expect(after).toBeLessThan(before * 0.9);
  });

  it("1 頁の失敗では止めない: 読めた頁の欄で対応表、読めなかった頁は unread。全部の頁が失敗なら最初の失敗を投げる", async () => {
    const answer = threePages();
    const { ctx } = ctxOf(async (p) => {
      if (requestedPage(p) === 2) throw new Anthropic.APIConnectionTimeoutError();
      return message(pageReadReply(answer, p));
    });
    const out = await readForm([image(1), image(2), image(3)], ctx);
    expect(out.unread).toEqual([2]);
    expect(out.mapping.unread).toEqual([2]);
    expect(new Set(out.mapping.fields.map((f) => f.page))).toEqual(new Set([1, 3]));

    const down = ctxOf(async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    await expect(readForm([image(1), image(2)], down.ctx)).rejects.toBeInstanceOf(AiCallFailed);
  });
});

describe("切れた答えから読めた欄を拾う", () => {
  const page1 = (): PageRead => toPageRead(komorebiReadResult(), 1);

  it("欄の途中・場所の数の途中・文字の途中で切れても、終わりまで書けた欄だけを拾う", () => {
    const full = JSON.stringify(page1());
    const all = page1().sections.flatMap((s) => s.fields).length;
    // 7 つ目の欄の終わりの後ろで、8 つ目の欄の途中を色々な所で切る
    const ends: number[] = [];
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < full.length; i++) {
      const c = full[i];
      if (c === '"' && full[i - 1] !== "\\") inStr = !inStr;
      if (inStr) continue;
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") {
        depth--;
        if (c === "}" && depth === 4) ends.push(i);
      }
    }
    expect(ends.length).toBe(all);
    const cut7 = ends[6];
    for (const extra of [1, 12, 40, 80]) {
      const got = salvagePageRead(full.slice(0, cut7 + extra))!;
      expect(got.sections.flatMap((s) => s.fields)).toHaveLength(7);
      expect(got.title).toBe(page1().title);
    }
    expect(salvagePageRead(full.slice(0, 30))).toBeNull();
    expect(salvagePageRead("")).toBeNull();
    expect(salvagePageRead(full)?.sections.flatMap((s) => s.fields)).toHaveLength(all);
  });

  it("続きをつなぐ: 読み済みの欄の繰り返しは落とし、同じ段は 1 つに", () => {
    const p = page1();
    const head: PageRead = { ...p, sections: [{ ...p.sections[0], fields: p.sections[0].fields.slice(0, 2) }] };
    const more: PageRead = { ...p, title: "", sections: p.sections.map((s, i) => (i === 0 ? { ...s, fields: s.fields.slice(1) } : s)) };
    const joined = joinPageReads(head, more);
    expect(joined.sections.map((s) => s.name)).toEqual(p.sections.map((s) => s.name));
    expect(joined.sections.flatMap((s) => s.fields.map((f) => f.label))).toEqual(p.sections.flatMap((s) => s.fields.map((f) => f.label)));
    expect(joined.title).toBe(p.title);
  });

  it("出力の上限で切れたら、拾った欄の名前を「読み済み」に渡して続きを 1 回頼む（仮名化の門を通る）。続きの欄とつなぐ", async () => {
    const answer = komorebiReadResult();
    const full = JSON.stringify(toPageRead(answer, 1));
    const { ctx, calls } = ctxOf(async (p) => {
      if (requestedDone(p) === null) return message(full.slice(0, Math.floor(full.length * 0.55)), "max_tokens", 20000);
      return message(pageReadReply(answer, p));
    });
    const out = await readForm([image(1)], ctx);
    expect(calls).toHaveLength(2);
    const done = requestedDone(calls[1])!;
    expect(done.length).toBeGreaterThan(3);
    expect(done[0]).toEqual({ 段: answer.fields[0].section, 欄: answer.fields[0].label });
    expect(out.continued).toEqual([1]);
    expect(out.partial).toEqual([]);
    expect(out.mapping.fields.map((f) => f.label)).toEqual(answer.fields.filter((f) => f.page === 1).map((f) => f.label));
    // 切れた 1 回目は失敗（bad_output）、続きは ok で数える
    expect(aiRows().map((r) => [r.status, r.error])).toEqual([
      ["failed", "bad_output"],
      ["ok", null],
    ]);
  });

  it("続きも失敗したら、拾えた欄だけで返す（partial）。拾えなければその頁は読めない", async () => {
    const answer = komorebiReadResult();
    const full = JSON.stringify(toPageRead(answer, 1));
    const { ctx } = ctxOf(async (p) => {
      if (requestedDone(p) === null) return message(full.slice(0, Math.floor(full.length * 0.5)), "max_tokens", 20000);
      throw new Anthropic.APIConnectionTimeoutError();
    });
    const out = await readForm([image(1)], ctx);
    expect(out.partial).toEqual([1]);
    expect(out.mapping.fields.length).toBeGreaterThan(3);
    expect(out.mapping.fields.length).toBeLessThan(answer.fields.filter((f) => f.page === 1).length);

    const none = ctxOf(async () => message('{"title":"様', "max_tokens", 20000));
    await expect(readForm([image(1)], none.ctx)).rejects.toBeInstanceOf(AiTruncated);
  });

  it("読み済みの欄の名前に電話番号らしい並びがあれば消してから渡す", async () => {
    const answer = komorebiReadResult();
    answer.fields[0] = { ...answer.fields[0], label: "連絡先 089-000-0000" };
    const full = JSON.stringify(toPageRead(answer, 1));
    const { ctx, calls } = ctxOf(async (p) => {
      if (requestedDone(p) === null) return message(full.slice(0, Math.floor(full.length * 0.5)), "max_tokens", 20000);
      return message(pageReadReply(answer, p));
    });
    await readForm([image(1)], ctx);
    expect(JSON.stringify(calls[1].messages)).not.toContain("089-000-0000");
  });

  it("読み済みの欄の名前の並びは返事の欄の順", () => {
    const p = toPageRead(komorebiReadResult(), 2);
    expect(doneFieldsOf(p).map((d) => d.欄)).toEqual(komorebiReadResult().fields.filter((f) => f.page === 2).map((f) => f.label));
  });
});

describe("候補（項目なしの欄）", () => {
  it("同意の欄は item を null のまま、候補だけを残す。台帳に無い候補・手書きの欄の候補は捨てる", () => {
    const k = komorebiReadResult();
    const consent = k.fields.findIndex((f) => f.section.includes("同意") || f.label.includes("同意"));
    expect(consent).toBeGreaterThanOrEqual(0);
    k.fields[consent] = { ...k.fields[consent], item: null, candidate: "consent.registry" };
    k.fields[0] = { ...k.fields[0], item: null, candidate: "person.nickname" };
    const m = checkReadResult(k).mapping;
    expect(m.fields[consent].item).toBeNull();
    expect(m.fields[consent].ai?.candidate).toBe("consent.registry");
    expect(m.fields[0].ai?.candidate).toBeUndefined();
  });
});

describe("受け口: 読めた頁から見せ、読めなかった頁を読み直す", () => {
  function bucketFake() {
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
    return { bucket, objects };
  }
  const SCOPE = { officeId: "office-demo", accountId: "acct-yamamoto" };
  const form = (n: number) =>
    buildFormReadForm(
      Array.from({ length: n }, (_, i) => ({
        blob: new Blob([tinyJpeg(1240, 1754, i + 1) as BlobPart], { type: "image/jpeg" }),
        meta: { source: "pdf" as const, page: i + 1, redacted: 0 },
        bare: true,
      })),
    );

  it("2 頁目が読めなくても下書きを保存し unread を返す。再読で 2 頁目の欄を足し、unread を外して版を上げる", async () => {
    const answer = threePages();
    let down = true;
    const { ctx, calls } = ctxOf(async (p) => {
      if (down && requestedPage(p) === 2) throw new Anthropic.APIConnectionTimeoutError();
      return message(pageReadReply(answer, p));
    });
    const { bucket } = bucketFake();
    const deps = { db, bucket, aiContext: async () => ctx, newId: () => "fm-t120" };
    const res = await formReadPost(deps, SCOPE, form(3));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "fm-t120", unread: [2], partial: [] });
    const first = (await getMapping(db, "office-demo", "fm-t120"))!;
    expect(first.mapping.unread).toEqual([2]);
    const before = first.mapping.fields.length;

    // 人が確認保存したあとでも、再読で AI の欄が足されたら下書きに戻る
    const checked = await saveCheckedMapping(db, { officeId: "office-demo", id: "fm-t120", version: first.version, mapping: first.mapping, by: "acct-yamamoto", at: "2026-11-05T01:00:00.000Z" });
    expect(checked.ok).toBe(true);
    const confirmed = (await getMapping(db, "office-demo", "fm-t120"))!;
    expect(confirmed.status).toBe("checked");

    down = false;
    const conflict = await formRereadPost(deps, SCOPE, "fm-t120", confirmed.version + 1);
    expect(conflict.status).toBe(409);
    const n = calls.length;
    const again = await formRereadPost(deps, SCOPE, "fm-t120", confirmed.version);
    expect(again.status).toBe(200);
    const body = (await again.json()) as { version: number; unread: number[] };
    expect(body).toMatchObject({ ok: true, version: confirmed.version + 1, unread: [] });
    expect(calls.slice(n).map(requestedPage)).toEqual([2]);
    const after = (await getMapping(db, "office-demo", "fm-t120"))!;
    expect(after.status).toBe("draft");
    expect(after.checked_at).toBeNull();
    expect(after.mapping.unread).toBeUndefined();
    expect(after.mapping.fields.length).toBe(before + answer.fields.filter((f) => f.page === 2).length);
    expect(new Set(after.mapping.fields.map((f) => f.id)).size).toBe(after.mapping.fields.length);
    expect(after.mapping.fields.filter((f) => f.page === 2).length).toBeGreaterThan(0);
  });

  it("全部の頁が読めなければ前と同じく AI 失敗（保存しない）", async () => {
    const { ctx } = ctxOf(async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    const res = await formReadPost({ db, bucket: bucketFake().bucket, aiContext: async () => ctx, newId: () => "fm-x" }, SCOPE, form(2));
    expect(res.status).toBe(502);
    expect(await getMapping(db, "office-demo", "fm-x")).toBeNull();
  });

  it("読み直しの欄は後ろに足し、id は続きの番号", () => {
    const cur = checkReadResult({ ...CAO_FORM_READ, fields: CAO_FORM_READ.fields.slice(0, 3), unread: [2] }).mapping;
    const read = checkReadResult({ ...CAO_FORM_READ, fields: CAO_FORM_READ.fields.slice(3, 5).map((f) => ({ ...f, page: 2 })) }).mapping;
    const m = mergeReread(cur, read, []);
    expect(m.fields.map((f) => f.id)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    expect(m.unread).toBeUndefined();
    expect(mergeReread(cur, read, [2]).unread).toEqual([2]);
  });
});

describe("読み取りの受け口の □ の右の空き（T168）", () => {
  const BLOBS = [
    { x: 0.127, y: 0.472, w: 0.014, h: 0.01, box: true },
    { x: 0.143, y: 0.472, w: 0.07, h: 0.01, box: false },
    { x: 0.92, y: 0.3, w: 0.002, h: 0.4, box: false, line: true },
  ];
  const answer = (): ReadResult => ({
    title: "架空の様式",
    issuer: "",
    pages: 1,
    fields: [{ page: 1, section: "禁忌", label: "アレルギー", position: "", shape: "check", options: [], item: "medical.allergies", confidence: "high", reason: "", box: { x: 0.127, y: 0.47, w: 0.014, h: 0.013 } }],
  });
  const bucket = { put: async () => undefined, get: async () => null };
  const SCOPE = { officeId: "office-demo", accountId: "acct-yamamoto" };
  const form = (ink: number[] | null) =>
    buildFormReadForm([{ blob: new Blob([tinyJpeg(1240, 1754, 7) as BlobPart], { type: "image/jpeg" }), meta: { source: "pdf" as const, page: 1, redacted: 0 }, bare: true, ...(ink ? { ink } : {}) }]);

  it("印刷の字の位置があれば字の欄を足して保存。無ければ足さない", async () => {
    const { ctx } = ctxOf(async (p) => message(pageReadReply(answer(), p)));
    const res = await formReadPost({ db, bucket, aiContext: async () => ctx, newId: () => "fm-t168", optionAi: false }, SCOPE, form(packInk(BLOBS)));
    expect(res.status).toBe(200);
    const saved = (await getMapping(db, "office-demo", "fm-t168"))!;
    expect(saved.mapping.fields.map((f) => [f.label, f.shape, f.item])).toEqual([
      ["アレルギー", "check", "medical.allergies"],
      ["アレルギー（　）", "text", "medical.allergies"],
    ]);
    expect(saved.mapping.fields[1].ai?.reason).toContain("（補）");

    const { ctx: ctx2 } = ctxOf(async (p) => message(pageReadReply(answer(), p)));
    const form2 = buildFormReadForm([{ blob: new Blob([tinyJpeg(1240, 1754, 8) as BlobPart], { type: "image/jpeg" }), meta: { source: "pdf" as const, page: 1, redacted: 0 }, bare: true }]);
    await formReadPost({ db, bucket, aiContext: async () => ctx2, newId: () => "fm-t168b", optionAi: false }, SCOPE, form2);
    expect((await getMapping(db, "office-demo", "fm-t168b"))!.mapping.fields).toHaveLength(1);
  });
});
