// 使う人が触る面（docs/tasks/T156.md）。本物は手元の next dev を puppeteer（headless Chrome、tools/print/chrome.ts の探し方）で開く。
// 偽の面（fake-site.ts）も同じ口を持つ。
//
// - 開けるのは localhost・127.0.0.1・[::1] だけ（guard.ts）。手は押す・書く・選ぶ・戻るだけで、使う人は URL を打てない（host の外へ出ない）
// - 筋ごとに新しい閲覧の箱（cookie を持ち越さない）。PC の幅（1536×864 か 1280×800）
// - window.print は開く前に差し替えて旗を立てる（headless が止まらず、「印刷の手前まで」の印になる）。確かめの窓は文を記録して OK
// - 同じ origin の HTTP の 4xx・5xx と頁の例外を数える（次の読みの errors）

import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";
import { chromePath } from "../../print/chrome.ts";
import { hashOf, lookOf, READ_LIMITS, readPageInBrowser, REF_ATTR, stubPrintInBrowser, type RawRead } from "./dom.ts";
import { assertLocalBase } from "./guard.ts";
import type { ActResult, Move, Snapshot } from "./types.ts";

export type Secrets = { password: string };

/** パスワードの印を値に替える（使う人の AI には印だけを見せる） */
export const PASSWORD_MARK = "{{password}}";
export function fillSecrets(text: string, secrets: Secrets): string {
  return text.split(PASSWORD_MARK).join(secrets.password);
}

export interface Surface {
  /** 筋の初めに開く（道は base からの相対） */
  open(path: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  act(move: Move, secrets: Secrets): Promise<ActResult>;
  /** 今の画面の写真（file に PNG）。撮れなければ false */
  shot(file: string): Promise<boolean>;
  /** 筋の前の下ごしらえ: ID とパスワードで入る（使う人の手に数えない） */
  login(id: string, secrets: Secrets): Promise<boolean>;
  /** 筋の前の下ごしらえ: 事業所の「発災開始」（T163。入ったあとに呼ぶ。使う人の手に数えない）。入れなければ false */
  startDisaster(): Promise<boolean>;
  /** 筋を終える（閲覧の箱を閉じる） */
  end(): Promise<void>;
}

export type Viewport = { width: number; height: number };
export const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  "1536": { width: 1536, height: 864 },
  "1280": { width: 1280, height: 800 },
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 送信中の印。部品の data-pending は "" か "true"。本人のページの未確認の数（data-pending="3"）や様式の未確認の理由は同じ名前の属性でも送信中ではない
 * （T166。前は未確認のある人を開くたびに 60 秒待ち、医療班の筋が時間切れになった）
 */
export const BUSY_SELECTOR = '[data-pending=""],[data-pending="true"],[aria-busy="true"]';

/** 頁の最初のボタンに React の印が付いたか（ボタンの無い頁は動いている扱い） */
export const HYDRATED_CHECK = `(() => { const b = document.querySelector("button"); return !b || Object.keys(b).some((k) => k.startsWith("__reactProps")); })()`;

/** 押したあとに落ち着くまで（移るなら移り終わるまで、通信が 0.5 秒止むまで）。next dev の初めの道は組み立てに時間がかかる */
async function settle(page: Page, navTimeout: number): Promise<void> {
  await wait(250);
  await page.waitForNetworkIdle({ idleTime: 600, timeout: navTimeout }).catch(() => undefined);
  // 押した物が送信中（components/ui の SubmitButton の data-pending・aria-busy、読込中の印）の間は待つ（移る前に読むと送信中の画面を読む）
  const until = Date.now() + Math.min(navTimeout, 60_000);
  while (Date.now() < until) {
    const busy = await page
      .evaluate((sel) => document.querySelector(sel) !== null, BUSY_SELECTOR)
      .catch(() => false);
    if (!busy) break;
    await wait(400);
  }
  await page.waitForNetworkIdle({ idleTime: 400, timeout: navTimeout }).catch(() => undefined);
  // 画面が動き出すまで（T166。next dev は読み込みのあとの組み立てが遅く、前は押しても一覧が開かず、行き止まりに数えていた）
  const live = Date.now() + Math.min(navTimeout, 60_000);
  while (Date.now() < live) {
    const ready = await page.evaluate(HYDRATED_CHECK).catch(() => true);
    if (ready) break;
    await wait(400);
  }
}

export type ChromeOptions = { base: string; viewport: Viewport; navTimeout?: number; headless?: boolean };

/** 本物の面。browser は筋をまたいで 1 つ、閲覧の箱は筋ごと */
export class ChromeSurface implements Surface {
  private browser: Browser | null = null;
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private errors: string[] = [];
  private dialogs: string[] = [];
  private readonly base: URL;
  private readonly navTimeout: number;
  private readonly opts: ChromeOptions;

