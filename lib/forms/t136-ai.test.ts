// T136 書類の紙の AI の見直しと再考。偽の Claude（本物の API は呼ばない）と手元の D1（node:sqlite）で、受け口の中身（lib/forms/review-post.ts）を通す。
// 塗る欄の字は描く物に入らない・Claude に送る物に台帳の名前・電話・生年月日が無い・塗った欄の答えは使わない・塗れていない頁は断る・
// 再考で直した欄が紙に効き、戻せる、を確かめる。
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymInputOf } from "../intake/extract.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { komorebiReadResult } from "./komorebi-form.fixture.ts";
import { insertReadMapping, saveCheckedMapping } from "./mapping-db.ts";
import { checkReadResult } from "./mapping.ts";
import { ORIGINALS, originalManifestKey, type OriginalManifest } from "./originals.ts";
import { pageImageKey } from "./page-images.ts";
import { pageOps } from "./review-compose.ts";
import { reviewList, type ComposePlan } from "./review-ai.ts";
import { loadFixes, loadReviewState } from "./review-db.ts";
import { loadReviewPaper, mappedFormKey } from "./review-load.ts";
import { planOf, reviewPost, type ReviewDeps } from "./review-post.ts";
import { paperReviewProps } from "./review-view.ts";

const TODAY = "2026-11-05";
const OFFICE = "office-demo";
const principal = {
  role: "care_manager",
  judge: false,
  admin: false,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: OFFICE, name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
} as const;

// 付け足しの無い JPEG（lib/forms/read-upload.test.ts と同じ作り）
const JFIF = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
const DQT = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x01];
const SCAN = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];
const CLEAN = new Uint8Array([0xff, 0xd8, ...JFIF, ...DQT, ...SCAN]);
const EXIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...JFIF, ...DQT, ...SCAN]);

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
let sent: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[];
/** 偽の Claude の答え（system で見直しか再考かを見分ける） */
let replyReview: (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => unknown;
let replyReread: (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => unknown;

const fake: ClaudeClient = {
  beta: {
    messages: {
      async create(params) {
        sent.push(params);
        const system = JSON.stringify(params.system);
        const body = system.includes("今回の頼み") ? replyReread(params) : replyReview(params);
        return {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: params.model,
          content: [{ type: "text", text: JSON.stringify(body), citations: null }],
          stop_reason: "end_turn",
          stop_details: null,
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        } as unknown as Anthropic.Beta.Messages.BetaMessage;
      },
    },
  },
};

const objects = new Map<string, Uint8Array | string>();
function deps(): ReviewDeps {
  return {
    db,
    today: TODAY,
    now: () => "2026-11-05T09:00:00.000Z",
    get: async (key) => {
      const v = objects.get(key);
      if (v === undefined) return null;
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
      return { body: bytes, size: bytes.length, text: async () => (typeof v === "string" ? v : "") };
    },
    aiContext: async (): Promise<AskJsonContext> => ({ env: { ANTHROPIC_API_KEY: "test" }, usage: d1UsageStore(db), office: { id: OFFICE, kind: "demo" }, claude: fake }),
  };
}

const manifest = (id: "matsuyama" | "kiroku"): OriginalManifest => ({
  id,
  sha256: ORIGINALS[id].sha256,
  pages: ORIGINALS[id].usePages.map((page) => ({ page, width: 3307, height: 4677, bytes: 1 })),
  importedAt: "2026-11-05T00:00:00.000Z",
});

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  sent = [];
  objects.clear();
  objects.set(originalManifestKey(OFFICE, "matsuyama"), JSON.stringify(manifest("matsuyama")));
  objects.set(originalManifestKey(OFFICE, "kiroku"), JSON.stringify(manifest("kiroku")));
  replyReview = () => ({ findings: [] });
  replyReread = () => ({ fields: [] });
});
afterEach(() => sqlite.close());

