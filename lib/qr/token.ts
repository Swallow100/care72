// QR の頁のトークン（docs/tasks/T16.md）。本人ごとに 1 つ、SESSION_SECRET の HMAC-SHA256 で署名する。
// 表に持たない。本人の行の版（people.qr_generation）と作った時刻（people.qr_issued_at）から、いつでも同じ物を作り直せる。
//
// 決まり:
// - 期限なしのトークンは作らない。期限は作った時刻から 90 日。exp の無い物・90 日より長い物は、署名が合っても通さない
// - 作り直すと版が上がり、前の版のトークンは通らない（lib/qr/store.ts の resolveQrToken が表の版と比べる）
// - 署名する文の頭に「care72-qr-v1:」を付ける。セッションの cookie（lib/auth/session.ts、同じ鍵で頭なし）と取り違えない
// - 中身は本人の id・版・時刻だけ。氏名・カナ・生年月日は入れない（URL に載るので）

import { z } from "zod";
import { fromBase64Url, toBase64Url, utf8 } from "../auth/bytes.ts";

/** 期限（日） */
export const QR_TTL_DAYS = 90;
export const QR_TTL_SEC = QR_TTL_DAYS * 24 * 60 * 60;
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

/** 作った時刻（秒）から期限まで */
export function qrTimes(issuedAtSec: number): { iat: number; exp: number } {
  return { iat: issuedAtSec, exp: issuedAtSec + QR_TTL_SEC };
}

/** 署名する。期限なし・90 日より長い物は作らない（投げる） */
export async function signQrToken(payload: QrPayload, secret: string): Promise<string> {
  const p = payloadSchema.parse(payload);
  if (p.exp <= p.iat || p.exp - p.iat > QR_TTL_SEC) throw new Error("QR の期限は 90 日まで");
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
  if (p.exp <= now || p.iat > now + 60 || p.exp <= p.iat || p.exp - p.iat > QR_TTL_SEC) return null;
  return p;
}
