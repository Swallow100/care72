"use client";

// ケアマネの一覧の 1 行（docs/tasks/T61.md）。名前・管理者の印・停止の印・ID・担当の人数と、行の下の操作。
// - 管理者には「改名」「管理者」/「管理者解除」「停止」/「再開」「再設定」（停止・管理者解除・自動発行は確認の窓を通す）。
//   改名・再設定は行の下に欄が開く。再設定（T148）は管理者が決めたパスワード（新規・確認、決まりは lib/auth/password-rule.ts）か
//   「自動発行」（前からの再発行）。自動発行した初期パスワードはこの画面の状態にだけ持って 1 回だけ出す（URL・保存・ログに残さない）。
//   決めたパスワードは送るだけで、応答にも画面にも出さない（「再発行済 パスワード 設定済」）
// - 自分の行には「パスワード変更」（管理者でなくても）。欄は components/office/OwnPassword.tsx（医療班・行政の受入一覧と同じ部品。T99）。
//   現在・新規・確認の 3 つの欄。変えたあともこの端末はログインしたまま、ほかの端末は入り直し（「他端末 再ログイン」）
// - 種のデモ事業所のアカウント（山本）は「固定」の 1 語でボタンを出さない（サーバーも断る）
// 送ったあとは一覧を読み直す（router.refresh。この部品の状態は残る）。

import { useRouter } from "next/navigation";
import { useState, type ComponentProps, type ComponentType, type SVGProps } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import {
  AddIcon,
  AssignIcon,
  CloseIcon,
  CopyIcon,
  EditIcon,
  PasswordIcon,
  RemoveIcon,
  RestoreIcon,
  RetryIcon,
  UnlistIcon,
} from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import { isFixedAccount } from "@/lib/auth/demo";
import { DISPLAY_NAME_MAX } from "@/lib/office/forms";
import { ASSIGN_ANCHOR, careManagerApiPath } from "@/lib/office/http-paths";
import { OFFICE_LABELS, STAFF_CONFIRM_LABELS } from "@/lib/office/labels";
import { appConfirm } from "@/lib/ui/dialog";
import { INPUT } from "./field";
import { FormButtons, OwnPasswordForm, PasswordDone, PasswordField, PasswordRule, passwordInputError, post, type Reply } from "./OwnPassword";

/** 新しいパスワードの長さ（欄の部品 OwnPassword.tsx の物。T61 のテストはここから読む） */
export { PASSWORD_INPUT } from "./OwnPassword";

export type CareManagerRowItem = {
  id: string;
  name: string;
  loginId: string | null;
  admin: boolean;
  people: number;
  disabled: boolean;
};

type Mode = "rename" | "password" | "reset" | null;

/**
 * ownPassword は自分の行のパスワード変更を出すか（既定は出す）。審査員の試用事業所（T115）の管理者はパスワードを持たない
 * （入れるのは審査員のセッションだけで、サーバーも fixed で断る）ので出さない。
 * openPassword は自分の行の変更の欄を開いて出す（ヘッダーの「初期パスワード」の「変更」から。T114）。変更を出す行だけ効く
 */
