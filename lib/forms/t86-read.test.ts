// T86 の 1（読み取りの場所と確かめの画面）: 欄ごとの値の場所（頁の画像の上の 0〜1 の矩形）と書体を Opus に返させ、
// 受けた頁の画像を R2 に置き、確かめる画面で頁の上に重ねて直せる。本物の API は呼ばない（偽の client が架空の自治体の様式の返事を返す）。
import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageBoxes } from "../../components/forms/mapping/PageBoxes.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { buildParams, type AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS, PURPOSES } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { clearDemoFormPages, type SeedBucket } from "../seed/reset.ts";
import { BOX_STEP, defaultSize, FIELD_TARGET, fromPercent, moveBox, placeAt, realignOptionBoxes, resizeBox, withBox } from "./box-edit.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { buildReadRequest, FORM_READ_SYSTEM, ReadSchema } from "./form-read.ts";
import { KOMOREBI_LAYOUT, komorebiReadResult } from "./komorebi-form.fixture.ts";
import { boxMoved, checkReadResult, clampBox, fitPages, mappingStats, parseMappingInput, type FormMapping } from "./mapping.ts";
import { getMapping, readStoredMapping } from "./mapping-db.ts";
import { pageImageGet } from "./page-image-http.ts";
import { jpegSize, pageImageHref, pageImageKey, parsePageImages, storePageImages, type PageImageBucket } from "./page-images.ts";
import { formReadPost } from "./read-post.ts";
import { buildFormReadForm } from "./read-upload.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** 形だけの JPEG（SOI・JFIF・SOF0〔幅と高さ〕・SOS・EOI）。付け足し（EXIF など）は無い。seed で中身を変える */
export function tinyJpeg(width: number, height: number, seed = 0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    seed & 0xff, 0x00, 0x12, 0x34,
    0xff, 0xd9,
  ]);
}

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

/** R2 の偽物（put・get・list・delete）。fail で put を落とす */
function fakeBucket(fail = false) {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const bucket: PageImageBucket & SeedBucket = {
    put: async (key, value, options) => {
      if (fail) throw new Error("R2 の失敗");
      objects.set(key, { bytes: value, type: options?.httpMetadata?.contentType });
    },
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: o.bytes, size: o.bytes.length } : null;
    },
    head: async (key) => (objects.has(key) ? {} : null),
    list: async ({ prefix }) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    delete: async (keys) => {
      for (const k of keys) objects.delete(k);
    },
  };
  return { bucket, objects };
}

const principal = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: false,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const SCOPE = { officeId: "office-demo", accountId: "acct-yamamoto" };

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

/** 偽の client で AI を呼ぶ文脈。返事は架空の自治体の様式（頁は 3 と言う。受けた画像の数にそろうか見る） */
function aiFake(answer: object = { ...komorebiReadResult(), pages: 3 }) {
  const calls: Params[] = [];
  const claude: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(JSON.stringify(answer));
        },
      },
    },
  };
  const aiContext = async (): Promise<AskJsonContext> => ({
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage: d1UsageStore(db),
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-04T06:00:00.000Z"),
    claude,
  });
  return { calls, aiContext };
}

/** 黒塗りの画面を通した頁の画像を送る形（白紙なので塗らずに送信を選んだ印 bare） */
function pagesForm(images: Uint8Array[]): FormData {
  return buildFormReadForm(
    images.map((bytes, i) => ({ blob: new Blob([bytes as BlobPart], { type: "image/jpeg" }), meta: { source: "pdf" as const, page: i + 1, redacted: 0 }, bare: true })),
  );
}

const A4 = [tinyJpeg(1240, 1754, 1), tinyJpeg(1240, 1754, 2)];

// ---------- 場所の形 ----------

