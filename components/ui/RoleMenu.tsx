"use client";

// ヘッダーの「役変更」（審査員だけ）。押すとその下に役の一覧が開き、選ぶとすぐ /api/auth/role に送って切り替わる。
// 別の画面に移らない（前は /login/role に移り、サーバーが役の一覧を読むまで何も変わらなかった）。外を押す・Esc で閉じる。
// 役の一覧はヘッダーが先に読んでおく。今の役は枠と太字（下地は敷かない）。

import { Menu } from "./Menu";
import { RoleIcon } from "./Icon";
import { SubmitButton } from "./SubmitButton";

export type RoleChoice = { role: string; label: string; sub: string | null };

export function RoleMenu({ choices, current, label }: { choices: readonly RoleChoice[]; current: string; label: string }) {
  return (
    <Menu label={label} hint={choices.map((c) => c.label).join("・")} icon={RoleIcon} kind="plain">
      <form method="post" action="/api/auth/role" className="grid gap-px" aria-label={label}>
        {choices.map((c) => {
          const now = c.role === current;
          return (
            <SubmitButton
              key={c.role}
              bare
              name="role"
              value={c.role}
              aria-current={now ? "true" : undefined}
              className={`relative flex min-h-10 w-full items-baseline justify-between gap-4 rounded px-3 py-2 text-left text-sm ${
                now ? "font-bold outline-2 -outline-offset-2 outline-accent" : ""
              }`}
            >
              <span className="font-bold">{c.label}</span>
              {c.sub && <span className="text-muted">{c.sub}</span>}
            </SubmitButton>
          );
        })}
      </form>
    </Menu>
  );
}
