// T64: QR の期限を 30・90・180 日から選ぶ。本人の行（people.qr_ttl_days、migration 0015）に日数を持ち、
// 期限の表示・トークンの署名・確かめ（resolveQrToken）が行の日数で動く。
// 決まりは前のまま: 期限なしは作らない、上限（180 日）より長い物は署名が合っても通さない、作り直すと前の版は通らない。

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { QrIssueForm } from "../../components/qr/QrIssueForm.tsx";
import { seedStatements } from "../../seed/sql.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { currentQrToken, issueQr, loadQrRow, qrState, resolveQrToken } from "./store.ts";
import {
  isQrTtlDays,
  parseQrTtl,
  QR_TTL_CHOICES,
  QR_TTL_DAYS,
  QR_TTL_MAX_DAYS,
  qrTimes,
  signQrToken,
  verifyQrToken,
  type QrPayload,
} from "./token.ts";

const SECRET = "test-secret-for-qr-token-0123456789abcdef";
const NOW = 1_793_000_000; // 2026-10-26 ごろ（秒）
const DAY = 24 * 60 * 60;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** 同じ鍵で署名だけ合わせた偽物（signQrToken が作らない物を作る） */
async function forge(p: object): Promise<string> {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`care72-qr-v1:${body}`));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

describe("日数の集合と読み方", () => {
  it("選べるのは 30・90・180 日。既定は 90、上限は 180", () => {
    expect([...QR_TTL_CHOICES]).toEqual([30, 90, 180]);
    expect(QR_TTL_DAYS).toBe(90);
    expect(QR_TTL_MAX_DAYS).toBe(180);
    expect(Math.max(...QR_TTL_CHOICES)).toBe(QR_TTL_MAX_DAYS);
    for (const d of [30, 90, 180]) expect(isQrTtlDays(d)).toBe(true);
    for (const d of [0, 1, 60, 91, 181, 365, -30, 90.5, "90", null, undefined]) expect(isQrTtlDays(d), String(d)).toBe(false);
  });

  it("フォームの ttl: 無ければ null（行の今の値のまま）、集合の数は日数、外は断る", () => {
    expect(parseQrTtl(null)).toEqual({ ok: true, days: null });
    expect(parseQrTtl("30")).toEqual({ ok: true, days: 30 });
    expect(parseQrTtl(" 180 ")).toEqual({ ok: true, days: 180 });
    expect(parseQrTtl("90")).toEqual({ ok: true, days: 90 });
    for (const bad of ["", "0", "60", "181", "365", "9999", "abc", "90日", "1e2", "-30", "30.0"]) expect(parseQrTtl(bad), bad).toEqual({ ok: false });
    // ファイルの欄など文字でない物も断る
    expect(parseQrTtl(new File(["30"], "x.txt"))).toEqual({ ok: false });
  });
});

describe("トークンの署名と期限（日数つき）", () => {
  it("30・90・180 日の期限で署名でき、期限の直前まで通り、ちょうどで通らない", async () => {
    for (const days of QR_TTL_CHOICES) {
      const p: QrPayload = { v: 1, p: "p-01", g: 1, ...qrTimes(NOW, days) };
      expect(p.exp - p.iat).toBe(days * DAY);
      const t = await signQrToken(p, SECRET);
      expect(await verifyQrToken(t, SECRET, NOW + days * DAY - 1), `${days}`).toEqual(p);
      expect(await verifyQrToken(t, SECRET, NOW + days * DAY), `${days}`).toBeNull();
    }
  });

  it("qrTimes の既定は 90 日（前の呼び方のまま）", () => {
    expect(qrTimes(NOW)).toEqual({ iat: NOW, exp: NOW + 90 * DAY });
  });

  it("180 日より長い物は作れない。期限なし・0 日も作らない", async () => {
    const base = { v: 1 as const, p: "p-01", g: 1, iat: NOW };
    await expect(signQrToken({ ...base, exp: NOW + 180 * DAY + 1 }, SECRET)).rejects.toThrow();
    await expect(signQrToken({ ...base, exp: NOW + 365 * DAY }, SECRET)).rejects.toThrow();
    await expect(signQrToken({ ...base, exp: NOW }, SECRET)).rejects.toThrow();
    await expect(signQrToken(base as unknown as QrPayload, SECRET)).rejects.toThrow();
    await expect(signQrToken({ ...base, exp: NOW + 180 * DAY }, SECRET)).resolves.toBeTypeOf("string");
  });

  it("鍵を知っていても、180 日より長い中身は通さない（署名が合っても）", async () => {
    const base = { v: 1, p: "p-01", g: 1, iat: NOW };
    expect(await verifyQrToken(await forge({ ...base, exp: NOW + 180 * DAY }), SECRET, NOW)).not.toBeNull();
    expect(await verifyQrToken(await forge({ ...base, exp: NOW + 180 * DAY + 1 }), SECRET, NOW)).toBeNull();
    expect(await verifyQrToken(await forge({ ...base, exp: NOW + 10 * 365 * DAY }), SECRET, NOW)).toBeNull();
  });
});

