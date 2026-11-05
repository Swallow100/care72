// T134 の 3・4・6: 一覧の公式の様式の取り寄せ（一覧の URL だけ取る・転送は一覧のホストだけ・版違い・壁・記録）と、
// 対応表の共有（最初の 1 回だけ AI で読み、版と頁の組が同じなら別の事業所は AI を呼ばずに写す、事業所の手直しは事業所ごと、
// 読めなかった頁のある答えは共有しない、取った記録が無い・古ければ読まない）。本物の API は呼ばない（偽の client）。
import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pageReadReply } from "./form-read-fake.ts";
import { komorebiReadResult } from "./komorebi-form.fixture.ts";
import type { ReadResult } from "./mapping.ts";
import { getMapping, saveCheckedMapping } from "./mapping-db.ts";
import { allMunicipalEntries, availability, municipalEntry } from "./municipal-forms.ts";
import {
  allowedRedirect,
  fetchOfficial,
  looksLikeFormat,
  MUNICIPAL_FETCH_TTL_MS,
  MUNICIPAL_SHA_HEADER,
  MUNICIPAL_SOURCE_MAX_BYTES,
  MUNICIPAL_VERSION_HEADER,
  municipalFetchKey,
  municipalSourceGet,
  parseFetchRecord,
} from "./municipal-http.ts";
import { sha256Hex } from "./originals.ts";
import type { PageImageBucket } from "./page-images.ts";
import { formReadPost, formRereadPost } from "./read-post.ts";
import { buildFormReadForm, formReadPagesOf, MUNICIPAL_FIELDS } from "./read-upload.ts";
import { getSharedMapping, officeCatalogMappings, pagesKeyOf, sharedCatalogIds } from "./shared-mapping.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** 形だけの JPEG（付け足しなし）。seed で中身を変える */
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

function reply(text: string, stop: "end_turn" | "max_tokens" = "end_turn"): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 3200, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket: PageImageBucket & { put(key: string, value: Uint8Array | string, o?: unknown): Promise<unknown> } = {
    put: async (key, value) => {
      objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : value);
    },
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: o, size: o.length } : null;
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
const PARTNER = principal({ accountId: "acct-partner-cm", office: { id: "office-partner", name: "協力事業所", kind: "regular" }, caseloadOf: "acct-partner-cm" });
const SCOPE = { officeId: "office-demo", accountId: "acct-yamamoto" };
const SCOPE2 = { officeId: "office-partner", accountId: "acct-partner-cm" };
const NOW = new Date("2026-11-05T06:00:00.000Z");

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

/** 偽の client。truncate の頁は出力の上限で切れた答え（読めなかった頁になる） */
function aiFake(opts: { fail?: boolean } = {}) {
  const calls: Params[] = [];
  const claude: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          if (opts.fail) throw new Error("落ちた");
          return reply(pageReadReply({ ...komorebiReadResult(), pages: 2 } as ReadResult, params));
        },
      },
    },
  };
  const aiContext = async (): Promise<AskJsonContext> => ({
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage: d1UsageStore(db),
    office: { id: "office-demo", kind: "demo" },
    now: () => NOW,
    claude,
  });
  return { calls, aiContext };
}

// 一覧の様式（PDF。取り込める物）と、偽の公式のファイル（版は一覧と違うので、版の合う道は一覧の sha を差し替えて試す）
const PDF_ENTRY = allMunicipalEntries().find((e) => e.form.format === "pdf" && availability(e).ok)!;
const XLSX_ENTRY = allMunicipalEntries().find((e) => e.form.format === "xlsx" && availability(e).ok)!;
const fakePdf = (n = 0) => new TextEncoder().encode(`%PDF-1.7\n% 偽の様式 ${n}\n%%EOF\n`);

/** 偽の fetch。urls に取った URL を残す */
function fakeFetch(routes: Record<string, () => Response>) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    const r = routes[url];
    return r ? r() : new Response("not found", { status: 404 });
  };
  return { urls, fetcher };
}

/** 一覧の版が fakePdf(0) のハッシュと同じだと見なすため、記録を直接置く（取った記録の形はサーバーと同じ） */
async function putRecord(bucket: ReturnType<typeof fakeBucket>["bucket"], officeId: string, id: string, sha256: string, at = NOW) {
  await bucket.put(municipalFetchKey(officeId, id), JSON.stringify({ id, sha256, bytes: 100, at: at.toISOString(), matches: true }));
}

