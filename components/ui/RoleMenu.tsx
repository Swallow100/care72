"use client";

// ヘッダーの「役変更」（審査員だけ）。押すとその下に役の一覧が開き、選ぶとすぐ /api/auth/role に送って切り替わる。
// 別の画面に移らない（前は /login/role に移り、サーバーが役の一覧を読むまで何も変わらなかった）。外を押す・Esc で閉じる。
// 役の一覧はヘッダーが先に読んでおく。今の役は枠と太字（下地は敷かない）。
// 新規事業所の中の役（T180）は「新規事業所」の下に、地の色を 1 段変えた面で 1 行ずつ（左に ケアマネ・医療班・利用者の名前、右にボタン。
// 利用者ごとに 本人・娘 などを 1 行にまとめ、人が増えても一覧が長くなりすぎないように）。行の組み方は lib/auth/role-rows.ts

import { choiceGroups, type ChoiceBlock } from "@/lib/auth/role-rows";
import { Menu } from "./Menu";
import { RoleIcon } from "./Icon";
import { SubmitButton } from "./SubmitButton";

export type RoleChoice = { role: string; label: string; sub: string | null; row?: string; name?: string; note?: true };

/**
 * 画面の切替の右の医療班の入口（T173）。役を選べる人だけ。押すと役を医療班にして受入一覧へ（役変更の一覧の「医療班」と同じ送り先）。
 * 役変更に気付かず利用者追加へ入り、医療班に着くまで 9 手かかった（最短 2）。見える字は「医療班」、読み上げと title は「医療班 受入一覧」。
 * 本物のケアマネ（役を選べない）には出さない。画面を移すリンクと見分けるためアイコンつき。
 * value は役の値（新規事業所の中では新規事業所の医療班、T180。デモの医療班へ飛ぶと世界が混ざって見える）
 */
export function StaffEntry({ label, name, value = "medical" }: { label: string; name: string; value?: string }) {
  return (
    <form method="post" action="/api/auth/role" className="ml-2" data-staff-entry>
      <SubmitButton bare size="sm" icon="RoleIcon" name="role" value={value} aria-label={name} title={name} className="relative inline-flex h-8 items-center gap-1 rounded px-2 whitespace-nowrap text-muted">
        {label}
      </SubmitButton>
    </form>
  );
}

export function RoleMenu({ choices, current, label }: { choices: readonly RoleChoice[]; current: string; label: string }) {
  return (
    <Menu label={label} hint={choices.filter((c) => !c.row && !c.note).map((c) => c.label).join("・")} icon={RoleIcon} kind="plain">
      <form method="post" action="/api/auth/role" className="grid gap-px" aria-label={label}>
        {choiceGroups(choices).map((g, i) =>
          g.nested ? (
            <div key={i} className="ml-3 grid gap-px rounded bg-base py-1" data-sandbox-roles>
              {g.blocks.map((b, j) => (
                <NestedBlock key={j} block={b} current={current} />
              ))}
            </div>
          ) : (
            g.blocks.map((b, j) => b.kind === "one" && <OneItem key={`${i}-${j}`} item={b.item} current={current} />)
          ),
        )}
      </form>
    </Menu>
  );
}

function OneItem({ item: c, current }: { item: RoleChoice; current: string }) {
  const now = c.role === current;
  return (
    <SubmitButton
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
}

function NestedBlock({ block: b, current }: { block: ChoiceBlock<RoleChoice>; current: string }) {
  if (b.kind === "note") return <p className="px-3 py-1 text-xs text-muted">{b.label}</p>;
  if (b.kind === "one") return null;
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="w-20 shrink-0 truncate text-xs text-muted" title={b.label}>
        {b.label}
      </span>
      <div className="flex min-w-0 flex-wrap gap-1">
        {b.items.map((c) => {
          const now = c.role === current;
          return (
            <SubmitButton
              key={c.role}
              bare
              name="role"
              value={c.role}
              aria-current={now ? "true" : undefined}
              aria-label={c.name}
              title={c.name}
              className={`relative inline-flex min-h-8 items-center rounded bg-panel px-2 text-sm whitespace-nowrap dark:bg-panel2 ${
                now ? "font-bold outline-2 -outline-offset-2 outline-accent" : ""
              }`}
            >
              {c.label}
            </SubmitButton>
          );
        })}
      </div>
    </div>
  );
}