describe("本人の行の日数で期限が決まる（D1）", () => {
  let db: ReturnType<typeof d1FromSqlite>;
  beforeEach(() => {
    const sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });

  it("種の人は既定の 90 日（まだ作っていない）", async () => {
    const row = (await loadQrRow(db, "p-01"))!;
    expect(row).toEqual({ qr_generation: 0, qr_issued_at: null, qr_ttl_days: 90 });
    expect(qrState(row, NOW)).toMatchObject({ status: "none", ttlDays: 90, expiresAt: null });
  });

  it("日数を付けずに作ると行の日数（既定 90）のまま。前の呼び方と同じ", async () => {
    const row = (await issueQr(db, "p-01", iso(NOW)))!;
    expect(row).toMatchObject({ qr_generation: 1, qr_ttl_days: 90 });
    expect(Date.parse(qrState(row, NOW).expiresAt!) / 1000 - NOW).toBe(90 * DAY);
  });

  it("行の日数で期限が変わる（30・90・180）。状態・期限・トークン・確かめが同じ日数で動く", async () => {
    for (const days of QR_TTL_CHOICES) {
      const row = (await issueQr(db, "p-01", iso(NOW), days))!;
      expect(row.qr_ttl_days).toBe(days);
      const state = qrState(row, NOW);
      expect(state).toMatchObject({ status: "active", ttlDays: days });
      expect(Date.parse(state.expiresAt!) / 1000 - NOW).toBe(days * DAY);
      expect(qrState(row, NOW + days * DAY - 1).status).toBe("active");
      expect(qrState(row, NOW + days * DAY).status).toBe("expired");
      const t = (await currentQrToken("p-01", row, SECRET))!;
      const body = JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString("utf8")) as QrPayload;
      expect(body.exp - body.iat).toBe(days * DAY);
      expect((await resolveQrToken(db, SECRET, t, NOW + days * DAY - 1))?.p).toBe("p-01");
      expect(await resolveQrToken(db, SECRET, t, NOW + days * DAY)).toBeNull();
    }
  });

  it("行と別の日数で署名したトークンは、版と時刻が合っていても通らない", async () => {
    const row = (await issueQr(db, "p-01", iso(NOW), 30))!;
    for (const days of [90, 180] as const) {
      const other = await signQrToken({ v: 1, p: "p-01", g: row.qr_generation, ...qrTimes(NOW, days) }, SECRET);
      expect(await resolveQrToken(db, SECRET, other, NOW + 60), `${days}`).toBeNull();
    }
    const same = await signQrToken({ v: 1, p: "p-01", g: row.qr_generation, ...qrTimes(NOW, 30) }, SECRET);
    expect((await resolveQrToken(db, SECRET, same, NOW + 60))?.p).toBe("p-01");
    // 集合の外の日数（60 日）は上限の内でも、行と合わないので通らない
    const sixty = await signQrToken({ v: 1, p: "p-01", g: row.qr_generation, iat: NOW, exp: NOW + 60 * DAY }, SECRET);
    expect(await resolveQrToken(db, SECRET, sixty, NOW + 60)).toBeNull();
  });

  it("日数を変えて作り直すと版が上がり、前の版（前の日数）は通らない。新しい方は通る", async () => {
    const first = (await issueQr(db, "p-01", iso(NOW), 180))!;
    const old = (await currentQrToken("p-01", first, SECRET))!;
    const second = (await issueQr(db, "p-01", iso(NOW + 100), 30))!;
    expect(second).toMatchObject({ qr_generation: 2, qr_ttl_days: 30 });
    const fresh = (await currentQrToken("p-01", second, SECRET))!;
    expect(await resolveQrToken(db, SECRET, old, NOW + 200)).toBeNull();
    expect((await resolveQrToken(db, SECRET, fresh, NOW + 200))?.g).toBe(2);
    // 日数を付けずに作り直すと、前に選んだ 30 日のまま
    const third = (await issueQr(db, "p-01", iso(NOW + 300)))!;
    expect(third).toMatchObject({ qr_generation: 3, qr_ttl_days: 30 });
  });

  it("日数だけ表で書き換えても、作ったトークンは通らなくなる（期限は行の日数で確かめる）", async () => {
    const row = (await issueQr(db, "p-01", iso(NOW), 90))!;
    const t = (await currentQrToken("p-01", row, SECRET))!;
    await db.prepare("UPDATE people SET qr_ttl_days = 180 WHERE id = 'p-01'").run();
    expect(await resolveQrToken(db, SECRET, t, NOW + 60)).toBeNull();
  });

  it("作り直しても台帳の版（version）と更新の時刻は変えない", async () => {
    const before = await db.prepare("SELECT version, updated_at FROM people WHERE id = 'p-01'").first();
    await issueQr(db, "p-01", iso(NOW), 180);
    expect(await db.prepare("SELECT version, updated_at FROM people WHERE id = 'p-01'").first()).toEqual(before);
  });
});

