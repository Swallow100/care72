// 様式の読み取りも黒塗りの画面を通す（T83、見直しの安全 中 5）。送る形の行き帰り・断る物・受け口の順・Claude への頼みの形。
// 本物の API は呼ばない。画像は作った小さな JPEG（中身の無い物）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildParams } from "../claude/call.ts";
import { OPUS } from "../claude/models.ts";
import { checkRedactedImage } from "../intake/read-check.ts";
import { BARE_MARK, READ_FORM, RAW_FILE_FIELD } from "../intake/read-form.ts";
import { buildReadRequest, FORM_READ_SYSTEM } from "./form-read.ts";
import { MAPPING_LABELS } from "./mapping.ts";
import { mappingError } from "./mapping-http.ts";
import { buildFormReadForm, FORM_READ_PAGES_MAX, formReadPagesOf, type FormReadPage } from "./read-upload.ts";

// 付け足しの無い JPEG（SOI・APP0 JFIF・DQT・SOS…EOI。lib/intake/read-form.test.ts と同じ作り）
const JFIF = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
const DQT = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x01];
const SCAN = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];
const CLEAN = new Uint8Array([0xff, 0xd8, ...JFIF, ...DQT, ...SCAN]);
const EXIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...JFIF, ...DQT, ...SCAN]);
const jpeg = (b: Uint8Array = CLEAN) => new Blob([b as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });

const pdfPage = (page: number, redacted: number, bare = false): FormReadPage => ({ blob: jpeg(), meta: { source: "pdf", page, redacted }, bare });

describe("送る形（ブラウザ → /api/forms/read）", () => {
  it("頁の順に画像と印を並べ、読み戻せる。白紙の頁（隠した所 0）は人が選んだ印 bare で通る", async () => {
    const form = buildFormReadForm([pdfPage(1, 0, true), pdfPage(2, 3)]);
    expect(form.getAll(READ_FORM.image)).toHaveLength(2);
    expect(form.getAll(READ_FORM.bare)).toEqual([BARE_MARK, "0"]);
    expect(form.has(RAW_FILE_FIELD)).toBe(false);
    const got = formReadPagesOf(form);
    expect(got.ok && got.pages.map((p) => p.meta)).toEqual([
      { source: "pdf", page: 1, redacted: 0 },
      { source: "pdf", page: 2, redacted: 3 },
    ]);
    if (got.ok) expect(new Uint8Array(await got.pages[0].image.arrayBuffer())).toEqual(CLEAN);
  });

  it("「未加工」: 生のファイルの欄・印の無い物・隠した所 0 で人が選んだ印の無い物・印の数が合わない物", () => {
    const raw = buildFormReadForm([pdfPage(1, 2)]);
    raw.set(RAW_FILE_FIELD, jpeg(), "form.pdf");
    expect(formReadPagesOf(raw)).toEqual({ ok: false, error: "not_redacted" });
    expect(formReadPagesOf(buildFormReadForm([pdfPage(1, 0, false)]))).toEqual({ ok: false, error: "not_redacted" });
    const noMeta = new FormData();
    noMeta.append(READ_FORM.image, jpeg(), "a.jpg");
    expect(formReadPagesOf(noMeta)).toEqual({ ok: false, error: "not_redacted" });
    const short = buildFormReadForm([pdfPage(1, 1), pdfPage(2, 1)]);
    short.delete(READ_FORM.redacted);
    short.append(READ_FORM.redacted, "1");
    expect(formReadPagesOf(short)).toEqual({ ok: false, error: "not_redacted" });
  });

  it("「入力不備」: 画像が無い・多すぎる・文字の欄・写真が 2 枚・元が混ざる・頁の順が合わない", () => {
    expect(formReadPagesOf(new FormData())).toEqual({ ok: false, error: "invalid" });
    const many = buildFormReadForm(Array.from({ length: FORM_READ_PAGES_MAX + 1 }, (_, i) => pdfPage(Math.min(i + 1, FORM_READ_PAGES_MAX), 1)));
    expect(formReadPagesOf(many)).toEqual({ ok: false, error: "invalid" });
    const text = new FormData();
    for (const [k, v] of [[READ_FORM.source, "photo"], [READ_FORM.page, "1"], [READ_FORM.redacted, "1"], [READ_FORM.bare, "0"], [READ_FORM.image, "x"]]) {
      text.append(k, v);
    }
    expect(formReadPagesOf(text)).toEqual({ ok: false, error: "invalid" });
    const photo = (redacted: number): FormReadPage => ({ blob: jpeg(), meta: { source: "photo", page: 1, redacted }, bare: false });
    expect(formReadPagesOf(buildFormReadForm([photo(1), photo(2)]))).toEqual({ ok: false, error: "invalid" });
    expect(formReadPagesOf(buildFormReadForm([pdfPage(1, 1), photo(1)]))).toEqual({ ok: false, error: "invalid" });
    expect(formReadPagesOf(buildFormReadForm([pdfPage(2, 1), pdfPage(1, 1)]))).toEqual({ ok: false, error: "invalid" });
    expect(formReadPagesOf(buildFormReadForm([photo(1)])).ok).toBe(true);
  });

  it("中身の確かめは入れる欄と同じ（PDF・PNG・EXIF の付いた JPEG は「未加工」）。応答は 415 と画面の言葉", async () => {
    expect(checkRedactedImage(CLEAN).ok).toBe(true);
    expect(checkRedactedImage(EXIF)).toEqual({ ok: false, error: "not_redacted" });
    expect(checkRedactedImage(new TextEncoder().encode("%PDF-1.7 x"))).toEqual({ ok: false, error: "not_redacted" });
    const res = mappingError("not_redacted");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, error: "not_redacted", label: MAPPING_LABELS.notRedacted });
    expect(MAPPING_LABELS.notRedacted).toBe("未加工");
  });
});

