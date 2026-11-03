// ホーム画面に追加の案内の判定（T51 で書き直した）。本人・家族のスマホの平時の画面の上（components/phone/InstallHint.tsx）。
// 対応は iPhone（iPad も同じ手順）・Android・LINE の中の 3 つ（11/3 15:4x 作者の確定。増やしも減らしもしない）。
// 判定は端末の様子を引数で受ける純な関数（installMode）。テストは node で回す。
// beforeinstallprompt（Android の 1 押しの画面）は読み込みの早いうちに 1 回だけ来るので、先頭の script（lib/ui/head-scripts.ts の
// INSTALL_SCRIPT）が受けて window に取っておく。受け口の名前はここで決め、script もここから読む。

/**
 * 出す案内の形。
 * ios: 共有 → ホーム画面に追加 → 追加 の 3 行。ios-line: LINE の中（外のブラウザへ）。ios-inapp: ほかのアプリの中（Safari で開く）。
 * android: 「追加」1 押し。android-manual: 右上のメニュー → ホーム画面に追加 の 2 行。android-line: LINE の中（外のブラウザへ）
 */
export type InstallMode = "ios" | "ios-line" | "ios-inapp" | "android" | "android-manual" | "android-line";

/** 端末の様子（描いたあとに読む） */
export type InstallEnv = {
  userAgent: string;
  /** ホーム画面から開いている（display-mode: standalone、iPhone の navigator.standalone） */
  standalone: boolean;
  /** この画面で入れた（appinstalled を受けた） */
  installed: boolean;
  /** 1 押しの画面（beforeinstallprompt）を受けて取ってある */
  deferred: boolean;
  /** navigator.platform（iPad の Safari は Mac と名乗るので、触れる点の数と合わせて見分ける） */
  platform?: string;
  /** navigator.maxTouchPoints */
  maxTouchPoints?: number;
};

/** beforeinstallprompt の出来事（標準の型に無いので、使う所だけ） */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

/** 先頭の script が取っておく所 */
export const INSTALL_PROMPT_KEY = "__care72Install";
export const INSTALLED_KEY = "__care72Installed";
/** 1 押しの画面を受けた・入れたときに window に投げる出来事の名前 */
export const INSTALL_READY_EVENT = "care72-install-ready";
/** 閉じた印（sessionStorage。そのタブの間だけ出さない） */
export const INSTALL_DISMISS_KEY = "care72:install-dismissed";
/** LINE の中で開いたページを外のブラウザで開き直させる、LINE の決まりのアドレスの印 */
export const EXTERNAL_BROWSER_PARAM = "openExternalBrowser";

export type InstallWindow = Window & {
  [INSTALL_PROMPT_KEY]?: InstallPromptEvent | null;
  [INSTALLED_KEY]?: boolean;
};

/** LINE の中のブラウザ（UA に「Line/版」） */
export const LINE_UA = /\bLine\/\d/i;
/** iPhone のほかのアプリの中（Instagram・Facebook・X・Google アプリ ほか）。Safari への出口が無い */
const IOS_IN_APP = /Instagram|FBAN|FBAV|FBIOS|Twitter|\bGSA\/|MicroMessenger|KAKAOTALK|Snapchat|Pinterest|TikTok|musical_ly|BytedanceWebview/i;

function isIos(env: InstallEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  // iPadOS の Safari は Mac と名乗る。Mac は触れる点を持たないので、点が 2 つ以上なら iPad
  const macLike = env.platform === "MacIntel" || /Macintosh/.test(env.userAgent);
  return macLike && (env.maxTouchPoints ?? 0) > 1;
}

/** 出す案内の形。出さないときは null（入れてある・PC・判断できない端末） */
export function installMode(env: InstallEnv): InstallMode | null {
  if (env.standalone || env.installed) return null;
  const ua = env.userAgent ?? "";
  if (ua.trim() === "") return null;
  const line = LINE_UA.test(ua);
  if (isIos({ ...env, userAgent: ua })) {
    if (line) return "ios-line";
    // Safari・Chrome・Edge・Firefox はどれも「Safari/」を名乗る。名乗らない物はアプリの中の画面
    if (IOS_IN_APP.test(ua) || !/Safari\//.test(ua)) return "ios-inapp";
    return "ios";
  }
  if (/Android/i.test(ua)) {
    if (line) return "android-line";
    return env.deferred ? "android" : "android-manual";
  }
  // PC（Windows・Mac・Linux）とそれ以外は出さない
  return null;
}

/** LINE の中から外のブラウザで開き直すアドレス（openExternalBrowser=1 を足す） */
export function externalBrowserUrl(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.set(EXTERNAL_BROWSER_PARAM, "1");
    return u.toString();
  } catch {
    return href;
  }
}

/** 外のブラウザで開き直したあとのアドレス（openExternalBrowser を外す）。変わらなければ null */
export function withoutExternalBrowser(href: string): string | null {
  try {
    const u = new URL(href);
    if (!u.searchParams.has(EXTERNAL_BROWSER_PARAM)) return null;
    u.searchParams.delete(EXTERNAL_BROWSER_PARAM);
    return u.toString();
  } catch {
    return null;
  }
}

/** このタブで閉じたか */
export function installDismissed(store: Pick<Storage, "getItem"> | null): boolean {
  try {
    return store?.getItem(INSTALL_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** 閉じた印を付ける（タブを閉じるまで出さない。次に開いたらまた出す） */
export function dismissInstall(store: Pick<Storage, "setItem"> | null): void {
  try {
    store?.setItem(INSTALL_DISMISS_KEY, "1");
  } catch {
    // 保存できない端末（プライベートの画面など）は、その描画の間だけ閉じる
  }
}

/**
 * 取ってある 1 押しの画面を出す。1 回しか使えないので、出す前に捨てる。
 * 入れたら INSTALLED_KEY を立てる。返り値は入れた・断った・取ってある画面が無い（null）
 */
export async function promptInstall(w: InstallWindow): Promise<"accepted" | "dismissed" | null> {
  const ev = w[INSTALL_PROMPT_KEY];
  if (!ev) return null;
  w[INSTALL_PROMPT_KEY] = null;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice.outcome === "accepted") w[INSTALLED_KEY] = true;
    return choice.outcome;
  } catch {
    return "dismissed";
  }
}
