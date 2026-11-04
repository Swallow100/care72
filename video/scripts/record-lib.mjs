// 手元の dev の本物の画面を headless Chrome で撮る道具（T43）。scripts/record.mjs が使う。
// - 撮り方は CDP の Page.startScreencast。画面が変わったときだけコマが来るので、来たコマを時刻つきで持ち、
//   最後に 30fps の連番（00001.jpg …、video/README.md の形）に並べ直す（その時刻までの最新のコマを使う）。同じコマは hard link
// - 一時止め（pause・resume）は録画の道具の一時停止と同じ。待つだけの所（1 分ごとの読み直しを待つなど）を詰める
// - mark(名前) で連番の中の秒を覚え、markers.json に書く（timeline.ts の from に使う）
// - puppeteer-core はルートの node_modules の物（ルートで npm ci が要る）。ブラウザは手元の Chrome か Edge
// 画面を描き直さない。ページに物を足さない（押した所の印も足さない）。操作は本物のボタンを押すだけ。
import { existsSync, linkSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export function findChrome() {
  const env = process.env.CHROME_PATH?.trim();
  if (env && existsSync(env)) return env;
  const p = CANDIDATES.find((c) => existsSync(c));
  if (!p) throw new Error("Chrome か Edge が見つからない（CHROME_PATH で場所を渡す）");
  return p;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    // ライトで撮る。保存したパスワード・拡張・履歴の無い新しいプロフィール（puppeteer の既定）
    args: ["--no-first-run", "--lang=ja-JP", "--force-color-profile=srgb", "--hide-scrollbars", `--force-device-scale-factor=${SCALE}`, "--disable-smooth-scrolling"],
  });
}

/** 撮る窓。PC は 1280×720 を 1.5 倍（コマは 1920×1080）、スマホは 375×812 を 2 倍 */
// 画面の流れ（screencast）は、窓の倍率を起動の --force-device-scale-factor に合わせないと CSS の大きさ（1280×720・375×812）で来る
// （11/3 の録画は頭の 1 枚だけ 1920×1080 で、残りは 1280×720 だった）。起動の倍率は 1 つなので、PC もスマホも 1.5 にそろえる
export const SCALE = 1.5;
export const PC = { width: 1280, height: 720, deviceScaleFactor: SCALE };
export const PHONE = { width: 375, height: 812, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true };

/** 新しい窓（cookie を分ける）を開き、ライトにする */
export async function newPage(browser, viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  // next dev が左下に出す開発の印（N の丸）を隠す。本番（care72.app）には無い物で、アプリの画面ではない
  await page.evaluateOnNewDocument(() => {
    const hide = () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none !important}";
      document.head.appendChild(s);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
  return page;
}

/**
 * ログインする（ログインの画面は撮らない。撮り始める前に済ませる）。
 * パスワードは環境変数から受けるだけで、どこにも書かない。role は審査員の役（family・self・medical・care_manager）
 */
export async function login(page, base, id, password, role) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle0", timeout: 180_000 });
  const url = await page.evaluate(
    async (uid, pw) => {
      const body = new FormData();
      body.set("id", uid);
      body.set("password", pw);
      const r = await fetch("/api/auth/login", { method: "POST", body, credentials: "same-origin", redirect: "follow" });
      // 送った先の 500（手元の D1 が空のときなど）は道が /api/auth/login のままなので、状態でも見る
      return r.ok ? r.url : `${location.origin}/login?status=${r.status}`;
    },
    id,
    password,
  );
  // 審査員は役を選ぶ画面（/login/role）へ、山本は担当一覧へ送られる。ログインの画面のままなら失敗
  if (new URL(url).pathname === "/login") throw new Error(`${id} でログインできない（dev に渡した値と合わせる）`);
  if (role) {
    const to = await page.evaluate(async (r) => {
      const body = new FormData();
      body.set("role", r);
      const res = await fetch("/api/auth/role", { method: "POST", body, credentials: "same-origin", redirect: "follow" });
      return res.url;
    }, role);
    if (new URL(to).pathname.startsWith("/login")) throw new Error(`役 ${role} を選べない`);
  }
}

/** 頁を開き、書体と通信が落ち着くまで待つ */
export async function open(page, base, path) {
  await page.goto(base + path, { waitUntil: "networkidle0", timeout: 180_000 });
  await settle(page);
}

export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 30_000 }).catch(() => undefined);
}

/** 画面をゆっくり下へ送る（px を ms かけて、マウスのホイールで） */
export async function scrollSlow(page, px, ms) {
  const steps = Math.max(1, Math.round(ms / 50));
  const vp = page.viewport();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: px / steps });
    await sleep(50);
  }
}

/** 文字で要素を探して押す（button・a・[role=button]・label）。見つからなければ止める */
export async function clickText(page, text, { exact = false, within = "body" } = {}) {
  const handle = await page.evaluateHandle(
    (t, ex, sel) => {
      const root = document.querySelector(sel) ?? document.body;
      const els = Array.from(root.querySelectorAll("button, a, [role=button], label, summary"));
      // ふりがな（ruby の rt）は外して比べる。空白も詰める（「無事じゃない」「動けない」）
      const norm = (e) => {
        const c = e.cloneNode(true);
        c.querySelectorAll("rt, rp").forEach((n) => n.remove());
        return (c.textContent ?? "").replace(/\s+/g, "");
      };
      const want = t.replace(/\s+/g, "");
      return els.find((e) => (ex ? norm(e) === want : norm(e).includes(want)) && e.getClientRects().length > 0) ?? null;
    },
    text,
    exact,
    within,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`押す所が無い: ${text}`);
  await el.scrollIntoView();
  // 撮っている録画があれば、押した所（要素の真ん中）を覚える。編集で押した所に輪を出す（src/parts/Frame.tsx）
  const box = await el.boundingBox();
  if (box && current?.active) current.tap(box.x + box.width / 2, box.y + box.height / 2);
  await el.click();
  return el;
}

