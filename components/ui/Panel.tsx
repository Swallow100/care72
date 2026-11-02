// 画面の枠の部品。地（base）・面（panel）・面の中（panel2）の 3 段の地の色で分け、枠線は引かない。面は透けない。
// 見出しは本文より大きく濃く: 画面の題 20px・区分の題 16px（どちらも太字の本文色）、欄の名前は 12px の薄い本文色。
// 余白だけの枠は作らない。面の中はページの流れに置き、区分ごとに内側で送らない（送るのは画面全体の縦 1 本）。

import { BackIcon } from "./Icon";
import { ButtonLink } from "./Button";

/** 画面の幅。text は読む画面（700〜1023px は 720px、1024px 以上は 880px の列）。wide は表の画面（担当一覧・様式 9 など） */
export type Width = "text" | "wide" | "full";

const WIDTH: Record<Width, string> = {
  text: "max-w-[720px] lg:max-w-[880px]",
  wide: "max-w-[90rem]",
  full: "",
};

/** 画面の外枠（main）。上の帯と同じ左右の余白 */
export function Page({ width = "wide", className = "", children, ...rest }: { width?: Width; className?: string; children: React.ReactNode } & React.ComponentProps<"main">) {
  return (
    <main className={`mx-auto w-full px-4 py-4 ${WIDTH[width]} ${className}`.trim()} {...rest}>
      {children}
    </main>
  );
}

/** 画面の題の段: 左上に戻る（あれば 1 つだけ）、題、数、右に操作 */
export function PageHead({
  title,
  count,
  back,
  sub,
  actions,
  id,
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  back?: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {back && <BackLink href={back} />}
      <h1 id={id} className="text-xl leading-8 font-bold">
        {title}
      </h1>
      {count !== undefined && <span className="text-sm text-muted">{count}</span>}
      {sub}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 戻る。画面の左上に 1 つだけ。アイコンと文字 */
export function BackLink({ href, label = "戻る" }: { href: string; label?: string }) {
  return (
    <ButtonLink href={href} kind="quiet" size="sm" icon={BackIcon} className="-ml-2" aria-label={label}>
      {label}
    </ButtonLink>
  );
}

/** 面（白）。区分の入れ物。tone は面の中（panel2）に置くとき */
export function Panel({
  as: Tag = "section",
  pad = "md",
  className = "",
  children,
  ...rest
}: { as?: "section" | "div" | "aside" | "form"; pad?: "none" | "sm" | "md"; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const p = pad === "none" ? "" : pad === "sm" ? "p-2" : "p-3";
  return (
    <Tag className={`rounded-lg bg-panel ${p} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

/** 区分の題の段: 題（16px 太字）・数・右に操作 */
export function PanelHead({
  title,
  count,
  id,
  as: H = "h2",
  sub,
  actions,
  className = "",
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  id?: string;
  as?: "h2" | "h3";
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 ${className}`.trim()}>
      <H id={id} className="text-[1rem] leading-6 font-bold">
        {title}
      </H>
      {count !== undefined && <span className="text-sm text-muted">{count}</span>}
      {sub}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** 欄の名前（12px の薄い本文色） */
export const LABEL = "text-xs text-muted";