/** 黒塗りの画面を通した頁（白紙なので塗らずに送信を選んだ印 bare）。origins は元の頁の番号 */
function pagesForm(images: Uint8Array[], municipal?: string, origins?: number[]): FormData {
  return buildFormReadForm(
    images.map((bytes, i) => ({
      blob: new Blob([bytes as BlobPart], { type: "image/jpeg" }),
      meta: { source: "pdf" as const, page: i + 1, redacted: 0 },
      bare: true,
      ...(origins ? { origin: origins[i] } : {}),
    })),
    municipal ? { municipal } : {},
  );
}

const A4 = (seed: number) => [tinyJpeg(1240, 1754, seed), tinyJpeg(1240, 1754, seed + 1)];

// ---------- 取り寄せ ----------

describe("取り寄せ（GET /api/forms/municipal/<id>/source）", () => {
  it("一覧の url だけを取り、版が違えば 409「版違い」と今の版のハッシュ。記録は置かない", async () => {
    const { bucket, objects } = fakeBucket();
    const body = fakePdf(1);
    const { urls, fetcher } = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response(body as BodyInit, { status: 200 }) });
    const res = await municipalSourceGet({ fetch: fetcher, bucket, now: () => NOW }, principal(), PDF_ENTRY.form.id, false);
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string; label: string; sha256: string };
    expect(j.error).toBe("version");
    expect(j.label).toBe("版違い");
    expect(j.sha256).toBe(await sha256Hex(body));
    expect(urls).toEqual([PDF_ENTRY.form.url]);
    expect(objects.size).toBe(0);
  });

  it("?accept=1（再読）は今の版を返し、取った版を事業所の R2 に記録する（ファイル本体は置かない）", async () => {
    const { bucket, objects } = fakeBucket();
    const body = fakePdf(2);
    const { fetcher } = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response(body as BodyInit, { status: 200 }) });
    const res = await municipalSourceGet({ fetch: fetcher, bucket, now: () => NOW }, principal(), PDF_ENTRY.form.id, true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get(MUNICIPAL_VERSION_HEADER)).toBe("changed");
    const sha = await sha256Hex(body);
    expect(res.headers.get(MUNICIPAL_SHA_HEADER)).toBe(sha);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
    expect([...objects.keys()]).toEqual([municipalFetchKey("office-demo", PDF_ENTRY.form.id)]);
    const rec = parseFetchRecord(PDF_ENTRY.form.id, new TextDecoder().decode(objects.values().next().value), NOW);
    expect(rec).toMatchObject({ id: PDF_ENTRY.form.id, sha256: sha, matches: false });
  });

  it("壁: ログインなし 401・ケアマネの役でない 403・一覧に無い id 404・取り込めない様式（旧形式・許諾要・内蔵）403。どれも外へ取りに行かない", async () => {
    const { bucket } = fakeBucket();
    const { urls, fetcher } = fakeFetch({});
    const get = (p: Principal | null, id: string) => municipalSourceGet({ fetch: fetcher, bucket }, p, id, true);
    expect((await get(null, PDF_ENTRY.form.id)).status).toBe(401);
    expect((await get(principal({ role: "medical" }), PDF_ENTRY.form.id)).status).toBe(403);
    expect((await get(principal({ office: null }), PDF_ENTRY.form.id)).status).toBe(403);
    expect((await get(principal(), "nowhere-1")).status).toBe(404);
    expect((await get(principal(), "../../etc")).status).toBe(404);
    expect((await get(principal(), "https://example.com/a.pdf")).status).toBe(404);
    for (const id of ["matsuyama-1", allMunicipalEntries().find((e) => e.form.format === "doc")!.form.id, allMunicipalEntries().find((e) => e.city.terms.flag === "許諾要" && e.form.format !== "doc" && e.form.format !== "xls")!.form.id]) {
      const r = await get(principal(), id);
      expect(r.status, id).toBe(403);
      expect(((await r.json()) as { label: string }).label, id).toMatch(/^(内蔵|旧形式|許諾要)$/);
    }
    expect(urls).toEqual([]);
  });

  it("転送は https で一覧のホストの中だけ、3 回まで。ほかのホスト・http・ポート付きへは行かない", async () => {
    const host = new URL(PDF_ENTRY.form.url).origin;
    const moved = `${host}/moved.pdf`;
    const ok = fakeFetch({
      [PDF_ENTRY.form.url]: () => new Response(null, { status: 301, headers: { location: "/moved.pdf" } }),
      [moved]: () => new Response(fakePdf(3) as BodyInit, { status: 200 }),
    });
    expect(await fetchOfficial(ok.fetcher, PDF_ENTRY.form.url)).toEqual(fakePdf(3));
    expect(ok.urls).toEqual([PDF_ENTRY.form.url, moved]);

    for (const loc of ["https://evil.example.com/a.pdf", "https://www.city.evil.jp/a.pdf", "http://" + new URL(PDF_ENTRY.form.url).host + "/a.pdf", `${host}:8443/a.pdf`]) {
      const f = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response(null, { status: 302, headers: { location: loc } }) });
      expect(await fetchOfficial(f.fetcher, PDF_ENTRY.form.url), loc).toBeNull();
      expect(f.urls, loc).toEqual([PDF_ENTRY.form.url]);
    }
    // 回る転送は 3 回で止める
    const loop = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response(null, { status: 302, headers: { location: PDF_ENTRY.form.url } }) });
    expect(await fetchOfficial(loop.fetcher, PDF_ENTRY.form.url)).toBeNull();
    expect(loop.urls.length).toBe(4);
    expect(allowedRedirect("https://www.nishi.or.jp/a.pdf")).toBe(false);
  });

  it("大きすぎる・空・形式の違う中身（頁の HTML など）は取得失敗", async () => {
    const { bucket } = fakeBucket();
    const big = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response("x", { status: 200, headers: { "content-length": String(MUNICIPAL_SOURCE_MAX_BYTES + 1) } }) });
    expect(await fetchOfficial(big.fetcher, PDF_ENTRY.form.url)).toBeNull();
    const html = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response("<!doctype html><title>移転</title>", { status: 200 }) });
    const r = await municipalSourceGet({ fetch: html.fetcher, bucket }, principal(), PDF_ENTRY.form.id, true);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { label: string }).label).toBe("取得失敗");
    const down = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response("", { status: 503 }) });
    expect((await municipalSourceGet({ fetch: down.fetcher, bucket }, principal(), PDF_ENTRY.form.id, true)).status).toBe(502);
    expect(looksLikeFormat("pdf", fakePdf())).toBe(true);
    expect(looksLikeFormat("xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(looksLikeFormat("xlsx", fakePdf())).toBe(false);
  });

  it("取った記録: 形が違う・別の様式・6 時間を過ぎた物は使わない", () => {
    const ok = JSON.stringify({ id: "a-1", sha256: "a".repeat(64), bytes: 10, at: NOW.toISOString(), matches: true });
    expect(parseFetchRecord("a-1", ok, NOW)).not.toBeNull();
    expect(parseFetchRecord("b-1", ok, NOW)).toBeNull();
    expect(parseFetchRecord("a-1", ok, new Date(NOW.getTime() + MUNICIPAL_FETCH_TTL_MS + 1))).toBeNull();
    expect(parseFetchRecord("a-1", "{", NOW)).toBeNull();
    expect(parseFetchRecord("a-1", JSON.stringify({ id: "a-1", sha256: "x", bytes: 10, at: NOW.toISOString(), matches: true }), NOW)).toBeNull();
  });

  it("配信の受け口は一覧の url しか渡さず、転送は自分でたどる（redirect: manual）", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(new URL("../../app/api/forms/municipal/[id]/source/route.ts", import.meta.url), "utf8");
    expect(route).toContain('redirect: "manual"');
    expect(route).not.toContain('redirect: "error"');
    expect(route).toContain("municipalSourceGet(");
    expect(route).not.toMatch(/searchParams\.get\("url"\)/);
  });
});