describe("場所の形（0〜1 の矩形）", () => {
  it("頁の中に収める。数でない・幅や高さが 0 以下・小さすぎる物は場所なし", () => {
    expect(clampBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.04 })).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.04 });
    expect(clampBox({ x: 0.9, y: 0.95, w: 0.3, h: 0.1 })).toEqual({ x: 0.9, y: 0.95, w: 0.1, h: 0.05 });
    expect(clampBox({ x: -0.05, y: 0.1, w: 0.2, h: 0.05 })).toEqual({ x: 0, y: 0.1, w: 0.15, h: 0.05 });
    expect(clampBox({ x: 0.123456, y: 0.2, w: 0.3, h: 0.04 })).toEqual({ x: 0.1235, y: 0.2, w: 0.3, h: 0.04 });
    for (const bad of [null, "x", { x: 0.1, y: 0.1, w: 0, h: 0.1 }, { x: 0.1, y: 0.1, w: 0.1 }, { x: NaN, y: 0, w: 0.1, h: 0.1 }, { x: 1, y: 0, w: 0.1, h: 0.1 }, { x: 0.1, y: 0.1, w: 0.001, h: 0.1 }]) {
      expect(clampBox(bad)).toBeNull();
    }
  });

  it("AI の返事: 欄ごとの場所・選択肢の場所・書体を残す。AI の読んだ場所も ai.box に", () => {
    const { mapping } = checkReadResult(komorebiReadResult("mincho"));
    expect(mapping.typeface).toBe("mincho");
    expect(mapping.fields).toHaveLength(KOMOREBI_LAYOUT.length);
    const name = mapping.fields.find((f) => f.label === "氏名" && f.section === "本人")!;
    expect(name.box).toEqual({ x: 0.3, y: 0.195, w: 0.62, h: 0.035 });
    expect(name.ai?.box).toEqual(name.box);
    const sex = mapping.fields.find((f) => f.label === "性別")!;
    expect(sex.options).toEqual(["男", "女"]);
    expect(sex.optionBoxes).toHaveLength(2);
    expect(sex.optionBoxes![1]).toEqual({ x: 0.43, y: 0.241, w: 0.018, h: 0.013 });
    // choice のほかの形は選択肢の場所を持たない
    expect(mapping.fields.find((f) => f.shape === "check")!.optionBoxes).toBeUndefined();
    expect(mappingStats(mapping)).toMatchObject({ fields: 20, placed: 20, boxMoved: 0 });
  });

  it("空の選択肢を落とすと、その場所もいっしょに落とす（並びがずれない）", () => {
    const r = komorebiReadResult();
    r.fields = [{ ...r.fields[3], options: ["男", " ", "女"], option_boxes: [{ x: 0.1, y: 0.1, w: 0.02, h: 0.02 }, { x: 0.2, y: 0.1, w: 0.02, h: 0.02 }, { x: 0.3, y: 0.1, w: 0.02, h: 0.02 }] }];
    const f = checkReadResult(r).mapping.fields[0];
    expect(f.options).toEqual(["男", "女"]);
    expect(f.optionBoxes?.map((b) => b?.x)).toEqual([0.1, 0.3]);
  });

  it("前の返事（場所の欄が無い。内閣府の様式例）は場所なしで、数え方も前のまま", () => {
    const { mapping } = checkReadResult(CAO_FORM_READ);
    expect(mapping.typeface).toBeUndefined();
    expect(mapping.fields.every((f) => f.box === undefined && f.ai?.box === undefined)).toBe(true);
    expect(mappingStats(mapping)).toMatchObject({ placed: 0, boxMoved: 0 });
  });

  it("画面から保存する対応表: 場所・選択肢の場所・書体・AI の読んだ場所を受け、はみ出しは切る。保存した JSON から読み戻せる", () => {
    const { mapping } = checkReadResult(komorebiReadResult());
    const moved = mapping.fields.map((f) => (f.label === "住所" ? { ...f, box: { x: 0.3, y: 0.31, w: 0.9, h: 0.035 } } : f));
    const parsed = parseMappingInput(JSON.parse(JSON.stringify({ ...mapping, fields: moved, typeface: "gothic" })));
    if (!parsed.ok) throw new Error(parsed.error);
    const addr = parsed.mapping.fields.find((f) => f.label === "住所")!;
    expect(addr.box).toEqual({ x: 0.3, y: 0.31, w: 0.7, h: 0.035 });
    expect(addr.ai?.box).toEqual({ x: 0.3, y: 0.3, w: 0.62, h: 0.035 });
    expect(boxMoved(addr)).toBe(true);
    expect(parsed.mapping.typeface).toBe("gothic");
    expect(parsed.mapping.fields.find((f) => f.label === "性別")!.optionBoxes).toHaveLength(2);
    expect(mappingStats(parsed.mapping)).toMatchObject({ placed: 20, boxMoved: 1 });
    // 保存した JSON からの読み戻し（D1 の mapping 列）
    const stored = readStoredMapping(JSON.stringify(parsed.mapping))!;
    expect(stored).toEqual(parsed.mapping);
    // 知らない書体は既定のゴシック、場所の形が違えば場所なし
    const odd = parseMappingInput({ ...mapping, typeface: "cursive", fields: [{ ...mapping.fields[0], box: { x: "a" } }] });
    expect(odd.ok && odd.mapping.typeface).toBe("gothic");
    expect(odd.ok && odd.mapping.fields[0].box).toBeNull();
  });

  it("頁の数は受けた頁の画像の数にそろえ、欄の頁もその中に", () => {
    const { mapping } = checkReadResult({ ...komorebiReadResult(), pages: 3, fields: [{ ...komorebiReadResult().fields[0], page: 3 }] });
    const fitted = fitPages(mapping, 2);
    expect(fitted.pages).toBe(2);
    expect(fitted.fields[0].page).toBe(2);
  });
});

