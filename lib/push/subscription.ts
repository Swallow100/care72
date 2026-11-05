// ブラウザの購読（PushSubscription の JSON）を受ける形（T149）。端末から来た物なので、全部ここで確かめてから表に入れる。
// 送り先（endpoint）は Web Push の事業者の https の宛先だけ。サーバーがその URL へ POST するので、ほかの宛先（社内の URL・
// 別のサイト）を入れさせない（送らせる道にしない）。鍵は p256dh（65 バイト）と auth（16 バイト）の base64url。

import { fromBase64Url } from "../auth/bytes.ts";
import { receiverKeysOk } from "./encrypt.ts";

/** 送り先の事業者（Chrome・Android は Google、Firefox は Mozilla、Safari・iPhone は Apple、Edge は Microsoft） */
const EXACT_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
/** この名前で終わる宛先（Apple と Microsoft は地域ごとの名前） */
const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export const MAX_ENDPOINT_LENGTH = 1024;

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** 送り先として受けてよい URL か（https・既定のポート・名前と鍵の無い URL・事業者の名前） */
export function endpointAllowed(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  const host = u.hostname.toLowerCase();
  return EXACT_HOSTS.includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

/** 端末から来た購読（JSON）を確かめる。形が違えば null */
export function parseSubscription(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { endpoint?: unknown; keys?: unknown };
  const keys = (o.keys && typeof o.keys === "object" ? o.keys : {}) as { p256dh?: unknown; auth?: unknown };
  if (typeof o.endpoint !== "string" || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  if (!endpointAllowed(o.endpoint)) return null;
  if (keys.p256dh.length > 128 || keys.auth.length > 64) return null;
  const p256dh = fromBase64Url(keys.p256dh);
  const auth = fromBase64Url(keys.auth);
  if (!p256dh || !auth || !receiverKeysOk({ p256dh, auth })) return null;
  return { endpoint: o.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}
