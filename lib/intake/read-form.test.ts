// 写真・PDF を読む送る形（T52）: 黒塗りの画面を通った画像だけを受け、生の PDF・付け足しのある JPEG を断る。
// 経過に「写真を読んだ（隠した所 N か所）」を残す。

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { SONNET } from "../claude/models.ts";
import { FORM_FILE_MAX_BYTES } from "../forms/form-read.ts";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { INTAKE_LABELS } from "../labels.ts";
import { stripJpegMetadata } from "../redact/jpeg.ts";
import { intakeError } from "./http.ts";
import { checkRedactedImage } from "./read-check.ts";
import {
  buildReadForm,
  PDF_PAGES_MAX,
  RAW_FILE_FIELD,
  READ_FORM,
  readMetaOf,
  readTimelineHead,
} from "./read-form.ts";
import { saveIntake, SaveRequestSchema, timelineBody, type SaveRequest } from "./save.ts";

const seg = (marker: number, body: number[]) => [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const JFIF = seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const EXIF = seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("MM"), 0, 42, 0, 0, 0, 8, ...ascii("GPS")]);
const DQT = seg(0xdb, [0, ...new Array(64).fill(1)]);
const SCAN = [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9];
/** canvas の出す形（JFIF だけ） */
const CLEAN = new Uint8Array([0xff, 0xd8, ...JFIF, ...DQT, ...SCAN]);
/** 携帯の写真の形（EXIF つき） */
const PHOTO = new Uint8Array([0xff, 0xd8, ...EXIF, ...DQT, ...SCAN]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("サーバーが受ける画像（lib/intake/read-form.ts の checkRedactedImage）", () => {
  it("塗った後の JPEG（付け足しなし）だけを通し、Claude に添える形にする", () => {
    const r = checkRedactedImage(CLEAN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.attachment).toMatchObject({ kind: "image", mediaType: "image/jpeg" });
  });

  it("生の PDF・PNG・EXIF の付いた JPEG は「未加工」で断る", () => {
    expect(checkRedactedImage(PDF)).toEqual({ ok: false, error: "not_redacted" });
    expect(checkRedactedImage(PNG)).toEqual({ ok: false, error: "not_redacted" });
    expect(checkRedactedImage(PHOTO)).toEqual({ ok: false, error: "not_redacted" });
    expect(checkRedactedImage(new TextEncoder().encode("hello"))).toEqual({ ok: false, error: "not_redacted" });
    // ブラウザが外せば通る
    expect(checkRedactedImage(stripJpegMetadata(PHOTO)).ok).toBe(true);
  });

  it("空・上限超えは今までどおりの失敗", () => {
    expect(checkRedactedImage(new Uint8Array())).toEqual({ ok: false, error: "file_empty" });
    expect(checkRedactedImage(new Uint8Array(FORM_FILE_MAX_BYTES + 1))).toEqual({ ok: false, error: "file_large" });
  });

  it("「未加工」の応答は 415 と画面の言葉", async () => {
    const res = intakeError("not_redacted");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, error: "not_redacted", label: INTAKE_LABELS.notRedacted });
  });
});

