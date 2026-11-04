// ホーム画面に追加の判定（T51 で書き直した。対応は iPhone・Android・LINE の中の 3 つ）と、先頭の script
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTALL_SCRIPT, PRESS_FADE_MS, PRESS_MIN_MS, PRESS_SCRIPT } from "./head-scripts";
import {
  dismissInstall,
  EXTERNAL_BROWSER_PARAM,
  externalBrowserUrl,
  INSTALL_DISMISS_KEY,
  INSTALL_PROMPT_KEY,
  INSTALL_READY_EVENT,
  installDismissed,
  INSTALLED_KEY,
  installMode,
  promptInstall,
  withoutExternalBrowser,
  type InstallEnv,
  type InstallPromptEvent,
  type InstallWindow,
} from "./install";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
  iphoneLine:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.18.0",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.21.106 (iPhone15,3; iOS 18_1; ja_JP; ja; scale=3.00; 1290x2796; 654123456)",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/486.0.0.45.103;FBBV/654321;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBCR/;FBID/phone;FBLC/ja_JP;FBOP/80]",
  iphoneX:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.70",
  iphoneGoogle:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/343.0.695551749 Mobile/15E148 Safari/604.1",
  ipadOld:
    "Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidLine:
    "Mozilla/5.0 (Linux; Android 14; SC-51D Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Line/14.18.1/IAB",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
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

describe("判定の表", () => {
  it("iPhone の Safari・Chrome・Edge・Firefox は共有 → ホーム画面に追加 → 追加 の手順", () => {
    for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.iphoneEdge, UA.iphoneFirefox]) {
      expect(installMode(env(ua, { platform: "iPhone", maxTouchPoints: 5 })), ua).toBe("ios");
    }
  });

  it("iPad は iPhone と同じ手順（Mac と名乗る iPad は触れる点の数で見分ける）", () => {
    expect(installMode(env(UA.ipadOld, { platform: "iPad", maxTouchPoints: 5 }))).toBe("ios");
    expect(installMode(env(UA.ipadDesktop, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe("ios");
  });

  it("iPhone の LINE の中はブラウザで開く", () => {
    expect(installMode(env(UA.iphoneLine, { platform: "iPhone", maxTouchPoints: 5 }))).toBe("ios-line");
  });

  it("iPhone のほかのアプリの中（Instagram・Facebook・X・Google アプリ）は Safari で開いてください", () => {
    for (const ua of [UA.iphoneInstagram, UA.iphoneFacebook, UA.iphoneX, UA.iphoneGoogle]) {
      expect(installMode(env(ua, { platform: "iPhone", maxTouchPoints: 5 })), ua).toBe("ios-inapp");
    }
  });

  it("Android: 1 押しの画面を受けていれば「追加」、無ければメニューの手順、LINE の中は外のブラウザへ", () => {
    expect(installMode(env(UA.androidChrome, { deferred: true, maxTouchPoints: 5 }))).toBe("android");
    expect(installMode(env(UA.androidChrome, { maxTouchPoints: 5 }))).toBe("android-manual");
    expect(installMode(env(UA.androidLine, { maxTouchPoints: 5 }))).toBe("android-line");
    expect(installMode(env(UA.androidLine, { deferred: true, maxTouchPoints: 5 }))).toBe("android-line");
  });

  it("ホーム画面から開いている・この画面で入れたときは出さない", () => {
    for (const ua of [UA.iphoneSafari, UA.androidChrome, UA.iphoneLine]) {
      expect(installMode(env(ua, { standalone: true }))).toBeNull();
      expect(installMode(env(ua, { installed: true, deferred: true }))).toBeNull();
    }
  });

  it("PC（触れない Windows・Mac・Linux）と判断できない端末は出さない", () => {
    expect(installMode(env(UA.windowsChrome, { platform: "Win32" }))).toBeNull();
    expect(installMode(env(UA.macSafari, { platform: "MacIntel", maxTouchPoints: 0 }))).toBeNull();
    expect(installMode(env(UA.linuxFirefox, { platform: "Linux x86_64" }))).toBeNull();
    expect(installMode(env(""))).toBeNull();
    expect(installMode(env("curl/8.0"))).toBeNull();
  });
});

describe("LINE のアドレス・閉じた印・1 押しの画面", () => {
  it("外のブラウザで開くアドレスに openExternalBrowser=1、開き直したら外す", () => {
    expect(externalBrowserUrl("https://care72.app/me")).toBe("https://care72.app/me?openExternalBrowser=1");
    expect(externalBrowserUrl("https://care72.app/me?x=1#a")).toBe("https://care72.app/me?x=1&openExternalBrowser=1#a");
    expect(withoutExternalBrowser("https://care72.app/me?openExternalBrowser=1")).toBe("https://care72.app/me");
    expect(withoutExternalBrowser("https://care72.app/me")).toBeNull();
    expect(EXTERNAL_BROWSER_PARAM).toBe("openExternalBrowser");
  });

  it("閉じたらそのタブの間は出さない（sessionStorage）。保存できない端末でも落ちない", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(installDismissed(store)).toBe(false);
    dismissInstall(store);
    expect(m.get(INSTALL_DISMISS_KEY)).toBe("1");
    expect(installDismissed(store)).toBe(true);
    expect(installDismissed(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
    };
    expect(installDismissed(broken)).toBe(false);
    expect(() => dismissInstall(broken)).not.toThrow();
  });

  it("1 押しの画面は 1 回だけ使い、入れたら入れた印", async () => {
    const prompt = vi.fn(async () => undefined);
    const ev = { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) } as unknown as InstallPromptEvent;
    const w = { [INSTALL_PROMPT_KEY]: ev } as unknown as InstallWindow;
    expect(await promptInstall(w)).toBe("accepted");
    expect(w[INSTALL_PROMPT_KEY]).toBeNull();
    expect(w[INSTALLED_KEY]).toBe(true);
    expect(await promptInstall(w)).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("断ったら入れた印は立てず、取ってある画面は捨てる（今の様子で出し直すと手順になる）", async () => {
    const ev = { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: "dismissed" as const }) } as unknown as InstallPromptEvent;
    const w = { [INSTALL_PROMPT_KEY]: ev } as unknown as InstallWindow;
    expect(await promptInstall(w)).toBe("dismissed");
    expect(w[INSTALLED_KEY]).toBeUndefined();
    expect(installMode(env(UA.androidChrome, { deferred: Boolean(w[INSTALL_PROMPT_KEY]) }))).toBe("android-manual");
  });
});

