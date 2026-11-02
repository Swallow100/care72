// Next から使う所。cookie（next/headers）と Cloudflare の env・D1 を読んで Principal を作る。
// テストはここを通らない（getCloudflareContext は OpenNext の外では動かない）。中身は principal.ts。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readCookie, SESSION_COOKIE } from "./cookie.ts";
import { resolvePrincipal, type Principal } from "./principal.ts";
import { canViewPage, homePath, type Page } from "./roles.ts";
import { nowSec, sessionSecret } from "./session.ts";

/** 1 つの要求の中では 1 回だけ読む（layout のヘッダーと page の両方が呼ぶ） */
export const getPrincipal = cache(async (): Promise<Principal> => {
  // cookies() を先に呼ぶ（build のときに静的な画面にしない）
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const { env } = await getCloudflareContext({ async: true });
  return resolvePrincipal(env.DB, env, sessionSecret(env), token, nowSec());
});

/** 役の入口。開けない役なら、その役の入口へ送る */
export async function requirePage(page: Page): Promise<Principal> {
  const p = await getPrincipal();
  if (!canViewPage(p.role, page)) redirect(homePath(p.role));
  return p;
}

/** route（API）から。cookie の見出しを読む */
export async function principalFromRequest(request: Request): Promise<{ principal: Principal; env: CloudflareEnv }> {
  const { env } = await getCloudflareContext({ async: true });
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return { principal: await resolvePrincipal(env.DB, env, sessionSecret(env), token, nowSec()), env };
}