describe("黒塗りの画面の印（source・page・redacted）", () => {
  it("ブラウザの送る形を読み戻せる。画像の欄は image（生のファイルの欄は使わない）", () => {
    const form = buildReadForm("p-04", new Blob([CLEAN], { type: "image/jpeg" }), { source: "pdf", page: 2, redacted: 3 });
    expect(readMetaOf(form)).toEqual({ source: "pdf", page: 2, redacted: 3 });
    expect(form.get(READ_FORM.personId)).toBe("p-04");
    expect(form.get(READ_FORM.image)).toBeInstanceOf(Blob);
    expect(form.has(RAW_FILE_FIELD)).toBe(false);
  });

  it("印が無い・形が違う・頁が上限の外なら null（サーバーは「未加工」）", () => {
    const f = (o: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(o)) form.set(k, v);
      return form;
    };
    expect(readMetaOf(f({}))).toBeNull();
    expect(readMetaOf(f({ source: "scan", page: "1", redacted: "0" }))).toBeNull();
    expect(readMetaOf(f({ source: "photo", page: "2", redacted: "0" }))).toBeNull();
    expect(readMetaOf(f({ source: "pdf", page: String(PDF_PAGES_MAX + 1), redacted: "0" }))).toBeNull();
    expect(readMetaOf(f({ source: "pdf", page: "1", redacted: "-1" }))).toBeNull();
    expect(readMetaOf(f({ source: "photo", page: "1", redacted: "1" }))).toEqual({ source: "photo", page: 1, redacted: 1 });
  });

  it("隠した所 0 は、人が確かめの窓で「送信」を選んだ印（bare=1）があるときだけ通る（T83、見直しの安全 中 5）", () => {
    const f = (o: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(o)) form.set(k, v);
      return form;
    };
    expect(readMetaOf(f({ source: "photo", page: "1", redacted: "0" }))).toBeNull();
    expect(readMetaOf(f({ source: "photo", page: "1", redacted: "0", bare: "0" }))).toBeNull();
    expect(readMetaOf(f({ source: "photo", page: "1", redacted: "0", bare: "1" }))).toEqual({ source: "photo", page: 1, redacted: 0 });
    // ブラウザの送る形: 人が選んだときだけ印を付ける。隠した所のある頁には付けない
    const blob = new Blob([CLEAN], { type: "image/jpeg" });
    const zero = { source: "photo", page: 1, redacted: 0 } as const;
    expect(readMetaOf(buildReadForm("p-04", blob, zero))).toBeNull();
    expect(readMetaOf(buildReadForm("p-04", blob, zero, { bare: true }))).toEqual(zero);
    expect(buildReadForm("p-04", blob, { ...zero, redacted: 2 }, { bare: true }).has(READ_FORM.bare)).toBe(false);
  });

  it("黒塗りの画面: 塗っていない頁があれば共通の部品の確かめの窓（戻るが先、送信は赤）。0 の頁に bare を付けるのは窓のあとだけ", () => {
    const sheet = readFileSync(new URL("../../components/person/RedactSheet.tsx", import.meta.url), "utf8");
    const ask = sheet.indexOf("await appChoice(L.noneText");
    const back = sheet.indexOf('{ value: "back", label: L.noneBack');
    // 送る側の言葉は入れる欄は「送信」、様式の読み取りは「読込」（T147 の sendLabel）
    const send = sheet.indexOf('{ value: "send", label: sendLabel === L.send ? L.noneOk : sendLabel, icon: "SendIcon", danger: true }');
    const bare = sheet.indexOf("bare: r.length === 0");
    for (const at of [ask, back, send, bare]) expect(at).toBeGreaterThan(0);
    expect(back).toBeLessThan(send);
    expect(ask).toBeLessThan(bare);
    expect(sheet).toMatch(/if \(a !== "send"\) \{/);
    const intake = readFileSync(new URL("../../components/person/Intake.tsx", import.meta.url), "utf8");
    expect(intake).toContain("buildReadForm(props.personId, page.blob, page.meta, { bare: page.bare })");
  });

  it("受け口（app/api/intake/read）は生のファイルの欄を断り、checkRedactedImage と印を通してから Claude を呼ぶ", () => {
    const route = readFileSync(new URL("../../app/api/intake/read/route.ts", import.meta.url), "utf8");
    const raw = route.indexOf("form.has(RAW_FILE_FIELD)");
    const meta = route.indexOf("if (!meta) return intakeError(\"not_redacted\")");
    const check = route.indexOf("checkRedactedImage(");
    const ask = route.indexOf("readIntake(rows");
    for (const at of [raw, meta, check, ask]) expect(at).toBeGreaterThan(0);
    expect(raw).toBeLessThan(ask);
    expect(meta).toBeLessThan(ask);
    expect(check).toBeLessThan(ask);
    // 前の受け方（toFormFile で PDF も通す）は使わない
    expect(route).not.toContain("toFormFile(");
  });
});

