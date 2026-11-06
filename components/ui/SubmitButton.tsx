"use client";

// フォームの送信のボタン。押してから次の画面が出るまで、押したときと同じ灰色を残し、二度押しを止める。
// HTML のフォーム（method="post"、サーバーが 303 で移す）でも React の action でも使える。
// 戻る（bfcache）で戻ったときと、15 秒たっても画面が移らないときは灰色を解く。
// 見た目は Button と同じ種類（主・無色・赤）。bare は見た目を呼ぶ側が全部持つとき（役選択の大きな行など）。
// confirm を渡すと、送る前にアプリ内の確認の窓（lib/ui/dialog.ts）を出し、決めたときだけ送る（T44）。
// 決めたときだけ confirm.fields を隠しの欄で足して送る（confirm=1 など）。窓が出せない（JS が動く前）と fields 無しで送られ、
// サーバーが確認の欄（URL の confirm）へ戻すので、確かめずに消えることは無い。

import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type SVGProps } from "react";
import { flushSync, useFormStatus } from "react-dom";
import { appConfirm } from "@/lib/ui/dialog";
import { buttonClass, type ButtonKind, type ButtonSize } from "./Button";
import * as Icons from "./Icon";
import type { DialogIconName } from "./Icon";

/** サーバーの画面からはアイコンを名前で渡す（関数はクライアントの部品に渡せない）。例 icon="LogoutIcon" */
export type IconName = keyof typeof Icons;

/** 送る前の確認。文字だけなのでサーバーの画面から渡せる */
export type SubmitConfirm = {
  /** 窓の本文 */
  message: string;
  /** 窓の題 */
  title?: string;
  /** 決める方のボタンの言葉（2〜4 字） */
  ok?: string;
  /** やめる方のボタンの言葉（2〜4 字。既定は取消。T166） */
  cancel?: string;
  /** 消す・外す・戻す操作（赤の塗り、最初の焦点は取消） */
  danger?: boolean;
  /** 決める方のボタンのアイコン（消す RemoveIcon・外す UnlistIcon・戻す RestoreIcon、無ければ消す操作は RemoveIcon・ほかは SaveIcon） */
  icon?: DialogIconName;
  /** 本文の下の小さな箇条書き（消す項目を 1 行ずつなど） */
  details?: string[];
  /** 決めたときだけ足して送る欄（例 { confirm: "1" }） */
  fields?: Record<string, string>;
};

const ICON: Record<ButtonSize, string> = { sm: "size-3.5", md: "size-4", lg: "size-[1.125rem]" };

export function SubmitButton({
  kind = "plain",
  size = "md",
  icon,
  bare = false,
  confirm,
  className = "",
  children,
  onClick,
  ...rest
}: {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName | ComponentType<SVGProps<SVGSVGElement>>;
  bare?: boolean;
  confirm?: SubmitConfirm;
  className?: string;
} & Omit<ComponentProps<"button">, "type">) {
  const { pending: actionPending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  /** 確認で決めたあと、足す欄を描いている間 */
  const [armed, setArmed] = useState(false);
  const self = useRef<HTMLButtonElement>(null);
  const pending = actionPending || clicked;

  useEffect(() => {
    if (!clicked) return;
    const t = window.setTimeout(() => {
      setClicked(false);
      setArmed(false);
    }, 15_000);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setClicked(false);
        setArmed(false);
      }
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
    <>
      <button
        ref={self}
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
          if (e.defaultPrevented) return;
          const form = e.currentTarget.form;
          if (form?.checkValidity() === false) return;
          if (confirm && form) {
            // 確認の窓で決めてから、足す欄を描いて同じボタンで送る（requestSubmit は click を起こさないので、ここへは戻らない）
            e.preventDefault();
            void appConfirm(confirm.message, { title: confirm.title, ok: confirm.ok, cancel: confirm.cancel, danger: confirm.danger, icon: confirm.icon, details: confirm.details }).then((ok) => {
              if (!ok || !form.isConnected) return;
              flushSync(() => {
                setArmed(true);
                setClicked(true);
              });
              form.requestSubmit(self.current ?? undefined);
            });
            return;
          }
          setClicked(true);
        }}
        {...rest}
      >
        {I && <I aria-hidden className={`${ICON[size]} shrink-0`} />}
        {children}
      </button>
      {armed && confirm?.fields && Object.entries(confirm.fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    </>
  );
}
