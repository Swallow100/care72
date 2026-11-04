// 手元の dev の本物の画面を headless Chrome で撮る道具（T43）。scripts/record.mjs が使う。
// - 撮り方は CDP の Page.startScreencast。画面が変わったときだけコマが来るので、来たコマを時刻つきで持ち、
//   最後に 30fps の連番（00001.jpg …、video/README.md の形）に並べ直す（その時刻までの最新のコマを使う）。同じコマは hard link
// - 一時止め（pause・resume）は録画の道具の一時停止と同じ。待つだけの所（1 分ごとの読み直しを待つなど）を詰める
// - mark(名前) で連番の中の秒を覚え、markers.json に書く（timeline.ts の from に使う）
// - puppeteer-core はルートの node_modules の物（ルートで npm ci が要る）。ブラウザは手元の Chrome か Edge
// 画面を描き直さない。ページに物を足さない（押した所の印も足さない）。操作は本物のボタンを押すだけ。
import { existsSync, linkSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import puppeteer from "puppeteer-core";
import { ROOT } from "./lib.mjs";

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

/**
 * 撮る Chrome を立てる。引数なしは前のまま（マイク・音は使わない）。
 * fakeAudio（WAV の道）を渡すと偽のマイク: Chrome の偽の機器が WAV を 1 回だけ流す（%noloop。流し終えたら無音）。
 * 許可の窓は出さずに通し、音の自動再生も通す（本人のスマホの定型文・訓練の声）。PC の本物のマイクは使わない
 * （getUserMedia は偽の機器だけ。Web Speech は newPage の守りで偽のマイクへ向ける）
 */
export async function launch(opts = {}) {
  const args = ["--no-first-run", "--lang=ja-JP", "--force-color-profile=srgb", "--hide-scrollbars", `--force-device-scale-factor=${SCALE}`, "--disable-smooth-scrolling"];
  if (opts.fakeAudio) {
    if (!existsSync(opts.fakeAudio)) throw new Error(`偽のマイクの WAV が無い: ${opts.fakeAudio}`);
    args.push(
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${opts.fakeAudio.replace(/\//g, "\\")}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    );
  }
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    // ライトで撮る。保存したパスワード・拡張・履歴の無い新しいプロフィール（puppeteer の既定）
    args,
  });
  if (opts.fakeAudio) FAKE_MIC.add(browser);
  return browser;
}

/** 偽のマイクで立てた Chrome（newPage が Web Speech を偽のマイクへ向ける） */
const FAKE_MIC = new WeakSet();

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
  // アプリの Service Worker（public/sw.js）は頁の応答が 4 秒来ないと前の写しを返す。手元の next dev は遅いので、
  // 災害モードに替わったあとも家族のスマホに平時の写しが出ていた。撮るときは SW を通さない（いつもネットの頁）
  await page.setBypassServiceWorker(true);
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
  // Web Speech（話す・本人のスマホの文字起こし）が聞く音を決める（speechGuard）。画面には何も足さない
  await page.evaluateOnNewDocument(speechGuard, FAKE_MIC.has(browser));
  return page;
}

/**
 * ページの Web Speech（SpeechRecognition）が聞く音を偽のマイクに決める（ページの中で動く。ほかの変数を使わない）。
 * Chrome の Web Speech は --use-fake-device-for-media-stream を見ず、PC の本物のマイクを開く（11/5 に試して分かった。
 * 許可の窓を通す --use-fake-ui-for-media-stream と組むと、部屋の音が Google の認識に送られる）。だから:
 * - 偽のマイクで撮るとき（fake）: start() に偽のマイクの音（getUserMedia の track の clone）を渡す。getUserMedia は 1 頁に 1 回だけ開く
 *   （聞き直しのたびに WAV が頭から流れ直さないように）。開けなければ audio-capture の失敗にする
 * - 偽のマイクで撮らないとき: 本物のマイクを開かずに not-allowed の失敗にする（前の headless の Chrome と同じ結果）
 * 認識の中身（Google が文字にした物）とアプリの動きは変えない
 */
function speechGuard(fake) {
  const own = [window.SpeechRecognition, window.webkitSpeechRecognition].filter((c) => typeof c === "function");
  if (own.length === 0) return;
  let shared = null;
  const fakeTrack = () => {
    if (!shared) shared = navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getAudioTracks()[0]);
    return shared.then((t) => t.clone());
  };
  const pending = new WeakMap();
  const later = (fn) => setTimeout(fn, 0);
  const fail = (r, error) =>
    later(() => {
      const E = window.SpeechRecognitionErrorEvent;
      r.dispatchEvent(E ? new E("error", { error }) : Object.assign(new Event("error"), { error }));
      r.dispatchEvent(new Event("end"));
    });
  for (const proto of new Set(own.map((c) => c.prototype))) {
    const start = proto.start;
    const stop = proto.stop;
    const abort = proto.abort;
    proto.start = function (track) {
      if (track) return start.call(this, track);
      const token = {};
      pending.set(this, token);
      if (!fake) {
        later(() => {
          if (pending.get(this) !== token) return;
          pending.delete(this);
          fail(this, "not-allowed");
        });
        return;
      }
      fakeTrack().then(
        (t) => {
          if (pending.get(this) !== token) return t.stop();
          pending.delete(this);
          try {
            start.call(this, t);
          } catch {
            t.stop();
            fail(this, "aborted");
          }
        },
        () => {
          if (pending.get(this) !== token) return;
          pending.delete(this);
          fail(this, "audio-capture");
        },
      );
    };
    const cancel = (orig) =>
      function () {
        if (pending.has(this)) {
          pending.delete(this);
          later(() => this.dispatchEvent(new Event("end")));
          return;
        }
        return orig.call(this);
      };
    proto.stop = cancel(stop);
    proto.abort = cancel(abort);
  }
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
  if (!el) {
    // 何が出ていたかを残す（画面の写しと、押せる物の文字）。out/look/ は commit しない
    const shot = join(ROOT, "out", "look", `missing-${Date.now()}.png`);
    mkdirSync(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot }).catch(() => undefined);
    const seen = await page.evaluate(() => Array.from(document.querySelectorAll("button, a, [role=button]")).map((e) => (e.textContent ?? "").replace(/\s+/g, "")).filter(Boolean).slice(0, 30));
    throw new Error(`押す所が無い: ${text}（${page.url()}、押せる物: ${seen.join("・")}、写し ${shot}）`);
  }
  await el.scrollIntoView();
  // 撮っている録画があれば、押した所（要素の真ん中）を覚える。編集で押した所に輪を出す（src/parts/Frame.tsx）
  const box = await el.boundingBox();
  if (box && current?.active) current.tap(box.x + box.width / 2, box.y + box.height / 2);
  await el.click();
  return el;
}