describe("経過の「写真を読んだ（隠した所 N か所）」", () => {
  it("写真と PDF の頁で言い分ける", () => {
    expect(readTimelineHead({ source: "photo", page: 1, redacted: 3 })).toBe("写真を読んだ（隠した所 3 か所）");
    expect(readTimelineHead({ source: "pdf", page: 2, redacted: 0 })).toBe("PDF を読んだ（2 頁目・隠した所 0 か所）");
    expect(timelineBody(true, ["medical.history"], [], false, { read: { source: "photo", page: 1, redacted: 2 } })).toBe(
      "写真を読んだ（隠した所 2 か所）。AI の分け方、人が確認: 既往",
    );
  });

  it("読んだ印は AI の分け方の保存にだけ付けられる", () => {
    const base = { personId: "p-04", version: 1, changes: [{ t: "note", value: "x" }] };
    const read = { source: "photo", page: 1, redacted: 1 };
    expect(SaveRequestSchema.safeParse({ ...base, ai: { model: SONNET }, read }).success).toBe(true);
    expect(SaveRequestSchema.safeParse({ ...base, ai: null, read }).success).toBe(false);
    expect(SaveRequestSchema.safeParse({ ...base, ai: { model: SONNET }, read: { ...read, redacted: -1 } }).success).toBe(false);
  });

  describe("保存", () => {
    let sqlite: DatabaseSync;
    let db: D1Database;
    const cm: Principal = {
      role: "care_manager",
      judge: false,
      admin: true,
      accountId: "acct-yamamoto",
      displayName: "山本",
      office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
      caseloadOf: "acct-yamamoto",
      personId: null,
      contactId: null,
    };
    beforeEach(() => {
      sqlite = migratedSqlite();
      for (const s of seedStatements()) sqlite.exec(s);
      db = d1FromSqlite(sqlite);
    });

    it("経過の本文の頭と payload に、何を読み何か所隠したか（画像も値も残さない）", async () => {
      const req = {
        personId: "p-04",
        version: 1,
        ai: { model: SONNET },
        read: { source: "pdf", page: 1, redacted: 4 },
        changes: [{ t: "field", key: "medical.history", value: ["認知症"] }],
      } as SaveRequest;
      const r = await saveIntake(db, cm, req, new Date("2026-11-03T08:00:00.000Z"));
      expect(r).toMatchObject({ ok: true });
      const tl = sqlite.prepare("SELECT body, payload FROM timeline_entries").get() as { body: string; payload: string };
      expect(tl.body).toBe("PDF を読んだ（1 頁目・隠した所 4 か所）。AI の分け方、人が確認: 既往");
      expect(JSON.parse(tl.payload)).toMatchObject({ ai: true, read: { source: "pdf", page: 1, redacted: 4 } });
    });
  });
});

describe("入れる欄（components/person/Intake.tsx）は写真・PDF を黒塗りの画面に通す", () => {
  it("選んだファイルはそのまま送らず黒塗りの画面へ。送るのは buildReadForm の形（塗った後の画像）だけ。読む前の確認の窓はやめた", () => {
    const src = readFileSync(new URL("../../components/person/Intake.tsx", import.meta.url), "utf8");
    expect(src).toContain("setRedacting(");
    expect(src).toContain("<RedactSheet");
    expect(src).toContain("buildReadForm(props.personId, page.blob, page.meta, { bare: page.bare })");
    expect(src).not.toMatch(/form\.set\("file"/);
    expect(src).not.toContain("FILE_NOTICE");
    // 黒塗りの画面は元のファイルを呼ぶ側へ返さない（返すのは塗った後の Blob と印）
    const sheet = readFileSync(new URL("../../components/person/RedactSheet.tsx", import.meta.url), "utf8");
    // origin は元の頁の番号（数だけ。T134 の共有の対応表の鍵）
    expect(sheet).toContain("export type RedactedPage = { name: string; blob: Blob; meta: ReadMeta; bare: boolean; origin: number }");
    // 1 頁の大きさの上限は様式の読み取りだけが頁の数から渡す（T146）
    expect(sheet).toContain("encodeRedacted(p, r, pageBytes?.(chosen.length))");
  });
});