// ---------- 送る形 ----------

describe("送る形（一覧の様式の id と元の頁の番号）", () => {
  it("全部の頁に元の頁の番号があるときだけ送り、受ける側で読み戻す。数が合わない・形が違えば invalid", () => {
    const got = formReadPagesOf(pagesForm(A4(1), PDF_ENTRY.form.id, [1, 2]));
    expect(got.ok && got.origins).toEqual([1, 2]);
    expect(got.ok && got.municipal).toBe(PDF_ENTRY.form.id);
    const none = formReadPagesOf(pagesForm(A4(1)));
    expect(none.ok && none.origins).toBeNull();
    expect(none.ok && none.municipal).toBeNull();
    const bad = pagesForm(A4(1), PDF_ENTRY.form.id, [1, 2]);
    bad.append(MUNICIPAL_FIELDS.origin, "3");
    expect(formReadPagesOf(bad)).toEqual({ ok: false, error: "invalid" });
    const badId = pagesForm(A4(1), "../x", [1, 2]);
    expect(formReadPagesOf(badId)).toEqual({ ok: false, error: "invalid" });
    expect(pagesKeyOf([1, 2])).toBe("1,2");
    expect(pagesKeyOf([])).toBeNull();
    expect(pagesKeyOf([0])).toBeNull();
  });
});

