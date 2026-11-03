import { describe, expect, it } from "vitest";
import { DISMISS_KEY, dismissInstall, externalBrowserUrl, installDismissed, installMode, promptInstall, type InstallEnv, type InstallWindow } from "./install.ts";
import { INSTALL_SCRIPT, PRESS_SCRIPT } from "./head-scripts.ts";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  iphoneLine: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.0",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidLine: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Line/14.19.0",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

const env = (userAgent: string, more: Partial<InstallEnv> = {}): InstallEnv => ({
  userAgent,
  standalone: false,
  installed: false,
  deferred: false,
  platform: "",
  maxTouchPoints: 0,
  ...more,
});

describe("ホーム画面に追加の案内の判定", () => {
  it("iPhone は Safari・Chrome とも共有の手順", () => {
    expect(installMode(env(UA.iphone, { platform: "iPhone", maxTouchPoints: 5 }))).toBe("ios");
    expect(installMode(env(UA.iphoneChrome, { platform: "iPhone", maxTouchPoints: 5 }))).toBe("ios");
  });

  it("iPad の Safari（Mac と名乗る）は指で触れるかで見分ける。Mac の PC は出さない", () => {
    expect(installMode(env(UA.ipadDesktop, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe("ios");
    expect(installMode(env(UA.mac, { platform: "MacIntel", maxTouchPoints: 0 }))).toBeNull();
  });

  it("Android は 1 押しの画面を受けていれば追加、まだならメニューの手順", () => {
    expect(installMode(env(UA.android, { deferred: true }))).toBe("android");
    expect(installMode(env(UA.android))).toBe("android-manual");
  });

  it("LINE の中は外のブラウザへ（iPhone・Android とも。1 押しの画面を受けていても）", () => {
    expect(installMode(env(UA.iphoneLine, { platform: "iPhone", maxTouchPoints: 5 }))).toBe("ios-line");
    expect(installMode(env(UA.androidLine, { deferred: true }))).toBe("android-line");
  });

  it("iPhone のほかのアプリの中は Safari で開く案内", () => {
    expect(installMode(env(UA.iphoneInstagram, { platform: "iPhone", maxTouchPoints: 5 }))).toBe("ios-inapp");
  });

  it("追加済み（ホーム画面から開いた・この画面で入れた）は出さない", () => {
    expect(installMode(env(UA.iphone, { standalone: true }))).toBeNull();
    expect(installMode(env(UA.android, { deferred: true, standalone: true }))).toBeNull();
    expect(installMode(env(UA.android, { installed: true }))).toBeNull();
  });

  it("PC と判断できない端末は出さない", () => {
    expect(installMode(env(UA.windows, { deferred: true }))).toBeNull();
    expect(installMode(env(""))).toBeNull();
  });

  it("外のブラウザで開くアドレスは openExternalBrowser=1 を足す（今の問い合わせは残す）", () => {
    expect(externalBrowserUrl("https://care72.app/me")).toBe("https://care72.app/me?openExternalBrowser=1");
    expect(externalBrowserUrl("https://care72.app/family?x=1#a")).toBe("https://care72.app/family?x=1&openExternalBrowser=1#a");
  });

  it("閉じたらその画面（タブ）の間だけ出さない。保存できない端末では出すだけ", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(installDismissed(store)).toBe(false);
    dismissInstall(store);
    expect(m.get(DISMISS_KEY)).toBe("1");
    expect(installDismissed(store)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(installDismissed(broken)).toBe(false);
    expect(() => dismissInstall(broken)).not.toThrow();
    expect(installDismissed(null)).toBe(false);
  });

  it("1 押しの画面は 1 回だけ使い、入れたら入れた印を立てる", async () => {
    const w = {
      __care72Install: { prompt: () => undefined, userChoice: Promise.resolve({ outcome: "accepted" as const }) },
    } as unknown as InstallWindow;
    expect(await promptInstall(w)).toBe(true);
    expect(w.__care72Install).toBeNull();
    expect(w.__care72Installed).toBe(1);
    expect(await promptInstall(w)).toBe(false);
  });

  it("断ったら入れた印は立てない", async () => {
    const w = {
      __care72Install: { prompt: () => undefined, userChoice: Promise.resolve({ outcome: "dismissed" as const }) },
    } as unknown as InstallWindow;
    expect(await promptInstall(w)).toBe(false);
    expect(w.__care72Installed).toBeUndefined();
  });
});

describe("先頭の小さな script", () => {
  it("文として読める（壊れた script を先頭に置かない）", () => {
    expect(() => new Function(PRESS_SCRIPT)).not.toThrow();
    expect(() => new Function(INSTALL_SCRIPT)).not.toThrow();
  });

  it("受け口の名前は lib/ui/install.ts と同じ", () => {
    expect(INSTALL_SCRIPT).toContain("__care72Install");
    expect(INSTALL_SCRIPT).toContain("__care72Installed");
    expect(INSTALL_SCRIPT).toContain('"care72-install-ready"');
    // LINE の判定の正規表現が文字のまま残っている（\b が消えていない）
    expect(INSTALL_SCRIPT).toContain(String.raw`/\bLine\//i`);
  });

  it("押したときの印は on と out、スクロールが始まったら外す", () => {
    expect(PRESS_SCRIPT).toContain('pressing="on"');
    expect(PRESS_SCRIPT).toContain('pressing="out"');
    expect(PRESS_SCRIPT).toContain('"pointercancel"');
    expect(PRESS_SCRIPT).toContain('"scroll"');
    expect(PRESS_SCRIPT).toContain("data-no-press");
    expect(PRESS_SCRIPT).toContain("data-press-host");
  });
});
