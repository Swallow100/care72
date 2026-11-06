// テストだけの鍵（その場で作る。値をどこにも書かない）。送り手の鍵（VAPID、env の形）と受け手（ブラウザ）の鍵。配信のコードからは使わない。

import { toBase64Url } from "../auth/bytes.ts";

const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** 送り手の鍵（env の形） */
export async function testVapidEnv(subject = "mailto:test@example.invalid") {
  const pair = (await crypto.subtle.generateKey(P256, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { VAPID_PUBLIC_KEY: toBase64Url(pub), VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: subject };
}

/** 受け手（ブラウザ）の鍵。json は PushSubscription の keys の形 */
export async function testReceiver() {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh, auth, json: { p256dh: toBase64Url(p256dh), auth: toBase64Url(auth) } };
}