/** いま撮っている録画（clickText が押した所を渡す先） */
let current = null;

/** 録画 1 本。start → （mark・pause・resume）→ stop(連番のフォルダ) */
export class Recorder {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.frames = []; // { t: 秒（壁の時刻）, data: Buffer }
    this.segments = []; // { from, to } 撮っている間（壁の時刻）
    this.marks = [];
    this.taps = []; // { at: 連番の中の秒, x, y: 窓の幅・高さに対する割合 }
    this.active = false;
  }

  /** 押した所を覚える（px は窓の中の位置） */
  tap(x, y) {
    const vp = this.page.viewport();
    this.taps.push({ at: Math.round(this.elapsed() * 100) / 100, x: Math.round((x / vp.width) * 1000) / 1000, y: Math.round((y / vp.height) * 1000) / 1000 });
  }

  now() {
    return Date.now() / 1000;
  }

  async start() {
    current = this;
    this.cdp = await this.page.createCDPSession();
    this.cdp.on("Page.screencastFrame", async (f) => {
      if (this.active) this.frames.push({ t: f.metadata.timestamp ?? this.now(), data: Buffer.from(f.data, "base64") });
      await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    const vp = this.page.viewport();
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 88,
      maxWidth: Math.round(vp.width * (vp.deviceScaleFactor ?? 1)),
      maxHeight: Math.round(vp.height * (vp.deviceScaleFactor ?? 1)),
      everyNthFrame: 1,
    });
    await this.resume();
  }

  /** 撮り始め・再開。今の画面を 1 枚撮って頭のコマにする（変わらない画面ではコマが来ないため） */
  async resume() {
    const shot = await this.page.screenshot({ type: "jpeg", quality: 88 });
    const t = this.now();
    this.frames.push({ t, data: Buffer.from(shot) });
    this.segments.push({ from: t, to: null });
    this.active = true;
  }

  pause() {
    const seg = this.segments.at(-1);
    if (seg && seg.to === null) seg.to = this.now();
    this.active = false;
  }

  /**
   * 下へ送る所はコマを自分で撮る。画面の流れ（screencast）は PC が忙しいと毎秒 2 コマまで落ち、送りがかくかくする（11/4 の撮り直しで R01 が 9 秒で 32 コマ）。
   * 1/30 秒ぶんずつ送って 1 枚ずつ撮り、撮った物に 30fps の時刻を付ける（実際にかかった時間は録画に入らない）。送り方は始めと終わりをゆるめる。
   * 起動で滑らかな送り（--disable-smooth-scrolling）を止めているので、1 回の送りはすぐ終わる
   */
  async scroll(px, seconds) {
    const page = this.page;
    const n = Math.max(1, Math.round(seconds * 30));
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const vp = page.viewport();
    await page.mouse.move(vp.width / 2, vp.height / 2);
    this.pause();
    const t0 = this.now();
    this.segments.push({ from: t0, to: t0 + n / 30 });
    let done = 0;
    for (let k = 0; k < n; k++) {
      const target = Math.round(px * ease((k + 1) / n));
      if (target !== done) await page.mouse.wheel({ deltaY: target - done });
      done = target;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const shot = await page.screenshot({ type: "jpeg", quality: 88 });
      this.frames.push({ t: t0 + k / 30, data: Buffer.from(shot) });
    }
    // 撮るのが 1/30 秒より速かったときも、次の区切りが自分で撮ったコマの後ろに来るように待つ
    const left = t0 + n / 30 + 0.05 - this.now();
    if (left > 0) await sleep(left * 1000);
    await this.resume();
  }

  /** 連番の中の今の秒を名前つきで覚える */
  mark(label) {
    const s = this.elapsed();
    this.marks.push({ label, at: Math.round(s * 10) / 10 });
    console.log(`  ${this.name} ${s.toFixed(1)} 秒 ${label}`);
  }

  elapsed() {
    let s = 0;
    for (const seg of this.segments) s += (seg.to ?? this.now()) - seg.from;
    return s;
  }

  /** 止めて連番に書く。dir の中の前の連番は消す */
  async stop(dir) {
    if (this.active) this.pause();
    if (current === this) current = null;
    await this.cdp.send("Page.stopScreencast").catch(() => undefined);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (/^\d{5}\.jpg$/.test(f) || f === "markers.json") rmSync(join(dir, f));
    const frames = this.frames.slice().sort((a, b) => a.t - b.t);
    const written = new Map(); // frames の添字 → 書いたファイル
    let n = 0;
    for (const seg of this.segments) {
      const count = Math.floor((seg.to - seg.from) * 30);
      let j = 0;
      for (let k = 0; k < count; k++) {
        const t = seg.from + k / 30;
        while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
        n++;
        const file = join(dir, `${String(n).padStart(5, "0")}.jpg`);
        const first = written.get(j);
        if (first) {
          try {
            linkSync(first, file);
          } catch {
            copyFileSync(first, file);
          }
        } else {
          writeFileSync(file, frames[j].data);
          written.set(j, file);
        }
      }
    }
    writeFileSync(join(dir, "markers.json"), JSON.stringify({ name: this.name, seconds: n / 30, marks: this.marks, taps: this.taps }, null, 2) + "\n");
    console.log(`${this.name}: ${n} 枚（${(n / 30).toFixed(1)} 秒、違うコマ ${written.size}）→ ${dir}`);
    return n;
  }
}
