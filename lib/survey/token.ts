// アンケートの招待の token と、送信元のハッシュ（docs/tasks/T42.md）。Workers と Node の両方で動く crypto だけを使う。

import { toBase64Url, utf8 } from "../auth/bytes.ts";

/** token の乱数の大きさ（バイト）。base64url で 43 文字 */
const TOKEN_BYTES = 32;

/** token の形（base64url で 32〜64 文字）。形の違う物は D1 を読む前に断る */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,64}$/;

/** 推測できない token（crypto の乱数 32 バイト = 256 ビット） */
export function newSurveyToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export function isSurveyTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_SHAPE.test(token);
}

/** リンクの有効の日数 */
export const SURVEY_TTL_DAYS = 14;

/** 開いてから送れるまでの秒（ボットの守り。人が 7 問を読んで答えるのに 15 秒より短いことは無い） */
export const MIN_FILL_SEC = 15;

/** 同じ送信元からの送信の上限（1 時間あたり） */
export const RATE_LIMIT_PER_HOUR = 20;

/**
 * 送信元（CF-Connecting-IP）のハッシュ。生の IP は持たない。
 * IP の数は少なく素の SHA-256 は総当りで戻せるので、SESSION_SECRET を鍵にした HMAC-SHA-256 にする（鍵は表に無い）。
 * 32 文字（128 ビット）に切って持つ。
 */
export async function sourceHash(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(`survey-source:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(ip)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 送信元の IP。Cloudflare の CF-Connecting-IP。手元の dev には無いので "local" */
export function clientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip")?.trim() || "local";
}
