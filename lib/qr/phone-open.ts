// スマホ入口のリンクを開く口（app/s/[token]/route.ts の中身。T69a）。D1 と鍵を引数で受け取る（テストで node:sqlite を渡す）。
// ログインも新規登録も無い: リンクが通れば、本人用は役 self・家族用は役 family のセッションを cookie に付け、/me か /family へ 303。
// 通らなければ「無効」の 1 画面（/s/invalid）へ 303。どれで落ちたかは出さず、cookie にも触らない（今のセッションは残す）。
// ケアマネ・行政・医療班・審査員のログイン中の端末では黙って替えない（設計の答え 11/4）: 間に 1 枚「ログイン中」（/s/<token>/switch）を出し、
// 「切替」（POST /s/<token>）でそのログインを終えて本人・家族の頁を開く。本人・家族のログイン中とログインなしは、そのまま開く。
// 応答は保存させない・Referer に載せない・検索に載せない（トークンを持った URL を漏らさない。QR の頁と同じ）。
// セッションの期限はリンクの期限と同じ（cookie の Max-Age は残りの秒）。版は開くたびに D1 と比べる（lib/auth/principal.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import { isSameOrigin, sessionCookie } from "../auth/cookie.ts";
import type { Principal } from "../auth/principal.ts";
import { PAGE_PATHS } from "../auth/roles.ts";
import { canChooseRole } from "../auth/wall.ts";
import { LINK_SESSION_PV, signSession } from "../auth/session.ts";
import { PHONE_LINK_INVALID_PATH, PHONE_LINK_PATH, type PhoneLinkPayload } from "./phone-link.ts";
import { resolvePhoneLink } from "./phone-link-store.ts";

/** 開く口の応答の見出し（どの応答にも付ける） */
export const PHONE_OPEN_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/** ログイン中の確かめの 1 枚（app/s/[token]/switch/page.tsx） */
export function phoneLinkSwitchPath(token: string): string {
  return `${PHONE_LINK_PATH}/${encodeURIComponent(token)}/switch`;
}

/** 切替の送り先（POST /s/<token>） */
export function phoneLinkOpenPath(token: string): string {
  return `${PHONE_LINK_PATH}/${encodeURIComponent(token)}`;
}

/**
 * リンクを開くと今のログインを失う人か。ケアマネ・行政・医療班のアカウントと、審査員・山本（どの役でも。役変更で戻れなくなるので。T95）。
 * 本人・家族のリンクのセッション（審査員でない self・family）とログインなしは false（そのまま開く）
 */
export function linkReplacesLogin(p: Principal | null): boolean {
  if (p === null) return false;
  if (canChooseRole(p)) return true;
  return p.role !== "self" && p.role !== "family";
}

function redirect(request: Request, path: string, setCookie?: string): Response {
  const headers = new Headers({ ...PHONE_OPEN_HEADERS, Location: new URL(path, request.url).toString() });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

/** リンクの中身でセッションを作り、cookie を付けて /me か /family へ */
async function enter(request: Request, secret: string, payload: PhoneLinkPayload, now: number): Promise<Response> {
  // セッションの iat は開いた時刻（リンクの iat が端末の時計の差で少し先でも、期限までの長さが 180 日を超えないように小さい方）
  const iat = Math.min(now, payload.iat);
  const session = await signSession(
    // li はリンクを作った時刻（resolvePhoneLink が D1 の phone_link_issued_at と同じかを確かめた値）。開くたびに D1 と比べる（T81）
    { v: 1, k: "link", p: payload.p, c: payload.c, g: payload.g, li: payload.iat, pv: LINK_SESSION_PV, iat, exp: payload.exp },
    secret,
  );
  const path = payload.c === null ? PAGE_PATHS.me : PAGE_PATHS.family;
  return redirect(request, path, sessionCookie(session, request.url, payload.exp - now));
}

/** /s/<token> の GET。current は今の cookie のログイン（無ければ null）。now は秒 */
export async function openPhoneLink(
  request: Request,
  db: D1Database,
  secret: string,
  token: string,
  now: number,
  current: Principal | null = null,
): Promise<Response> {
  const hit = await resolvePhoneLink(db, secret, token, now);
  if (!hit) return redirect(request, PHONE_LINK_INVALID_PATH);
  if (linkReplacesLogin(current)) return redirect(request, phoneLinkSwitchPath(token));
  return enter(request, secret, hit.payload, now);
}

/** /s/<token> の POST（ログイン中の 1 枚の「切替」）。同じ所からのフォームだけ。今のログインを本人・家族のセッションに替える */
export async function switchPhoneLink(request: Request, db: D1Database, secret: string, token: string, now: number): Promise<Response> {
  if (!isSameOrigin(request)) return new Response(null, { status: 403, headers: PHONE_OPEN_HEADERS });
  const hit = await resolvePhoneLink(db, secret, token, now);
  if (!hit) return redirect(request, PHONE_LINK_INVALID_PATH);
  return enter(request, secret, hit.payload, now);
}
