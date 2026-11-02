"use client";

// フォームの送信のボタン。押してから次の画面が出るまで、押したときと同じ灰色を残し、二度押しを止める。
// HTML のフォーム（method="post"、サーバーが 303 で移す）でも React の action でも使える。
// 戻る（bfcache）で戻ったときと、15 秒たっても画面が移らないときは灰色を解く。
// 見た目は Button と同じ種類（主・無色・赤）。bare は見た目を呼ぶ側が全部持つとき（役選択の大きな行など）。

import { useEffect, useState, type ComponentProps, type ComponentType, type SVGProps } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonKind, type ButtonSize } from "./Button";
import * as Icons from "./Icon";

/** サーバーの画面からはアイコンを名前で渡す（関数はクライアントの部品に渡せない）。例 icon="LogoutIcon" */
export type IconName = keyof typeof Icons;

const ICON: Record<ButtonSize, string> = { sm: "size-3.5", md: "size-4", lg: "size-[1.125rem]" };

export function SubmitButton({
  kind = "plain",
  size = "md",
  icon,
  bare = false,
  className = "",
  children,
  onClick,
  ...rest
}: {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName | ComponentType<SVGProps<SVGSVGElement>>;
  bare?: boolean;
  className?: string;
} & Omit<ComponentProps<"button">, "type">) {
  const { pending: actionPending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  const pending = actionPending || clicked;

  useEffect(() => {
    if (!clicked) return;
    const t = window.setTimeout(() => setClicked(false), 15_000);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setClicked(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pageshow", onShow);
    };
  }, [clicked]);

  const I = typeof icon === "string" ? Icons[icon] : icon;
  const fill = kind === "main" || kind === "dangerFill";
  return (
    <button
      type="submit"
      className={bare ? className : buttonClass(kind, size, className)}
      data-press={fill && !bare ? "overlay" : ""}
      data-pending={pending ? "" : undefined}
      aria-busy={pending || undefined}
      onClick={(e) => {
        // 送信中のもう一押しは止める（disabled にすると押した値が送られないことがあるので使わない）
        if (pending) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (!e.defaultPrevented && e.currentTarget.form?.checkValidity() !== false) setClicked(true);
      }}
      {...rest}
    >
      {I && <I aria-hidden className={`${ICON[size]} shrink-0`} />}
      {children}
    </button>
  );
}
