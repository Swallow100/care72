"use client";
// パスワードの欄。右の「表示」「隠す」で見える・見えないを切り替える（アイコンと文字。アイコンだけのボタンにしない）。
// JavaScript が無ければ隠したまま送れる（フォームの POST はそのまま）。

import { useState } from "react";
import { HideIcon, PasswordIcon, ShowIcon } from "@/components/ui/Icon";
import { FIELD, FIELD_ICON } from "./field";

export function PasswordField({ id }: { id: string }) {
  const [show, setShow] = useState(false);
  const Toggle = show ? HideIcon : ShowIcon;
  return (
    <div className="relative">
      <PasswordIcon aria-hidden className={FIELD_ICON} />
      <input
        id={id}
        name="password"
        type={show ? "text" : "password"}
        required
        autoComplete="current-password"
        maxLength={1024}
        className={`${FIELD} pr-[4.75rem]`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-pressed={show}
        className="absolute top-1/2 right-1.5 inline-flex h-9 -translate-y-1/2 items-center gap-1 rounded px-2 text-xs font-bold text-muted"
        data-press=""
      >
        <Toggle aria-hidden className="size-4" />
        {show ? "隠す" : "表示"}
      </button>
    </div>
  );
}
