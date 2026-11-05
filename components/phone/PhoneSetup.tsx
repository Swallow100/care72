"use client";

// 本人・家族の頁の上の「準備」の欄（docs/tasks/T149.md）。ID とパスワード → ホーム画面に追加 → 通知の許可、の順に 1 つずつ案内し、
// 済むまで出し続ける。閉じるはこの表示の間だけ（次に開いた時にまた出す）。済んだら出さない。決まりは lib/phone/setup.ts。
// - ID: リンクで開いた人だけ（審査員の役・ID で入った人には作る欄を出さない）。作ると ID を見せる。パスワードは送ったら欄から消す
// - ホーム画面: 前の案内（T44・T51）と同じ言葉と手順（iPhone は共有の手順の絵、Android は「追加」、LINE は外のブラウザへ）
// - 通知: 押すと端末の許可の窓 → 購読（鍵はサーバーが渡した公開鍵）→ サーバーへ送る。許可済みの端末は開くたびに送り直す
//   （毎朝の戻しで消えた購読も戻る）。鍵の無い配信は「通知 未設定」。iPhone の Safari の中は「ホーム画面から開いて」
// - 災害モード（compact）は安否のボタンの上に 1 行と、押せるボタン 1 つ（安否のボタンはいつも押せる。この欄は押さなくてよい）
// ボタンは無色（面の中の灰色）。本人・家族の画面で面を塗るのは赤緑のボタンだけ。端末の様子は描いたあとに読む。

import { useCallback, useEffect, useState, type ComponentType, type FormEvent, type SVGProps } from "react";
import { EasyWords } from "@/components/forms/EasyText";
import {
  AddIcon,
  BrowserMenuIcon,
  CloseIcon,
  ExternalIcon,
  HideIcon,
  IdIcon,
  LaterIcon,
  NotifyIcon,
  PasswordIcon,
  SaveIcon,
  ShareIcon,
  ShowIcon,
} from "@/components/ui/Icon";
import { easy } from "@/lib/forms/easy-words";
import { SETUP_EASY as S } from "@/lib/phone/labels";
import {
  currentStep,
  INSTALLED_MARK_KEY,
  keyBytes,
  sameKey,
  setupSteps,
  setupVisible,
  type NotifyState,
  type SetupStep,
} from "@/lib/phone/setup";
import {
  externalBrowserUrl,
  INSTALL_READY_EVENT,
  installMode,
  promptInstall,
  type InstallMode,
  type InstallWindow,
} from "@/lib/ui/install";
import { INSTALL_PHRASES as P } from "@/lib/ui/labels";

/** 購読の API（app/api/push）と ID の API（app/api/phone/account） */
const PUSH_API = "/api/push";
const ACCOUNT_API = "/api/phone/account";
/** SW が入るのを待つ長さ（入らない端末で待ち続けない） */
const SW_WAIT_MS = 8000;

export type PhoneSetupProps = {
  /** 購読の公開鍵（VAPID）。鍵の無い配信は null（通知 未設定） */
  vapidKey: string | null;
  /** ID の段: hidden 出さない・create まだ・done 作った（loginId を見せる） */
  account: { kind: "hidden" } | { kind: "create" } | { kind: "done"; loginId: string };
  /** 災害モード（安否のボタンの上に 1 行） */
  compact?: boolean;
};

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || Boolean(window.matchMedia?.("(display-mode: standalone)").matches);
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function markInstalled() {
  try {
    localStore()?.setItem(INSTALLED_MARK_KEY, "1");
  } catch {
    // 保存できない端末は、ホーム画面から開いた時だけ済みに見える
  }
}

/** ホーム画面の段: 案内の形（null は済み・入れる必要の無い端末） */
function readInstall(): InstallMode | null {
  const w = window as InstallWindow;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (standalone() || w.__care72Installed) {
    markInstalled();
    return null;
  }
  let marked = false;
  try {
    marked = localStore()?.getItem(INSTALLED_MARK_KEY) === "1";
  } catch {
    marked = false;
  }
  if (marked) return null;
  return installMode({
    userAgent: nav.userAgent,
    standalone: false,
    installed: false,
    deferred: Boolean(w.__care72Install),
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
  });
}