// ---------- migration 0015 ----------

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
const migrationNames = () => readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const MIGRATION_0015 = "0015_qr_ttl_days.sql";

describe("migration 0015（people.qr_ttl_days）", () => {
  it("番号は 0015 で 1 つだけ", () => {
    expect(migrationNames().filter((n) => n.startsWith("0015_"))).toEqual([MIGRATION_0015]);
  });

  it("前からある行は既定の 90 日になり、ほかの列はそのまま", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    // 種は今の事業所の列（0017 の地図の中心、T68）を書くので、0017 は先に当てる（offices に列を足すだけで people に触れない）。
    // 種は気象庁の写しの表（0020、T72）も空にするので 0020 も先に（新しい表を作るだけで people に触れない）。
    // 種は同意の AI 提供（0024、T74）を書くので 0024 も先に（consents を建て直すだけで people に触れない）
    const early = (n: string) => n < MIGRATION_0015 || n.startsWith("0017_") || n.startsWith("0020_") || n.startsWith("0024_");
    for (const n of migrationNames().filter(early)) db.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    for (const s of seedStatements()) db.exec(s);
    db.exec(`UPDATE people SET qr_generation = 2, qr_issued_at = '${iso(NOW)}' WHERE id = 'p-01'`);
    const before = db.prepare("SELECT * FROM people ORDER BY id").all();
    expect(before.length).toBeGreaterThanOrEqual(10);
    for (const n of migrationNames().filter((n) => !early(n))) db.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
    const after = db.prepare("SELECT * FROM people ORDER BY id").all() as Array<Record<string, unknown>>;
    // 比べるのは 0015 の前からある列だけ（あとの migration が足す列〔0018 のスマホ入口など〕は数えない）
    const cols = Object.keys(before[0] as object);
    expect(after.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]])))).toEqual(before);
    expect(after.every((r) => r.qr_ttl_days === 90)).toBe(true);
    db.close();
  });

  it("30・90・180 だけ入り、ほかと NULL は CHECK・NOT NULL で断る", () => {
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const set = (v: number | null) => db.prepare("UPDATE people SET qr_ttl_days = ? WHERE id = 'p-01'").run(v);
    for (const v of [30, 90, 180]) expect(() => set(v), String(v)).not.toThrow();
    for (const v of [0, 60, 91, 181, 365, null]) expect(() => set(v), String(v)).toThrow();
    db.close();
  });

  it("CHECK の日数は QR_TTL_CHOICES と同じ", () => {
    const sql = readFileSync(new URL(MIGRATION_0015, MIGRATIONS), "utf8");
    const m = sql.match(/qr_ttl_days IN \(([^)]*)\)/);
    expect(m?.[1].split(",").map((s) => Number(s.trim()))).toEqual([...QR_TTL_CHOICES]);
    expect(sql).toMatch(/DEFAULT 90/);
  });
});

// ---------- 画面のフォーム（作成・再作成の横の期限） ----------

describe("QR の画面の作成・再作成のフォーム", () => {
  const html = (status: "none" | "active" | "expired", ttlDays: 30 | 90 | 180) =>
    renderToStaticMarkup(createElement(QrIssueForm, { personId: "p-01", status, ttlDays }));

  it("期限の選択は隠しの欄 ttl で今の行の日数を送る（JS の前でも）。ボタンの字は「90 日」", () => {
    for (const d of QR_TTL_CHOICES) {
      const h = html("active", d);
      expect(h).toContain(`<input type="hidden" name="ttl" value="${d}"/>`);
      expect(h).toContain(`${d} 日`);
    }
    expect(html("none", 90)).toContain('action="/api/people/p-01/qr"');
    expect(html("none", 90)).toContain('method="post"');
  });

  it("まだ無ければ「作成」、あれば「再作成」。使える QR の再作成は赤", () => {
    expect(html("none", 90)).toContain("作成");
    expect(html("none", 90)).not.toContain("再作成");
    expect(html("active", 90)).toContain("再作成");
    expect(html("expired", 90)).toContain("再作成");
    expect(html("active", 90)).toContain("text-danger");
    expect(html("none", 90)).toContain("bg-accent");
    expect(html("none", 90)).not.toContain("text-danger");
  });

  it("選ぶ所は焦点の枠を持ち、言葉は「期限」", () => {
    const h = html("active", 30);
    expect(h).toContain('aria-label="期限"');
    expect(h).toContain("focus-visible:outline-solid");
    expect(h).not.toMatch(/判定|診断|緊急度|札/);
  });
});
