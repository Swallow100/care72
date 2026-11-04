// Next から使う所。cookie（next/headers）と Cloudflare の env・D1 を読んで Principal を作る。
// テストはここを通らない（getCloudflareContext は OpenNext の外では動かない）。中身は principal.ts。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readCookie, SESSION_COOKIE } from "./cookie.ts";
import { isPhonePage, pageExit } from "./phone-gate.ts";
import { resolvePrincipal, type Principal } from "./principal.ts";
import { LOGIN_PATH, type Page } from "./roles.ts";
import { decodeSession, nowSec, sessionSecret, type SessionPayload } from "./session.ts";

/** 1 つの要求の中では 1 回だけ読む（layout のヘッダーと page の両方が呼ぶ）。ログインしていなければ null */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  // cookies() を先に呼ぶ（build のときに静的な画面にしない）
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const { env } = await getCloudflareContext({ async: true });
  return resolvePrincipal(env.DB, env, sessionSecret(env), token, nowSec());
});

/**
 * 役の入口。ログインしていなければ /login へ、開けない役なら、その役の入口へ送る。
 * 本人・家族の頁（/me・/family）だけは、通らなくなったリンクのセッションを「無効」の頁へ、審査員の役が替わっていたら役選択へ
 * （ID・パスワードのログイン欄に落とさない。T77。送り先の決め方は lib/auth/phone-gate.ts）
 */
export async function requirePage(page: Page): Promise<Principal> {
  const p = await getPrincipal();
  let lost: SessionPayload | null = null;
  if (!p && isPhonePage(page)) {
    // 通らなかった cookie が本人・家族の物だったかを見るだけ（署名と形。入れる判断には使わない）
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
    const { env } = await getCloudflareContext({ async: true });
    lost = await decodeSession(token, sessionSecret(env));
  }
  const exit = pageExit(page, p, lost);
  if (exit !== null || !p) redirect(exit ?? LOGIN_PATH);
  return p;
}

/** route（API）から。cookie の見出しを読む。ログインしていなければ principal は null（denied が 401 を返す） */
export async function principalFromRequest(request: Request): Promise<{ principal: Principal | null; env: CloudflareEnv }> {
  const { env } = await getCloudflareContext({ async: true });
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return { principal: await resolvePrincipal(env.DB, env, sessionSecret(env), token, nowSec()), env };
}
