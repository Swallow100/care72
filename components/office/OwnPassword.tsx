"use client";

// 自分のパスワードの変更の欄（T61）。事業所の画面のケアマネの自分の行（CareManagerRow）と、医療班・行政の受入一覧の見出しの行
// （components/staff/StaffPassword.tsx、T99）で同じ部品を使う（言葉・長さ・送り先・回数の制限が同じになる）。
// 現在・新規・確認の 3 つの欄。確認が違えばその場で「確認 不一致」。送り先は /api/auth/password（lib/auth/password-change.ts）で、
// 今のパスワードの打ち間違いはログインと同じ回数で止まる（429「回数超過 しばらく待機」）。断りの言葉はサーバーの label をそのまま出す。
// 変えたあともこの端末はログインしたまま、ほかの端末は入り直し（PasswordDone の「変更済 他端末 再ログイン」）。
// パスワードはこの部品の状態にだけ持つ（URL・保存・ログに残さない）。

import { useRouter } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/Button";
import { CloseIcon, SaveIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import { OWN_PASSWORD_API_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { INPUT } from "./AddCareManager";

/** 新しいパスワードの長さ（lib/auth/password-change.ts の NEW_PASSWORD_MIN・MAX と同じ。テストで確かめる） */
export const PASSWORD_INPUT = { min: 8, max: 64 } as const;

/** 白い面の上に置くとき（受入一覧）の欄。地は面の中の灰色（受入の入口の欄と同じ）。形はケアマネの行の欄と同じ */
const INPUT_ON_PANEL = INPUT.replace("bg-panel ", "bg-panel2 ");

export type Reply = { ok: true; changed?: boolean; password?: string } | { ok: false; error?: string; label?: string };

/** JSON を送って応答を読む。つながらない・読めないときは { ok: false } */
export async function post(path: string, body: unknown): Promise<Reply> {
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

/**
 * 自分のパスワードの変更の欄。loginId は隠した欄（パスワードの管理の道具が ID と組にできるように。無ければ置かない）。
 * onPanel は白い面の上に置くとき（欄の地を面の中の灰色に）。変えたら onDone、取消は onCancel（どちらも欄を閉じるのは親）
 */
export function OwnPasswordForm({
  loginId,
  onPanel = false,
  onCancel,
  onDone,
  className = "",
  ...rest
}: {
  loginId: string | null;
  onPanel?: boolean;
  onCancel: () => void;
  onDone: () => void;
} & Omit<ComponentProps<"form">, "onSubmit" | "children">) {
  const router = useRouter();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = onPanel ? INPUT_ON_PANEL : INPUT;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      setError(OFFICE_LABELS.confirmMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await post(OWN_PASSWORD_API_PATH, { current: pw.current, next: pw.next });
    setBusy(false);
    if (r.ok) {
      setPw({ current: "", next: "", confirm: "" });
      onDone();
      router.refresh();
    } else {
      setError(r.label ?? "送信失敗");
    }
  }

  return (
    <form onSubmit={submit} aria-label={OFFICE_LABELS.changePassword} className={`grid gap-1.5 ${className}`.trim()} {...rest}>
      {/* パスワードの管理の道具が ID と組にできるように（見せない） */}
      {loginId && <input type="text" name="username" autoComplete="username" value={loginId} readOnly hidden />}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <PasswordField label={OFFICE_LABELS.currentPassword} auto="current-password" input={input} value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} focus />
        <PasswordField label={OFFICE_LABELS.nextPassword} auto="new-password" input={input} min value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} />
        <PasswordField label={OFFICE_LABELS.confirmPassword} auto="new-password" input={input} min value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} />
      </div>
      <FormButtons busy={busy} ok={OFFICE_LABELS.change} onCancel={onCancel} error={error} />
    </form>
  );
}

/** 変えたあとの 1 行（「変更済 他端末 再ログイン」） */
export function PasswordDone({ className = "" }: { className?: string }) {
  return (
    <p role="status" className={`flex flex-wrap items-baseline justify-end gap-x-2 text-sm ${className}`.trim()}>
      <StateText tone="ok">{OFFICE_LABELS.changed}</StateText>
      <span className="text-muted">{OFFICE_LABELS.otherDevices}</span>
    </p>
  );
}

function PasswordField({
  label,
  auto,
  input,
  min = false,
  focus = false,
  value,
  onChange,
}: {
  label: string;
  auto: "current-password" | "new-password";
  input: string;
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
        className={input}
      />
    </label>
  );
}

/** 欄の下の 保存（変更）・取消 と断りの言葉（ケアマネの行の改名の欄も同じ） */
export function FormButtons({ busy, ok, onCancel, error }: { busy: boolean; ok: string; onCancel: () => void; error: string | null }) {
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