// ---------- 共有 ----------

describe("対応表の共有", () => {
  const ID = PDF_ENTRY.form.id;
  const SHA = "b".repeat(64);

  it("最初の事業所だけ AI で読み、共有に入れる。2 つ目の事業所は AI を呼ばずに写して下書きにする（頁の画像は事業所ごとに置く）", async () => {
    const { bucket, objects } = fakeBucket();
    await putRecord(bucket, "office-demo", ID, SHA);
    await putRecord(bucket, "office-partner", ID, SHA);
    const first = aiFake();
    const r1 = await formReadPost({ db, bucket, aiContext: first.aiContext, newId: () => "fm-a", now: () => NOW.toISOString() }, SCOPE, pagesForm(A4(10), ID, [1, 2]));
    const b1 = (await r1.json()) as { ok: boolean; id: string; shared: boolean };
    expect(b1).toMatchObject({ ok: true, id: "fm-a", shared: false });
    expect(first.calls.length).toBe(2); // 1 頁 1 回
    const shared = await getSharedMapping(db, { catalogId: ID, sha256: SHA, pages: "1,2" });
    expect(shared?.aiModel).toBe(OPUS);
    expect(shared?.mapping.fields.length).toBeGreaterThan(5);

    const second = aiFake({ fail: true });
    const r2 = await formReadPost({ db, bucket, aiContext: second.aiContext, newId: () => "fm-b", now: () => NOW.toISOString() }, SCOPE2, pagesForm(A4(20), ID, [1, 2]));
    const b2 = (await r2.json()) as { ok: boolean; id: string; shared: boolean };
    expect(b2).toMatchObject({ ok: true, id: "fm-b", shared: true });
    expect(second.calls.length).toBe(0);
    const m2 = await getMapping(db, "office-partner", "fm-b");
    expect(m2?.status).toBe("draft");
    expect(m2?.ai_model).toBe(OPUS);
    expect(m2?.mapping.fields.map((f) => [f.label, f.item, f.box])).toEqual(shared!.mapping.fields.map((f) => [f.label, f.item, f.box]));
    expect(m2?.pageImages?.length).toBe(2);
    expect([...objects.keys()].filter((k) => k.startsWith("forms/office-partner/fm-b/"))).toHaveLength(2);
    // AI の呼び出しの記録（1 日の上限に数える物）は最初の事業所の 2 回だけ
    expect((sqlite.prepare("SELECT count(*) AS n FROM ai_calls").get() as { n: number }).n).toBe(2);
    expect((sqlite.prepare("SELECT uses FROM form_shared_mappings").get() as { uses: number }).uses).toBe(1);
    expect(await officeCatalogMappings(db, "office-partner")).toEqual({ [ID]: { id: "fm-b", status: "draft", sha256: SHA } });
    // 事業所の壁: ほかの事業所の対応表は読めない
    expect(await getMapping(db, "office-demo", "fm-b")).toBeNull();
  });

  it("事業所の確かめ・手直しは事業所ごと: 1 つ目の事業所が欄を直して確認保存しても、共有と 2 つ目の事業所の写しは変わらない", async () => {
    const { bucket } = fakeBucket();
    await putRecord(bucket, "office-demo", ID, SHA);
    await putRecord(bucket, "office-partner", ID, SHA);
    await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-a", now: () => NOW.toISOString() }, SCOPE, pagesForm(A4(10), ID, [1, 2]));
    const before = await getSharedMapping(db, { catalogId: ID, sha256: SHA, pages: "1,2" });
    const mine = (await getMapping(db, "office-demo", "fm-a"))!;
    const edited = { ...mine.mapping, fields: mine.mapping.fields.map((f, i) => (i === 0 ? { ...f, label: "直した欄", item: null, confirmed: true } : f)), holdRisky: true };
    expect((await saveCheckedMapping(db, { officeId: "office-demo", id: "fm-a", version: mine.version, mapping: edited, by: "acct-yamamoto", at: NOW.toISOString() })).ok).toBe(true);
    expect(await getSharedMapping(db, { catalogId: ID, sha256: SHA, pages: "1,2" })).toEqual(before);
    await formReadPost({ db, bucket, aiContext: aiFake({ fail: true }).aiContext, newId: () => "fm-b", now: () => NOW.toISOString() }, SCOPE2, pagesForm(A4(20), ID, [1, 2]));
    const theirs = (await getMapping(db, "office-partner", "fm-b"))!;
    expect(theirs.mapping.fields[0].label).not.toBe("直した欄");
    expect(theirs.mapping.holdRisky).toBeUndefined();
    expect(theirs.mapping.fields.some((f) => f.confirmed)).toBe(false);
    expect(theirs.status).toBe("draft");
  });

  it("版（サーバーの記録の版）か送った頁の組が違えば写さずに AI で読む", async () => {
    const { bucket } = fakeBucket();
    await putRecord(bucket, "office-demo", ID, SHA);
    await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-a", now: () => NOW.toISOString() }, SCOPE, pagesForm(A4(10), ID, [1, 2]));
    // 版が違う（市が様式を変えた）
    await putRecord(bucket, "office-partner", ID, "c".repeat(64));
    const v = aiFake();
    const r = (await (await formReadPost({ db, bucket, aiContext: v.aiContext, newId: () => "fm-b", now: () => NOW.toISOString() }, SCOPE2, pagesForm(A4(20), ID, [1, 2]))).json()) as {
      shared: boolean;
    };
    expect(r.shared).toBe(false);
    expect(v.calls.length).toBe(2);
    // 頁の組が違う（2 頁目と 3 頁目を選んだ）
    const p = aiFake();
    await putRecord(bucket, "office-partner", ID, SHA);
    const r2 = (await (await formReadPost({ db, bucket, aiContext: p.aiContext, newId: () => "fm-c", now: () => NOW.toISOString() }, SCOPE2, pagesForm(A4(30), ID, [2, 3]))).json()) as {
      shared: boolean;
    };
    expect(r2.shared).toBe(false);
    expect(p.calls.length).toBe(2);
    expect(await sharedCatalogIds(db, [{ id: ID, sha256: SHA }])).toEqual(new Set([ID]));
    expect(await sharedCatalogIds(db, [{ id: ID, sha256: "d".repeat(64) }])).toEqual(new Set());
  });

  it("取った記録が無い・古いと読まない（再取得）。一覧の様式でない id・取り込めない様式は断る。どれも AI を呼ばない", async () => {
    const { bucket } = fakeBucket();
    const ai = aiFake();
    const post = (form: FormData) => formReadPost({ db, bucket, aiContext: ai.aiContext, now: () => NOW.toISOString() }, SCOPE, form);
    const r = await post(pagesForm(A4(10), ID, [1, 2]));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { label: string }).label).toBe("再取得");
    await putRecord(bucket, "office-demo", ID, SHA, new Date(NOW.getTime() - MUNICIPAL_FETCH_TTL_MS - 1000));
    expect((await post(pagesForm(A4(10), ID, [1, 2]))).status).toBe(409);
    // ほかの事業所の記録は使えない
    await putRecord(bucket, "office-partner", ID, SHA);
    expect((await post(pagesForm(A4(10), ID, [1, 2]))).status).toBe(409);
    expect((await post(pagesForm(A4(10), "nowhere-9", [1, 2]))).status).toBe(400);
    expect((await post(pagesForm(A4(10), "matsuyama-1", [1, 2]))).status).toBe(403);
    expect(ai.calls.length).toBe(0);
    expect((sqlite.prepare("SELECT count(*) AS n FROM form_mappings WHERE catalog_id IS NOT NULL").get() as { n: number }).n).toBe(0);
  });

  it("読めなかった頁がある答えは共有に入れない（事業所の下書きは残り、再読できる）。元の頁の番号が無ければ共有しない", async () => {
    const { bucket } = fakeBucket();
    await putRecord(bucket, "office-demo", ID, SHA);
    // 2 頁目だけ落ちる
    const calls: Params[] = [];
    let n = 0;
    const claude: ClaudeClient = {
      beta: {
        messages: {
          create: async (params) => {
            calls.push(params);
            n++;
            if (n === 2) throw new Error("落ちた");
            return reply(pageReadReply({ ...komorebiReadResult(), pages: 2 } as ReadResult, params));
          },
        },
      },
    };
    const aiContext = async (): Promise<AskJsonContext> => ({ env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: { id: "office-demo", kind: "demo" }, now: () => NOW, claude });
    const res = (await (await formReadPost({ db, bucket, aiContext, newId: () => "fm-a", readConcurrency: 1, now: () => NOW.toISOString() }, SCOPE, pagesForm(A4(10), ID, [1, 2]))).json()) as {
      ok: boolean;
      unread: number[];
    };
    expect(res.ok).toBe(true);
    expect(res.unread.length).toBeGreaterThan(0);
    expect((sqlite.prepare("SELECT count(*) AS n FROM form_shared_mappings").get() as { n: number }).n).toBe(0);
    const m = await getMapping(db, "office-demo", "fm-a");
    expect(m?.mapping.unread?.length).toBeGreaterThan(0);
    // 再読の道は今のまま使える
    const rr = await formRereadPost({ db, bucket, aiContext: aiFake().aiContext, now: () => NOW.toISOString() }, SCOPE, "fm-a", m!.version);
    expect(rr.status).toBe(200);

    // 元の頁の番号の無い送り方（前の画面）は読むが共有しない
    await putRecord(bucket, "office-partner", ID, SHA);
    await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-b", now: () => NOW.toISOString() }, SCOPE2, pagesForm(A4(20), ID));
    expect((sqlite.prepare("SELECT count(*) AS n FROM form_shared_mappings").get() as { n: number }).n).toBe(0);
    expect((await getMapping(db, "office-partner", "fm-b"))?.mapping.fields.length).toBeGreaterThan(0);
  });

  it("一覧の様式でない読み取り（事業所が自分で入れたファイル）は今のまま: 共有に入れず、写しもしない", async () => {
    const { bucket } = fakeBucket();
    const ai = aiFake();
    const r = (await (await formReadPost({ db, bucket, aiContext: ai.aiContext, newId: () => "fm-own", now: () => NOW.toISOString() }, SCOPE, pagesForm(A4(40)))).json()) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(ai.calls.length).toBe(2);
    expect((sqlite.prepare("SELECT count(*) AS n FROM form_shared_mappings").get() as { n: number }).n).toBe(0);
    expect((sqlite.prepare("SELECT catalog_id FROM form_mappings WHERE id = 'fm-own'").get() as { catalog_id: string | null }).catalog_id).toBeNull();
  });
});