describe("受け口と画面", () => {
  it("受け口（app/api/forms/read → lib/forms/read-post.ts）は印と中身を確かめてから Claude を呼ぶ。生のファイルの欄（file）と toFormFile は使わない", () => {
    const entry = readFileSync(new URL("../../app/api/forms/read/route.ts", import.meta.url), "utf8");
    expect(entry).toContain("formReadPost(");
    expect(entry).not.toContain("toFormFile(");
    expect(entry).not.toContain('form?.get("file")');
    // T86 で中身を lib に移した（テストで通すため）。順の確かめは移した先で
    const route = readFileSync(new URL("./read-post.ts", import.meta.url), "utf8");
    const pages = route.indexOf("formReadPagesOf(form)");
    const check = route.indexOf("checkRedactedImage(bytes)");
    const ask = route.indexOf("readForm(files, ctx)");
    for (const at of [pages, check, ask]) expect(at).toBeGreaterThan(0);
    expect(pages).toBeLessThan(check);
    expect(check).toBeLessThan(ask);
    expect(route).not.toContain("toFormFile(");
    expect(route).not.toContain('form?.get("file")');
  });

  it("画面（FormReadPanel）は黒塗りの画面を通し、塗った後の頁だけを送る", () => {
    const panel = readFileSync(new URL("../../components/forms/mapping/FormReadPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain('import("@/components/person/RedactSheet")');
    expect(panel).toContain("<RedactSheet files={redacting}");
    expect(panel).toContain('post("/api/forms/read", buildFormReadForm(');
    expect(panel).not.toMatch(/append\("file"/);
  });

  it("Claude への頼み: 頁の画像を順に並べて 1 回。黒く塗った所を推し量らない", () => {
    const a = { kind: "image" as const, attachment: { kind: "image" as const, mediaType: "image/jpeg" as const, data: "QQ==" }, bytes: 1 };
    const b = { ...a, attachment: { ...a.attachment, data: "Qg==" } };
    const req = buildReadRequest([a, b]);
    expect(req.attachments).toEqual([a.attachment, b.attachment]);
    expect(buildReadRequest(a).attachments).toEqual([a.attachment]);
    const content = buildParams(req, OPUS).messages[0].content as Array<{ type: string; source?: { data: string } }>;
    expect(content.map((c) => c.type)).toEqual(["image", "image", "text"]);
    expect(content.slice(0, 2).map((c) => c.source?.data)).toEqual(["QQ==", "Qg=="]);
    expect(FORM_READ_SYSTEM).toContain("黒く塗りつぶした四角は、ケアマネが隠した所。中身を推し量らない・出さない。");
    expect(FORM_READ_SYSTEM).toContain("並びの順に 1 枚が 1 頁");
  });
});
