import { beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { signSession, verifySession } from "../auth/session.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { currentQrToken, issueQr, loadQrRow, qrState, resolveQrToken } from "./store.ts";
import { QR_TTL_SEC, qrTimes, signQrToken, verifyQrToken, type QrPayload } from "./token.ts";

const SECRET = "test-secret-for-qr-token-0123456789abcdef";
const OTHER = "another-secret-for-qr-token-0123456789abc";
const NOW = 1_793_000_000; // 2026-10-26 ごろ（秒）
const DAY = 24 * 60 * 60;

const payload = (over: Partial<QrPayload> = {}): QrPayload => ({ v: 1, p: "p-01", g: 1, ...qrTimes(NOW), ...over });

describe("トークンの署名と期限", () => {
  it("署名して確かめると同じ中身が戻る。期限は 90 日", async () => {
    const t = await signQrToken(payload(), SECRET);
    const p = await verifyQrToken(t, SECRET, NOW + 1);
    expect(p).toEqual(payload());
    expect(p!.exp - p!.iat).toBe(90 * DAY);
    expect(QR_TTL_SEC).toBe(90 * DAY);
  });

  it("同じ版と時刻からは同じトークン（表に持たずに作り直せる）", async () => {
    expect(await signQrToken(payload(), SECRET)).toBe(await signQrToken(payload(), SECRET));
  });

  it("中身に氏名・カナ・生年月日を入れない（本人の id・版・時刻だけ）", async () => {
    const t = await signQrToken(payload(), SECRET);
    const body = JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString("utf8"));
    expect(Object.keys(body).sort()).toEqual(["exp", "g", "iat", "p", "v"]);
  });

  it("期限を過ぎたら通らない（ちょうどの時刻も）", async () => {
    const t = await signQrToken(payload(), SECRET);
    expect(await verifyQrToken(t, SECRET, NOW + 90 * DAY - 1)).not.toBeNull();
    expect(await verifyQrToken(t, SECRET, NOW + 90 * DAY)).toBeNull();
    expect(await verifyQrToken(t, SECRET, NOW + 365 * DAY)).toBeNull();
  });

  it("期限なし・90 日より長い物は作らない", async () => {
    await expect(signQrToken(payload({ exp: NOW + 90 * DAY + 1 }), SECRET)).rejects.toThrow();
    await expect(signQrToken(payload({ exp: NOW }), SECRET)).rejects.toThrow();
    await expect(signQrToken({ v: 1, p: "p-01", g: 1, iat: NOW } as unknown as QrPayload, SECRET)).rejects.toThrow();
  });

  it("鍵が違う・中身を書き換えた・署名を書き換えた・形が違う物は通らない", async () => {
    const t = await signQrToken(payload(), SECRET);
    expect(await verifyQrToken(t, OTHER, NOW)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload(), p: "p-02" })).toString("base64url");
    expect(await verifyQrToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifyQrToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    for (const bad of ["", ".", "abc", `${body}`, `${body}.${sig}.x`, "x".repeat(600), null, undefined]) {
      expect(await verifyQrToken(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("鍵を知っていても、期限の長すぎる中身や作った時刻が先の物は通さない", async () => {
    // 同じ形で署名だけ合わせた偽物（signQrToken は作らないので、手で同じ署名を作る）
    const forge = async (p: object) => {
      const body = Buffer.from(JSON.stringify(p)).toString("base64url");
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`care72-qr-v1:${body}`));
      return `${body}.${Buffer.from(sig).toString("base64url")}`;
    };
    expect(await verifyQrToken(await forge(payload()), SECRET, NOW)).not.toBeNull();
    expect(await verifyQrToken(await forge(payload({ exp: NOW + 10 * 365 * DAY })), SECRET, NOW)).toBeNull();
    expect(await verifyQrToken(await forge(payload({ iat: NOW + 3600, exp: NOW + 3600 + DAY })), SECRET, NOW)).toBeNull();
    const { exp: _exp, ...noExp } = payload();
    expect(await verifyQrToken(await forge(noExp), SECRET, NOW)).toBeNull();
  });

  it("セッションの cookie と取り違えない（同じ鍵でも、どちらの向きにも通らない）", async () => {
    const session = await signSession({ v: 1, k: "account", a: "acct-yamamoto", pv: "x", iat: NOW, exp: NOW + 3600 }, SECRET);
    expect(await verifySession(session, SECRET, NOW)).not.toBeNull();
    expect(await verifyQrToken(session, SECRET, NOW)).toBeNull();
    const qr = await signQrToken(payload(), SECRET);
    expect(await verifySession(qr, SECRET, NOW)).toBeNull();
  });
});

describe("版（作り直すと前の物は無効）", () => {
  let db: ReturnType<typeof d1FromSqlite>;
  beforeEach(() => {
    const sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });
  const iso = (sec: number) => new Date(sec * 1000).toISOString();

  it("種の人はまだ作っていない（版 0）。トークンも無い", async () => {
    const row = (await loadQrRow(db, "p-01"))!;
    expect(row).toEqual({ qr_generation: 0, qr_issued_at: null });
    expect(qrState(row, NOW).status).toBe("none");
    expect(await currentQrToken("p-01", row, SECRET)).toBeNull();
  });

  it("作ると版 1・有効、トークンが通る。90 日で期限切れ", async () => {
    const row = (await issueQr(db, "p-01", iso(NOW)))!;
    expect(row.qr_generation).toBe(1);
    const state = qrState(row, NOW);
    expect(state.status).toBe("active");
    expect(Date.parse(state.expiresAt!) / 1000 - NOW).toBe(90 * DAY);
    expect(qrState(row, NOW + 90 * DAY).status).toBe("expired");
    const t = (await currentQrToken("p-01", row, SECRET))!;
    expect((await resolveQrToken(db, SECRET, t, NOW + 60))?.p).toBe("p-01");
    expect(await resolveQrToken(db, SECRET, t, NOW + 90 * DAY)).toBeNull();
  });

  it("作り直すと版が上がり、前の版のトークンは通らない。新しい方は通る", async () => {
    const first = (await issueQr(db, "p-01", iso(NOW)))!;
    const old = (await currentQrToken("p-01", first, SECRET))!;
    const second = (await issueQr(db, "p-01", iso(NOW + 100)))!;
    expect(second.qr_generation).toBe(2);
    const fresh = (await currentQrToken("p-01", second, SECRET))!;
    expect(fresh).not.toBe(old);
    expect(await resolveQrToken(db, SECRET, old, NOW + 200)).toBeNull();
    expect((await resolveQrToken(db, SECRET, fresh, NOW + 200))?.g).toBe(2);
  });

  it("作り直しても台帳の版（version）と更新の時刻は変えない", async () => {
    const before = await db.prepare("SELECT version, updated_at FROM people WHERE id = 'p-01'").first();
    await issueQr(db, "p-01", iso(NOW));
    expect(await db.prepare("SELECT version, updated_at FROM people WHERE id = 'p-01'").first()).toEqual(before);
  });

  it("ほかの人の版と取り違えない（版が同じでも、本人の id が違えば通らない作り）", async () => {
    await issueQr(db, "p-01", iso(NOW));
    await issueQr(db, "p-02", iso(NOW));
    const t1 = (await currentQrToken("p-01", (await loadQrRow(db, "p-01"))!, SECRET))!;
    expect((await resolveQrToken(db, SECRET, t1, NOW))?.p).toBe("p-01");
    // 鍵の無い人は版と時刻を合わせても、署名が違うので通らない
    expect(await resolveQrToken(db, OTHER, t1, NOW)).toBeNull();
  });

  it("作った時刻が表と違うトークン（同じ版）は通らない", async () => {
    const row = (await issueQr(db, "p-01", iso(NOW)))!;
    const shifted = await signQrToken({ v: 1, p: "p-01", g: row.qr_generation, ...qrTimes(NOW - 100) }, SECRET);
    expect(await resolveQrToken(db, SECRET, shifted, NOW)).toBeNull();
  });

  it("本人の行が無ければ通らない", async () => {
    const t = await signQrToken({ v: 1, p: "p-nobody", g: 1, ...qrTimes(NOW) }, SECRET);
    expect(await resolveQrToken(db, SECRET, t, NOW)).toBeNull();
  });
});
