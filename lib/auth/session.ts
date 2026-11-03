// セッション。cookie に入れる文字列を SESSION_SECRET の HMAC-SHA256 で署名する。7 日で切れる。
// 表に持たない（署名だけで確かめる）。ログアウトは cookie を消す。
// 中身は「誰か」だけで、事業所・役の名前・担当は毎回 D1 から読む（アカウントを消せば次の要求から入れない）。
// pv はパスワードのハッシュの指紋。パスワードを変えると前のセッションは使えなくなる。
// 3 つ目の形 link（T69a）: 本人・家族がスマホ入口のリンク（lib/qr/phone-link.ts）で開いたセッション。パスワードは無く pv は固定の "link"。
// 期限はリンクの期限と同じ（最長 180 日。本人・家族はホーム画面に追加して何か月も開く）。版（g）は毎回 D1 と比べ、作り直すと切れる。

import { z } from "zod";
import { PHONE_LINK_TTL_SEC } from "../qr/phone-link.ts";
import { fromBase64Url, toBase64Url, utf8 } from "./bytes.ts";
import { JUDGE_ROLES } from "./roles.ts";

export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
/** スマホ入口のセッションの上限（リンクの期限と同じ 180 日）。account・judge は SESSION_TTL_SEC のまま */
export const LINK_SESSION_TTL_SEC = PHONE_LINK_TTL_SEC;
/** スマホ入口のセッションの pv（パスワードの指紋の代わりの固定の字） */
export const LINK_SESSION_PV = "link";
/** 長すぎる cookie は読む前に捨てる */
const MAX_TOKEN_LENGTH = 2048;

const base = { v: z.literal(1), pv: z.string().min(1).max(64), iat: z.number().int(), exp: z.number().int() };
const payloadSchema = z.discriminatedUnion("k", [
  z.object({ ...base, k: z.literal("account"), a: z.string().min(1).max(128) }).strict(),
  z.object({ ...base, k: z.literal("judge"), r: z.enum(JUDGE_ROLES).nullable() }).strict(),
  z
    .object({
      ...base,
      pv: z.literal(LINK_SESSION_PV),
      k: z.literal("link"),
      /** 本人の id */
      p: z.string().min(1).max(128),
      /** 連絡先の id（家族のスマホ）。本人のスマホは null */
      c: z.string().min(1).max(128).nullable(),
      /** リンクの版（people.phone_link_generation） */
      g: z.number().int().min(1),
    })
    .strict(),
]);
export type SessionPayload = z.infer<typeof payloadSchema>;

export class SessionSecretMissing extends Error {
  constructor() {
    super("SESSION_SECRET が無い（配信では Cloudflare の secret に入れる）");
    this.name = "SessionSecretMissing";
  }
}

/** 手元で SESSION_SECRET が無いときの署名の鍵。配信の build では使わない */
export const DEV_SESSION_SECRET = "care72-dev-only-session-secret-not-for-production";
const MIN_SECRET_LENGTH = 32;
// 出したかの印は globalThis に置く（next dev は同じファイルを画面と route の 2 つの束で読むので、変数だと 2 回出る）
const WARNED = Symbol.for("care72.devSessionSecretWarned");
const marks = globalThis as unknown as Record<symbol, boolean | undefined>;

/**
 * 署名の鍵。手元（NODE_ENV が production でない）で無ければ開発用の固定の値で動き、console に 1 行出す。
 * 配信の build（NODE_ENV=production）で無い・短いときは投げる（最初の要求で止まる。Workers は env を要求の中でしか読めない）。
 */
export function sessionSecret(env: { SESSION_SECRET?: string }, nodeEnv: string | undefined = process.env.NODE_ENV): string {
  const v = env.SESSION_SECRET?.trim();
  if (v && v.length >= MIN_SECRET_LENGTH) return v;
  if (nodeEnv === "production") throw new SessionSecretMissing();
  if (v) return v;
  if (!marks[WARNED]) {
    marks[WARNED] = true;
    console.warn("SESSION_SECRET が無いので開発用の値で署名する（手元だけ。配信では止まる）");
  }
  return DEV_SESSION_SECRET;
}

/** テストのため: 1 行出したかを戻す */
export function resetDevSecretWarning(): void {
  marks[WARNED] = false;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/** 署名・形・期限を確かめる。どれかが違えば null。now は秒 */
export async function verifySession(token: string | null | undefined, secret: string, now: number): Promise<SessionPayload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const sig = fromBase64Url(token.slice(dot + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, utf8(body));
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
  const maxTtl = p.k === "link" ? LINK_SESSION_TTL_SEC : SESSION_TTL_SEC;
  if (p.exp <= now || p.iat > now + 60 || p.exp - p.iat > maxTtl) return null;
  return p;
}

/** 新しいセッションの時刻（今から 7 日） */
export function sessionTimes(now: number): { iat: number; exp: number } {
  return { iat: now, exp: now + SESSION_TTL_SEC };
}

/** パスワードのハッシュの指紋（SHA-256 の先頭 16 字）。ハッシュそのものは cookie に入れない */
export async function passwordVersion(passwordHash: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", utf8(passwordHash));
  return toBase64Url(new Uint8Array(d)).slice(0, 16);
}

/**
 * 平文の secret の指紋。平文の素の SHA-256 を cookie に入れると、cookie から総当たりで戻せるので、
 * SESSION_SECRET の HMAC にする（鍵を知らなければ計算できない）。平文を変えると前のセッションが切れる。
 */
export async function plainPasswordVersion(password: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(`care72-pv-plain:${password.normalize("NFC")}`));
  return toBase64Url(new Uint8Array(sig)).slice(0, 16);
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