/** いま撮っている録画（clickText が押した所を渡す先） */
let current = null;

/**
 * セレクタで要素を探して押す（clickText と同じく、撮っている録画に押した所を覚える）。見つからなければ止める。
 * 2 つの窓を同時に撮るときは rec にその窓の録画を渡す（無ければ最後に撮り始めた録画で、窓が同じときだけ覚える）
 */
export async function clickSel(page, selector, { timeout = 15_000, rec = null } = {}) {
  const el = await page.waitForSelector(selector, { visible: true, timeout }).catch(() => null);
  if (!el) {
    const shot = join(ROOT, "out", "look", `missing-${Date.now()}.png`);
    mkdirSync(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot }).catch(() => undefined);
    throw new Error(`押す所が無い: ${selector}（${page.url()}、写し ${shot}）`);
  }
  await el.scrollIntoView();
  const box = await el.boundingBox();
  const r = rec ?? current;
  if (box && r?.active && r.page === page) r.tap(box.x + box.width / 2, box.y + box.height / 2);
  await el.click();
  return el;
}

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

// ---------- Claude と声の場面（scripts/record.mjs の ai-*）で使う物 ----------

/** WAV の fmt と data を読む */
function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = b.subarray(p + 8, p + 8 + size);
    if (id === "data") data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`WAV が読めない: ${file}`);
  return { fmt, data, rate: fmt.readUInt32LE(4), block: fmt.readUInt16LE(12) };
}

/**
 * 偽のマイクに流す声（WAV）を作る。Windows の読み上げ（scripts/tts-placeholder.ps1 と同じ Microsoft Haruka、48kHz・16bit・mono）で
 * 文を 1 つずつ読み、頭に before 秒、文の間に gap 秒、後ろに after 秒の無音を足す。架空の文だけを渡す（実在の人の声は使わない）。
 * 文は環境変数で PowerShell に渡す（引数の引用で字が崩れないように）。作った秒（無音を除く）を返す
 */
