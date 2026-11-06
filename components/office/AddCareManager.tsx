"use client";

// ケアマネの区分の見出しと「ケアマネ追加」（docs/tasks/T30.md）。追加は事業所の管理者だけ。
// 見出しの右の「ケアマネ追加」（担当一覧の右上の「利用者追加」と同じ見た目・同じ高さ）を押すと、見出しのすぐ下に
// 「ケアマネ追加」の欄が開く。名前と ID と、任意のパスワード（T148。新規・確認の 2 欄、決まりは lib/auth/password-rule.ts）を送る。
// パスワードを空にすれば、サーバーが作った初期パスワードをこの画面の状態にだけ持って 1 回だけ出す（URL・保存・ログに残さない。
// 閉じる・読み直すと消える）。決めたパスワードは送るだけで、応答にも画面にも出さない（「パスワード 設定済」）。
// 足したあとは欄を閉じ、「追加済」を出し、一覧を読み直す（router.refresh。この部品の状態は残る）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AddPersonIcon, CloseIcon, CopyIcon, SaveIcon } from "@/components/ui/Icon";
import { PanelHead } from "@/components/ui/Panel";
import { StateText } from "@/components/ui/Tag";
import { DISPLAY_NAME_MAX } from "@/lib/office/forms";
import { CARE_MANAGERS_API_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { INPUT } from "./field";
import { PasswordField, PasswordRule, passwordInputError } from "./OwnPassword";

/** password は作った初期パスワード（1 回だけ出す）。決めたパスワードで足したときは null */
type Added = { displayName: string; loginId: string; password: string | null };

/** 入れる欄の形（ケアマネの行の改名・パスワード変更の欄も同じ。T61）。元は ./field.ts（部品どうしが互いを読まないように。T148） */
export { INPUT };

export function AddCareManager({ count, admin, children }: { count: number; admin: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // パスワードは任意。入れたら決まりと確認を送る前に見る（サーバーも同じ決まりで断る）
    if (pw.next !== "" || pw.confirm !== "") {
      const bad = passwordInputError(pw.next, pw.confirm);
      if (bad) {
        setError(bad);
        return;
      }
    }
    setBusy(true);
    setError(null);
    setAdded(null);
    setCopied(false);
    try {
      const res = await fetch(CARE_MANAGERS_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pw.next === "" ? { displayName, loginId } : { displayName, loginId, password: pw.next }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; account: { displayName: string; loginId: string }; password: string | null }
        | { ok: false; label?: string }
        | null;
      if (data?.ok) {
        setAdded({ displayName: data.account.displayName, loginId: data.account.loginId, password: data.password });
        setDisplayName("");
        setLoginId("");
        setPw({ next: "", confirm: "" });
        setOpen(false);
        router.refresh();
      } else {
        setError(data?.label ?? "送信失敗");
      }
    } catch {
      setError("送信失敗");
    }
    setBusy(false);
  }

  async function copy() {
    if (!added?.password) return;
    try {
      await navigator.clipboard.writeText(added.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <PanelHead
        id="cm-title"
        title={OFFICE_LABELS.careManagers}
        count={count}
        actions={
          admin && !open ? (
            <Button kind="main" icon={AddPersonIcon} aria-expanded={false} onClick={() => setOpen(true)}>
              {OFFICE_LABELS.addCareManager}
            </Button>
          ) : null
        }
      />
      {added && (
        <div role="status" className="mt-2 rounded bg-panel2 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <StateText tone="ok">追加済</StateText>
            <span className="font-bold">{added.displayName}</span>
            <span className="text-muted">
              {OFFICE_LABELS.loginId} {added.loginId}
            </span>
          </div>
          {added.password !== null ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted">{OFFICE_LABELS.initialPassword}</span>
                <span className="text-lg font-bold select-all">{added.password}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StateText tone="check" className="text-xs">
                  {OFFICE_LABELS.shownOnce}
                </StateText>
                <Button kind="plainIn" size="sm" icon={CopyIcon} onClick={copy} className="ml-auto">
                  {copied ? OFFICE_LABELS.copied : OFFICE_LABELS.copy}
                </Button>
                <Button kind="quiet" size="sm" icon={CloseIcon} onClick={() => setAdded(null)}>
                  {OFFICE_LABELS.close}
                </Button>
              </div>
            </>
          ) : (
            // 決めたパスワードは出さない（管理者はもう知っている）
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" data-cm-added-set>
              <span className="text-muted">{OFFICE_LABELS.password}</span>
              <span className="font-bold">{OFFICE_LABELS.passwordSet}</span>
              <Button kind="quiet" size="sm" icon={CloseIcon} onClick={() => setAdded(null)} className="ml-auto">
                {OFFICE_LABELS.close}
              </Button>
            </div>
          )}
        </div>
      )}
      {admin && open && (
        <form onSubmit={submit} aria-labelledby="cm-add-title" className="mt-2 grid gap-2 rounded bg-panel2 p-2.5">
          <h3 id="cm-add-title" className="text-sm font-bold">
            {OFFICE_LABELS.addCareManager}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">{OFFICE_LABELS.displayName}</span>
              <input
                type="text"
                required
                maxLength={DISPLAY_NAME_MAX}
                autoComplete="off"
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">{OFFICE_LABELS.loginId}</span>
              <input
                type="text"
                required
                minLength={3}
                maxLength={32}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className={INPUT}
              />
            </label>
          </div>
          {/* パスワードは任意（空ならサーバーが作って 1 回だけ出す）。決まりは欄の下の 1 行 */}
          <div className="grid grid-cols-2 gap-2" data-cm-add-password>
            <PasswordField
              label={OFFICE_LABELS.password}
              auto="new-password"
              input={INPUT}
              min
              required={false}
              value={pw.next}
              onChange={(v) => setPw({ ...pw, next: v })}
            />
            <PasswordField
              label={OFFICE_LABELS.confirmPassword}
              auto="new-password"
              input={INPUT}
              min
              required={pw.next !== ""}
              value={pw.confirm}
              onChange={(v) => setPw({ ...pw, confirm: v })}
            />
          </div>
          <PasswordRule />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="submit" kind="main" icon={SaveIcon} disabled={busy} data-pending={busy ? "" : undefined}>
              {busy ? OFFICE_LABELS.sending : OFFICE_LABELS.add}
            </Button>
            <Button kind="quiet" icon={CloseIcon} onClick={() => setOpen(false)} disabled={busy}>
              {OFFICE_LABELS.cancel}
            </Button>
            {error && (
              <span role="alert" className="text-sm font-bold text-danger">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
      {children}
    </>
  );
}
