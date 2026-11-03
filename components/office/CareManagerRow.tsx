"use client";

// ケアマネの一覧の 1 行（docs/tasks/T61.md）。名前・管理者の印・停止の印・ID・担当の人数と、行の下の操作。
// - 管理者には「改名」「管理者」/「管理者解除」「停止」/「再開」「再発行」（停止・管理者解除・再発行は確認の窓を通す）。
//   改名は行の下に欄が開く。再発行した初期パスワードはこの画面の状態にだけ持って 1 回だけ出す（URL・保存・ログに残さない）
// - 自分の行には「パスワード変更」（管理者でなくても）。現在・新規・確認の 3 つの欄。変えたあともこの端末はログインしたまま、
//   ほかの端末は入り直し（「他端末 再ログイン」）
// - 種のデモ事業所のアカウント（山本）は「固定」の 1 語でボタンを出さない（サーバーも断る）
// 送ったあとは一覧を読み直す（router.refresh。この部品の状態は残る）。

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  SaveIcon,
  UnlistIcon,
} from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import { isFixedAccount } from "@/lib/auth/demo";
import { DISPLAY_NAME_MAX } from "@/lib/office/forms";
import { ASSIGN_ANCHOR, careManagerApiPath, OWN_PASSWORD_API_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS, STAFF_CONFIRM_LABELS } from "@/lib/office/labels";
import { appConfirm } from "@/lib/ui/dialog";
import { INPUT } from "./AddCareManager";

/** 新しいパスワードの長さ（lib/auth/password-change.ts の NEW_PASSWORD_MIN・MAX と同じ。テストで確かめる） */
export const PASSWORD_INPUT = { min: 8, max: 64 } as const;

export type CareManagerRowItem = {
  id: string;
  name: string;
  loginId: string | null;
  admin: boolean;
  people: number;
  disabled: boolean;
};

type Mode = "rename" | "password" | null;
type Reply = { ok: true; changed?: boolean; password?: string } | { ok: false; error?: string; label?: string };

async function post(path: string, body: unknown): Promise<Reply> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return ((await res.json().catch(() => null)) as Reply | null) ?? { ok: false };
  } catch {
    return { ok: false };
  }
}

export function CareManagerRow({ item, self, manage }: { item: CareManagerRowItem; self: boolean; manage: boolean }) {
  const router = useRouter();
  const fixed = isFixedAccount(item.id);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ label: string; hasPeople: boolean } | null>(null);
  const [reissued, setReissued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);
  const [name, setName] = useState(item.name);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });

  // 管理者の操作は自分の行には出さない（自分の停止・管理者解除・再発行はサーバーも断る）。改名は自分にも
  const canManage = manage && !fixed;
  const others = canManage && !self;
  const canPassword = self && !fixed;

  function open(next: Mode) {
    setError(null);
    setPasswordDone(false);
    setMode(next);
    if (next === "rename") setName(item.name);
    if (next === "password") setPw({ current: "", next: "", confirm: "" });
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
    if (r.ok && typeof r.password === "string") setReissued(r.password);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      setError({ label: OFFICE_LABELS.confirmMismatch, hasPeople: false });
      return;
    }
    setBusy(true);
    setError(null);
    const r = await post(OWN_PASSWORD_API_PATH, { current: pw.current, next: pw.next });
    setBusy(false);
    if (r.ok) {
      setPw({ current: "", next: "", confirm: "" });
      setMode(null);
      setPasswordDone(true);
      router.refresh();
    } else {
      setError({ label: r.label ?? "送信失敗", hasPeople: false });
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
                <Button kind="danger" size="sm" icon={RemoveIcon} disabled={busy} onClick={() => void toggleAdmin()}>
                  {OFFICE_LABELS.removeAdmin}
                </Button>
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
                <Button kind="danger" size="sm" icon={UnlistIcon} disabled={busy} onClick={() => void toggleDisabled()}>
                  {OFFICE_LABELS.disable}
                </Button>
              )}
              <Button kind="danger" size="sm" icon={RetryIcon} disabled={busy} onClick={() => void reissue()}>
                {OFFICE_LABELS.resetPassword}
              </Button>
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
        <form onSubmit={changePassword} aria-label={OFFICE_LABELS.changePassword} className="mt-1.5 grid gap-1.5" data-cm-form="password">
          {/* パスワードの管理の道具が ID と組にできるように（見せない） */}
          <input type="text" name="username" autoComplete="username" value={item.loginId ?? ""} readOnly hidden />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <PasswordField label={OFFICE_LABELS.currentPassword} auto="current-password" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} focus />
            <PasswordField label={OFFICE_LABELS.nextPassword} auto="new-password" min value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} />
            <PasswordField label={OFFICE_LABELS.confirmPassword} auto="new-password" min value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} />
          </div>
          <FormButtons busy={busy} ok={OFFICE_LABELS.change} onCancel={() => setMode(null)} error={error?.label ?? null} />
        </form>
      )}

      {passwordDone && (
        <p role="status" className="mt-1 flex flex-wrap items-baseline justify-end gap-x-2 text-sm">
          <StateText tone="ok">{OFFICE_LABELS.changed}</StateText>
          <span className="text-muted">{OFFICE_LABELS.otherDevices}</span>
        </p>
      )}

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

function PasswordField({
  label,
  auto,
  min = false,
  focus = false,
  value,
  onChange,
}: {
  label: string;
  auto: "current-password" | "new-password";
  min?: boolean;
  focus?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="password"
        required
        autoComplete={auto}
        autoFocus={focus}
        minLength={min ? PASSWORD_INPUT.min : undefined}
        maxLength={min ? PASSWORD_INPUT.max : undefined}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </label>
  );
}

function FormButtons({ busy, ok, onCancel, error }: { busy: boolean; ok: string; onCancel: () => void; error: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="submit" kind="main" size="sm" icon={SaveIcon} disabled={busy} data-pending={busy ? "" : undefined}>
        {busy ? OFFICE_LABELS.sending : ok}
      </Button>
      <Button kind="quiet" size="sm" icon={CloseIcon} onClick={onCancel} disabled={busy}>
        {OFFICE_LABELS.cancel}
      </Button>
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
