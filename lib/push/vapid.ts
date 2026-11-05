// Web Push の送り手の鍵（VAPID、RFC 8292）。env の VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT から読む（T149）。
// 鍵は Cloudflare の secret（配信）と .dev.vars（手元）にだけ置き、コード・文書・ログ・応答に値を出さない。
// 形: 公開鍵は P-256 の非圧縮の点（65 バイト、頭が 0x04）の base64url、秘密鍵はその d（32 バイト）の base64url。
//   作り方は tools/push/vapid-keys.ts（作者が手元で 1 回。作業者は作らない）。
// どれかが無い・形が違う・公開鍵と秘密鍵が組でない、のどれでも null（送らない。画面は「通知 未設定」）。
// 署名は WebCrypto の ECDSA P-256（SHA-256）。WebCrypto の署名は r‖s の 64 バイトで、JWS の ES256 の形そのまま。Workers と Node の両方で動く。

import { fromBase64Url, toBase64Url, utf8 } from "../auth/bytes.ts";

export type VapidEnv = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };

export type Vapid = {
  /** 公開鍵（base64url、65 バイト）。ブラウザの pushManager.subscribe の applicationServerKey と、Authorization の k */
  publicKey: string;
  /** 秘密鍵（署名だけ。取り出せない形） */
  privateKey: CryptoKey;
  /** 連絡先（mailto: か https:）。送り先の事業者が困ったときの宛先 */
  subject: string;
};

const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/** JWT の期限（秒）。仕様の上限は 24 時間。送るたびに作るので短くてよい */
export const VAPID_JWT_TTL_SEC = 12 * 60 * 60;

/** 公開鍵の形（65 バイト、0x04 で始まる）。違えば null */
export function parseVapidPublicKey(raw: string | undefined | null): Uint8Array<ArrayBuffer> | null {
  const v = raw?.trim();
  if (!v) return null;
  const b = fromBase64Url(v);
  if (!b || b.length !== 65 || b[0] !== 0x04) return null;
  return b;
}

/** 連絡先の形。mailto: か https: で始まる 1 行（200 字まで） */
export function parseVapidSubject(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v || v.length > 200 || /[\s]/.test(v)) return null;
  if (/^mailto:[^@\s]+@[^@\s]+$/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** 画面に渡す公開鍵（購読に使う）。3 つ揃っていて形が合うときだけ。組かどうかは loadVapid が見る */
export function vapidPublicKey(env: VapidEnv): string | null {
  if (!parseVapidPublicKey(env.VAPID_PUBLIC_KEY) || !parseVapidSubject(env.VAPID_SUBJECT)) return null;
  const d = fromBase64Url(env.VAPID_PRIVATE_KEY?.trim() ?? "");
  if (!d || d.length !== 32) return null;
  return env.VAPID_PUBLIC_KEY!.trim();
}

/** 秘密鍵を読み、公開鍵と組かを確かめる（試しに署名して公開鍵で確かめる）。合わなければ null */
export async function loadVapid(env: VapidEnv): Promise<Vapid | null> {
  const publicKey = vapidPublicKey(env);
  if (!publicKey) return null;
  const pub = parseVapidPublicKey(publicKey)!;
  const subject = parseVapidSubject(env.VAPID_SUBJECT)!;
  let privateKey: CryptoKey;
  let verifyKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        d: env.VAPID_PRIVATE_KEY!.trim(),
        x: toBase64Url(pub.slice(1, 33)),
        y: toBase64Url(pub.slice(33, 65)),
        ext: false,
      },
      P256,
      false,
      ["sign"],
    );
    verifyKey = await crypto.subtle.importKey("raw", pub, P256, false, ["verify"]);
    const probe = utf8("care72-vapid-probe");
    const sig = await crypto.subtle.sign(SIGN, privateKey, probe);
    if (!(await crypto.subtle.verify(SIGN, verifyKey, sig, probe))) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

/** 送り先の URL の origin（JWT の aud） */
export function audienceOf(endpoint: string): string {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

/** VAPID の JWT（ES256）。now は秒 */
export async function vapidJwt(vapid: Vapid, endpoint: string, now: number): Promise<string> {
  const head = toBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(utf8(JSON.stringify({ aud: audienceOf(endpoint), exp: now + VAPID_JWT_TTL_SEC, sub: vapid.subject })));
  const input = `${head}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, vapid.privateKey, utf8(input)));
  return `${input}.${toBase64Url(sig)}`;
}

/** Authorization の見出しの値（RFC 8292 の vapid の形） */
export async function vapidAuthorization(vapid: Vapid, endpoint: string, now: number): Promise<string> {
  return `vapid t=${await vapidJwt(vapid, endpoint, now)}, k=${vapid.publicKey}`;
}

/** 鍵を 1 組作る（tools/push/vapid-keys.ts が作者の手元で使う。値はここで出さない） */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey(P256, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("秘密鍵を取り出せない");
  return { publicKey: toBase64Url(pub), privateKey: jwk.d };
}
