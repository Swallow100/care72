// 画面を開けないときの送り先（T77、docs/progress/qa-20261104.md の高 3）。lib/auth/server.ts の requirePage と、
// 本人・家族の頁（app/me・app/family）が本人の行を読めなかったときに使う。D1・cookie・Next に触らない（テストは中身を渡す）。
//
// 本人・家族の頁（/me・/family）は、ID・パスワードのログイン欄に落とさない（本人・家族は ID を持たない。T69a）:
// - リンクのセッション（k が link）が通らない（最初に戻す・毎朝 4 時の戻しで版が 0 に戻った・再発行・期限切れ・一覧から外した）
//   → 「無効」の頁（/s/invalid。リンクを開き直して落ちたときと同じ 1 画面）
// - 審査員・役を替えた山本（T95）の本人・家族の役（p-01・c-01-1）のセッションが切れた（期限・パスワードの変更） → 同じ「無効」の頁
// - 審査員・山本のログインが生きていて、役がもう本人・家族でない（別のタブでケアマネの役に替えて最初に戻した など） → 役を選び直す頁
// - それ以外（cookie が無い・ケアマネなどのアカウントのセッション・読めない cookie）→ 今までどおりログイン欄
// ほかの画面（担当一覧・本人のページ・訓練・受け持ち）は今までどおり（ログインが無ければログイン欄、役が違えば役の入口）。

import { PHONE_LINK_INVALID_PATH } from "../qr/phone-link.ts";
import { resolvePrincipal, type AuthEnv, type Principal } from "./principal.ts";
import { canViewPage, homePath, LOGIN_PATH, ROLE_SELECT_PATH, type Page } from "./roles.ts";
import { decodeSession, type SessionPayload } from "./session.ts";
import { canChooseRole } from "./wall.ts";

/** 本人・家族のスマホの頁 */
export const PHONE_PAGES = ["me", "family"] as const satisfies readonly Page[];
export type PhonePage = (typeof PHONE_PAGES)[number];

export function isPhonePage(page: Page): page is PhonePage {
  return (PHONE_PAGES as readonly Page[]).includes(page);
}

/** 通らなかったセッションが本人・家族の物だったか（リンクか、審査員・役を替えた山本〔T95〕の本人・家族の役） */
function wasPhoneSession(lost: SessionPayload | null): boolean {
  if (!lost) return false;
  if (lost.k === "link") return true;
  // 本人・家族の ID（T149）が通らない（作り直し・再発行・パスワードの変更）は、ID を持っているのでログイン欄へ（false）
  if (lost.k === "phone") return false;
  return lost.r === "self" || lost.r === "family";
}

/**
 * 画面を開けないときの送り先。開けるなら null。
 * principal は今のログイン（通らなければ null）、lost は通らなかった cookie の中身（署名と形だけ確かめた物。lib/auth/session.ts の decodeSession）
 */
export function pageExit(page: Page, principal: Principal | null, lost: SessionPayload | null): string | null {
  if (principal) {
    if (canViewPage(principal.role, page)) return null;
    // 審査員・山本（T95）の役は cookie 1 つで全部のタブが同じ。本人スマホのタブは、ほかのタブで役を替えたら役を選び直す頁へ
    if (canChooseRole(principal) && isPhonePage(page)) return ROLE_SELECT_PATH;
    return homePath(principal.role);
  }
  if (isPhonePage(page) && wasPhoneSession(lost)) return PHONE_LINK_INVALID_PATH;
  return LOGIN_PATH;
}

/**
 * 本人・家族の頁でログインは通ったが、本人・連絡先の行が読めないとき（notFound の代わり）。
 * 審査員と役を替えた山本（T95）は役を選び直す頁、本人・家族のリンクは「無効」の頁
 */
export function phoneGoneExit(principal: Principal): string {
  return canChooseRole(principal) ? ROLE_SELECT_PATH : PHONE_LINK_INVALID_PATH;
}

/** cookie の文字列から送り先まで（テストと同じ道。server.ts は 1 要求 1 回の getPrincipal を使うので、組み立てだけここと同じ） */
export async function resolvePageExit(
  db: Parameters<typeof resolvePrincipal>[0],
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  now: number,
  page: Page,
): Promise<string | null> {
  const principal = await resolvePrincipal(db, env, secret, token, now);
  const lost = principal === null && isPhonePage(page) ? await decodeSession(token, secret) : null;
  return pageExit(page, principal, lost);
}
