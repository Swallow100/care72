import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, Panel } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { homePath } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";

export const metadata: Metadata = { title: "ログイン | ケア72" };

type Props = { searchParams: Promise<{ e?: string }> };

const INPUT =
  "mt-1 h-10 w-full rounded bg-panel2 px-3 outline-none focus-visible:outline-2 focus-visible:outline-accent";

// ID とパスワード。送り先は /api/auth/login（フォームの POST。JavaScript が無くても動く）。
// どの画面もログインが要る。ログインしていなければ、どの画面からもここへ来る。審査員の ID とパスワードは提出書類に。
// 狭い 1 列（入れる欄が 2 つだけなので、読む画面の列よりさらに狭く）
export default async function LoginPage({ searchParams }: Props) {
  const p = await getPrincipal();
  if (p) redirect(homePath(p.role));
  const { e } = await searchParams;

  return (
    <Page width="full" className="max-w-sm py-10">
      <Panel aria-labelledby="login-title" className="p-5">
        <h1 id="login-title" className="text-xl leading-8 font-bold">
          ログイン
        </h1>
        <form method="post" action="/api/auth/login" className="mt-4 grid gap-4">
          <label className="block">
            <span className="text-xs text-muted">ID</span>
            <input
              name="id"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={128}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">パスワード</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              maxLength={1024}
              className={INPUT}
            />
          </label>
          {e && (
            <p role="alert" className="text-sm font-bold text-danger">
              認証失敗
            </p>
          )}
          <SubmitButton kind="main" size="lg" className="mt-1 w-full">
            ログイン
          </SubmitButton>
        </form>
      </Panel>
    </Page>
  );
}
