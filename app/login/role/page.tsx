import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { Page } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { currentChoice, roleChoicesFor } from "@/lib/auth/choices";
import { choiceGroups } from "@/lib/auth/role-rows";
import { homePath, LOGIN_PATH, SANDBOX_CHOICE, SANDBOX_LABELS } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";
import { canChooseRole } from "@/lib/auth/wall";

export const metadata: Metadata = { title: "役選択 | ケア72" };

// 審査員がログインのあとに役を選ぶ。選び直しはふだんヘッダーの「役変更」（その場で開く一覧）で、ここはその一覧が使えないときの入口。
// 見本のケアマネ（山本）も同じ一覧で選び直せる（T95）。ほかの人は自分の役の入口へ。
// 審査員には 4 つの役の下に「新規事業所」（T115。そのセッションだけの空の事業所の管理者）。作れる数の上限なら ?sandbox=limit で戻り、その項目に「上限到達」。
// 上はログインと同じ印（72 時間の輪）。選んだ役は枠で示す（下地は敷かない）。押してから移るまで灰色を残す
export default async function RoleSelectPage({ searchParams }: { searchParams: Promise<{ sandbox?: string | string[] }> }) {
  const p = await getPrincipal();
  if (!p) redirect(LOGIN_PATH);
  if (!canChooseRole(p)) redirect(homePath(p.role));
  const { env } = await getCloudflareContext({ async: true });
  const choices = await roleChoicesFor(env.DB, p);
  const limit = (await searchParams).sandbox === "limit";
  const now = currentChoice(p);

  return (
    <Page width="full" className="max-w-md py-8 sm:py-14">
      <div className="flex items-center gap-3">
        <BrandMark size={44} className="shrink-0" />
        {/* 選び直しの案内の 1 行は外した（T184。この画面のヘッダーには役変更が無く、画面に無い物を指していた） */}
        <h1 className="min-w-0 text-xl leading-7 font-bold">役選択</h1>
      </div>
      <form method="post" action="/api/auth/role" className="mt-4 grid gap-1">
        {choiceGroups(choices).map((g, i) =>
          g.nested ? (
            // 新規事業所の中の役（T180）。左に ケアマネ・医療班・利用者の名前、右にボタン（利用者ごとに 本人・娘 などを 1 行に）
            <div key={i} className="ml-4 grid gap-1 py-1" data-sandbox-roles>
              {g.blocks.map((b, j) =>
                b.kind === "note" ? (
                  <p key={j} className="px-1 text-sm text-muted">
                    {b.label}
                  </p>
                ) : b.kind === "row" ? (
                  <div key={j} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm break-words text-muted">
                      {b.label}
                    </span>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {b.items.map((c) => (
                        <SubmitButton
                          key={c.role}
                          bare
                          name="role"
                          value={c.role}
                          aria-current={now === c.role ? "true" : undefined}
                          aria-label={c.name}
                          title={c.name}
                          className={`relative inline-flex min-h-10 items-center rounded-lg bg-panel px-3 text-left font-bold ${
                            now === c.role ? "outline-2 -outline-offset-2 outline-accent" : ""
                          }`}
                        >
                          {c.label}
                        </SubmitButton>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            g.blocks.map((b) => {
              if (b.kind !== "one") return null;
              const c = b.item;
              const current = now === c.role;
              const full = limit && c.role === SANDBOX_CHOICE;
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
                  {full ? (
                    <span role="alert" className="font-bold text-danger">
                      {SANDBOX_LABELS.limit}
                    </span>
                  ) : (
                    c.sub && <span className="text-muted">{c.sub}</span>
                  )}
                </SubmitButton>
              );
            })
          ),
        )}
      </form>
    </Page>
  );
}
