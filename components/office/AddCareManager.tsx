"use client";

// ケアマネ追加（docs/tasks/T30.md）。事業所の管理者だけに出す。名前と ID を送り、サーバーが作った初期パスワードを
// この画面の状態にだけ持って 1 回だけ出す（URL・保存・ログに残さない。閉じる・読み直すと消える）。
// 足したあとはケアマネの一覧を読み直す（router.refresh。この部品の状態は残る）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DISPLAY_NAME_MAX } from "@/lib/office/forms";
import { CARE_MANAGERS_API_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";

type Added = { displayName: string; loginId: string; password: string };

const INPUT =
  "w-full min-w-0 rounded-md bg-panel2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent";
const BUTTON = "rounded-md px-3 py-1.5 text-sm font-bold";

export function AddCareManager() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAdded(null);
    setCopied(false);
    try {
      const res = await fetch(CARE_MANAGERS_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, loginId }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; account: { displayName: string; loginId: string }; password: string }
        | { ok: false; label?: string }
        | null;
      if (data?.ok) {
        setAdded({ displayName: data.account.displayName, loginId: data.account.loginId, password: data.password });
        setDisplayName("");
        setLoginId("");
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
    if (!added) return;
    try {
      await navigator.clipboard.writeText(added.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-3 grid gap-2">
      {added && (
        <div role="status" className="rounded-md bg-panel2 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold">{added.displayName}</span>
            <span className="text-muted">
              {OFFICE_LABELS.loginId} {added.loginId}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted">{OFFICE_LABELS.initialPassword}</span>
            <span className="select-all text-lg font-bold tabular-nums">{added.password}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`text-xs font-bold text-state-check`}>{OFFICE_LABELS.shownOnce}</span>
            <button type="button" onClick={copy} className={`${BUTTON} ml-auto bg-panel`} data-press>
              {copied ? OFFICE_LABELS.copied : OFFICE_LABELS.copy}
            </button>
            <button type="button" onClick={() => setAdded(null)} className={`${BUTTON} bg-panel`} data-press>
              {OFFICE_LABELS.close}
            </button>
          </div>
        </div>
      )}
      <form onSubmit={submit} aria-label={OFFICE_LABELS.addCareManager} className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="text-muted">{OFFICE_LABELS.displayName}</span>
            <input
              type="text"
              required
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="off"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="text-muted">{OFFICE_LABELS.loginId}</span>
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className={`${BUTTON} bg-accent text-on-accent disabled:bg-panel2 disabled:text-muted`}
            data-press="overlay"
          >
            {busy ? OFFICE_LABELS.sending : OFFICE_LABELS.addCareManager}
          </button>
          {error && (
            <span role="alert" className="text-sm font-bold text-danger">
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