export function makeVoice(lines, out, { before = 1, gap = 0.7, after = 40 } = {}) {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    '$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Name -eq "Microsoft Haruka Desktop" } | Select-Object -First 1',
    'if (-not $v) { $v = $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Culture.Name -eq "ja-JP" } | Select-Object -First 1 }',
    'if (-not $v) { throw "ja-JP の読み上げの声が無い" }',
    "$s.SelectVoice($v.Name)",
    "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
    "$s.SetOutputToWaveFile($env:CARE72_SAY_OUT, $f)",
    "$s.Speak($env:CARE72_SAY)",
    "$s.SetOutputToNull()",
    "$s.Dispose()",
  ].join("; ");
  mkdirSync(dirname(out), { recursive: true });
  const parts = [];
  let fmt = null;
  let rate = 48000;
  let block = 2;
  let spoken = 0;
  for (const [i, text] of lines.entries()) {
    const tmp = `${out}.${i}.tmp.wav`;
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      env: { ...process.env, CARE72_SAY: text, CARE72_SAY_OUT: tmp },
      stdio: ["ignore", "ignore", "inherit"],
    });
    const w = readWav(tmp);
    rmSync(tmp);
    ({ fmt, rate, block } = w);
    parts.push(w.data);
    spoken += w.data.length / (rate * block);
  }
  const silence = (s) => Buffer.alloc(Math.round(s * rate) * block);
  const body = Buffer.concat([silence(before), ...parts.flatMap((d, i) => (i === 0 ? [d] : [silence(gap), d])), silence(after)]);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + body.length, 4);
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16);
  fmt.copy(head, 20, 0, 16);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(body.length, 40);
  writeFileSync(out, Buffer.concat([head, body]));
  return spoken;
}

/**
 * 撮れた連番の一部（from 秒〜to 秒）を別の録画のフォルダに写す（hard link。番号は 00001 から振り直す）。
 * 同じ 1 本の録画から、着信の所（R08）のように別の番号の素材を切り出すため。印（marks・taps）は範囲の物だけを頭からの秒に直して持つ
 */
export function cut(srcDir, from, to, dstDir, name) {
  const frames = readdirSync(srcDir).filter((f) => /^\d{5}\.jpg$/.test(f)).sort();
  const a = Math.max(0, Math.floor(from * 30));
  const b = Math.min(frames.length, Math.ceil(to * 30));
  mkdirSync(dstDir, { recursive: true });
  for (const f of readdirSync(dstDir)) if (/^\d{5}\.jpg$/.test(f) || f === "markers.json") rmSync(join(dstDir, f));
  for (let i = a; i < b; i++) {
    const file = join(dstDir, `${String(i - a + 1).padStart(5, "0")}.jpg`);
    try {
      linkSync(join(srcDir, frames[i]), file);
    } catch {
      copyFileSync(join(srcDir, frames[i]), file);
    }
  }
  const src = JSON.parse(readFileSync(join(srcDir, "markers.json"), "utf8"));
  const start = a / 30;
  const inside = (x) => x.at >= start && x.at <= b / 30;
  const shift = (x) => ({ ...x, at: Math.round((x.at - start) * 100) / 100 });
  const marks = (src.marks ?? []).filter(inside).map(shift);
  const taps = (src.taps ?? []).filter(inside).map(shift);
  writeFileSync(
    join(dstDir, "markers.json"),
    JSON.stringify({ name, seconds: (b - a) / 30, from: { take: basename(srcDir), at: Math.round(start * 100) / 100 }, marks, taps }, null, 2) + "\n",
  );
  console.log(`${name}: ${b - a} 枚（${((b - a) / 30).toFixed(1)} 秒、${basename(srcDir)} の ${start.toFixed(1)} 秒から）→ ${dstDir}`);
}

/**
 * 頁が取り寄せたアプリの声（Gemini TTS の WAV）の道を覚え、あとで同じ頁から取り寄せ直して保存する。
 * 録画（screencast）に音は入らないので、編集で音の線に置くため。取り寄せ直すのは最初に 200 で返った道だけ
 * （声はサーバーが R2 に置いてあるので、2 度目は Gemini を呼ばない）。返すのは保存したファイルと道（id は手元の架空のデータの物）
 */
export function collectVoices(page, pattern) {
  const seen = new Set(); // 200 で返った道（返った順）
  page.on("response", (r) => {
    const u = r.url();
    if (pattern.test(u) && r.status() === 200) seen.add(u);
  });
  return {
    get count() {
      return seen.size;
    },
    async save(dir, prefix = "voice") {
      mkdirSync(dir, { recursive: true });
      const out = [];
      let i = 0;
      for (const u of seen) {
        i++;
        const b64 = await page
          .evaluate(async (url) => {
            const r = await fetch(url, { credentials: "same-origin" });
            if (!r.ok) return null;
            const buf = new Uint8Array(await r.arrayBuffer());
            let s = "";
            for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
            return btoa(s);
          }, u)
          .catch(() => null);
        if (!b64) continue;
        const file = `${prefix}-${i}.wav`;
        writeFileSync(join(dir, file), Buffer.from(b64, "base64"));
        const url = new URL(u);
        out.push({ file, path: url.pathname + url.search });
      }
      return out;
    },
  };
}
