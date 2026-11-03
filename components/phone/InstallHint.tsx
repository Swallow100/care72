"use client";

// ホーム画面に追加の案内（T44。本人・家族のスマホの平時の画面の上）。判定は lib/ui/install.ts、言葉は lib/ui/labels.ts の INSTALL_PHRASES。
// Android の Chrome は「追加」1 押しで入る。iPhone は Safari の共有 → ホーム画面に追加 → 追加 の手順を 3 行。LINE の中は外のブラウザへ。
// 追加済み・PC・判断できないときは出さない。閉じたらその画面（タブ）の間は出さない。
// 端末の様子は描いたあと（useEffect）に読む。サーバーの描画と最初の描画では何も出さない（出す・出さないの食い違いを作らない）。

import { ArrowTopRightOnSquareIcon, ArrowUpOnSquareIcon, EllipsisVerticalIcon, PlusIcon } from "@heroicons/react/20/solid";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { EasyWords } from "@/components/forms/EasyText";
import { CloseIcon } from "@/components/ui/Icon";
import { easy } from "@/lib/forms/easy-words";
import {
  dismissInstall,
  externalBrowserUrl,
  INSTALL_READY_EVENT,
  installDismissed,
  installMode,
  promptInstall,
  type InstallMode,
  type InstallWindow,
} from "@/lib/ui/install";
import { INSTALL_PHRASES as P } from "@/lib/ui/labels";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMode(): InstallMode | null {
  const w = window as InstallWindow;
  const nav = navigator as Navigator & { standalone?: boolean };
  return installMode({
    userAgent: nav.userAgent,
    standalone: nav.standalone === true || Boolean(window.matchMedia?.("(display-mode: standalone)").matches),
    installed: Boolean(w.__care72Installed),
    deferred: Boolean(w.__care72Install),
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
  });
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function Step({ icon: I, m }: { icon: Icon; m: string }) {
  return (
    <li className="flex items-center gap-3">
      <I aria-hidden className="size-8 shrink-0" />
      <span>
        <EasyWords words={easy(m)} />
      </span>
    </li>
  );
}

const BIG = "flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-2xl font-bold";

export function InstallHint() {
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [href, setHref] = useState("");

  useEffect(() => {
    if (installDismissed(sessionStore())) return;
    const update = () => setMode(readMode());
    update();
    setHref(externalBrowserUrl(location.href));
    // 1 押しの画面は描いたあとに来ることがある（来たら手順から「追加」に替える）。入れたら消える
    window.addEventListener(INSTALL_READY_EVENT, update);
    return () => window.removeEventListener(INSTALL_READY_EVENT, update);
  }, []);

  if (!mode) return null;

  const close = () => {
    dismissInstall(sessionStore());
    setMode(null);
  };

  return (
    <section className="phone-text mb-3 rounded-lg bg-panel px-4 py-3 text-xl" data-install={mode} aria-labelledby="install-lead">
      <p id="install-lead" className="font-bold">
        <EasyWords words={easy(mode === "android-line" || mode === "ios-line" ? P.line : mode === "ios-inapp" ? P.inApp : P.lead)} />
      </p>
      {mode === "ios" && (
        <ol className="mt-2 space-y-2">
          <Step icon={ArrowUpOnSquareIcon} m={P.iosShare} />
          <Step icon={PlusIcon} m={P.iosAdd} />
          <Step icon={PlusIcon} m={P.iosDone} />
        </ol>
      )}
      {mode === "android-manual" && (
        <ol className="mt-2 space-y-2">
          <Step icon={EllipsisVerticalIcon} m={P.androidMenu} />
          <Step icon={PlusIcon} m={P.androidAdd} />
        </ol>
      )}
      <div className="mt-3 flex gap-2">
        {mode === "android" && (
          <button
            type="button"
            className={`${BIG} bg-accent text-on-accent`}
            data-press="overlay"
            data-install-action="add"
            onClick={async () => {
              const w = window as InstallWindow;
              await promptInstall(w);
              // 入れた・断った、どちらでも取ってある画面は使い切ったので、今の様子で出し直す（入れたら消える、断ったら手順）
              setMode(readMode());
            }}
          >
            <PlusIcon aria-hidden className="size-7 shrink-0" />
            <span>
              <EasyWords words={easy(P.add)} />
            </span>
          </button>
        )}
        {(mode === "android-line" || mode === "ios-line") && href && (
          <a href={href} className={`${BIG} bg-accent text-on-accent`} data-press="overlay" data-install-action="browser">
            <ArrowTopRightOnSquareIcon aria-hidden className="size-7 shrink-0" />
            <span>
              <EasyWords words={easy(P.openBrowser)} />
            </span>
          </a>
        )}
        <button type="button" className={`${BIG} bg-panel2 text-ink`} data-press data-install-action="close" onClick={close}>
          <CloseIcon aria-hidden className="size-7 shrink-0" />
          <span>
            <EasyWords words={easy(P.close)} />
          </span>
        </button>
      </div>
    </section>
  );
}
