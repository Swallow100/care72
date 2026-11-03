// スマホ入口のリンクを開く口（app/s/[token]/route.ts の中身。T69a）。D1 と鍵を引数で受け取る（テストで node:sqlite を渡す）。
// ログインも新規登録も無い: リンクが通れば、本人用は役 self・家族用は役 family のセッションを cookie に付け、/me か /family へ 303。
// 通らなければ「無効」の 1 画面（/s/invalid）へ 303。どれで落ちたかは出さず、cookie にも触らない（今のセッションは残す）。
// 応答は保存させない・Referer に載せない・検索に載せない（トークンを持った URL を漏らさない。QR の頁と同じ）。
// セッションの期限はリンクの期限と同じ（cookie の Max-Age は残りの秒）。版は開くたびに D1 と比べる（lib/auth/principal.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import { sessionCookie } from "../auth/cookie.ts";
import { PAGE_PATHS } from "../auth/roles.ts";
import { LINK_SESSION_PV, signSession } from "../auth/session.ts";
import { PHONE_LINK_INVALID_PATH } from "./phone-link.ts";
import { resolvePhoneLink } from "./phone-link-store.ts";

/** 開く口の応答の見出し（どちらの応答にも付ける） */
export const PHONE_OPEN_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function redirect(request: Request, path: string, setCookie?: string): Response {
  const headers = new Headers({ ...PHONE_OPEN_HEADERS, Location: new URL(path, request.url).toString() });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

/** /s/<token> の GET。now は秒 */
export async function openPhoneLink(request: Request, db: D1Database, secret: string, token: string, now: number): Promise<Response> {
  const hit = await resolvePhoneLink(db, secret, token, now);
  if (!hit) return redirect(request, PHONE_LINK_INVALID_PATH);
  const { payload } = hit;
  // セッションの iat は開いた時刻（リンクの iat が端末の時計の差で少し先でも、期限までの長さが 180 日を超えないように小さい方）
  const iat = Math.min(now, payload.iat);
  const session = await signSession(
    { v: 1, k: "link", p: payload.p, c: payload.c, g: payload.g, pv: LINK_SESSION_PV, iat, exp: payload.exp },
    secret,
  );
  const path = payload.c === null ? PAGE_PATHS.me : PAGE_PATHS.family;
  return redirect(request, path, sessionCookie(session, request.url, payload.exp - now));
}