const json = (body: Record<string, unknown>) =>
  new Request("https://care72.test/api/forms/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function runRequest(meta: Record<string, unknown>, images: Uint8Array[]): Request {
  const fd = new FormData();
  fd.append("meta", JSON.stringify(meta));
  images.forEach((b, i) => fd.append("image", new Blob([b as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), `p${i + 1}.jpg`));
  return new Request("https://care72.test/api/forms/review", { method: "POST", body: fd });
}

async function plan(person: string, form: string): Promise<{ hash: string; plan: ComposePlan; painted: number }> {
  const res = await reviewPost(deps(), principal, json({ op: "plan", person, form }));
  expect(res.status).toBe(200);
  return (await res.json()) as { hash: string; plan: ComposePlan; painted: number };
}

/** 台帳の名前・電話・生年月日（漏れの見張り） */
async function secretsOf(person: string): Promise<string[]> {
  const paper = await loadReviewPaper(deps(), principal, person, "matsuyama");
  const { key } = pseudonymize([pseudonymInputOf(paper!.rows)], { on: TODAY });
  return key.secrets.map((s) => s.value);
}

describe("AI の見直し（計画書の原本の枠の紙）", () => {
  it("塗る欄（氏名・フリガナ・生年月日・住所・電話・地図）の字と印は描く物に入らず、欄の矩形は塗る。描く物に台帳の秘密が無い", async () => {
    for (const person of ["p-01", "p-03", "p-07"]) {
      const paper = (await loadReviewPaper(deps(), principal, person, "matsuyama"))!;
      const { painted, plan: p } = planOf(paper, TODAY);
      for (const k of ["target.name", "target.kana", "target.birth", "target.address", "target.phone"]) {
        const f = paper.subject.fields.find((x) => x.id === k)!;
        if (f.values.length > 0) expect(painted.has(k), `${person} ${k}`).toBe(true);
      }
      const drawn = JSON.stringify(p.pages.map((x) => x.draws));
      for (const s of await secretsOf(person)) expect(drawn.includes(s), `${person} の描く物に秘密`).toBe(false);
      expect(drawn).not.toMatch(/0\d{1,3}-\d{2,4}-\d{3,4}/);
      // 生年月日の元号の印（□）も描かない（部品と印は欄ごと）
      const birthMarks = paper.sheet.pages.flatMap((pg) => pg.items).filter((it) => it.fieldId.startsWith("target.birth:"));
      expect(birthMarks.length).toBeGreaterThan(0);
      for (const it of birthMarks) expect(p.pages.some((pg) => pg.paints.some((b) => b.x <= it.box.x && b.y <= it.box.y))).toBe(true);
      // 地図は描かない
      expect(drawn).not.toContain("<svg");
    }
  });

  it("描く物を絵の px に（紙面と同じ空き・行の高さ、塗る四角）", () => {
    const ops = pageOps({
      image: { x: 0, y: 0, w: 210, h: 297 },
      draws: [{ kind: "text", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 }, lines: ["あい"], fontPt: 10, top: false }],
      paints: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }],
    });
    expect(Math.max(ops.w, ops.h)).toBe(1568);
    const t = ops.texts[0];
    const pxPerMm = ops.w / 210;
    expect(t.x).toBeCloseTo(0.1 * ops.w + 0.8 * pxPerMm, 5);
    expect(t.fontPx).toBeCloseTo(10 * (25.4 / 72) * pxPerMm, 5);
    expect(ops.paints[0]).toEqual({ x: 0.5 * ops.w, y: 0.5 * ops.h, w: 0.1 * ops.w, h: 0.1 * ops.h });
  });

  it("照合: 塗った絵と仮名の一覧だけを送り、塗った欄・一覧に無い id の答えは捨て、医療の語の理由は落とす。記録と 1 日の上限に数える", async () => {
    const { hash, plan: p } = await plan("p-01", "matsuyama");
    const paper = (await loadReviewPaper(deps(), principal, "p-01", "matsuyama"))!;
    const { painted } = planOf(paper, TODAY);
    const rows = reviewList(paper.subject, painted);
    const paintedRow = rows.find((r) => r.painted)!;
    const plain = rows.find((r) => !r.painted && r.label === "区分")!;
    expect(plain).toBeDefined();
    replyReview = () => ({
      findings: [
        { id: paintedRow.rid, kind: "unreadable", where: "黒い", why: "読めない" },
        { id: "r999", kind: "misplaced", where: "x", why: "y" },
        { id: plain.rid, kind: "mismatch", where: "欄の右", why: "診断名のよう" },
      ],
    });
    const res = await reviewPost(deps(), principal, runRequest({ person: "p-01", form: "matsuyama", hash, round: 1, paints: p.pages.map((x) => x.paints.length) }, p.pages.map(() => CLEAN)));
    expect(res.status).toBe(200);
    const r = (await res.json()) as { ai: Array<{ field: string; why: string; kind: string }>; redo: unknown[]; run: string };
    expect(r.ai).toHaveLength(1);
    expect(r.ai[0]).toMatchObject({ field: plain.field, kind: "mismatch", why: "欄の右" });
    // 原本の枠の紙は再考しない
    expect(r.redo).toEqual([]);
    // 送った物: 画像は頁の数、一覧は仮名。台帳の秘密は入らない
    expect(sent).toHaveLength(1);
    const body = JSON.stringify(sent[0]);
    for (const s of await secretsOf("p-01")) expect(body.includes(s)).toBe(false);
    expect(body).toContain("（塗り）");
    expect(sent[0].model).toBe("claude-sonnet-5-5");
    expect(((sent[0].messages[0].content as unknown[]) ?? []).filter((b) => (b as { type: string }).type === "image")).toHaveLength(p.pages.length);
    // 記録（run）と ai_calls
    const state = await loadReviewState(db, "p-01", "matsuyama", hash);
    expect(state.run?.body.findings).toHaveLength(1);
    expect(sqlite.prepare("SELECT purpose, status FROM ai_calls").all()).toEqual([{ purpose: "form_read", status: "ok" }]);
  });

  it("塗った数が足りない・付け足しのある JPEG・紙の版が古い・AI 提供が不同意は断り、Claude を呼ばない", async () => {
    const { hash, plan: p } = await plan("p-01", "matsuyama");
    const paints = p.pages.map((x) => x.paints.length);
    const imgs = p.pages.map(() => CLEAN);
    const short = await reviewPost(deps(), principal, runRequest({ person: "p-01", form: "matsuyama", hash, paints: paints.map((n) => n - 1) }, imgs));
    expect(short.status).toBe(415);
    const exif = await reviewPost(deps(), principal, runRequest({ person: "p-01", form: "matsuyama", hash, paints }, p.pages.map(() => EXIF)));
    expect(exif.status).toBe(415);
    const old = await reviewPost(deps(), principal, runRequest({ person: "p-01", form: "matsuyama", hash: "0000", paints }, imgs));
    expect(old.status).toBe(409);
    sqlite.exec("UPDATE consents SET status = 'refused' WHERE person_id = 'p-01' AND kind = 'ai_overseas'");
    const refused = await reviewPost(deps(), principal, runRequest({ person: "p-01", form: "matsuyama", hash, paints }, imgs));
    expect(refused.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("確認済は紙の版に付く", async () => {
    const { hash } = await plan("p-02", "matsuyama");
    expect((await reviewPost(deps(), principal, json({ op: "confirm", person: "p-02", form: "matsuyama", hash: "old" }))).status).toBe(409);
    expect((await reviewPost(deps(), principal, json({ op: "confirm", person: "p-02", form: "matsuyama", hash, seen: [] }))).status).toBe(200);
    expect((await loadReviewState(db, "p-02", "matsuyama", hash)).confirmed).not.toBeNull();
    expect((await loadReviewState(db, "p-02", "matsuyama", "other")).confirmed).toBeNull();
  });

  it("ケアマネの役でない人・ほかの事業所の人は見直せない", async () => {
    const res = await reviewPost(deps(), { ...principal, role: "medical" } as never, json({ op: "plan", person: "p-01", form: "matsuyama" }));
    expect(res.status).toBe(404);
  });
});

describe("再考（対応表の紙）", () => {
  async function addKomorebi(): Promise<string> {
    const id = "map-komorebi";
    const mapping = checkReadResult(komorebiReadResult()).mapping;
    await insertReadMapping(db, { id, officeId: OFFICE, hash: createHash("sha256").update(id).digest("hex"), kind: "pdf", mapping, model: "test", by: "acct-yamamoto", at: "2026-11-04T00:00:00.000Z" });
    expect((await saveCheckedMapping(db, { officeId: OFFICE, id, version: 1, mapping, by: "acct-yamamoto", at: "2026-11-04T01:00:00.000Z" })).ok).toBe(true);
    const pages = Array.from({ length: mapping.pages }, (_, i) => ({ page: i + 1, width: 1240, height: 1754, bytes: CLEAN.length }));
    sqlite.prepare("UPDATE form_mappings SET page_images = ?1 WHERE id = ?2").run(JSON.stringify(pages), id);
    for (const p of pages) objects.set(pageImageKey(OFFICE, id, p.page), CLEAN);
    return id;
  }

  it("直せそうな欄に再考の印 → その欄だけ読み直し（Opus、空の頁と項目表だけ）→ 紙に効く → 戻せる", async () => {
    const id = await addKomorebi();
    const form = mappedFormKey(id);
    const first = await plan("p-01", form);
    const paper = (await loadReviewPaper(deps(), principal, "p-01", form))!;
    const { painted } = planOf(paper, TODAY);
    const rows = reviewList(paper.subject, painted);
    const target = rows.find((r) => !r.painted)!;
    const field = paper.mapped!.mapping.fields.find((f) => f.id === target.field)!;
    replyReview = () => ({ findings: [{ id: target.rid, kind: "misplaced", where: "下の行", why: "隣の欄に入る" }] });
    const ran = await reviewPost(deps(), principal, runRequest({ person: "p-01", form, hash: first.hash, round: 1, paints: first.plan.pages.map((x) => x.paints.length) }, first.plan.pages.map(() => CLEAN)));
    expect(ran.status).toBe(200);
    const r = (await ran.json()) as { run: string; redo: Array<{ id: string; kinds: string[] }> };
    expect(r.redo).toEqual([{ id: field.id, kinds: ["misplaced"] }]);

    const moved = { x: field.box!.x, y: Math.min(0.9, field.box!.y + 0.01), w: field.box!.w, h: field.box!.h };
    replyReread = (params) => {
      // 再考の頼みに人の値は入らない（台帳の秘密も伏字も無い）
      expect(JSON.stringify(params.messages)).not.toContain("（塗り）");
      return { fields: [{ id: field.id, item: field.item, box: [moved.x, moved.y, moved.w, moved.h], options: field.options, option_boxes: [], reason: "書く所を下へ" }] };
    };
    // ブラウザが言う欄のうち、前の回で見つけた欄だけを読み直す（ほかの欄は無視）
    const redo = await reviewPost(deps(), principal, json({ op: "redo", person: "p-01", form, run: r.run, fields: [...r.redo, { id: "f-other", kinds: ["misplaced"] }] }));
    expect(redo.status).toBe(200);
    expect(((await redo.json()) as { fixed: string[] }).fixed).toEqual([field.id]);
    expect(sent.at(-1)!.model).toBe("claude-opus-5-5");
    const secrets = await secretsOf("p-01");
    for (const s of secrets) expect(JSON.stringify(sent.at(-1)).includes(s)).toBe(false);

    // 直しが紙に効き、紙の版が変わる。一覧の「再考済」に出る
    const fixes = await loadFixes(db, OFFICE, form, 2);
    expect([...fixes.keys()]).toEqual([field.id]);
    const after = (await loadReviewPaper(deps(), principal, "p-01", form))!;
    expect(after.hash).not.toBe(first.hash);
    expect(after.mapped!.mapping.fields.find((f) => f.id === field.id)!.box).toEqual(moved);
    const view = await paperReviewProps(db, { personId: "p-01", formKey: form, subject: after.subject, sheet: after.sheet, consents: after.rows.consents, fixes: after.mapped!.fixes });
    expect(view.fixes.map((f) => f.field)).toEqual([field.id]);

    // 2 回目の照合（直した紙）で残りが無ければ再考しない。記録は回ごとに残る
    replyReview = () => ({ findings: [] });
    const second = await plan("p-01", form);
    const ran2 = await reviewPost(deps(), principal, runRequest({ person: "p-01", form, hash: second.hash, run: r.run, round: 2, paints: second.plan.pages.map((x) => x.paints.length) }, second.plan.pages.map(() => CLEAN)));
    const r2 = (await ran2.json()) as { redo: unknown[] };
    expect(r2.redo).toEqual([]);
    const state = await loadReviewState(db, "p-01", form, second.hash);
    expect(state.run?.body.rounds.map((x) => [x.round, x.redo, x.fixed])).toEqual([
      [1, [field.id], [field.id]],
      [2, [], []],
    ]);

    // 戻す
    expect((await reviewPost(deps(), principal, json({ op: "undo", person: "p-01", form, field: field.id }))).status).toBe(200);
    expect((await loadFixes(db, OFFICE, form, 2)).size).toBe(0);
    expect((await loadReviewPaper(deps(), principal, "p-01", form))!.hash).toBe(first.hash);
  });
});