export function CareManagerRow({
  item,
  self,
  manage,
  ownPassword = true,
  openPassword = false,
}: {
  item: CareManagerRowItem;
  self: boolean;
  manage: boolean;
  ownPassword?: boolean;
  openPassword?: boolean;
}) {
  const router = useRouter();
  const fixed = isFixedAccount(item.id);
  // 変更の欄を開いて出せる行（自分・固定でない・パスワードを持つ）
  const opensPassword = self && !fixed && ownPassword;
  const [mode, setMode] = useState<Mode>(openPassword && opensPassword ? "password" : null);
  // 同じ事業所の画面でヘッダーの「変更」を押したとき（部品は残り、印だけが付く）も欄を開く
  const [openedFor, setOpenedFor] = useState(openPassword);
  if (openPassword !== openedFor) {
    setOpenedFor(openPassword);
    if (openPassword && opensPassword) setMode("password");
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ label: string; hasPeople: boolean } | null>(null);
  const [reissued, setReissued] = useState<string | null>(null);
  // 決めたパスワードで再設定した（パスワードは出さない）
  const [resetSet, setResetSet] = useState(false);
  const [resetPw, setResetPw] = useState({ next: "", confirm: "" });
  const [copied, setCopied] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);
  const [name, setName] = useState(item.name);

  // 管理者の操作は自分の行には出さない（自分の停止・管理者解除・再発行はサーバーも断る）。改名は自分にも
  const canManage = manage && !fixed;
  const others = canManage && !self;
  const canPassword = self && !fixed && ownPassword;

  function open(next: Mode) {
    setError(null);
    setPasswordDone(false);
    setResetSet(false);
    setResetPw({ next: "", confirm: "" });
    setMode(next);
    if (next === "rename") setName(item.name);
  }

  async function act(body: Record<string, unknown>): Promise<Reply> {
    setBusy(true);
    setError(null);
    const r = await post(careManagerApiPath(item.id), body);
    if (r.ok) router.refresh();
    else setError({ label: r.label ?? "送信失敗", hasPeople: r.error === "has_people" });
    setBusy(false);
    return r;
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const r = await act({ action: "rename", displayName: name });
    if (r.ok) setMode(null);
  }

  async function toggleAdmin() {
    if (item.admin) {
      const ok = await appConfirm(item.name, {
        title: STAFF_CONFIRM_LABELS.removeAdminTitle,
        ok: STAFF_CONFIRM_LABELS.removeAdminOk,
        danger: true,
        icon: "RemoveIcon",
      });
      if (!ok) return;
    }
    await act({ action: "admin", admin: !item.admin });
  }

  async function toggleDisabled() {
    if (!item.disabled) {
      const ok = await appConfirm(item.name, {
        title: STAFF_CONFIRM_LABELS.disableTitle,
        ok: STAFF_CONFIRM_LABELS.disableOk,
        danger: true,
        icon: "UnlistIcon",
      });
      if (!ok) return;
    }
    await act({ action: "disable", disabled: !item.disabled });
  }

  async function reissue() {
    const ok = await appConfirm(item.name, { title: STAFF_CONFIRM_LABELS.resetTitle, ok: STAFF_CONFIRM_LABELS.resetOk, danger: true });
    if (!ok) return;
    setReissued(null);
    setCopied(false);
    const r = await act({ action: "reset_password" });
    if (r.ok && typeof r.password === "string") {
      setReissued(r.password);
      setMode(null);
    }
  }

  /** 管理者が決めたパスワードで再設定（T148）。決まりと確認を送る前に見る（サーバーも同じ決まりで断る） */
  async function resetTo(e: React.FormEvent) {
    e.preventDefault();
    const bad = passwordInputError(resetPw.next, resetPw.confirm);
    if (bad) {
      setError({ label: bad, hasPeople: false });
      return;
    }
    setReissued(null);
    const r = await act({ action: "reset_password", password: resetPw.next });
    if (r.ok) {
      setResetPw({ next: "", confirm: "" });
      setResetSet(true);
      setMode(null);
    }
  }

  async function copy() {
    if (!reissued) return;
    try {
      await navigator.clipboard.writeText(reissued);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const hasActions = canManage || canPassword;
  return (
    <li className="rounded bg-panel2 px-2 py-1.5" data-cm-row={item.id} data-disabled={item.disabled ? "" : undefined}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-bold ${item.disabled ? "text-muted" : ""}`}>{item.name}</span>
        {item.admin && <span className="text-xs text-muted">{OFFICE_LABELS.admin}</span>}
        {item.disabled && (
          <StateText tone="unknown" className="text-xs">
            {OFFICE_LABELS.disabled}
          </StateText>
        )}
        {fixed && <span className="text-xs text-muted">{OFFICE_LABELS.fixed}</span>}
        {item.loginId && (
          <span className={`text-xs text-muted ${item.disabled ? "opacity-70" : ""}`}>
            {OFFICE_LABELS.loginId} {item.loginId}
          </span>
        )}
        <span className={`ml-auto ${item.disabled ? "text-muted" : ""}`}>
          {item.people}
          <span className="text-xs text-muted"> {OFFICE_LABELS.people}</span>
        </span>
      </div>

      {hasActions && mode === null && (
        <div className="mt-1 flex flex-wrap items-center justify-end gap-1" data-cm-actions>
          {canManage && (
            <Button kind="plainIn" size="sm" icon={EditIcon} disabled={busy} onClick={() => open("rename")}>
              {OFFICE_LABELS.rename}
            </Button>
          )}
          {others && (
            <>
              {item.admin ? (
                <DangerIn icon={RemoveIcon} disabled={busy} onClick={() => void toggleAdmin()}>
                  {OFFICE_LABELS.removeAdmin}
                </DangerIn>
              ) : (
                <Button kind="plainIn" size="sm" icon={AddIcon} disabled={busy} onClick={() => void toggleAdmin()}>
                  {OFFICE_LABELS.makeAdmin}
                </Button>
              )}
              {item.disabled ? (
                <Button kind="plainIn" size="sm" icon={RestoreIcon} disabled={busy} onClick={() => void toggleDisabled()}>
                  {OFFICE_LABELS.enable}
                </Button>
              ) : (
                <DangerIn icon={UnlistIcon} disabled={busy} onClick={() => void toggleDisabled()}>
                  {OFFICE_LABELS.disable}
                </DangerIn>
              )}
              <DangerIn icon={RetryIcon} disabled={busy} onClick={() => open("reset")}>
                {OFFICE_LABELS.resetOpen}
              </DangerIn>
            </>
          )}
          {canPassword && (
            <Button kind="plainIn" size="sm" icon={PasswordIcon} disabled={busy} onClick={() => open("password")}>
              {OFFICE_LABELS.changePassword}
            </Button>
          )}
        </div>
      )}

      {error && mode === null && (
        <div role="alert" className="mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm">
          <span className="font-bold text-danger">{error.label}</span>
          {/* 担当がいる人は止められない。担当の表（一括変更、T60）へ */}
          {error.hasPeople && (
            <ButtonLink href={`#${ASSIGN_ANCHOR}`} kind="plainIn" size="sm" icon={AssignIcon}>
              {OFFICE_LABELS.assignMany}
            </ButtonLink>
          )}
        </div>
      )}

      {mode === "rename" && (
        <form onSubmit={rename} aria-label={`${item.name} ${OFFICE_LABELS.rename}`} className="mt-1.5 grid gap-1.5" data-cm-form="rename">
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">{OFFICE_LABELS.displayName}</span>
            <input
              type="text"
              required
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="off"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
          </label>
          <FormButtons busy={busy} ok={OFFICE_LABELS.save} onCancel={() => setMode(null)} error={error?.label ?? null} />
        </form>
      )}

      {mode === "password" && (
        <OwnPasswordForm
          loginId={item.loginId}
          onCancel={() => setMode(null)}
          onDone={() => {
            setMode(null);
            setPasswordDone(true);
          }}
          className="mt-1.5"
          data-cm-form="password"
        />
      )}

      {mode === "reset" && (
        <form onSubmit={resetTo} aria-label={`${item.name} ${OFFICE_LABELS.resetOpen}`} className="mt-1.5 grid gap-1.5" data-cm-form="reset">
          <div className="grid grid-cols-2 gap-1.5">
            <PasswordField
              label={OFFICE_LABELS.nextPassword}
              auto="new-password"
              input={INPUT}
              min
              focus
              value={resetPw.next}
              onChange={(v) => setResetPw({ ...resetPw, next: v })}
            />
            <PasswordField
              label={OFFICE_LABELS.confirmPassword}
              auto="new-password"
              input={INPUT}
              min
              value={resetPw.confirm}
              onChange={(v) => setResetPw({ ...resetPw, confirm: v })}
            />
          </div>
          <PasswordRule />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="submit" kind="main" size="sm" icon={PasswordIcon} disabled={busy} data-pending={busy ? "" : undefined}>
              {busy ? OFFICE_LABELS.sending : OFFICE_LABELS.setPassword}
            </Button>
            {/* 決めずにサーバーが作る（前からの再発行。確認の窓を通し、1 回だけ出す） */}
            <DangerIn icon={RetryIcon} disabled={busy} onClick={() => void reissue()} data-cm-auto>
              {OFFICE_LABELS.autoPassword}
            </DangerIn>
            <Button kind="quiet" size="sm" icon={CloseIcon} onClick={() => setMode(null)} disabled={busy}>
              {OFFICE_LABELS.cancel}
            </Button>
            {error && (
              <span role="alert" className="text-sm font-bold text-danger">
                {error.label}
              </span>
            )}
          </div>
        </form>
      )}

      {resetSet && (
        <p role="status" className="mt-1 flex flex-wrap items-baseline justify-end gap-x-2 text-sm" data-cm-reset-set>
          <StateText tone="ok">{OFFICE_LABELS.reissued}</StateText>
          <span className="text-muted">{OFFICE_LABELS.password}</span>
          <span className="font-bold">{OFFICE_LABELS.passwordSet}</span>
        </p>
      )}

      {passwordDone && <PasswordDone className="mt-1" />}

      {reissued && (
        <div role="status" className="mt-1.5 rounded bg-panel px-2.5 py-2 text-sm" data-cm-reissued>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <StateText tone="ok">{OFFICE_LABELS.reissued}</StateText>
            {item.loginId && (
              <span className="text-muted">
                {OFFICE_LABELS.loginId} {item.loginId}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted">{OFFICE_LABELS.newPassword}</span>
            <span className="text-lg font-bold select-all">{reissued}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StateText tone="check" className="text-xs">
              {OFFICE_LABELS.shownOnce}
            </StateText>
            <Button kind="plain" size="sm" icon={CopyIcon} onClick={() => void copy()} className="ml-auto">
              {copied ? OFFICE_LABELS.copied : OFFICE_LABELS.copy}
            </Button>
            <Button kind="quiet" size="sm" icon={CloseIcon} onClick={() => setReissued(null)}>
              {OFFICE_LABELS.close}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * 灰色の行の上の赤の操作（停止・管理者解除・再発行）。Button の danger は地が面の中の灰色で行と同じになり、白い地のボタン
 * （改名・管理者・再開）と形がそろわないので、白い地（plainIn）に赤の文字と印で描く（components/ui は変えない）。押したときは灰色だけ
 */
function DangerIn({ icon: I, children, className = "", ...rest }: { icon: IconType; children: React.ReactNode } & Omit<ComponentProps<"button">, "children">) {
  return (
    <Button kind="plainIn" size="sm" className={`group ${className}`.trim()} data-danger="" {...rest}>
      <I aria-hidden className="size-3.5 shrink-0 text-danger group-disabled:text-muted" />
      <span className="text-danger group-disabled:text-muted">{children}</span>
    </Button>
  );
}
