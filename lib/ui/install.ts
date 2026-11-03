// ホーム画面に追加の案内（T44。本人・家族のスマホの /me と /family だけ）。判定の筋だけを持ち、画面は components/phone/InstallHint.tsx。
// - Android の Chrome などは beforeinstallprompt を受けて「追加」1 押しで入る（受けるのは lib/ui/head-scripts.ts の INSTALL_SCRIPT）
// - iPhone・iPad はページから入れる仕組みが無く、Safari の共有からしか入らないので、手順を 2〜3 行で出す
// - LINE の中で開いているときは openExternalBrowser=1 を付けたアドレスで外のブラウザへ出す
// - 追加済み（ホーム画面から開いた・入れた）・PC・判断できないときは出さない
// - 閉じたらその画面（タブ）の間だけ出さない（sessionStorage）。次に開いたらまた出す（入れるまで）

export type InstallMode = "android" | "android-manual" | "android-line" | "ios" | "ios-line" | "ios-inapp";

/** 判定に使う端末の様子。画面の部品が描いたあと（useEffect）に window から集めて渡す（サーバーの描画では触らない） */
export type InstallEnv = {
  userAgent: string;
  /** ホーム画面から開いている（display-mode: standalone、iPhone は navigator.standalone） */
  standalone: boolean;
  /** この画面で入れた（appinstalled を受けた） */
  installed: boolean;
  /** 1 押しで入る画面を出せる（beforeinstallprompt を受けて取ってある） */
  deferred: boolean;
  /** navigator.platform と maxTouchPoints（iPad の Safari は PC の Mac と名乗るので、指で触れるかで見分ける） */
  platform?: string;
  maxTouchPoints?: number;
};

export const INSTALL_READY_EVENT = "care72-install-ready";
export const DISMISS_KEY = "care72:install-dismissed";

/** 今の端末・開き方での案内の種類。出さないときは null */
export function installMode(env: InstallEnv): InstallMode | null {
  if (env.standalone || env.installed) return null;
  const ua = env.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1);
  const line = /\bLine\//i.test(ua);
  if (ios) {
    if (line) return "ios-line";
    // ほかのアプリの中のブラウザ（Facebook・Instagram・X・Google の検索アプリなど）は共有から追加できない
    if (/FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|GSA\//.test(ua)) return "ios-inapp";
    // Safari 以外（Chrome の CriOS・Firefox の FxiOS・Edge の EdgiOS）も共有から入れられるので同じ手順
    return "ios";
  }
  if (!/Android/i.test(ua)) return null;
  if (line) return "android-line";
  return env.deferred ? "android" : "android-manual";
}

/** LINE の中のブラウザから外のブラウザで開き直すアドレス（LINE が openExternalBrowser=1 を見て外へ出す） */
export function externalBrowserUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set("openExternalBrowser", "1");
  return url.toString();
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** この画面（タブ）で閉じたか。読めない端末では閉じていない扱い（出すだけ） */
export function installDismissed(storage: Pick<Store, "getItem"> | null): boolean {
  try {
    return storage?.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstall(storage: Pick<Store, "setItem"> | null): void {
  try {
    storage?.setItem(DISMISS_KEY, "1");
  } catch {
    // 保存できなければ、次に開いたときにまた出るだけ
  }
}

type Deferred = { prompt: () => Promise<void> | void; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type InstallWindow = Window & { __care72Install?: Deferred | null; __care72Installed?: number };

/** Android の 1 押しで入る画面を出す。入れたら true。取ってある画面は 1 回しか使えないので、出したら捨てる */
export async function promptInstall(w: InstallWindow): Promise<boolean> {
  const deferred = w.__care72Install;
  if (!deferred) return false;
  w.__care72Install = null;
  await deferred.prompt();
  const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  if (choice.outcome === "accepted") w.__care72Installed = 1;
  return choice.outcome === "accepted";
}