const isIos = (m: InstallMode | null) => m === "ios" || m === "ios-line" || m === "ios-inapp";

async function swReady(): Promise<ServiceWorkerRegistration | null> {
  const sw = navigator.serviceWorker;
  if (!sw) return null;
  return Promise.race([sw.ready, new Promise<null>((r) => setTimeout(() => r(null), SW_WAIT_MS))]);
}

/** 購読して（鍵が違えば作り直して）サーバーへ送る。送れたら true */
async function subscribe(vapidKey: string): Promise<boolean> {
  const reg = await swReady();
  if (!reg || !("pushManager" in reg)) return false;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, vapidKey)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
  const res = await fetch(PUSH_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return res.ok;
}

/** 通知の今の様子（端末の許可・ブラウザの対応・鍵） */
function readNotify(vapidKey: string | null, mode: InstallMode | null): NotifyState {
  if (!vapidKey) return "off";
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!has) return isIos(mode) && !standalone() ? "need-home" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" ? "checking" : "todo";
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const BIG = "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-4 text-2xl font-bold bg-panel2 text-ink";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
const INPUT = `h-14 w-full rounded-lg bg-panel2 pl-12 pr-3 text-xl outline-none ${FOCUS}`;

function Easy({ m }: { m: string }) {
  return <EasyWords words={easy(m)} />;
}

function Step({ icon: I, m }: { icon: Icon; m: string }) {
  return (
    <li className="flex items-center gap-3">
      <I aria-hidden className="size-8 shrink-0" />
      <span>
        <Easy m={m} />
      </span>
    </li>
  );
}

const STEP_WORDS: Record<SetupStep, string> = { account: S.stepAccount, install: S.stepInstall, notify: S.stepNotify };

