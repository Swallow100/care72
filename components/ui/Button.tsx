// ボタンの部品。種類は 3 つと、その仲間:
//   main   主の操作（保存・分ける・印刷・追加）。操作の色の塗り
//   plain  それ以外（無色）。面の上では面の中の灰色、面の中の上では面の白
//   danger 出る・消す・外す（ログアウト・一覧から外す・平時に戻す）。赤の文字。確かめのあとの最後の 1 押しは dangerFill（赤の塗り）
//   quiet  文字だけ（閉じる・取消・戻る）。地も色も持たない
// 押したときは灰色だけ（data-press）。高さは大きさで揃える（sm 28px・md 32px・lg 40px）。角は 3px、ピル型にしない。
// アイコンは文字の左に並べる（アイコンだけのボタンにしない）。

import Link from "next/link";
import type { ComponentProps, ComponentType, SVGProps } from "react";
import { LinkPending } from "./LinkPending";

export type ButtonKind = "main" | "plain" | "plainIn" | "danger" | "dangerFill" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const KIND: Record<ButtonKind, string> = {
  main: "bg-accent text-on-accent disabled:bg-panel2 disabled:text-muted",
  plain: "bg-panel2 text-ink disabled:text-muted",
  plainIn: "bg-panel text-ink disabled:text-muted",
  danger: "bg-panel2 text-danger disabled:text-muted",
  dangerFill: "bg-danger text-on-accent disabled:bg-panel2 disabled:text-muted",
  quiet: "text-ink disabled:text-muted",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1 px-2 text-xs",
  md: "h-8 gap-1.5 px-3 text-sm",
  lg: "h-10 gap-2 px-4 text-[0.9375rem]",
};

const ICON: Record<ButtonSize, string> = { sm: "size-3.5", md: "size-4", lg: "size-[1.125rem]" };

/** 塗りのボタンは地を残して灰色を重ねる（overlay）。ほかは地を灰色に */
const pressOf = (kind: ButtonKind) => (kind === "main" || kind === "dangerFill" ? "overlay" : "");

/** ボタンの見た目の class。Link・button・label など、どの要素にも当てられる */
export function buttonClass(kind: ButtonKind = "plain", size: ButtonSize = "md", extra = ""): string {
  return `relative inline-flex shrink-0 items-center justify-center rounded font-bold whitespace-nowrap ${SIZE[size]} ${KIND[kind]} ${extra}`.trim();
}

function Inner({ icon: I, size, children }: { icon?: IconType; size: ButtonSize; children: React.ReactNode }) {
  return (
    <>
      {I && <I aria-hidden className={`${ICON[size]} shrink-0`} />}
      {children}
    </>
  );
}

type Common = { kind?: ButtonKind; size?: ButtonSize; icon?: IconType; className?: string };

export function Button({ kind = "plain", size = "md", icon, className = "", children, type = "button", ...rest }: Common & ComponentProps<"button">) {
  return (
    <button type={type} className={buttonClass(kind, size, className)} data-press={pressOf(kind)} {...rest}>
      <Inner icon={icon} size={size}>
        {children}
      </Inner>
    </button>
  );
}

/** 画面を移るボタン。押してから次の画面が出るまで灰色を残す */
export function ButtonLink({ kind = "plain", size = "md", icon, className = "", children, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass(kind, size, className)} data-press={pressOf(kind)} {...rest}>
      <Inner icon={icon} size={size}>
        {children}
      </Inner>
      <LinkPending />
    </Link>
  );
}