// ---------- 場所を直す計算 ----------

describe("場所を直す（確かめの画面の計算）", () => {
  const b = { x: 0.3, y: 0.2, w: 0.6, h: 0.04 };
  it("動かす・大きさを変える・数（%）で直す。頁の外へは出さない", () => {
    expect(moveBox(b, BOX_STEP, 0)).toEqual({ ...b, x: 0.305 });
    expect(moveBox(b, 1, 1)).toEqual({ ...b, x: 0.4, y: 0.96 });
    expect(moveBox(b, -1, -1)).toEqual({ ...b, x: 0, y: 0 });
    expect(resizeBox(b, 0.01, -0.01)).toEqual({ ...b, w: 0.61, h: 0.03 });
    expect(resizeBox(b, 1, 0)).toEqual({ ...b, w: 0.7 });
    expect(fromPercent(b, "y", 25)).toEqual({ ...b, y: 0.25 });
    expect(fromPercent(b, "w", Number("x"))).toEqual(b);
  });

  it("押した所へ移す（大きさは保つ）。場所が無ければ形に合う大きさで置く", () => {
    expect(placeAt(b, { w: 0.1, h: 0.1 }, 0.1, 0.5)).toEqual({ ...b, x: 0.1, y: 0.5 });
    expect(placeAt(b, { w: 0.1, h: 0.1 }, 0.9, 0.99)).toEqual({ ...b, x: 0.4, y: 0.96 });
    const check = checkReadResult(komorebiReadResult()).mapping.fields.find((f) => f.shape === "check")!;
    expect(placeAt(null, defaultSize(check, FIELD_TARGET), 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5, w: 0.025, h: 0.018 });
  });

  it("選択肢の場所を替える・選択肢を書き直すと同じ名前の場所を引き継ぐ", () => {
    const sex = checkReadResult(komorebiReadResult()).mapping.fields.find((f) => f.label === "性別")!;
    const moved = withBox(sex, 1, { x: 0.5, y: 0.241, w: 0.018, h: 0.013 });
    expect(moved.optionBoxes![1]!.x).toBe(0.5);
    expect(moved.box).toEqual(sex.box);
    const cleared = withBox(withBox(sex, 0, null), 1, null);
    expect(cleared.optionBoxes).toBeUndefined();
    const re = realignOptionBoxes(sex, ["女", "その他"]);
    expect(re.options).toEqual(["女", "その他"]);
    expect(re.optionBoxes).toEqual([sex.optionBoxes![1], null]);
    expect(realignOptionBoxes(sex, ["はい"]).optionBoxes).toBeUndefined();
  });
});

// ---------- Claude への頼み ----------

describe("Claude への頼み（form_read）", () => {
  it("返事の形に欄ごとの場所・選択肢の場所・書体。指示に場所の決まり。モデルは Opus・effort high のまま", () => {
    const shape = ReadSchema.safeParse(komorebiReadResult());
    expect(shape.success).toBe(true);
    // 前の形（場所の欄が無い返事）は通さない（構造化出力で全部の欄を求める）
    expect(ReadSchema.safeParse(CAO_FORM_READ).success).toBe(false);
    expect(FORM_READ_SYSTEM).toContain("左上を (0,0)、右下を (1,1)");
    expect(FORM_READ_SYSTEM).toContain("option_boxes");
    expect(FORM_READ_SYSTEM).toContain("typeface");
    expect(PURPOSES.form_read).toMatchObject({ model: OPUS, effort: "high" });
    const params = buildParams(buildReadRequest({ kind: "image", attachment: { kind: "image", mediaType: "image/jpeg", data: "QQ==" }, bytes: 1 }), OPUS);
    expect(JSON.stringify(params.output_config)).toContain("option_boxes");
  });
});

// ---------- 受け口（頁の画像を置く） ----------