export function PhoneSetup({ vapidKey, account: initialAccount, compact = false }: PhoneSetupProps) {
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [account, setAccount] = useState(initialAccount);
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [notify, setNotify] = useState<NotifyState>("checking");
  const [skipped, setSkipped] = useState<SetupStep[]>([]);
  const [href, setHref] = useState("");

  const resync = useCallback(async () => {
    if (!vapidKey) return;
    try {
      setNotify((await subscribe(vapidKey)) ? "done" : "failed");
    } catch {
      setNotify("failed");
    }
  }, [vapidKey]);

  useEffect(() => {
    const update = () => setMode(readInstall());
    const m = readInstall();
    setMode(m);
    setHref(externalBrowserUrl(location.href));
    const n = readNotify(vapidKey, m);
    setNotify(n);
    setReady(true);
    // 許可済みの端末は開くたびに購読を送り直す（毎朝の戻しで消えた購読・鍵を替えた配信のあと）
    if (n === "checking") void resync();
    const installed = () => {
      markInstalled();
      update();
    };
    window.addEventListener(INSTALL_READY_EVENT, update);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener(INSTALL_READY_EVENT, update);
      window.removeEventListener("appinstalled", installed);
    };
  }, [vapidKey, resync]);

  if (!ready || closed) return null;
  const input = { account: account.kind, installDone: mode === null, notify, skipped };
  if (!setupVisible(input, compact)) return null;
  const steps = setupSteps(input).filter((s) => !compact || s.step !== "account");
  const current = compact ? (mode !== null ? "install" : "notify") : currentStep(input);

  const allow = async () => {
    if (!vapidKey) return;
    let perm: NotificationPermission;
    try {
      perm = await Notification.requestPermission();
    } catch {
      setNotify("unsupported");
      return;
    }
    if (perm !== "granted") {
      setNotify(perm === "denied" ? "denied" : "todo");
      return;
    }
    setNotify("checking");
    await resync();
  };

  const add = async () => {
    await promptInstall(window as InstallWindow);
    setMode(readInstall());
  };

  const status = (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-lg" aria-label="準備">
      {steps.map((s) => (
        <li key={s.step} className={s.done ? "text-muted" : "font-bold"} data-setup-step={s.step} data-done={s.done ? "1" : "0"}>
          {s.done && <SaveIcon aria-hidden className="mr-1 inline size-5 align-[-0.15em]" />}
          <Easy m={STEP_WORDS[s.step]} /> <Easy m={s.done ? S.done : s.step === "notify" && notify === "off" ? S.notConfigured : S.todo} />
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <section className="phone-text mx-3 mt-3 rounded-lg bg-panel px-4 py-3" data-phone-setup="compact" aria-label="準備">
        {status}
        {current === "notify" && (notify === "todo" || notify === "failed") && (
          <button type="button" className={`mt-2 ${BIG} ${FOCUS}`} data-press data-setup-action="allow" onClick={allow}>
            <NotifyIcon aria-hidden className="size-7 shrink-0" />
            <Easy m={S.allow} />
          </button>
        )}
        {current === "install" && mode === "android" && (
          <button type="button" className={`mt-2 ${BIG} ${FOCUS}`} data-press data-setup-action="add" onClick={add}>
            <AddIcon aria-hidden className="size-7 shrink-0" />
            <Easy m={P.add} />
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="phone-text mb-3 rounded-lg bg-panel px-4 py-3 text-xl" data-phone-setup={current ?? "done"} aria-labelledby="setup-title">
      <h2 id="setup-title" className="text-2xl font-bold">
        <Easy m={S.title} />
      </h2>
      <div className="mt-1">{status}</div>

      {current === "account" && account.kind === "create" && (
        <AccountForm onDone={(loginId) => setAccount({ kind: "done", loginId })} onLater={() => setSkipped((s) => [...s, "account"])} />
      )}

      {current === "install" && mode !== null && (
        <div className="mt-3" data-install={mode}>
          <p className="font-bold">
            <Easy m={mode === "android-line" || mode === "ios-line" ? P.line : mode === "ios-inapp" ? P.inApp : P.lead} />
          </p>
          {mode === "ios" && (
            <ol className="mt-2 space-y-2" data-setup-ios-steps>
              <Step icon={ShareIcon} m={P.iosShare} />
              <Step icon={AddIcon} m={P.iosAdd} />
              <Step icon={SaveIcon} m={P.iosDone} />
            </ol>
          )}
          {mode === "android-manual" && (
            <ol className="mt-2 space-y-2">
              <Step icon={BrowserMenuIcon} m={P.androidMenu} />
              <Step icon={AddIcon} m={P.androidAdd} />
            </ol>
          )}
          {mode === "android" && (
            <button type="button" className={`mt-3 ${BIG} ${FOCUS}`} data-press data-install-action="add" onClick={add}>
              <AddIcon aria-hidden className="size-7 shrink-0" />
              <Easy m={P.add} />
            </button>
          )}
          {(mode === "android-line" || mode === "ios-line") && href && (
            <a href={href} className={`mt-3 ${BIG} ${FOCUS}`} data-press data-install-action="browser">
              <ExternalIcon aria-hidden className="size-7 shrink-0" />
              <Easy m={P.openBrowser} />
            </a>
          )}
        </div>
      )}

      {current === "notify" && (
        <div className="mt-3" data-notify={notify}>
          <p className="font-bold">
            <Easy
              m={
                notify === "off"
                  ? S.notConfigured
                  : notify === "need-home"
                    ? S.notifyFromHome
                    : notify === "denied"
                      ? S.denied
                      : notify === "unsupported"
                        ? S.unsupported
                        : S.notifyLead
              }
            />
          </p>
          {notify === "failed" && (
            <p className="mt-1 text-lg">
              <Easy m={S.failed} />
            </p>
          )}
          {(notify === "todo" || notify === "failed") && (
            <button type="button" className={`mt-3 ${BIG} ${FOCUS}`} data-press data-setup-action="allow" onClick={allow}>
              <NotifyIcon aria-hidden className="size-7 shrink-0" />
              <Easy m={S.allow} />
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className={`mt-3 ${BIG} ${FOCUS} min-h-12 text-xl`}
        data-press
        data-setup-action="close"
        onClick={() => setClosed(true)}
      >
        <CloseIcon aria-hidden className="size-6 shrink-0" />
        <Easy m={S.close} />
      </button>
    </section>
  );
}

/** ID とパスワードを作る欄。送ったらパスワードの欄を空にする。断られたら理由の言葉（サーバーが返すやさしい日本語） */
function AccountForm({ onDone, onLater }: { onDone: (loginId: string) => void; onLater: () => void }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(ACCOUNT_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId, password, password2 }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; loginId?: string; words?: string } | null;
      if (res.ok && body?.ok && body.loginId) {
        setPassword("");
        setPassword2("");
        onDone(body.loginId);
      } else {
        setError(body?.words ?? S.failed);
      }
    } catch {
      setError(S.failed);
    } finally {
      setBusy(false);
    }
  };

  const Toggle = show ? HideIcon : ShowIcon;
  return (
    <form className="mt-3 space-y-3" onSubmit={submit} data-setup-account>
      <p className="font-bold">
        <Easy m={S.accountLead} />
      </p>
      <label className="block">
        <span className="text-lg">
          <Easy m={S.loginId} />
        </span>
        <span className="relative mt-1 block">
          <IdIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-6 -translate-y-1/2 text-muted" />
          <input
            name="username"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            maxLength={32}
            required
            className={INPUT}
          />
        </span>
      </label>
      <label className="block">
        <span className="text-lg">
          <Easy m={S.password} />
        </span>
        <span className="relative mt-1 block">
          <PasswordIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-6 -translate-y-1/2 text-muted" />
          <input
            name="new-password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={64}
            required
            className={`${INPUT} pr-24`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-pressed={show}
            className={`absolute top-1/2 right-1.5 inline-flex h-11 -translate-y-1/2 items-center gap-1 rounded px-2 text-base font-bold text-muted ${FOCUS}`}
            data-press
          >
            <Toggle aria-hidden className="size-5" />
            {show ? "隠す" : "表示"}
          </button>
        </span>
      </label>
      <label className="block">
        <span className="text-lg">
          <Easy m={S.password2} />
        </span>
        <span className="relative mt-1 block">
          <PasswordIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-6 -translate-y-1/2 text-muted" />
          <input
            name="new-password-2"
            type={show ? "text" : "password"}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
            maxLength={64}
            required
            className={INPUT}
          />
        </span>
      </label>
      {error && (
        <p className="text-lg font-bold" role="alert" data-setup-error>
          <Easy m={error} />
        </p>
      )}
      <button type="submit" className={`${BIG} ${FOCUS}`} data-press data-setup-action="create" disabled={busy}>
        <SaveIcon aria-hidden className="size-7 shrink-0" />
        <Easy m={busy ? S.sending : S.create} />
      </button>
      <button type="button" className={`${BIG} ${FOCUS} min-h-12 text-xl`} data-press data-setup-action="later" onClick={onLater}>
        <LaterIcon aria-hidden className="size-6 shrink-0" />
        <Easy m={S.later} />
      </button>
    </form>
  );
}

/** 作った ID を見せる 1 行（準備が済んだあとも、本人・家族の頁の下に小さく。パスワードは出さない） */
export function PhoneLoginIdLine({ loginId }: { loginId: string }) {
  return (
    <p className="phone-text mt-4 px-1 text-lg text-muted" data-phone-login-id>
      <Easy m={S.made} /> <span className="font-bold text-ink">{loginId}</span>
    </p>
  );
}
