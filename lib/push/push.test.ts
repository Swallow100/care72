// T149: Web Push。VAPID の署名（RFC 8292）、中身の暗号化（RFC 8291 の aes128gcm）、購読の形と送り先の制限、送る・結果の記録。
// 鍵はテストの中でその場で作る（鍵の値をどこにも書かない）。暗号化は受け手の側の復号をここで別に書いて確かめる
// （HKDF を HMAC で手で組み、送る側の WebCrypto の HKDF とは別の道）。本物の送り先へは送らない（偽の fetch）。Claude は呼ばない。

import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url, utf8 } from "../auth/bytes.ts";
import { encryptPayload, RECORD_SIZE } from "./encrypt.ts";
import { pushMessage, PUSH_BODY, PUSH_TAG, PUSH_TITLE, PUSH_URL, audienceOf } from "./message.ts";
import { sendAll, sendPush, type PushFetch } from "./send.ts";
import { endpointAllowed, parseSubscription } from "./subscription.ts";
import { testReceiver, testVapidEnv } from "./test-keys.ts";
import { audienceOf as vapidAudience, loadVapid, parseVapidSubject, vapidAuthorization, vapidJwt, vapidPublicKey } from "./vapid.ts";

const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const NOW = 1_800_000_000;

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const cat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) {
    out.set(x, i);
    i += x.length;
  }
  return out;
};

/** 受け手の側の復号（RFC 8291 の 3.3・3.4 と RFC 8188 を、HMAC で手で組む） */
async function decrypt(body: Uint8Array, receiver: Awaited<ReturnType<typeof testReceiver>>): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
  const idlen = body[20];
  const senderPub = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  expect(rs).toBe(RECORD_SIZE);
  expect(idlen).toBe(65);
  const senderKey = await crypto.subtle.importKey("raw", senderPub, ECDH, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, receiver.pair.privateKey, 256));
  const prkKey = await hmac(receiver.auth, shared);
  const ikm = await hmac(prkKey, cat(utf8("WebPush: info\0"), receiver.p256dh, senderPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, sealed));
  // 終わりの 0 の詰め物を外し、最後のレコードの区切り 0x02 を外す
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  expect(plain[end - 1]).toBe(0x02);
  return plain.slice(0, end - 1);
}

describe("送り手の鍵（VAPID）", () => {
  it("3 つ揃って組のときだけ読める。どれかが無い・形が違う・組でないときは null（送らない）", async () => {
    const env = await testVapidEnv();
    expect(vapidPublicKey(env)).toBe(env.VAPID_PUBLIC_KEY);
    expect(await loadVapid(env)).not.toBeNull();
    expect(await loadVapid({})).toBeNull();
    expect(vapidPublicKey({ ...env, VAPID_SUBJECT: undefined })).toBeNull();
    expect(vapidPublicKey({ ...env, VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(vapidPublicKey({ ...env, VAPID_PUBLIC_KEY: "AAAA" })).toBeNull();
    const other = await testVapidEnv();
    // 公開鍵と秘密鍵が組でない（別々に作った物）
    expect(await loadVapid({ ...env, VAPID_PRIVATE_KEY: other.VAPID_PRIVATE_KEY })).toBeNull();
  });

  it("連絡先は mailto: か https: だけ", () => {
    expect(parseVapidSubject("mailto:a@example.invalid")).toBe("mailto:a@example.invalid");
    expect(parseVapidSubject("https://care72.app")).toBe("https://care72.app");
    expect(parseVapidSubject("http://care72.app")).toBeNull();
    expect(parseVapidSubject("care72")).toBeNull();
    expect(parseVapidSubject("mailto:a b@x")).toBeNull();
  });

  it("JWT は ES256 で、公開鍵で確かめられ、aud は送り先の origin・exp は 24 時間以内・sub は連絡先", async () => {
    const env = await testVapidEnv();
    const vapid = (await loadVapid(env))!;
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    const jwt = await vapidJwt(vapid, endpoint, NOW);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(h)!))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(c)!));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: expect.any(Number), sub: env.VAPID_SUBJECT });
    expect(claims.exp - NOW).toBeGreaterThan(0);
    expect(claims.exp - NOW).toBeLessThanOrEqual(24 * 3600);
    const pub = await crypto.subtle.importKey("raw", fromBase64Url(env.VAPID_PUBLIC_KEY)!, P256, false, ["verify"]);
    const sig = fromBase64Url(s)!;
    expect(sig.length).toBe(64);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, utf8(`${h}.${c}`))).toBe(true);
    expect(await vapidAuthorization(vapid, endpoint, NOW)).toMatch(new RegExp(`^vapid t=[^,]+, k=${env.VAPID_PUBLIC_KEY}$`));
    expect(vapidAudience("https://web.push.apple.com:443/x?y=1")).toBe("https://web.push.apple.com");
  });
});

