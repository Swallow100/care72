import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { homePath } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";

export const metadata: Metadata = { title: "ログイン | ケア72" };

type Props = { searchParams: Promise<{ e?: string }> };

const INPUT =
  "mt-1 w-full rounded-md bg-panel2 px-3 py-3 outline-none focus-visible:outline-2 focus-visible:outline-accent";

// ID とパスワード。送り先は /api/auth/login（フォームの POST。JavaScript が無くても動く）
export default async function LoginPage({ searchParams }: Props) {
  const p = await getPrincipal();
  if (p.role !== "guest") redirect(homePath(p.role));
  const { e } = await searchParams;

  return (
    <main className="mx-auto max-w-sm px-4 py-10">
      <section aria-labelledby="login-title" className="rounded-lg bg-panel p-6">
        <h1 id="login-title" className="text-xl font-bold">
          ログイン
        </h1>
        <form method="post" action="/api/auth/login" className="mt-5 grid gap-4">
          <label className="block">
            <span className="text-sm text-muted">ID</span>
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
            <span className="text-sm text-muted">パスワード</span>
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
          <button
            type="submit"
            className="mt-1 rounded-md bg-accent px-4 py-3 font-bold text-on-accent"
            data-press="overlay"
          >
            ログイン
          </button>
        </form>
      </section>
      <Link href="/" className="mt-4 inline-block rounded px-2 py-1 text-sm text-muted" data-press>
        戻る
      </Link>
    </main>
  );
}
