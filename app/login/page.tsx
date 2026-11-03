import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FIELD, FIELD_ICON } from "@/components/login/field";
import { BrandMark } from "@/components/brand/BrandMark";
import { PasswordField } from "@/components/login/PasswordField";
import { IdIcon } from "@/components/ui/Icon";
import { LABEL, Page, Panel } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { waitMinutes } from "@/lib/auth/lockout";
import { homePath } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";

export const metadata: Metadata = { title: "ログイン | ケア72" };

type Props = { searchParams: Promise<{ e?: string; m?: string }> };

/** 断りの文。値は /api/auth/login が付ける（1: ID かパスワードが違う。どちらが違うかは言わない）。知らない値は短い 1 文 */
const ERRORS: Record<string, string> = { "1": "ID かパスワードが違う", locked: "回数超過 しばらく待機" };

/** 回数の制限で止めたとき（/login?e=locked&m=<残りの分>。lib/auth/lockout.ts）は「回数超過 待機 N 分」 */
function errorText(e: string, m: string | undefined): string {
  const minutes = e === "locked" ? waitMinutes(m) : null;
  if (minutes !== null) return `回数超過 待機 ${minutes} 分`;
  return ERRORS[e] ?? "ログインできない";
}

// ID とパスワード。送り先は /api/auth/login（フォームの POST。JavaScript が無くても動く）。
// どの画面もログインが要る。ログインしていなければ、どの画面からもここへ来る。審査員の ID とパスワードは提出書類の欄にだけ書く（画面に案内を出さない）。
// 上は名前と見出し「ログイン」、右に印（components/brand/BrandMark）。道具の説明の見出しは置かない（T66、作者 11/4）。
// 新規登録は作らない（DECISIONS 11/4 00:5x）。欄は大きく（48px）、中にアイコン。狭い 1 列。
export default async function LoginPage({ searchParams }: Props) {
  const p = await getPrincipal();
  if (p) redirect(homePath(p.role));
  const { e, m } = await searchParams;
  const error = e ? errorText(e, m) : null;

  return (
    <Page width="full" className="max-w-[26rem] py-8 sm:py-14">
      <Panel aria-labelledby="login-title" className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-muted">ケア72</p>
            <h1 id="login-title" className="mt-1 text-lg leading-7 font-bold sm:text-xl">
              ログイン
            </h1>
          </div>
          <BrandMark size={56} className="shrink-0" />
        </div>
        <form method="post" action="/api/auth/login" className="mt-6 grid gap-4">
          <div>
            <label htmlFor="login-id" className={`${LABEL} font-bold`}>
              ID
            </label>
            <div className="relative mt-1">
              <IdIcon aria-hidden className={FIELD_ICON} />
              <input
                id="login-id"
                name="id"
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={128}
                className={FIELD}
              />
            </div>
          </div>
          <div>
            <label htmlFor="login-password" className={`${LABEL} font-bold`}>
              パスワード
            </label>
            <div className="mt-1">
              <PasswordField id="login-password" />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm font-bold text-danger">
              {error}
            </p>
          )}
          <SubmitButton kind="main" size="lg" icon="LoginIcon" className="mt-1 h-12 w-full text-[1rem]">
            ログイン
          </SubmitButton>
        </form>
      </Panel>
      <p className="mt-3 text-center text-xs text-muted">デモの利用者はすべて架空です</p>
    </Page>
  );
}