describe("中身の暗号化（aes128gcm）", () => {
  it("受け手の鍵で戻すと元の中身。毎回違う（salt と使い捨ての鍵）", async () => {
    const r = await testReceiver();
    const plain = utf8(JSON.stringify(pushMessage("self")));
    const a = await encryptPayload(plain, { p256dh: r.p256dh, auth: r.auth });
    const b = await encryptPayload(plain, { p256dh: r.p256dh, auth: r.auth });
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
    expect(new TextDecoder().decode(await decrypt(a, r))).toBe(JSON.stringify(pushMessage("self")));
    expect(new TextDecoder().decode(await decrypt(b, r))).toBe(JSON.stringify(pushMessage("self")));
    // 本文の長さ = 頭(16+4+1+65) + 中身 + 区切り 1 + 認証の印 16
    expect(a.length).toBe(86 + plain.length + 1 + 16);
  });

  it("ほかの受け手の鍵では戻せない", async () => {
    const r = await testReceiver();
    const other = await testReceiver();
    const body = await encryptPayload(utf8("x"), { p256dh: r.p256dh, auth: r.auth });
    await expect(decrypt(body, { ...other })).rejects.toThrow();
  });

  it("受け手の鍵の形が違う・長すぎる中身は投げる", async () => {
    const r = await testReceiver();
    await expect(encryptPayload(utf8("x"), { p256dh: r.p256dh.slice(1), auth: r.auth })).rejects.toThrow();
    await expect(encryptPayload(utf8("x"), { p256dh: r.p256dh, auth: r.auth.slice(1) })).rejects.toThrow();
    await expect(encryptPayload(new Uint8Array(RECORD_SIZE), { p256dh: r.p256dh, auth: r.auth })).rejects.toThrow();
  });
});

describe("通知の文と押した先", () => {
  it("文は固定で名前を持たない。本人は /me、家族は /family", () => {
    expect(pushMessage("self")).toEqual({ t: PUSH_TITLE, b: PUSH_BODY.self, u: "/me", g: PUSH_TAG });
    expect(pushMessage("family")).toEqual({ t: PUSH_TITLE, b: PUSH_BODY.family, u: "/family", g: PUSH_TAG });
    expect(PUSH_TITLE).toBe("ケア72");
    expect(PUSH_BODY.self).toBe("大丈夫ですか");
    expect(audienceOf(null)).toBe("self");
    expect(audienceOf("c-1")).toBe("family");
    expect(Object.values(PUSH_URL)).toEqual(["/me", "/family"]);
  });
});