describe("一覧の様式（Excel）も同じ道", () => {
  it("Excel の頁（ブラウザで描いた頁の画像）でも記録の版と頁の組で共有する", async () => {
    const { bucket } = fakeBucket();
    const id = XLSX_ENTRY.form.id;
    await putRecord(bucket, "office-demo", id, "e".repeat(64));
    await putRecord(bucket, "office-partner", id, "e".repeat(64));
    const excelForm = (seed: number) =>
      buildFormReadForm(
        [tinyJpeg(1754, 1240, seed)].map((bytes) => ({ blob: new Blob([bytes as BlobPart], { type: "image/jpeg" }), meta: { source: "excel" as const, page: 1, redacted: 0 }, bare: true, origin: 1 })),
        { municipal: id },
      );
    await formReadPost({ db, bucket, aiContext: aiFake().aiContext, newId: () => "fm-x", now: () => NOW.toISOString() }, SCOPE, excelForm(1));
    const second = aiFake({ fail: true });
    const r = (await (await formReadPost({ db, bucket, aiContext: second.aiContext, newId: () => "fm-y", now: () => NOW.toISOString() }, SCOPE2, excelForm(2))).json()) as { shared: boolean };
    expect(r.shared).toBe(true);
    expect(second.calls.length).toBe(0);
    expect(municipalEntry(id)?.form.format).toBe("xlsx");
  });
});

// 取り寄せの GET で PARTNER の事業所に記録が置かれること（事業所ごとの置き場）
describe("記録の置き場は事業所ごと", () => {
  it("同じ様式を 2 つの事業所が取ると、記録は別々の場所", async () => {
    const { bucket, objects } = fakeBucket();
    const { fetcher } = fakeFetch({ [PDF_ENTRY.form.url]: () => new Response(fakePdf(5) as BodyInit, { status: 200 }) });
    await municipalSourceGet({ fetch: fetcher, bucket, now: () => NOW }, principal(), PDF_ENTRY.form.id, true);
    await municipalSourceGet({ fetch: fetcher, bucket, now: () => NOW }, PARTNER, PDF_ENTRY.form.id, true);
    expect([...objects.keys()].sort()).toEqual([municipalFetchKey("office-demo", PDF_ENTRY.form.id), municipalFetchKey("office-partner", PDF_ENTRY.form.id)].sort());
  });
});
