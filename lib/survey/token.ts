// アンケートの招待の token と、送信元のハッシュ（docs/tasks/T42.md）。Workers と Node の両方で動く crypto だけを使う。

import { fromBase64Url, toBase64Url, utf8 } from "../auth/bytes.ts";

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

/** 開いてから送れるまでの秒（ボットの守り。人が 9 問を読んで答えるのに 15 秒より短いことは無い） */
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

// ---------- 頁を開いた時刻の署名（15 秒の守り。T65） ----------
// 共有のリンクは何人も開くので、リンクの行に開いた時刻を 1 つ持つ形（T42 の opened_at）では守れない。
// 頁を出すときに「この token の頁をこの時刻に出した」を SESSION_SECRET で署名して埋め、送信でその時刻から 15 秒たったかを見る。
// token も署名に入れるので、審査員のリンクで取った印を本物のリンクに使い回せない。
// 印は 2 時間で切る（T81、朝の見直し 11/4 の安全 中 6）。1 つの印で何度でも送れると、印を 1 回取ったボットが 15 秒の守りを越え続けるので。
// 9 問は 2 時間あれば答えられる。切れた印は too_fast と分けて stale（頁を開き直す）。

async function stampKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(`survey-stamp:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const stampMessage = (token: string, ms: number): Uint8Array<ArrayBuffer> => utf8(`${token}:${ms}`);

/** 頁を出した時刻の印（"<ミリ秒>.<署名>"） */
export async function openStamp(token: string, now: Date, secret: string): Promise<string> {
  const ms = now.getTime();
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await stampKey(secret), stampMessage(token, ms)));
  return `${ms}.${toBase64Url(mac)}`;
}

/** 開いた時刻の印の期限（秒） */
export const STAMP_TTL_SEC = 2 * 60 * 60;

/** 印を確かめ、頁を出した時刻（ミリ秒）を返す。形が違う・署名が合わない・先の時刻は null（期限は checkStamp で見る） */
export async function stampTime(stamp: unknown, token: string, now: Date, secret: string): Promise<number | null> {
  if (typeof stamp !== "string" || stamp.length > 128) return null;
  const m = /^(\d{12,14})\.([A-Za-z0-9_-]{43})$/.exec(stamp);
  if (!m) return null;
  const ms = Number(m[1]);
  const mac = fromBase64Url(m[2]);
  if (!mac || !Number.isSafeInteger(ms) || ms > now.getTime()) return null;
  const ok = await crypto.subtle.verify("HMAC", await stampKey(secret), mac, stampMessage(token, ms));
  return ok ? ms : null;
}

export type StampCheck = { ok: true; openedAt: number } | { ok: false; error: "too_fast" | "stale" };

/**
 * 送信のときの印の確かめ（lib/survey/submit.ts）。印が無い・合わない・開いてから 15 秒未満は too_fast、2 時間を過ぎた物は stale。
 * ちょうど 15 秒・ちょうど 2 時間は通す
 */
export async function checkStamp(stamp: unknown, token: string, now: Date, secret: string): Promise<StampCheck> {
  const openedAt = await stampTime(stamp, token, now, secret);
  if (openedAt === null) return { ok: false, error: "too_fast" };
  const age = now.getTime() - openedAt;
  if (age < MIN_FILL_SEC * 1000) return { ok: false, error: "too_fast" };
  if (age > STAMP_TTL_SEC * 1000) return { ok: false, error: "stale" };
  return { ok: true, openedAt };
}