  constructor(opts: ChromeOptions) {
    this.opts = opts;
    this.base = assertLocalBase(opts.base);
    this.navTimeout = opts.navTimeout ?? 120_000;
  }

  static available(): boolean {
    return chromePath() !== null;
  }

  private async ensure(): Promise<Page> {
    if (this.page) return this.page;
    if (!this.browser) {
      const exe = chromePath();
      if (!exe) throw new Error("Chrome か Edge が見つからない（CHROME_PATH で場所を渡す）");
      this.browser = await puppeteer.launch({ executablePath: exe, headless: this.opts.headless ?? true, args: ["--font-render-hinting=none", "--lang=ja-JP"] });
    }
    this.ctx = await this.browser.createBrowserContext();
    const page = await this.ctx.newPage();
    await page.setViewport({ ...this.opts.viewport, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(stubPrintInBrowser);
    page.on("response", (res) => {
      const status = res.status();
      if (status < 400) return;
      let u: URL;
      try {
        u = new URL(res.url());
      } catch {
        return;
      }
      if (u.origin !== this.base.origin) return;
      // 開発の道具の要求（next dev の組み立て・地図のタイルの代わり）は数えない
      if (u.pathname.startsWith("/_next/") || u.pathname.startsWith("/__nextjs")) return;
      this.errors.push(`HTTP ${status} ${u.pathname}`);
    });
    page.on("pageerror", (e) => this.errors.push(`頁の例外 ${e instanceof Error ? e.name : "Error"}`));
    page.on("dialog", (d) => {
      this.dialogs.push(`窓「${d.message().slice(0, 80)}」`);
      void d.accept().catch(() => undefined);
    });
    this.page = page;
    return page;
  }

  private url(path: string): string {
    const u = new URL(path, this.base);
    if (u.origin !== this.base.origin) throw new Error("base の外の道は開かない");
    return u.href;
  }

  async open(path: string): Promise<void> {
    const page = await this.ensure();
    await page.goto(this.url(path), { waitUntil: "domcontentloaded", timeout: this.navTimeout }).catch((e) => this.errors.push(`開けない ${e instanceof Error ? e.name : "Error"}`));
    await settle(page, this.navTimeout);
  }

  async snapshot(): Promise<Snapshot> {
    const page = await this.ensure();
    let raw: RawRead;
    try {
      raw = await page.evaluate(readPageInBrowser, READ_LIMITS);
    } catch {
      // 移る途中で読めなかった。落ち着いてからもう一度
      await settle(page, this.navTimeout);
      raw = await page.evaluate(readPageInBrowser, READ_LIMITS);
    }
    const errors = this.errors;
    this.errors = [];
    const alerts = [...raw.alerts, ...this.dialogs];
    this.dialogs = [];
    if (raw.printed) await page.evaluate(() => void ((window as unknown as { __personaPrinted?: boolean }).__personaPrinted = false)).catch(() => undefined);
    const snap = { ...raw, alerts, errors };
    return { ...snap, hash: hashOf(snap), look: lookOf(snap) };
  }

  async act(move: Move, secrets: Secrets): Promise<ActResult> {
    const page = await this.ensure();
    try {
      if (move.action === "back") {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: this.navTimeout }).catch(() => null);
        await settle(page, this.navTimeout);
        return { ok: true };
      }
      if (move.action === "done" || move.action === "give_up") return { ok: true };
      if (move.ref === null) return { ok: false, error: "押す物の番号が無い" };
      const el = await page.$(`[${REF_ATTR}="${move.ref}"]`);
      if (!el) return { ok: false, error: `番号 ${move.ref} の物が無い` };
      if (move.action === "click") {
        await el.scrollIntoView().catch(() => undefined);
        // 新しいタブで開くリンク（一括印刷など）は同じタブで開く（台は 1 つのタブだけを読む）
        await el.evaluate((n) => n.closest("a[target]")?.removeAttribute("target")).catch(() => undefined);
        await el.click();
      } else if (move.action === "type") {
        const text = fillSecrets(move.text ?? "", secrets);
        await el.click({ count: 3 }).catch(() => undefined);
        await el.evaluate((n) => {
          if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) n.select();
        });
        await page.keyboard.press("Backspace");
        await el.type(text, { delay: 5 });
      } else if (move.action === "select") {
        const want = move.text ?? "";
        // アプリの選ぶ部品（components/ui/Select。ボタン＋開く一覧）は、人と同じくボタンを押して一覧の項目を押す（T162）
        const custom = await el.evaluate((n) => n instanceof HTMLButtonElement && n.getAttribute("aria-haspopup") === "listbox");
        if (custom) {
          if ((await el.evaluate((n) => n.getAttribute("aria-expanded"))) !== "true") await el.click();
          await settle(page, this.navTimeout);
          const listId = await el.evaluate((n) => n.getAttribute("aria-controls"));
          const options = listId ? await page.$$(`[id="${listId}"] [role=option]`) : [];
          const texts = await Promise.all(options.map((o) => o.evaluate((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())));
          const at = texts.findIndex((t) => t === want) >= 0 ? texts.findIndex((t) => t === want) : texts.findIndex((t) => t.includes(want));
          if (at < 0) return { ok: false, error: `選択肢「${want.slice(0, 20)}」が無い` };
          await options[at].click();
          await settle(page, this.navTimeout);
          return { ok: true };
        }
        const value = await el.evaluate((n, label) => {
          if (!(n instanceof HTMLSelectElement)) return null;
          const o = Array.from(n.options).find((x) => x.textContent?.trim() === label) ?? Array.from(n.options).find((x) => x.textContent?.includes(label));
          return o ? o.value : null;
        }, want);
        if (value === null) return { ok: false, error: `選択肢「${want.slice(0, 20)}」が無い` };
        await el.select(value);
      }
      await settle(page, this.navTimeout);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : "押せない" };
    }
  }

