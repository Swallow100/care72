import { afterEach, describe, expect, it, vi } from "vitest";
import { fromBase64Url, toBase64Url, utf8 } from "./bytes.ts";
import { clearSessionCookie, isSameOrigin, readCookie, SESSION_COOKIE, seeOther, sessionCookie } from "./cookie.ts";
import {
  DEV_SESSION_SECRET,
  passwordVersion,
  resetDevSecretWarning,
  SESSION_TTL_SEC,
  sessionSecret,
  SessionSecretMissing,
  sessionTimes,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session.ts";

const SECRET = "test-secret-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;

function judge(over: Partial<Extract<SessionPayload, { k: "judge" }>> = {}): SessionPayload {
  return { v: 1, k: "judge", r: null, pv: "pv-test", ...sessionTimes(NOW), ...over };
}

describe("セッションの署名", () => {
  it("署名した物は同じ鍵で読める", async () => {
    const p: SessionPayload = { v: 1, k: "account", a: "acct-yamamoto", pv: "pv-test", ...sessionTimes(NOW) };
    const token = await signSession(p, SECRET);
    expect(await verifySession(token, SECRET, NOW)).toEqual(p);
    expect(await verifySession(await signSession(judge({ r: "family" }), SECRET), SECRET, NOW)).toMatchObject({
      k: "judge",
      r: "family",
    });
  });

  it("違う鍵・書き換えた中身・壊れた形は読めない", async () => {
    const token = await signSession(judge(), SECRET);
    expect(await verifySession(token, `${SECRET}x`, NOW)).toBeNull();

    // 中身を書き換えて署名はそのまま（役を勝手に足す）
    const [, sig] = token.split(".");
    const forged = toBase64Url(utf8(JSON.stringify(judge({ r: "care_manager" }))));
    expect(await verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();

    // 署名の 1 バイトを変える
    const sigBytes = fromBase64Url(sig)!;
    sigBytes[0] ^= 1;
    expect(await verifySession(`${token.split(".")[0]}.${toBase64Url(sigBytes)}`, SECRET, NOW)).toBeNull();

    for (const bad of [null, undefined, "", "abc", "a.b.c", `.${sig}`, `${token}x`, "x".repeat(3000)]) {
      expect(await verifySession(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("形の違う中身は、署名が合っていても読まない", async () => {
    const sign = async (obj: unknown) => {
      const body = toBase64Url(utf8(JSON.stringify(obj)));
      const key = await crypto.subtle.importKey("raw", utf8(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(body)));
      return `${body}.${toBase64Url(sig)}`;
    };
    const t = sessionTimes(NOW);
    expect(await verifySession(await sign({ v: 2, k: "judge", r: null, pv: "x", ...t }), SECRET, NOW)).toBeNull();
    expect(await verifySession(await sign({ v: 1, k: "judge", r: "admin", pv: "x", ...t }), SECRET, NOW)).toBeNull();
    expect(await verifySession(await sign({ v: 1, k: "account", pv: "x", ...t }), SECRET, NOW)).toBeNull();
    expect(await verifySession(await sign({ v: 1, k: "judge", r: null, pv: "x", extra: 1, ...t }), SECRET, NOW)).toBeNull();
    expect(await verifySession(await sign("just text"), SECRET, NOW)).toBeNull();
  });

  it("7 日で切れる。ちょうどの時刻で切れる", async () => {
    expect(SESSION_TTL_SEC).toBe(7 * 24 * 60 * 60);
    const token = await signSession(judge(), SECRET);
    expect(await verifySession(token, SECRET, NOW + SESSION_TTL_SEC - 1)).not.toBeNull();
    expect(await verifySession(token, SECRET, NOW + SESSION_TTL_SEC)).toBeNull();
    expect(await verifySession(token, SECRET, NOW + SESSION_TTL_SEC + 1)).toBeNull();
  });

  it("7 日より長い・先の時刻に作った物は読まない", async () => {
    const long = await signSession(judge({ iat: NOW, exp: NOW + SESSION_TTL_SEC + 1 }), SECRET);
    expect(await verifySession(long, SECRET, NOW)).toBeNull();
    const future = await signSession(judge({ iat: NOW + 3600, exp: NOW + 3600 + 60 }), SECRET);
    expect(await verifySession(future, SECRET, NOW)).toBeNull();
  });

  it("パスワードの指紋はハッシュごとに違い、ハッシュそのものを含まない", async () => {
    const a = await passwordVersion("pbkdf2-sha256:100000:AAAA:BBBB");
    const b = await passwordVersion("pbkdf2-sha256:100000:AAAA:BBBC");
    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(a).not.toContain("BBBB");
  });
});

describe("署名の鍵（SESSION_SECRET）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDevSecretWarning();
  });

  it("あればそれを使う", () => {
    expect(sessionSecret({ SESSION_SECRET: SECRET }, "production")).toBe(SECRET);
    expect(sessionSecret({ SESSION_SECRET: ` ${SECRET} ` }, "development")).toBe(SECRET);
  });

  it("手元で無ければ開発用の値で動き、console に 1 回だけ出す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sessionSecret({}, "development")).toBe(DEV_SESSION_SECRET);
    expect(sessionSecret({ SESSION_SECRET: "  " }, "development")).toBe(DEV_SESSION_SECRET);
    expect(sessionSecret({}, undefined)).toBe(DEV_SESSION_SECRET);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("SESSION_SECRET");
  });

  it("配信の build（NODE_ENV=production）で無い・短いと止まる", () => {
    expect(() => sessionSecret({}, "production")).toThrow(SessionSecretMissing);
    expect(() => sessionSecret({ SESSION_SECRET: "" }, "production")).toThrow(SessionSecretMissing);
    expect(() => sessionSecret({ SESSION_SECRET: "short" }, "production")).toThrow(SessionSecretMissing);
  });
});

describe("cookie", () => {
  it("HttpOnly・SameSite=Lax・Path=/・7 日。https なら Secure、手元の http は外す", () => {
    const https = sessionCookie("tok", "https://care72.example/api/auth/login");
    expect(https).toBe(`${SESSION_COOKIE}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`);
    const http = sessionCookie("tok", "http://localhost:3072/api/auth/login");
    expect(http).toBe(`${SESSION_COOKIE}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  });

  it("消す cookie は Max-Age=0", () => {
    expect(clearSessionCookie("https://care72.example/")).toBe(
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    );
  });

  it("Cookie の見出しから読む", () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=xyz.abc; b=2`, SESSION_COOKIE)).toBe("xyz.abc");
    expect(readCookie(`${SESSION_COOKIE}=`, SESSION_COOKIE)).toBeNull();
    expect(readCookie("a=1", SESSION_COOKIE)).toBeNull();
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
    expect(readCookie(`x${SESSION_COOKIE}=1`, SESSION_COOKIE)).toBeNull();
  });

  it("フォームの POST のあとは 303 で送る", () => {
    const r = seeOther(new Request("http://localhost:3072/api/auth/login", { method: "POST" }), "/login?e=1", "a=b");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("http://localhost:3072/login?e=1");
    expect(r.headers.get("set-cookie")).toBe("a=b");
  });

  it("別のサイトからの POST は断る", () => {
    const req = (headers: Record<string, string>) =>
      new Request("https://care72.example/api/auth/login", { method: "POST", headers });
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site", origin: "https://care72.example" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "https://care72.example" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null" }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(true);
  });
});
