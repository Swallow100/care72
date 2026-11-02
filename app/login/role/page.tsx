import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { judgeChoices } from "@/lib/auth/choices";
import { homePath } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";

export const metadata: Metadata = { title: "役選択 | ケア72" };

// 審査員がログインのあとに役を選ぶ。選び直しもここ（ヘッダーの「役変更」）。選んだ役は枠で示す
export default async function RoleSelectPage() {
  const p = await getPrincipal();
  if (!p.judge) redirect(homePath(p.role));
  const { env } = await getCloudflareContext({ async: true });
  const choices = await judgeChoices(env.DB);

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">役選択</h1>
      <form method="post" action="/api/auth/role" className="mt-5 grid gap-2">
        {choices.map((c) => {
          const current = p.role === c.role;
          return (
            <button
              key={c.role}
              type="submit"
              name="role"
              value={c.role}
              aria-current={current ? "true" : undefined}
              className={`flex items-baseline justify-between gap-4 rounded-lg bg-panel px-5 py-4 text-left ${
                current ? "outline-2 -outline-offset-2 outline-accent" : ""
              }`}
              data-press
            >
              <span className="text-lg font-bold">{c.label}</span>
              {c.sub && <span className="text-muted">{c.sub}</span>}
            </button>
          );
        })}
      </form>
    </main>
  );
}
