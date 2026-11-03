// QR の頁のトークン（docs/tasks/T16.md）。本人ごとに 1 つ、SESSION_SECRET の HMAC-SHA256 で署名する。
// 表に持たない。本人の行の版（people.qr_generation）と作った時刻（people.qr_issued_at）から、いつでも同じ物を作り直せる。
//
// 決まり:
// - 期限なしのトークンは作らない。期限は作った時刻から 30・90・180 日（本人の行の people.qr_ttl_days、既定 90。T64）。
//   exp の無い物・上限の 180 日より長い物は、署名が合っても通さない。行の日数と違う物は resolveQrToken が通さない
// - 作り直すと版が上がり、前の版のトークンは通らない（lib/qr/store.ts の resolveQrToken が表の版と比べる）
// - 署名する文の頭に「care72-qr-v1:」を付ける。セッションの cookie（lib/auth/session.ts、同じ鍵で頭なし）と取り違えない
// - 中身は本人の id・版・時刻だけ。氏名・カナ・生年月日は入れない（URL に載るので）

import { z } from "zod";
import { fromBase64Url, toBase64Url, utf8 } from "../auth/bytes.ts";

const DAY_SEC = 24 * 60 * 60;

/** 選べる期限（日）。migrations/0015_qr_ttl_days.sql の CHECK と同じ並び */
export const QR_TTL_CHOICES = [30, 90, 180] as const;
export type QrTtlDays = (typeof QR_TTL_CHOICES)[number];
/** 既定の期限（日）。行に日数が無いとき・選ばずに作ったときの値 */
export const QR_TTL_DAYS: QrTtlDays = 90;
export const QR_TTL_SEC = QR_TTL_DAYS * DAY_SEC;
/** 上限（日）。これより長い物は署名が合っても通さない */
export const QR_TTL_MAX_DAYS = 180;
const QR_TTL_MAX_SEC = QR_TTL_MAX_DAYS * DAY_SEC;

export function isQrTtlDays(v: unknown): v is QrTtlDays {
  return typeof v === "number" && (QR_TTL_CHOICES as readonly number[]).includes(v);
}

/**
 * フォームの ttl を読む。欄が無ければ null（行の今の日数のまま）。集合の数（"30"・"90"・"180"）は日数、ほかは断る。
 * 数の書き方は 10 進の整数だけ（"1e2"・"30.0"・"90日" は断る）
 */
export function parseQrTtl(raw: FormDataEntryValue | null | undefined): { ok: true; days: QrTtlDays | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, days: null };
  if (typeof raw !== "string") return { ok: false };
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return { ok: false };
  const n = Number(s);
  return isQrTtlDays(n) ? { ok: true, days: n } : { ok: false };
}
/** 長すぎる文字列は読む前に捨てる */
const MAX_TOKEN_LENGTH = 512;
/** 署名の頭（セッションの署名と分ける） */
const SIGN_PREFIX = "care72-qr-v1:";

const payloadSchema = z
  .object({
    v: z.literal(1),
    /** 本人の id */
    p: z.string().min(1).max(128),
    /** 版（1 から） */
    g: z.number().int().min(1),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
export type QrPayload = z.infer<typeof payloadSchema>;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** 作った時刻（秒）から期限まで。日数の既定は 90 */
export function qrTimes(issuedAtSec: number, ttlDays: QrTtlDays = QR_TTL_DAYS): { iat: number; exp: number } {
  return { iat: issuedAtSec, exp: issuedAtSec + ttlDays * DAY_SEC };
}

/** 署名する。期限なし・180 日より長い物は作らない（投げる） */
export async function signQrToken(payload: QrPayload, secret: string): Promise<string> {
  const p = payloadSchema.parse(payload);
  if (p.exp <= p.iat || p.exp - p.iat > QR_TTL_MAX_SEC) throw new Error("QR の期限は 180 日まで");
  const body = toBase64Url(utf8(JSON.stringify(p)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(SIGN_PREFIX + body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/** 署名・形・期限を確かめる。どれかが違えば null（版は見ない。版は表と比べる）。now は秒 */
export async function verifyQrToken(token: string | null | undefined, secret: string, now: number): Promise<QrPayload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const sig = fromBase64Url(token.slice(dot + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, utf8(SIGN_PREFIX + body));
  if (!ok) return null;
  const raw = fromBase64Url(body);
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.exp <= now || p.iat > now + 60 || p.exp <= p.iat || p.exp - p.iat > QR_TTL_MAX_SEC) return null;
  return p;
}