describe("様式の読み取りの受け口（lib/forms/read-post.ts）", () => {
  it("読んだ対応表に場所が入り、頁の数は受けた画像の数。頁の画像を R2 の事業所の置き場に置き、大きさを D1 に", async () => {
    const { bucket, objects } = fakeBucket();
    const ai = aiFake();
    const res = await formReadPost({ db, bucket, aiContext: ai.aiContext, newId: () => "fm-komorebi" }, SCOPE, pagesForm(A4));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "fm-komorebi", reused: false, rejected: 0 });
    expect(ai.calls).toHaveLength(1);

    const stored = (await getMapping(db, "office-demo", "fm-komorebi"))!;
    expect(stored.status).toBe("draft");
    expect(stored.mapping.pages).toBe(2);
    expect(stored.mapping.typeface).toBe("mincho");
    expect(mappingStats(stored.mapping)).toMatchObject({ placed: 20 });
    expect(stored.pageImages).toEqual([
      { page: 1, width: 1240, height: 1754, bytes: A4[0].length },
      { page: 2, width: 1240, height: 1754, bytes: A4[1].length },
    ]);
    expect([...objects.keys()].sort()).toEqual(["forms/office-demo/fm-komorebi/1.jpg", "forms/office-demo/fm-komorebi/2.jpg"]);
    expect(objects.get(pageImageKey("office-demo", "fm-komorebi", 2))).toEqual({ bytes: A4[1], type: "image/jpeg" });
  });

  it("同じ頁の画像は読み直さない（AI を呼ばない）。T86 の前に読んだ対応表（画像なし）なら、ここで画像を置く", async () => {
    const { bucket, objects } = fakeBucket();
    const ai = aiFake();
    const deps = { db, bucket, aiContext: ai.aiContext, newId: () => "fm-1" };
    await formReadPost(deps, SCOPE, pagesForm(A4));
    // 画像の無い前の対応表にする
    sqlite.exec("UPDATE form_mappings SET page_images = NULL");
    objects.clear();
    const again = await formReadPost(deps, SCOPE, pagesForm(A4));
    expect(await again.json()).toMatchObject({ ok: true, id: "fm-1", reused: true });
    expect(ai.calls).toHaveLength(1);
    expect(objects.size).toBe(2);
    expect((await getMapping(db, "office-demo", "fm-1"))!.pageImages).toHaveLength(2);
  });

  it("R2 に置けなくても読み取りは成り立つ（画像なし → 紙は 2 列のまま）", async () => {
    const { bucket } = fakeBucket(true);
    const res = await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-2" }, SCOPE, pagesForm(A4));
    expect(res.status).toBe(200);
    const stored = (await getMapping(db, "office-demo", "fm-2"))!;
    expect(stored.pageImages).toBeNull();
    expect(stored.mapping.fields.length).toBe(20);
  });

  it("塗っていない印の無い頁・生のファイルは今までどおり未加工で断り、AI も R2 も呼ばない", async () => {
    const { bucket, objects } = fakeBucket();
    const ai = aiFake();
    const form = pagesForm([A4[0]]);
    form.set("bare", "0");
    const res = await formReadPost({ db, bucket, aiContext: ai.aiContext }, SCOPE, form);
    expect(res.status).toBe(415);
    expect(ai.calls).toHaveLength(0);
    expect(objects.size).toBe(0);
  });
});

// ---------- 頁の画像 ----------

