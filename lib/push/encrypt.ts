// Web Push の中身の暗号化（RFC 8291 の aes128gcm、RFC 8188 の 1 つのレコード）。WebCrypto だけで、Workers と Node の両方で動く（T149）。
// 受け手（ブラウザ）の鍵 2 つ（p256dh: P-256 の公開鍵 65 バイト、auth: 16 バイト）で、送るたびに作る使い捨ての鍵と ECDH をし、
// HKDF で中身の鍵と nonce を作り、AES-128-GCM で包む。送り先の事業者（Web Push の事業者）には中身が読めない。
//
//   IKM   = HKDF(salt = auth, ikm = ECDH(使い捨ての秘密鍵, p256dh), info = "WebPush: info\0" ‖ p256dh ‖ 使い捨ての公開鍵, 32)
//   CEK   = HKDF(salt = salt, ikm = IKM, info = "Content-Encoding: aes128gcm\0", 16)
//   NONCE = HKDF(salt = salt, ikm = IKM, info = "Content-Encoding: nonce\0", 12)
//   本文  = salt(16) ‖ rs(4、4096) ‖ idlen(1、65) ‖ 使い捨ての公開鍵(65) ‖ AES-GCM(CEK, NONCE, 中身 ‖ 0x02)

import { utf8 } from "../auth/bytes.ts";

/** 1 つのレコードの大きさ（仕様の既定）。中身はこれより十分小さい（通知の文は固定の短い文） */
export const RECORD_SIZE = 4096;
const SALT_BYTES = 16;
const TAG_BYTES = 16;

export type ReceiverKeys = { p256dh: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> };

/** テストだけ: salt と使い捨ての鍵を決めて渡す（同じ入力で同じ出力を見る） */
export type EncryptOptions = { salt?: Uint8Array<ArrayBuffer>; senderKeys?: CryptoKeyPair };

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** 受け手の鍵の形（p256dh 65 バイトで 0x04 始まり、auth 16 バイト）。違えば false */
export function receiverKeysOk(k: ReceiverKeys): boolean {
  return k.p256dh.length === 65 && k.p256dh[0] === 0x04 && k.auth.length === 16;
}

/** 中身を包む。戻りは送る本文（Content-Encoding: aes128gcm） */
export async function encryptPayload(
  plaintext: Uint8Array,
  receiver: ReceiverKeys,
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (!receiverKeysOk(receiver)) throw new Error("受け手の鍵の形が違う");
  // 中身 ‖ 区切り(0x02) ‖ 認証の印(16) が 1 つのレコードに入ること
  if (plaintext.length + 1 + TAG_BYTES > RECORD_SIZE) throw new Error("中身が長すぎる");

  const sender = opts.senderKeys ?? ((await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey));
  const receiverPublic = await crypto.subtle.importKey("raw", receiver.p256dh, ECDH, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverPublic }, sender.privateKey, 256),
  );

  const ikm = await hkdf(receiver.auth, shared, concat(utf8("WebPush: info\0"), receiver.p256dh, senderPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, concat(plaintext, new Uint8Array([0x02]))),
  );

  const header = new Uint8Array(SALT_BYTES + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(SALT_BYTES, RECORD_SIZE, false);
  header[SALT_BYTES + 4] = senderPublic.length;
  return concat(header, senderPublic, sealed);
}