describe("購読の形と送り先の制限", () => {
  it("Web Push の事業者の https の宛先だけ", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://api.push.apple.com/3/device/x",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(endpointAllowed(ok), ok).toBe(true);
    }
    for (const ng of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://example.com/push",
      "https://push.apple.com.example.com/x",
      "https://evilnotify.windows.com.example/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://care72.app/api/x",
      "javascript:alert(1)",
      `https://fcm.googleapis.com/${"a".repeat(1100)}`,
    ]) {
      expect(endpointAllowed(ng), ng).toBe(false);
    }
  });

  it("鍵の形を確かめる（p256dh 65 バイト・auth 16 バイト）", async () => {
    const r = await testReceiver();
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(parseSubscription({ endpoint, keys: r.json })).toEqual({ endpoint, ...r.json });
    expect(parseSubscription({ endpoint, keys: { ...r.json, auth: toBase64Url(new Uint8Array(8)) } })).toBeNull();
    expect(parseSubscription({ endpoint, keys: { ...r.json, p256dh: "!!" } })).toBeNull();
    expect(parseSubscription({ endpoint: "https://example.com/x", keys: r.json })).toBeNull();
    expect(parseSubscription({ endpoint })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("x")).toBeNull();
  });
});

describe("送る（偽の送り先）", () => {
  async function setup() {
    const vapid = (await loadVapid(await testVapidEnv()))!;
    const r = await testReceiver();
    const target = { id: "s1", endpoint: "https://fcm.googleapis.com/fcm/send/abc", ...r.json };
    return { vapid, r, target };
  }

  it("POST で、暗号化した本文・VAPID・TTL・Urgency・Topic を付け、移りは追わない。受け手の鍵で戻すと固定の文", async () => {
    const { vapid, r, target } = await setup();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: PushFetch = async (url, init) => {
      seen.push({ url, init });
      return new Response(null, { status: 201 });
    };
    const out = await sendPush(fetchFn, vapid, target, pushMessage("family"), NOW);
    expect(out).toEqual({ id: "s1", result: "sent", status: 201 });
    expect(seen).toHaveLength(1);
    const { url, init } = seen[0];
    expect(url).toBe(target.endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const h = init.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe(String(12 * 3600));
    expect(h.Urgency).toBe("high");
    expect(h.Topic).toBe(PUSH_TAG);
    expect(h.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    const plain = JSON.parse(new TextDecoder().decode(await decrypt(init.body as Uint8Array, r)));
    expect(plain).toEqual(pushMessage("family"));
  });

  it("404・410 は無くなった購読、429・500・通信の失敗は失敗、許していない宛先は送らずに無くなった扱い", async () => {
    const { vapid, target } = await setup();
    const status = (s: number): PushFetch => async () => new Response(null, { status: s });
    expect((await sendPush(status(410), vapid, target, pushMessage("self"), NOW)).result).toBe("gone");
    expect((await sendPush(status(404), vapid, target, pushMessage("self"), NOW)).result).toBe("gone");
    expect((await sendPush(status(429), vapid, target, pushMessage("self"), NOW)).result).toBe("failed");
    expect((await sendPush(status(500), vapid, target, pushMessage("self"), NOW)).result).toBe("failed");
    const boom: PushFetch = async () => {
      throw new Error("通信なし");
    };
    expect((await sendPush(boom, vapid, target, pushMessage("self"), NOW)).result).toBe("failed");
    let called = 0;
    const count: PushFetch = async () => {
      called++;
      return new Response(null, { status: 201 });
    };
    expect((await sendPush(count, vapid, { ...target, endpoint: "https://example.com/x" }, pushMessage("self"), NOW)).result).toBe(
      "gone",
    );
    expect(called).toBe(0);
  });

  it("束は 6 つずつ並べ、1 つの失敗でほかを止めない", async () => {
    const { vapid, target } = await setup();
    let running = 0;
    let peak = 0;
    const fetchFn: PushFetch = async (url) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return new Response(null, { status: url.endsWith("/3") ? 500 : 201 });
    };
    const targets = Array.from({ length: 13 }, (_, i) => ({ ...target, id: `s${i}`, endpoint: `${target.endpoint}/${i}`, message: pushMessage("self") }));
    const out = await sendAll(fetchFn, vapid, targets, NOW);
    expect(out).toHaveLength(13);
    expect(out.filter((o) => o.result === "failed").map((o) => o.id)).toEqual(["s3"]);
    expect(peak).toBeLessThanOrEqual(6);
  });
});
