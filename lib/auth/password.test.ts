import { describe, expect, it } from "vitest";
import { fromBase64Url, sameBytes, toBase64Url } from "./bytes.ts";
import {
  hashPassword,
  isPasswordHash,
  MAX_PBKDF2_ITERATIONS,
  parsePasswordHash,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from "./password.ts";

// テストだけの値（本物のパスワードではない）
const PW = "test-only-pass-0001";

describe("パスワードのハッシュ（PBKDF2-SHA256）", () => {
  it("形は pbkdf2-sha256:<回数>:<salt>:<hash>、回数は Workers の上限の 100,000", async () => {
    const h = await hashPassword(PW);
    expect(h).toMatch(/^pbkdf2-sha256:100000:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(MAX_PBKDF2_ITERATIONS);
    // 区切りに "$" を使わない（dotenv の展開に読まれないように）
    expect(h).not.toContain("$");
    expect(h).not.toContain(PW);
  });

  it("合うパスワードだけ通る", async () => {
    const h = await hashPassword(PW);
    expect(await verifyPassword(PW, h)).toBe(true);
    expect(await verifyPassword(`${PW}x`, h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
    expect(await verifyPassword(PW.toUpperCase(), h)).toBe(false);
  });

  it("salt は毎回違い、同じパスワードでもハッシュが違う", async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword(PW, b)).toBe(true);
  });

  it("文字列に含めた回数と salt で確かめる（回数を変えたハッシュも読める）", async () => {
    const salt = new Uint8Array(16).fill(7);
    const h = await hashPassword(PW, { iterations: 1000, salt });
    expect(h.split(":")[1]).toBe("1000");
    expect(parsePasswordHash(h)?.iterations).toBe(1000);
    expect(await verifyPassword(PW, h)).toBe(true);
    // 同じ salt と回数なら同じ
    expect(await hashPassword(PW, { iterations: 1000, salt })).toBe(h);
  });

  it("NFC にそろえる（濁点の付け方が違っても同じ）", async () => {
    const composed = "がっこう-0001";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const h = await hashPassword(composed, { iterations: 1000 });
    expect(await verifyPassword(decomposed, h)).toBe(true);
  });

  it("壊れた・違う形のハッシュは通さない（例外にしない）", async () => {
    const h = await hashPassword(PW, { iterations: 1000 });
    const [prefix, iter, salt, hash] = h.split(":");
    const bad = [
      "",
      PW,
      `sha256:${iter}:${salt}:${hash}`,
      `${prefix}:${iter}:${salt}`,
      `${prefix}:0:${salt}:${hash}`,
      `${prefix}:01000:${salt}:${hash}`,
      `${prefix}:${MAX_PBKDF2_ITERATIONS + 1}:${salt}:${hash}`,
      `${prefix}:${iter}:${salt}:${hash.slice(0, -2)}`,
      `${prefix}:${iter}:${salt}:${hash}=`,
      ` ${h}`,
      `${h}\n`,
    ];
    for (const b of bad) {
      expect(isPasswordHash(b), b).toBe(false);
      expect(await verifyPassword(PW, b), b).toBe(false);
    }
    expect(await verifyPassword(PW, null)).toBe(false);
    expect(await verifyPassword(PW, undefined)).toBe(false);
  });

  it("hash の 1 字を変えると通らない", async () => {
    const h = await hashPassword(PW, { iterations: 1000 });
    const parts = h.split(":");
    const bytes = fromBase64Url(parts[3])!;
    bytes[0] ^= 1;
    parts[3] = toBase64Url(bytes);
    expect(await verifyPassword(PW, parts.join(":"))).toBe(false);
  });

  it("Workers で動かない回数・空・長すぎる入力は作らない", async () => {
    await expect(hashPassword(PW, { iterations: MAX_PBKDF2_ITERATIONS + 1 })).rejects.toThrow();
    await expect(hashPassword("")).rejects.toThrow();
    await expect(hashPassword("x".repeat(1025))).rejects.toThrow();
    expect(await verifyPassword("x".repeat(1025), await hashPassword(PW, { iterations: 1000 }))).toBe(false);
  });

  it("バイト列の比べ方", () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
    expect(fromBase64Url("a")).toBeNull();
    expect(fromBase64Url("ab+c")).toBeNull();
    expect(toBase64Url(fromBase64Url("AQID")!)).toBe("AQID");
  });
});