describe("先頭の script", () => {
  it("どちらも文として読め、import を持たない", () => {
    expect(() => new Function(PRESS_SCRIPT)).not.toThrow();
    expect(() => new Function(INSTALL_SCRIPT)).not.toThrow();
    for (const s of [PRESS_SCRIPT, INSTALL_SCRIPT]) {
      expect(s).not.toMatch(/\bimport\b|=>|\blet\b|\bconst\b|`/);
    }
  });

  it("受け口の名前が install.ts と揃う", () => {
    expect(INSTALL_SCRIPT).toContain(JSON.stringify(INSTALL_PROMPT_KEY));
    expect(INSTALL_SCRIPT).toContain(JSON.stringify(INSTALLED_KEY));
    expect(INSTALL_SCRIPT).toContain(JSON.stringify(INSTALL_READY_EVENT));
    expect(INSTALL_SCRIPT).toContain(JSON.stringify(EXTERNAL_BROWSER_PARAM));
  });

  it("install: 1 押しの画面を取っておいて知らせ、入れたら印。LINE の外ではアドレスの印を外す", () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const events: string[] = [];
    const replaced: string[] = [];
    const w: Record<string, unknown> = {
      addEventListener: (t: string, f: (e: unknown) => void) => (handlers[t] = f),
      dispatchEvent: (e: Event) => events.push(e.type),
      location: { href: "https://care72.app/me?openExternalBrowser=1#x" },
      history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u) },
      URL,
    };
    const run = new Function("window", "navigator", INSTALL_SCRIPT);
    run(w, { userAgent: UA.iphoneSafari });
    expect(replaced).toEqual(["/me#x"]);
    const ev = { preventDefault: vi.fn() };
    handlers.beforeinstallprompt(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(w[INSTALL_PROMPT_KEY]).toBe(ev);
    handlers.appinstalled({});
    expect(w[INSTALL_PROMPT_KEY]).toBeNull();
    expect(w[INSTALLED_KEY]).toBe(true);
    expect(events).toEqual([INSTALL_READY_EVENT, INSTALL_READY_EVENT]);

    // LINE の中ではアドレスはそのまま（外へ出るまで印が要る）
    const replaced2: string[] = [];
    run({ ...w, history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => replaced2.push(u) } }, { userAgent: UA.iphoneLine });
    expect(replaced2).toEqual([]);
  });
});

/** 押したときの script を、偽の window と要素で動かす */
class FakeEl {
  attrs = new Map<string, string>();
  disabled = false;
  constructor(
    public name: string,
    public matches: (sel: string) => boolean,
    public parent: FakeEl | null = null,
  ) {}
  nodeType = 1;
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  closest(sel: string): FakeEl | null {
    if (sel.includes("[") && sel.includes("(")) throw new Error("壊れた選択子");
    // 選択子の並び（a,b,c）のどれかに当たる一番近い祖先
    const parts = sel.split(",");
    for (let el: FakeEl | null = this; el; el = el.parent) if (parts.some((p) => el!.matches(p.trim()))) return el;
    return null;
  }
}

describe("押したときの script", () => {
  let handlers: Record<string, (e: unknown) => void>;
  const down = (target: FakeEl, x = 0, y = 0, more: Record<string, unknown> = {}) =>
    handlers.pointerdown({ target, button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, ...more });

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {};
    const w = {
      addEventListener: (t: string, f: (e: unknown) => void) => (handlers[t] = f),
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    };
    new Function("window", "document", PRESS_SCRIPT)(w, { documentElement: {} });
  });
  afterEach(() => vi.useRealTimers());

  const button = () => new FakeEl("button", (s) => s === "button");

  it("置いた瞬間に on、離しても 120ms までは残し、out にしてから 360ms で外す", () => {
    const b = button();
    down(b);
    expect(b.getAttribute("data-pressing")).toBe("on");
    vi.advanceTimersByTime(30);
    handlers.pointerup({ pointerId: 1 });
    expect(b.getAttribute("data-pressing")).toBe("on");
    vi.advanceTimersByTime(PRESS_MIN_MS - 30);
    expect(b.getAttribute("data-pressing")).toBe("out");
    vi.advanceTimersByTime(PRESS_FADE_MS);
    expect(b.getAttribute("data-pressing")).toBeNull();
  });

  it("長く押してから離したらすぐ out", () => {
    const b = button();
    down(b);
    vi.advanceTimersByTime(500);
    handlers.pointerup({ pointerId: 1 });
    vi.advanceTimersByTime(0);
    expect(b.getAttribute("data-pressing")).toBe("out");
  });

  it("指が 8px 動いたら消す（7px までは残す）", () => {
    const b = button();
    down(b, 100, 100);
    handlers.pointermove({ pointerId: 1, clientX: 105, clientY: 104 });
    expect(b.getAttribute("data-pressing")).toBe("on");
    handlers.pointermove({ pointerId: 1, clientX: 100, clientY: 108 });
    expect(b.getAttribute("data-pressing")).toBeNull();
    handlers.pointerup({ pointerId: 1 });
    vi.advanceTimersByTime(1000);
    expect(b.getAttribute("data-pressing")).toBeNull();
  });

  it("スクロール・pointercancel・窓の blur ですぐ消す", () => {
    for (const ev of ["scroll", "pointercancel", "blur"]) {
      const b = button();
      down(b);
      handlers[ev]({});
      expect(b.getAttribute("data-pressing"), ev).toBeNull();
    }
  });

  it("別の物を押したら前の印を外す（印を持つのは 1 つ）", () => {
    const a = button();
    const b = button();
    down(a);
    handlers.pointerup({ pointerId: 1 });
    down(b);
    expect(a.getAttribute("data-pressing")).toBeNull();
    expect(b.getAttribute("data-pressing")).toBe("on");
  });

  it("主ボタンだけ。disabled・aria-disabled・data-no-press の中は付けない", () => {
    const b = button();
    down(b, 0, 0, { button: 2 });
    expect(b.getAttribute("data-pressing")).toBeNull();
    down(b, 0, 0, { isPrimary: false });
    expect(b.getAttribute("data-pressing")).toBeNull();
    const off = button();
    off.disabled = true;
    down(off);
    expect(off.getAttribute("data-pressing")).toBeNull();
    const aria = button();
    aria.setAttribute("aria-disabled", "true");
    down(aria);
    expect(aria.getAttribute("data-pressing")).toBeNull();
    const pad = new FakeEl("pad", (s) => s === "[data-no-press]");
    const inPad = new FakeEl("button", (s) => s === "button", pad);
    down(inPad);
    expect(inPad.getAttribute("data-pressing")).toBeNull();
  });

  it("data-press-host を持つ物は、その祖先に印を付ける。壊れた選択子でも落ちない", () => {
    const row = new FakeEl("row", (s) => s === "tr");
    const b = new FakeEl("button", (s) => s === "button", row);
    b.setAttribute("data-press-host", "tr");
    down(b);
    expect(row.getAttribute("data-pressing")).toBe("on");
    expect(b.getAttribute("data-pressing")).toBeNull();

    const c = button();
    c.setAttribute("data-press-host", "[(");
    expect(() => down(c)).not.toThrow();
    expect(c.getAttribute("data-pressing")).toBe("on");
  });
});
