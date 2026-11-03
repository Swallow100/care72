// 本人・家族のスマホ入口のリンク（docs/tasks/T69a.md）。ケアマネが本人のページから出し、本人・家族が自分のスマホで開く。
// 作りは QR の頁のトークン（lib/qr/token.ts）と同じ: SESSION_SECRET の HMAC-SHA256 で署名し、表に持たない。
// 本人の行の版（people.phone_link_generation）と作った時刻（people.phone_link_issued_at）から、いつでも同じ物を作り直せる。
//
// 決まり:
// - 期限は作った時刻から 180 日（QR の上限と同じ）。日数は選ばない。期限なし・180 日より長い物は署名が合っても通さない
// - 版は本人ごとに 1 つで、本人用と家族用の全部のリンクが同じ版を使う。作り直すと全部のリンクが一度に無効になる
//   （版を表と比べるのは lib/qr/phone-link-store.ts の resolvePhoneLink）
// - 署名する文の頭に「care72-phone-v1:」を付ける。QR（care72-qr-v1:）ともセッションの cookie（頭なし）とも取り違えない
// - 中身は本人の id・連絡先の id（本人用は null）・版・時刻だけ。氏名・カナ・生年月日・電話・住所は入れない（URL に載るので）

import { z } from "zod";
import { fromBase64Url, toBase64Url, utf8 } from "../auth/bytes.ts";
import { QR_TTL_MAX_DAYS } from "./token.ts";

const DAY_SEC = 24 * 60 * 60;

/** 期限（日）。QR の上限と同じで、選ばない */
export const PHONE_LINK_TTL_DAYS = QR_TTL_MAX_DAYS;
export const PHONE_LINK_TTL_SEC = PHONE_LINK_TTL_DAYS * DAY_SEC;
/** 長すぎる文字列は読む前に捨てる */
const MAX_TOKEN_LENGTH = 512;
/** 署名の頭（QR とセッションの署名と分ける） */
const SIGN_PREFIX = "care72-phone-v1:";

const payloadSchema = z
  .object({
    v: z.literal(1),
    /** 本人の id */
    p: z.string().min(1).max(128),
    /** 連絡先の id（家族用）。本人用は null */
    c: z.string().min(1).max(128).nullable(),
    /** 版（1 から） */
    g: z.number().int().min(1),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
export type PhoneLinkPayload = z.infer<typeof payloadSchema>;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** 作った時刻（秒）から期限まで（180 日） */
export function phoneLinkTimes(issuedAtSec: number): { iat: number; exp: number } {
  return { iat: issuedAtSec, exp: issuedAtSec + PHONE_LINK_TTL_SEC };
}

function badTimes(p: Pick<PhoneLinkPayload, "iat" | "exp">): boolean {
  return p.exp <= p.iat || p.exp - p.iat > PHONE_LINK_TTL_SEC;
}

/** 署名する。期限なし・180 日より長い物は作らない（投げる） */
export async function signPhoneLink(payload: PhoneLinkPayload, secret: string): Promise<string> {
  const p = payloadSchema.parse(payload);
  if (badTimes(p)) throw new Error("スマホ入口の期限は 180 日まで");
  const body = toBase64Url(utf8(JSON.stringify(p)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(SIGN_PREFIX + body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/** 署名・形・期限を確かめる。どれかが違えば null（版は見ない。版は表と比べる）。now は秒 */
export async function verifyPhoneLink(token: string | null | undefined, secret: string, now: number): Promise<PhoneLinkPayload | null> {
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
  if (p.exp <= now || p.iat > now + 60 || badTimes(p)) return null;
  return p;
}

/** 開く口の道（/s/<token>）。元（scheme://host）は lib/qr/url.ts の originFromHeaders */
export const PHONE_LINK_PATH = "/s";
/** 通らないリンクを開いたときの 1 画面（/s/<token> から 303 で送る。トークンを URL に残さない） */
export const PHONE_LINK_INVALID_PATH = "/s/invalid";

export function phoneLinkUrl(origin: string, token: string): string {
  return `${origin}${PHONE_LINK_PATH}/${token}`;
}