  async shot(file: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.screenshot({ path: file as `${string}.png`, fullPage: false });
      return true;
    } catch {
      return false;
    }
  }

  async login(id: string, secrets: Secrets): Promise<boolean> {
    await this.open("/login");
    const page = await this.ensure();
    const idBox = await page.$("#login-id");
    const pwBox = await page.$("#login-password");
    if (!idBox || !pwBox) return false;
    await idBox.type(id);
    await pwBox.type(secrets.password);
    await Promise.all([page.waitForNavigation({ timeout: this.navTimeout }).catch(() => null), pwBox.press("Enter")]);
    await settle(page, this.navTimeout);
    this.errors = [];
    return !new URL(page.url()).pathname.startsWith("/login") || new URL(page.url()).pathname.startsWith("/login/role");
  }

  /** 手元の種に戻す（事業所の「最初に戻す」と同じ要求。入ったあとに呼ぶ） */
  async resetSeed(): Promise<boolean> {
    const page = await this.ensure();
    const landed = await page
      .evaluate(async () => {
        const body = new FormData();
        body.set("confirm", "1");
        const r = await fetch("/office/reset", { method: "POST", body, credentials: "same-origin" });
        return r.url;
      })
      .catch(() => "");
    this.errors = [];
    // 戻せたら /office?reset=done へ移る（lib/seed/http.ts の officeResetHref）
    return landed.includes("reset=done");
  }

  /** 事業所の「発災開始」と同じ要求（事業所の画面の版を読んでから送る。lib/seed/http.ts の startPost）。入れたら /office へ移る */
  async startDisaster(): Promise<boolean> {
    const page = await this.ensure();
    const landed = await page
      .evaluate(async () => {
        const html = await (await fetch("/office", { credentials: "same-origin" })).text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const version = doc.querySelector<HTMLInputElement>("form[data-seed-start] input[name=version]")?.value;
        if (version === undefined) return "";
        const body = new FormData();
        body.set("version", version);
        const r = await fetch("/office/start", { method: "POST", body, credentials: "same-origin" });
        return r.url;
      })
      .catch(() => "");
    this.errors = [];
    return landed !== "" && new URL(landed).pathname === "/office" && !landed.includes("error=");
  }

  async end(): Promise<void> {
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.page = null;
    this.errors = [];
    this.dialogs = [];
  }

  async close(): Promise<void> {
    await this.end();
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
