// Web Push を送る（T149）。1 つの購読へ 1 回 POST する sendPush と、購読の束へ数を絞って並べて送る sendAll。
// fetch は引数で受ける（テストは偽の送り先。本物の通知は鍵のある配信でだけ出る）。移りは追わない（redirect: "manual"。
// Workers は "error" を受けない）。送り先は購読を受けた時に Web Push の事業者の https だけに絞ってある（lib/push/subscription.ts）が、
// 送る前にもう一度確かめる。
// 応答: 201・200・202 は届いた、404・410 は購読が無くなった（表から消す）、ほか（429・5xx・通信の失敗）は失敗（表は残す）。

import { fromBase64Url, utf8 } from "../auth/bytes.ts";
import { encryptPayload } from "./encrypt.ts";
import { PUSH_TAG, PUSH_TTL_SEC, type PushMessage } from "./message.ts";
import { endpointAllowed } from "./subscription.ts";
import { vapidAuthorization, type Vapid } from "./vapid.ts";

export type PushFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushOutcome = { id: string; result: "sent" | "gone" | "failed"; status: number | null };

/** 同時に送る数（Workers の 1 要求の外向きの接続の数） */
export const PUSH_CONCURRENCY = 6;
/** 1 つの送り先を待つ長さ */
export const PUSH_TIMEOUT_MS = 10_000;

/** 1 つの購読へ送る。now は秒 */
export async function sendPush(
  fetchFn: PushFetch,
  vapid: Vapid,
  target: PushTarget,
  message: PushMessage,
  now: number,
): Promise<PushOutcome> {
  const p256dh = fromBase64Url(target.p256dh);
  const auth = fromBase64Url(target.auth);
  if (!endpointAllowed(target.endpoint) || !p256dh || !auth) return { id: target.id, result: "gone", status: null };
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await encryptPayload(utf8(JSON.stringify(message)), { p256dh, auth });
  } catch {
    // 鍵の形が違う購読（受けた時に確かめているので、ふつうは無い）
    return { id: target.id, result: "gone", status: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetchFn(target.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Authorization: await vapidAuthorization(vapid, target.endpoint, now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(PUSH_TTL_SEC),
        Urgency: "high",
        // 届いていない前の通知は、新しい物に置き換わる（同じ印）
        Topic: PUSH_TAG,
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return { id: target.id, result: "gone", status: res.status };
    if (res.status >= 200 && res.status < 300) return { id: target.id, result: "sent", status: res.status };
    return { id: target.id, result: "failed", status: res.status };
  } catch {
    return { id: target.id, result: "failed", status: null };
  } finally {
    clearTimeout(timer);
  }
}

/** 購読の束へ、PUSH_CONCURRENCY ずつ並べて送る。1 つの失敗でほかを止めない */
export async function sendAll(
  fetchFn: PushFetch,
  vapid: Vapid,
  targets: ReadonlyArray<PushTarget & { message: PushMessage }>,
  now: number,
): Promise<PushOutcome[]> {
  const out: PushOutcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++];
      out.push(await sendPush(fetchFn, vapid, t, t.message, now));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, targets.length) }, worker));
  return out;
}
