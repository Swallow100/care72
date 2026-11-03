import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mark72 } from "@/components/login/Mark72";
import { Page } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { judgeChoices } from "@/lib/auth/choices";
import { homePath, LOGIN_PATH } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";

export const metadata: Metadata = { title: "役選択 | ケア72" };

// 審査員がログインのあとに役を選ぶ。選び直しはふだんヘッダーの「役変更」（その場で開く一覧）で、ここはその一覧が使えないときの入口。
// 上はログインと同じ印（72 時間の輪）。選んだ役は枠で示す（下地は敷かない）。押してから移るまで灰色を残す
export default async function RoleSelectPage() {
  const p = await getPrincipal();
  if (!p) redirect(LOGIN_PATH);
  if (!p.judge) redirect(homePath(p.role));
  const { env } = await getCloudflareContext({ async: true });
  const choices = await judgeChoices(env.DB);

  return (
    <Page width="full" className="max-w-md py-8 sm:py-14">
      <div className="flex items-center gap-3">
        <Mark72 size={44} className="shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl leading-7 font-bold">役選択</h1>
          <p className="text-xs text-muted">どの立場で見るか。あとでヘッダーの「役変更」で変えられる</p>
        </div>
      </div>
      <form method="post" action="/api/auth/role" className="mt-4 grid gap-1">
        {choices.map((c) => {
          const current = p.role === c.role;
          return (
            <SubmitButton
              key={c.role}
              bare
              name="role"
              value={c.role}
              aria-current={current ? "true" : undefined}
              className={`relative flex min-h-14 items-baseline justify-between gap-4 rounded-lg bg-panel px-4 py-3.5 text-left ${
                current ? "outline-2 -outline-offset-2 outline-accent" : ""
              }`}
            >
              <span className="text-lg font-bold">{c.label}</span>
              {c.sub && <span className="text-muted">{c.sub}</span>}
            </SubmitButton>
          );
        })}
      </form>
    </Page>
  );
}