describe("頁の画像（JPEG の大きさ・保存の形・返す道の壁）", () => {
  it("JPEG の SOF から幅と高さ。壊れた物・SOF の無い物は null", () => {
    expect(jpegSize(tinyJpeg(1240, 1754))).toEqual({ width: 1240, height: 1754 });
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("保存の形は頁が 1 から順の物だけ", () => {
    expect(parsePageImages('[{"page":1,"width":10,"height":20,"bytes":30}]')).toEqual([{ page: 1, width: 10, height: 20, bytes: 30 }]);
    for (const bad of [null, "", "x", "[]", '[{"page":2,"width":10,"height":20,"bytes":30}]', '[{"page":1,"width":0,"height":20,"bytes":30}]']) {
      expect(parsePageImages(bad)).toBeNull();
    }
    expect(pageImageHref("fm 1", 2)).toBe("/api/forms/mappings/fm%201/pages/2");
  });

  it("自分の事業所の対応表の頁だけ返す。ログインなし 401、ケアマネの役でない 403、ほかの事業所・無い頁 404。手元に残さない", async () => {
    const { bucket } = fakeBucket();
    await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-3" }, SCOPE, pagesForm(A4));
    const ok = await pageImageGet(db, bucket, principal(), "fm-3", "2");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(A4[1]);
    expect((await pageImageGet(db, bucket, null, "fm-3", "1")).status).toBe(401);
    expect((await pageImageGet(db, bucket, principal({ role: "medical", office: null, caseloadOf: null }), "fm-3", "1")).status).toBe(403);
    const other = principal({ office: { id: "office-partner", name: "協力事業所", kind: "regular" } });
    expect((await pageImageGet(db, bucket, other, "fm-3", "1")).status).toBe(404);
    for (const page of ["3", "0", "x", "1.jpg"]) expect((await pageImageGet(db, bucket, principal(), "fm-3", page)).status).toBe(404);
    expect((await pageImageGet(db, bucket, principal(), "../fm-3", "1")).status).toBe(404);
  });

  it("D1 の書き込みは対応表の版を上げない（人が確かめる中身でない）", async () => {
    const { bucket } = fakeBucket();
    await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-4" }, SCOPE, pagesForm(A4));
    expect((await getMapping(db, "office-demo", "fm-4"))!.version).toBe(1);
    expect(await storePageImages(db, bucket, { officeId: "office-demo", mappingId: "fm-4", images: [new Uint8Array([1, 2])] })).toBeNull();
  });

  it("デモ事業所の戻しで、デモ事業所の頁の画像だけ消す（対応表は戻しで消える）", async () => {
    const { bucket, objects } = fakeBucket();
    objects.set("forms/office-demo/fm-1/1.jpg", { bytes: A4[0] });
    objects.set("forms/office-demo/fm-1/2.jpg", { bytes: A4[1] });
    objects.set("forms/office-partner/fm-9/1.jpg", { bytes: A4[0] });
    objects.set("recordings/office-demo/p-01/x.webm", { bytes: A4[0] });
    expect(await clearDemoFormPages(bucket)).toBe(2);
    expect([...objects.keys()].sort()).toEqual(["forms/office-partner/fm-9/1.jpg", "recordings/office-demo/p-01/x.webm"]);
  });
});

// ---------- 確かめの画面 ----------

describe("確かめの画面（頁の画像の上に場所を重ねる）", () => {
  const { mapping } = checkReadResult(komorebiReadResult());
  const pages = [1, 2].map((page) => ({ page, width: 1240, height: 1754, src: pageImageHref("fm-1", page) }));
  const html = (selected: string | null, target = FIELD_TARGET, m: FormMapping = mapping) =>
    renderToStaticMarkup(
      createElement(PageBoxes, { pages, fields: m.fields, selected, target, onSelect: () => {}, onTarget: () => {}, onBox: () => {} }),
    );

  it("頁の画像と、その頁の欄の枠を比（%）の位置で。選んだ欄の枠と、位置の直し（動かす・数）", () => {
    const name = mapping.fields.find((f) => f.label === "氏名" && f.section === "本人")!;
    const out = html(name.id);
    expect(out).toContain('src="/api/forms/mappings/fm-1/pages/1"');
    expect(out).toContain('aria-label="1頁 元様式"');
    // 1 頁の欄は 15、2 頁の欄はこの頁に出ない
    expect(out.match(/data-box="/g)).toHaveLength(15);
    expect(out).toContain(`data-box="${name.id}"`);
    expect(out).toMatch(new RegExp(`border-2 border-accent" style="left:30\\.00%;top:19\\.50%;width:62\\.00%;height:3\\.50%" data-box="${name.id}"`));
    expect(out).toContain(`data-box-controls="${name.id}"`);
    for (const w of ["左", "右", "上", "下", "位置解除", "左端", "上端", "幅", "高さ"]) expect(out).toContain(w);
    expect(out).toContain('data-box-input="y" value="19.5"');
    // 面を塗らない（様式の字を隠さない）。選んだ印に薄い下地を敷かない
    expect(out).not.toMatch(/bg-accent|bg-\[/);
  });

  it("choice は選択肢ごとの □ の枠と対象の切替。場所の無い欄は位置なしと位置追加", () => {
    const sex = mapping.fields.find((f) => f.label === "性別")!;
    const out = html(sex.id, 1);
    expect(out.match(/data-option-box="/g)).toHaveLength(2);
    expect(out).toContain('aria-pressed="true" class="absolute border-2 border-accent" style="left:43.00%');
    expect(out).toContain('aria-label="対象"');
    const none = { ...mapping, fields: mapping.fields.map((f) => (f.id === sex.id ? { ...f, box: null } : f)) };
    const empty = html(sex.id, FIELD_TARGET, none);
    expect(empty).toContain("位置なし");
    expect(empty).toContain("位置追加");
  });
});
