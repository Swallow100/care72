// セッションの cookie と、フォームの POST の返し方。
// cookie は HttpOnly・SameSite=Lax・Path=/・7 日。Secure は https のときだけ付ける（手元の http://localhost では外す）。

import { SESSION_TTL_SEC } from "./session.ts";

export const SESSION_COOKIE = "care72_session";

function isHttps(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === "https:";
}

function attrs(requestUrl: string, maxAge: number): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isHttps(requestUrl)) parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie の値 */
export function sessionCookie(token: string, requestUrl: string): string {
  return `${SESSION_COOKIE}=${token}; ${attrs(requestUrl, SESSION_TTL_SEC)}`;
}

export function clearSessionCookie(requestUrl: string): string {
  return `${SESSION_COOKIE}=; ${attrs(requestUrl, 0)}`;
}

/** Cookie の見出しから 1 つ読む */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** フォームの POST のあとに別の画面へ送る（303） */
export function seeOther(request: Request, path: string, setCookie?: string): Response {
  const headers = new Headers({ Location: new URL(path, request.url).toString(), "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

/**
 * 同じ所から来た POST か。Sec-Fetch-Site があればそれを、無ければ Origin を見る。どちらも無い（curl など）は通す。
 * SameSite=Lax と合わせて、別のサイトのフォームからログイン・ログアウトさせない。
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return origin === new URL(request.url).origin;
}
