"use client";

// 受入一覧（/staff）の見出しの行の右: 書き出し（children の CSV出力、T62）と「パスワード変更」（T99）。
// 医療班・行政のアカウント（作者の道具 tools/office/new-staff.ts で作る。T97）は事業所の画面を開けないので、自分のパスワードはここから変える。
// 押すと見出しの行のすぐ下に欄が開く（白い面。欄は T61 の事業所のケアマネの自分の行と同じ部品 components/office/OwnPassword.tsx）。
// 開いている間はボタンに枠（選んだ印。下地は敷かない）。もう一度押す・取消で閉じる。
// 審査員のログインと種の固定のアカウント（役を替えた山本）は「パスワード変更 固定」の印だけ（サーバーも 403 fixed で断る）。
// 入口を出すかは lib/auth/password-change.ts の ownPasswordEntry（画面が principal から決めて渡す）。
// 親は見出しの行（flex-wrap）。欄と変更済の 1 行は basis-full でその行の下に折り返す。

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PasswordIcon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { OwnPasswordForm, PasswordDone } from "@/components/office/OwnPassword";

export function StaffPassword({
  entry,
  loginId,
  initialOpen = false,
  children,
}: {
  entry: "open" | "fixed" | null;
  loginId: string | null;
  /** 欄を開いて出す（ヘッダーの「初期パスワード」の「変更」から。T114）。入口が open のときだけ効く */
  initialOpen?: boolean;
  /** 左に並べる物（受入一覧では CSV出力） */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen && entry === "open");
  const [done, setDone] = useState(false);
  const id = useId();
  return (
    <>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 self-center">
        {children}
        {entry === "open" && (
          <Button
            icon={PasswordIcon}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => {
              setDone(false);
              setOpen((v) => !v);
            }}
            className={open ? "outline-2 -outline-offset-2 outline-accent" : ""}
          >
            {OFFICE_LABELS.changePassword}
          </Button>
        )}
        {entry === "fixed" && (
          <span className="text-xs text-muted" data-own-password="fixed">
            {OFFICE_LABELS.changePassword} {OFFICE_LABELS.fixed}
          </span>
        )}
      </div>
      {open && (
        <Panel as="div" pad="sm" id={id} className="basis-full" data-own-password="form">
          <OwnPasswordForm
            loginId={loginId}
            onPanel
            onCancel={() => setOpen(false)}
            onDone={() => {
              setOpen(false);
              setDone(true);
            }}
          />
        </Panel>
      )}
      {done && <PasswordDone className="basis-full" />}
    </>
  );
}
