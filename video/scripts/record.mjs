// 手元の dev の本物の画面を撮る（T43）。撮れた連番は video/assets/rec/<番号>-<回>/ に置く（commit しない）。
// 鍵の要らない所だけ撮る。Claude を呼ぶ所（入れる欄・様式の読み取り・訓練・録音の分類・着信の声）は撮らない（作者が本番で撮る）。
//
// 使い方（video/ の中で。dev は別に立てておく）:
//   CLOUDFLARE_INCLUDE_PROCESS_ENV=true JUDGE_PASSWORD=<捨てる値> CAREMANAGER_DEMO_PASSWORD=<捨てる値> npx next dev -p 3073   （ルートで）
//   CARE72_CM_PASSWORD=<同じ値> CARE72_JUDGE_PASSWORD=<同じ値> node scripts/record.mjs <場面> [回]
//   場面: prep（最初に戻す → 平時に戻す。撮らない）、calm（R01・R02・R03・R04・R05、平時）、disaster（R10・R11・R12・R13、平時 → 大雨）
//   回は録画のフォルダの番号（既定 1）。撮ったら npm run scan
// パスワードは環境変数で受けるだけで、ファイル・記録に書かない。ログインの画面は撮らない（撮り始める前に済ませる）。
// Git Bash で道（/ で始まる引数）を渡すときは MSYS_NO_PATHCONV=1。
//
// Claude と声の場面（11/5。手元の dev に作者の鍵を入れて撮る。本番には入らない。ファイルの下の「Claude と声の場面」）:
//   ai-intake（R02 入れる欄: 話す → Sonnet が欄に分ける → 保存 → 問い返し）、ai-form（R06 様式の読み取り: 架空の様式の画像 → Opus → 対応表 → 差込）、
//   ai-drill（R07 訓練の大雨想定〔連続の時計〕・R08 着信〔R07 から切り出す〕・R09 採点と講評）、ai-finish（いちばん新しい訓練を終わりまで進めて R09 だけ）、
//   ai-voice（R12 本人のスマホ: 赤 → けが → 動けない → 定型文 → 録音、
//   R10-voice ケアマネの一覧: 文字起こしと分類。R10-voice は scan が拾わない名前）。
//   声は偽のマイク（Windows の読み上げの架空の文）。ログインは山本だけで、本人のスマホはスマホ入口のリンクで入る。
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { Recorder, clickSel, clickText, collectVoices, cut, launch, login, makeVoice, newPage, open, PC, PHONE, settle, sleep } from "./record-lib.mjs";

const base = process.env.CARE72_BASE ?? "http://localhost:3073";
const cmPw = process.env.CARE72_CM_PASSWORD;
const judgePw = process.env.CARE72_JUDGE_PASSWORD;
const [scene, take = "1"] = process.argv.slice(2);
// 置き場は既定で assets/rec。CARE72_REC_DIR を渡すとそこへ（鍵の無い試し撮りを scan に拾わせないため。scan は一番大きい回を使う）
// 災害の種類（11/6 から作者の望みで地震。CARE72_KIND=heavy_rain で前の大雨）。事業所のボタンの名前と、訓練の想定の印
const KIND = process.env.CARE72_KIND === "heavy_rain" ? "heavy_rain" : "earthquake";
const KIND_LABEL = KIND === "heavy_rain" ? "大雨" : "地震";
const recDir = (id) => join(process.env.CARE72_REC_DIR ?? join(ROOT, "assets", "rec"), `${id}-${take}`);

if (!cmPw || !judgePw || !scene) {
  console.error("使い方: CARE72_CM_PASSWORD=… CARE72_JUDGE_PASSWORD=… node scripts/record.mjs <prep|calm|disaster> [回]");
  process.exit(2);
}

/** フォームを送る（form の action と、中にある欄 need で探す）。送ったあとの頁の読み込みを待つ */
async function submitForm(page, action, need = "*") {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }),
    page.evaluate(
      (a, n) => {
        const form = Array.from(document.querySelectorAll("form")).find((x) => x.getAttribute("action") === a && x.querySelector(n));
        if (!form) throw new Error(`フォームが無い: ${a} ${n}`);
        form.requestSubmit();
      },
      action,
      need,
    ),
  ]);
  await settle(page);
}

/** 最初に戻す → 災害モードなら平時に戻す（撮らない） */
async function prep(cm) {
  await open(cm, base, "/office?reset=confirm");
  await submitForm(cm, "/office/reset", '[name="confirm"]');
  // T153 から種は平時で始まる。前の種（大雨の最中）の配信でも同じに撮れるよう、災害モードのときだけ平時に戻す
  await open(cm, base, "/office?confirm=normal");
  const normal = await cm.evaluate(() => !!Array.from(document.querySelectorAll("form")).find((x) => x.getAttribute("action") === "/office/mode" && x.querySelector('[name="confirm"]')));
  // 大雨・地震のボタンも同じ action のフォームなので、確認の欄（confirm と kind=normal）の物を送る
  if (normal) await submitForm(cm, "/office/mode", '[name="confirm"]');
  console.log(normal ? "最初に戻し、平時にした" : "最初に戻した（種が平時）");
}

/** 平時: 担当一覧・本人のページ・3 つの紙面 */
async function calm(browser) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");

  // R01 担当一覧の平時。ゆっくり下へ
  await open(cm, base, "/");
  let r = new Recorder(cm, "R01");
  await r.start();
  await sleep(2500);
  r.mark("下へ");
  await r.scroll(900, 9);
  await sleep(2000);
  await r.stop(recDir("R01"));

  // R02 本人のページの上の段（山田 ハナ）。入れる欄は Claude が要るので撮らない
  await open(cm, base, "/?open=p-01");
  r = new Recorder(cm, "R02");
  await r.start();
  await sleep(7000);
  await r.stop(recDir("R02"));

  // R03〜R05 紙面（画面のまま。?print=1 は印刷の窓が出るので使わない）
  for (const [id, path, px] of [
    ["R03", "/people/p-01/forms/matsuyama", 2600],
    ["R04", "/people/p-01/forms/own", 1600],
    ["R05", "/people/p-01/forms/medical", 700], // 紙面の下の端まで（右の原本の列は長いので、送りすぎると左が空く）
  ]) {
    await open(cm, base, path);
    r = new Recorder(cm, id);
    await r.start();
    await sleep(2500);
    r.mark("下へ");
    await r.scroll(px, 14);
    await sleep(2500);
    await r.stop(recDir(id));
  }
}

/** R15 本人のページ（山田 ハナ）を上から下まで送る。N11「話した内容は、アプリの中に記録されていきます」（作者の頼み 11/6）。平時に戻してから撮る */
async function page(browser) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");
  await prep(cm);
  await open(cm, base, "/?open=p-01");
  await settle(cm);
  // 送れる長さ。頁そのものか、いちばん長く送れる中の枠
  const h = await cm.evaluate(() => {
    let best = document.documentElement.scrollHeight - innerHeight;
    for (const el of document.querySelectorAll("*")) {
      const st = getComputedStyle(el);
      if (!/(auto|scroll)/.test(st.overflowY)) continue;
      best = Math.max(best, el.scrollHeight - el.clientHeight);
    }
    // 経過の欄（前の撮影の安否の記録が残る）は計画の場面に合わないので、その見出しが下の端から出る手前で止める
    const log = Array.from(document.querySelectorAll("h2, h3")).find((e) => e.textContent?.trim() === "経過");
    if (log) best = Math.min(best, Math.round(log.getBoundingClientRect().top - innerHeight - 8));
    return best;
  });
  console.log(`送る長さ ${h}px`);
  const r = new Recorder(cm, "R15");
  await r.start();
  await sleep(1500);
  r.mark("下へ");
  await r.scroll(h, 5);
  await sleep(1500);
  await r.stop(recDir("R15"));
}

/**
 * 赤が一覧に効くのは読み直し（AppHeader の AutoRefresh）。AutoRefresh は 1 分ごとと、画面が見えるようになった時に読み直す。
 * 1 分ごとの方は、撮る道具がほかの窓を撮っている間（隠れた扱い）に来るととぶので待てない（11/4 の撮り直しで 60 秒撮りっぱなしになった）。
 * 見えるようになった時の道（visibilitychange）で今すぐ読み直させる。読み直す中身はアプリのまま（サーバーで今の時刻から当て直す）
 */
async function waitRefresh(page, rec, label) {
  await rec.resume();
  rec.mark(`${label} 読み直しの前`);
  await sleep(1500);
  const seen = refreshes(page);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const until = Date.now() + 30_000;
  while (Date.now() < until && refreshes(page) === seen) await sleep(200);
  if (refreshes(page) === seen) console.log(`  ${label}: 読み直しが来ない`);
  await sleep(600);
  rec.mark(`${label} 読み直し`);
  await sleep(4500);
}

/** 頁ごとの読み直しの数（RSC の要求が終わった数） */
const refreshCount = new WeakMap();
function watchRefresh(page) {
  refreshCount.set(page, 0);
  page.on("requestfinished", (req) => {
    // 先読み（Link の prefetch）は数えない
    if (req.headers()["next-router-prefetch"]) return;
    if (req.headers()["rsc"] === "1" || req.url().includes("_rsc=")) refreshCount.set(page, (refreshCount.get(page) ?? 0) + 1);
  });
  page.on("close", () => console.log("  頁が閉じた"));
  page.on("error", (e) => console.log(`  頁が落ちた: ${e.message}`));
}
function refreshes(page) {
  return refreshCount.get(page) ?? 0;
}


/**
 * R16 QR の画面（山田 ハナ）。N25「QR コードなどを用いて」。手元の dev の QR は localhost を指すので、読んでも開けない（作者の頼み 11/7）。
 * 無ければ作る（手元の D1 だけ）
 */
async function qrScene(browser) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");
  await open(cm, base, "/people/p-01/forms/qr");
  if ((await cm.$eval("[data-qr-status]", (e) => e.getAttribute("data-qr-status")).catch(() => null)) !== "active") {
    await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), cm.click('form[action*="/qr"] button[type="submit"]')]);
    await open(cm, base, "/people/p-01/forms/qr");
  }
  const target = await cm.$eval("a[href*='/q/']", (e) => e.getAttribute("href")).catch(() => "");
  console.log(`  QR の行き先の host: ${target ? new URL(target, base).host : "不明"}`);
  const r = new Recorder(cm, "R16");
  await r.start();
  await sleep(6000);
  await r.stop(recDir("R16"));
}

/**
 * R17 訓練の経過の欄を下へ送る。N17「72 時間のシミュレーション訓練の間に」（作者の頼み 11/7）。手元の D1 に残っている一番新しい訓練を開くだけで、AI は呼ばない。
 * 「最初に戻す」で訓練が消えるので、disaster や ai-voice より先に撮る
 */
async function logScene(browser) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");
  await open(cm, base, "/drill");
  const id = await cm.$eval("tr[data-drill]", (e) => e.getAttribute("data-drill")).catch(() => null);
  if (!id) throw new Error("手元に訓練の記録が無い");
  await open(cm, base, `/drill/${id}`);
  const r = new Recorder(cm, "R17");
  await r.start();
  await sleep(1500);
  const tabs = await cm.$$("[data-pane-tab]");
  let tab = null;
  for (const t of tabs) if ((await t.evaluate((e) => e.textContent ?? "")).includes("経過")) tab = t;
  if (tab) {
    r.mark("経過のタブ");
    await tab.click();
    await sleep(1500);
  } else console.log("  経過のタブが無い（広い画面で並んでいる形）");
  await scrollToSel(r, cm, "[data-log]", 1.5, 70);
  await sleep(800);
  r.mark("下へ");
  const h = await cm.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
  console.log(`  送れる長さ ${h}px`);
  await r.scroll(Math.min(h, 3600), 10);
  await sleep(1000);
  await r.stop(recDir("R17"));
}

/** 発災時: 平時 → 大雨。ケアマネ（R10）・家族のスマホ（R11）・本人のスマホ（R12）を同時に、続いて医療班の受入（R13） */
async function disaster(browser) {
  const cm = await newPage(browser, PC);
  const fam = await newPage(browser, PHONE);
  const self = await newPage(browser, PHONE);
  await login(cm, base, "judge", judgePw, "care_manager");
  watchRefresh(cm);
  // スマホには最初に戻したあとに入る（戻す前の状態を撮らないため）。家族のスマホが平時のまま映った件の元は Service Worker の写し（record-lib.mjs の newPage）
  await prep(cm);
  await login(fam, base, "judge", judgePw, "family");
  await login(self, base, "judge", judgePw, "self");
  await open(fam, base, "/family");
  await open(self, base, "/me");

  const r10 = new Recorder(cm, "R10");
  const r11 = new Recorder(fam, "R11");
  const r12 = new Recorder(self, "R12");
  await r11.start();
  await r12.start();
  await sleep(2000);
  r11.pause();
  r12.pause();

  // ケアマネ: 事業所の画面で大雨に切り替え、警戒レベル 4・停電 地区 かわなぎ町
  await open(cm, base, "/office");
  await r10.start();
  await sleep(2000);
  r10.mark(`${KIND_LABEL}を押す`);
  await clickText(cm, KIND_LABEL, { exact: true, within: "main" });
  // 平時から災害モードへは確認の窓が出る（T79）。窓を映してから「切替」を押す
  await cm.waitForSelector('dialog[open] [data-dialog-action="ok"]', { visible: true, timeout: 15_000 });
  r10.mark("確認の窓");
  await sleep(1800);
  await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), clickText(cm, "切替", { exact: true, within: "dialog[open]" })]);
  await settle(cm);
  await sleep(1500);
  r10.mark("災害情報");
  await cm.evaluate(() => {
    const pick = (sel) => document.querySelector(sel)?.click();
    pick('input[name="level"][value="4"]');
    pick('input[name="outage"][value="area"]');
    const town = Array.from(document.querySelectorAll('input[name="town"]')).find((x) => x.value === "かわなぎ町");
    if (town && !town.checked) town.click();
    // 停電開始は地区のときに要る。今の時刻（手元の時計）を入れる
    const at = document.querySelector('input[name="outage_at"]');
    if (at) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      at.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  });
  await sleep(1500);
  // 事業所の画面には「保存」が 2 つある（上の地域の欄と、災害情報の欄）。災害情報の欄の物を押す
  await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), clickText(cm, "保存", { exact: true, within: 'form[action="/office/info"]' })]);
  await settle(cm);
  await sleep(1500);
  r10.mark("担当一覧へ");
  await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), clickText(cm, "担当一覧", { exact: true, within: "header" })]);
  await settle(cm);
  r10.mark("発災時の表");
  await sleep(5000);
  r10.pause();

  // 家族のスマホ: 開き直すと災害モードの画面（平時の画面は 30 秒ごとに見に行く。待つ所は撮らない）
  await open(fam, base, "/family");
  await r11.resume();
  r11.mark("無事ですか");
  await sleep(3000);
  r11.mark("赤");
  await clickText(fam, "無事じゃない");
  await sleep(4000);
  r11.mark("送った");
  await sleep(2000);
  r11.pause();

  // ケアマネ: 1 分ごとの読み直しで山田の行が至急に
  await waitRefresh(cm, r10, "家族の赤");
  r10.pause();

  // 本人のスマホ: 赤 → 1 画面 1 問（押すたびに送る）。けが ある のあとは「動けますか」だけを聞いて、定型文と録音へ進む（lib/signals/phone.ts、T69b）。
  // 手元の Chrome にはマイクが無いので録音には入らず、次の問いへ進む。動けない まで答えて止める
  await open(self, base, "/me");
  await r12.resume();
  r12.mark("赤と緑");
  await sleep(3000);
  r12.mark("赤");
  await clickText(self, "無事じゃない");
  await sleep(2500);
  for (const [label, answer] of [
    ["けが", "ある"],
    ["動けますか", "動けない"],
  ]) {
    r12.mark(`${label} ${answer}`);
    await clickText(self, answer, { exact: true });
    await sleep(2200);
  }
  await sleep(3000);
  r12.mark("送った");
  await sleep(2000);
  await r12.stop(recDir("R12"));

  // ケアマネ: 読み直しで理由が本人の答えに。行の詳細を開く → 電話の記録（不通）→ 優先変更の欄
  await waitRefresh(cm, r10, "本人の赤");
  r10.mark("行の詳細を開く");
  // 行の左の開くボタン（名前を押すと右に本人のページが開くので、行の詳細はこちら）
  await cm.click('tr[data-row="p-01"] button[aria-expanded]');
  await sleep(3500);
  r10.mark("詳細を下へ");
  await r10.scroll(400, 4);
  await sleep(2000);
  await cm.screenshot({ path: join(ROOT, "out", "look", "R10-detail.png") }).catch(() => undefined);
  try {
    r10.mark("不通");
    await clickText(cm, "不通", { within: 'tr[data-detail="p-01"]' });
    await sleep(3500);
    // 優先変更は詳細の右の欄（押すボタンではない）。映して止める
    r10.mark("優先変更");
    await sleep(4000);
  } catch (e) {
    console.log(`  行の詳細の操作で止まった: ${e.message}`);
  }
  await r10.stop(recDir("R10"));
  await r11.stop(recDir("R11"));

  await staff(browser);
}

/** 医療班: 受け持ちの画面で避難所を入れ、山田を検索して受入 → 受け持ちの表の行から医療要約（R13）。disaster のあとに続けて撮る */
async function staff(browser) {
  const med = await newPage(browser, PC);
  await login(med, base, "judge", judgePw, "medical");
  await open(med, base, "/staff");
  const r13 = new Recorder(med, "R13");
  await r13.start();
  await sleep(2000);
  r13.mark("避難所");
  await med.type('[data-field="shelter"]', "福音小学校", { delay: 90 });
  await sleep(800);
  r13.mark("検索");
  if (!(await med.$('form[data-form="search"]'))) {
    await clickText(med, "検索", { within: "[data-intake]" });
    await med.waitForSelector('form[data-form="search"]', { timeout: 10_000 });
    await sleep(500);
  }
  await med.type('form[data-form="search"] input[type="search"]', "ヤマダ ハナ", { delay: 90 });
  await med.evaluate(() => {
    const el = document.querySelector('form[data-form="search"] input[type="date"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "1942-04-18");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(1000);
  await clickText(med, "検索", { exact: true, within: 'form[data-form="search"]' });
  await sleep(3000);
  r13.mark("受入");
  await med.click('tr[data-hit="p-01"] button');
  await sleep(3500);
  await settle(med);
  r13.mark("受入のあと");
  await sleep(2500);
  // 受入のすぐあとに医療要約を開く（docs/DECISIONS.md「動画」。N25 の「要約が届きます」の間に書類が映るように）。
  // 受け持ちの表に入った山田の行の、氏名の横の「医療要約」（StaffTable の data-summary）
  r13.mark("医療要約");
  await Promise.all([med.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), med.click('tr[data-person="p-01"] a[data-summary]')]);
  await settle(med);
  await sleep(3500);
  r13.mark("下へ");
  await r13.scroll(900, 7);
  await sleep(2000);
  await r13.stop(recDir("R13"));
}

// ---------- Claude と声の場面（11/5） ----------
// 作者の鍵（.dev.vars の ANTHROPIC_API_KEY・GEMINI_API_KEY）を入れた手元の dev で撮る。鍵が無ければ AI の手前まで撮って止める（鍵待ち）。
// 1 場面 1 回の成功が目標（訓練は大雨想定。10 分版はアプリから外した〔T124〕。Claude と声を合わせて 150 回ほど）。AI の言葉は毎回違うので、撮ったら sheet.mjs で
// 「診断」「判定」「重症」・実名が無いかを見る。待つだけの所（AI が考える間）は録画を一時止めにして詰め、止めた所は markers.json の印で分かる

/** 偽のマイクの声と、様式の読み取りに上げる画像の置き場（commit しない。video/assets は .gitignore） */
const inputDir = join(ROOT, "assets", "rec-input");
/**
 * 入れる欄で話す文（山田の未確認の 3 つ: ワーファリンの残り・夜の支援者・避難先 2。docs/video/SHOOTING.md の例から。実在の人・場所は言わない）。
 * 例の「車で来られます」は Web Speech が「来るまで来られます」と聞き違えた（11/5 の試し）ので「来てくれます」に
 */
/** 問いへの答え（架空の人の架空の答え）。上から順に、文か数で答える問いに入れる */
const INTAKE_ANSWERS = ["1 回 1 錠", "娘さんの車で行きます", "2 階の箪笥に保管しています", "かかりつけは市民病院です"];
const INTAKE_LINES = ["ワーファリンはあと10日分あります。", "夜は娘さんが来てくれます。", "2つ目の避難先は娘さんの家です。"];
/** 本人のスマホの録音に入る声（架空の文。実在の人の声は使わない） */
const VOICE_LINES = ["足が痛くて動けない"];

/**
 * 偽のマイクの WAV を作る（毎回作り直す。文を変えても古い声を使わない）。before は話し始めの前の無音の秒。
 * WAV は偽のマイクが開いた時から流れるので、聞き取りが始まる前に声が来ると頭が欠ける（11/5 の R02-4 で「ワーファリンは…」が「和風あります」に）
 */
function micFile(name, lines, after, before = 1) {
  const out = join(inputDir, `mic-${name}.wav`);
  const spoken = makeVoice(lines, out, { before, gap: 0.9, after });
  console.log(`偽のマイクの声 ${name}: ${spoken.toFixed(1)} 秒（前に ${before} 秒、後ろに ${after} 秒の無音）`);
  return out;
}

/**
 * 最初に戻す → 平時に戻す（prep と同じ操作）。次の 2 つでやり直す（最初に戻すを 2 回押しても同じ状態になる）:
 * - 立てたばかりの next dev は頁を組みながら読み直すことがあり、途中で頁が切り替わると止まる
 * - アプリが最初に戻せなかった（/office?reset=failed。11/5 は長く回した dev で「最初に戻せない TypeError」が出て、気づかずに先へ進んだ）
 */
async function prepSafe(cm) {
  for (let i = 1; i <= 3; i++) {
    try {
      await open(cm, base, "/office?reset=confirm");
      await submitForm(cm, "/office/reset", '[name="confirm"]');
      if (/[?&]reset=failed/.test(cm.url())) throw new Error("アプリが最初に戻せない（reset=failed）");
      // T153 から種は平時で始まる。災害モードのときだけ平時に戻す
      await open(cm, base, "/office?confirm=normal");
      const normal = await cm.evaluate(() => !!Array.from(document.querySelectorAll("form")).find((x) => x.getAttribute("action") === "/office/mode" && x.querySelector('[name="confirm"]')));
      if (normal) await submitForm(cm, "/office/mode", '[name="confirm"]');
      console.log(normal ? "最初に戻し、平時にした" : "最初に戻した（種が平時）");
      return;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (i === 3 || !/Execution context was destroyed|detached|Navigating frame|navigation|reset=failed/i.test(msg)) throw e;
      console.log(`  最初に戻すをやり直す（${i} 回目。${msg.slice(0, 80)}）`);
      await sleep(5000);
    }
  }
  throw new Error("最初に戻せない");
}

/** 通信が落ち着くまで少しだけ待つ（訓練の頁は通信が絶えないことがあり、settle の 30 秒を撮ってしまうため。上限 4 秒） */
async function settleShort(page) {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 4000 }).catch(() => undefined);
}

/** 画面にも字幕にも出さない言葉（CLAUDE.md の「守ること」）。AI の言葉に出たら、その回は使わない */
const BANNED = "診断|判定|重症|病気がわかる";

/** 今の画面の文字に使わない言葉が無いかを見て、あれば前後の字と一緒に hits に足す（撮った物を使うかを決めるため。words.json に書く） */
async function checkWords(page, where, hits) {
  const found = await page
    .evaluate((src) => {
      const re = new RegExp(src, "g");
      const t = document.body?.innerText ?? "";
      const out = [];
      for (let m = re.exec(t); m; m = re.exec(t)) out.push(t.slice(Math.max(0, m.index - 24), m.index + 24).replace(/\s+/g, " "));
      return out;
    }, BANNED)
    .catch(() => []);
  for (const text of found) hits.push({ where, text });
  if (found.length > 0) console.log(`  使わない言葉（${where}）: ${found.join(" ／ ")}`);
}

/** 使わない言葉の結果を録画のフォルダに書く（無ければ空の一覧） */
function writeWords(dir, hits) {
  writeFileSync(join(dir, "words.json"), JSON.stringify({ banned: BANNED, hits }, null, 2) + "\n");
  console.log(`  使わない言葉: ${hits.length === 0 ? "なし" : `${hits.length} か所（words.json）`}`);
}

/** 手元の dev に鍵が見えているか（/api/health。値は返らない、有る・無いだけ） */
async function aiKeys(page) {
  const ai = await page
    .evaluate(async () => {
      const r = await fetch("/api/health", { cache: "no-store" });
      return (await r.json()).ai ?? null;
    })
    .catch(() => null);
  console.log(`鍵: Anthropic ${ai?.anthropic ? "有り" : "無し"}・Gemini ${ai?.gemini ? "有り" : "無し"}`);
  return { anthropic: ai?.anthropic === true, gemini: ai?.gemini === true };
}

/**
 * 頁の中の条件 fn が真になるまで待つ。keep 秒だけ撮り、まだなら録画を一時止めにして待ち（AI が考えている間を詰める）、真になったら撮り直す。
 * 真になったら true、timeout まで来なければ false（撮り直してから返す）
 */
async function waitCut(rec, page, fn, { keep = 3, timeout = 180_000, label = "待ち", arg } = {}) {
  const waiting = page.waitForFunction(fn, { timeout, polling: 250 }, arg).then(
    () => true,
    () => false,
  );
  const early = await Promise.race([waiting, sleep(keep * 1000).then(() => null)]);
  if (early !== null) return early;
  const t0 = Date.now();
  const wasActive = rec.active;
  if (wasActive) {
    rec.mark(`${label} 一時止め`);
    rec.pause();
  }
  const ok = await waiting;
  console.log(`  ${rec.name} ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} 秒 詰めた${ok ? "" : "（来ない）"}`);
  if (wasActive) {
    await settle(page);
    await rec.resume();
    rec.mark(`${label} 再開`);
  }
  return ok;
}

/** 要素の上の端が画面の上から offset px に来るまで、ゆっくり送る（撮っている間だけ呼ぶ） */
async function scrollToSel(rec, page, selector, seconds = 1.5, offset = 90) {
  const dy = await page
    .evaluate((s, off) => {
      const el = document.querySelector(s);
      return el ? Math.round(el.getBoundingClientRect().top - off) : 0;
    }, selector, offset)
    .catch(() => 0);
  if (Math.abs(dy) > 8) await rec.scroll(dy, seconds);
}

/** 文字の欄の中身が min 字を超えて quiet ミリ秒変わらなくなるまで待つ（話した文が流れ終わるまで） */
async function waitTyped(page, selector, { min = 10, quiet = 2500, timeout = 45_000 } = {}) {
  const until = Date.now() + timeout;
  let last = null;
  let since = Date.now();
  while (Date.now() < until) {
    const v = await page.$eval(selector, (e) => e.value).catch(() => "");
    if (v !== last) {
      last = v;
      since = Date.now();
    } else if (v.length >= min && Date.now() - since >= quiet) return v;
    await sleep(200);
  }
  return last ?? "";
}

/** R02 入れる欄（ケアマネ）。本人のページの上の段を 7 秒（R02-3 と同じ長さ）→ 話す → 停止 → 入力（Sonnet）→ 変更点 → 保存 → 問い返し */
async function aiIntake() {
  const wav = micFile("R02", INTAKE_LINES, 30, 2.5);
  const browser = await launch({ fakeAudio: wav });
  try {
    // 右の列に大きく寄るので細かく撮る（作者の頼み 11/7）
    const cm = await newPage(browser, { ...PC, deviceScaleFactor: 2.5 });
    await login(cm, base, "judge", judgePw, "care_manager");
    await prepSafe(cm);
    const keys = await aiKeys(cm);
    await open(cm, base, "/?open=p-01");
    const blocked = await cm.$('[data-intake="panel"] [data-ai-status="blocked"]');
    const r = new Recorder(cm, "R02");
    await r.start();
    await sleep(7000);
    r.mark("話す");
    await clickSel(cm, '[data-intake="speak"]');
    await cm.waitForSelector('[data-intake="listening"]', { timeout: 10_000 }).catch(() => console.log("  聞いている印が出ない"));
    const said = await waitTyped(cm, '[data-intake="text"] textarea', { min: 15, quiet: 3000, timeout: 50_000 });
    console.log(`  話した文（Web Speech）: ${said.replace(/\n/g, " / ")}`);
    r.mark("停止");
    await clickSel(cm, '[data-intake="speak"]');
    await sleep(2500);
    if (!keys.anthropic || blocked) {
      console.log("  AI が使えない（鍵待ち）。入力の前で止める");
      await r.stop(recDir("R02"));
      return;
    }
    r.mark("入力");
    // 入力のボタン（流れの中の提案の塊も data-intake="split" なので、ボタンに絞る）
    await clickSel(cm, 'button[type="submit"][data-intake="split"]');
    const got = await waitCut(
      r,
      cm,
      () => !!document.querySelector('[data-intake="changes"]') || !!document.querySelector('[data-intake="failed"], [data-intake="log"] .text-danger'),
      { keep: 3, timeout: 150_000, label: "Sonnet" },
    );
    const failed = await cm.$('[data-intake="failed"], [data-intake="log"] .text-danger');
    if (!got || failed) {
      const why = failed ? await failed.evaluate((e) => e.textContent?.trim()) : "時間切れ";
      console.log(`  入力が通らない: ${why}`);
      await sleep(2500);
      await r.stop(recDir("R02"));
      process.exitCode = 1;
      return;
    }
    r.mark("変更点");
    const hits = [];
    await checkWords(cm, "変更点", hits);
    await sleep(2500);
    await scrollToSel(r, cm, '[data-intake="changes"]', 2, 140);
    await sleep(4500);
    r.mark("保存");
    await clickText(cm, "保存", { exact: true, within: '[data-intake="changes"]' });
    await settle(cm);
    await sleep(2500);
    r.mark("問い返し");
    await checkWords(cm, "問い返し", hits);
    await scrollToSel(r, cm, '[data-intake="question"]', 1.5, 140);
    await sleep(3000);
    // 問いに答えていく（選ぶ問いは AI を呼ばない。文で答える問いは Sonnet が分けて、保存する）。やり取りが増えると下へ送れる
    for (let i = 0; i < INTAKE_ANSWERS.length; i++) {
      const box = '[data-intake="question"]';
      if (!(await cm.$(box))) break;
      r.mark(`問い ${i + 1}`);
      await checkWords(cm, `問い ${i + 1}`, hits);
      await sleep(1800);
      const choice = await cm.$(`${box} [data-choice]`);
      const area = await cm.$(`${box} textarea`);
      const line = await cm.$(`${box} form input:not([type="checkbox"]):not([type="radio"])`);
      if (choice) {
        await choice.click();
      } else if (area || line) {
        await (area ?? line).type(INTAKE_ANSWERS[i], { delay: 45 });
        await sleep(500);
        await cm.click(`${box} button[type="submit"]`);
      } else break;
      await sleep(1200);
      if (area) {
        const split = await waitCut(r, cm, () => !!document.querySelector('[data-intake="changes"]'), { keep: 2, timeout: 120_000, label: "Sonnet 答え" });
        if (split) {
          await sleep(1800);
          await clickText(cm, "保存", { exact: true, within: '[data-intake="changes"]' });
        }
      }
      await settleShort(cm);
      await sleep(1800);
      r.mark(`答え ${i + 1}`);
    }
    await sleep(1500);
    // 右の列を見せながら、下へ何度かに分けて送る
    for (let i = 0; i < 4; i++) {
      r.mark(`下へ ${i + 1}`);
      await r.scroll(260, 1.4);
      await sleep(1100);
    }
    await sleep(1000);
    await r.stop(recDir("R02"));
    writeWords(recDir("R02"), hits);
  } finally {
    await browser.close();
  }
}

/** 架空の自治体（こもれび市）の白紙の様式の 1 頁目を画像にする（lib/forms/komorebi-form.fixture.ts の HTML。実在の自治体の様式は使わない） */
async function komorebiPhoto(browser) {
  const out = join(inputDir, "こもれび市_個別避難計画.jpg");
  const { komorebiBlankHtml } = await import(pathToFileURL(join(ROOT, "..", "lib", "forms", "komorebi-form.fixture.ts")).href);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(komorebiBlankHtml(), { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const el = await page.$(".pg");
    await el.screenshot({ path: out, type: "jpeg", quality: 90 });
  } finally {
    await page.close();
  }
  return out;
}

/**
 * 黒塗りの画面（pdf.js を含む重い部品）を撮る前に 1 回開いて取消で閉じる（AI は呼ばない）。
 * 立てたばかりの next dev は初めて組むのに 1 分を超えることがあり、11/5 の 1 回目は頁の絵が 60 秒出ずに止まった
 */
async function warmRedact(cm, jpg) {
  await open(cm, base, "/forms/mapping");
  const [chooser] = await Promise.all([cm.waitForFileChooser({ timeout: 15_000 }), clickText(cm, "選択", { exact: true })]);
  await chooser.accept([jpg]);
  await sleep(1000);
  await clickText(cm, "読込", { exact: true });
  const ok = await cm
    .waitForSelector('[data-redact="page-image"]', { visible: true, timeout: 300_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    await cm.screenshot({ path: join(ROOT, "out", "look", "R06-redact.png") }).catch(() => undefined);
    throw new Error("黒塗りの画面に頁の絵が出ない（写し out/look/R06-redact.png）");
  }
  await clickSel(cm, '[data-redact="cancel"]');
  await sleep(1500);
  console.log("  黒塗りの画面を先に開いて閉じた（撮る前の組み立て）");
}

/** R06 様式の読み取り（ケアマネ）。選択 → 読取 → 黒塗りの画面 → 送信（塗り無し）→ Opus → 対応表 → 確認保存 → 差込（山田）の紙面 */
async function aiForm(browser) {
  const jpg = await komorebiPhoto(browser);
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");
  await prepSafe(cm);
  const keys = await aiKeys(cm);
  if (keys.anthropic) await warmRedact(cm, jpg);
  await open(cm, base, "/forms/mapping");
  const r = new Recorder(cm, "R06");
  await r.start();
  await sleep(2500);
  r.mark("選択");
  const [chooser] = await Promise.all([cm.waitForFileChooser({ timeout: 15_000 }), clickText(cm, "選択", { exact: true })]);
  await chooser.accept([jpg]);
  await sleep(2000);
  if (!keys.anthropic) {
    console.log("  AI が使えない（鍵待ち）。読取の前で止める");
    await r.stop(recDir("R06"));
    return;
  }
  r.mark("読取");
  await clickText(cm, "読込", { exact: true });
  await cm.waitForSelector('[data-redact="page-image"]', { visible: true, timeout: 180_000 });
  r.mark("黒塗りの画面");
  await sleep(3000);
  r.mark("送信");
  await clickSel(cm, '[data-redact="send"]');
  // 塗った所が 0 の頁は「塗り無し」の窓（appChoice。戻る・送信を選ぶ）。確認の窓（appConfirm）の OK とは作りが違う（11/5 の 2 回目はこれで止まった）
  await cm.waitForSelector('dialog[open] button[data-choice="send"]', { visible: true, timeout: 60_000 });
  r.mark("塗り無し");
  await sleep(2000);
  await clickSel(cm, 'dialog[open] button[data-choice="send"]');
  r.mark("読取中");
  const landed = await waitCut(r, cm, () => /^\/forms\/mapping\/[^/]+$/.test(location.pathname), { keep: 4, timeout: 300_000, label: "Opus" });
  if (!landed) {
    console.log("  読取が終わらない・失敗（画面の写しを out/look に）");
    await cm.screenshot({ path: join(ROOT, "out", "look", "R06-fail.png") }).catch(() => undefined);
    await sleep(2000);
    await r.stop(recDir("R06"));
    process.exitCode = 1;
    return;
  }
  await settle(cm);
  r.mark("対応表");
  const hits = [];
  await checkWords(cm, "対応表", hits);
  await sleep(3500);
  r.mark("下へ");
  const h = await cm.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await r.scroll(Math.min(h, 2400), 14);
  await sleep(2500);
  await r.scroll(-h, 3);
  await sleep(1000);
  r.mark("確認保存");
  await clickText(cm, "確認保存", { exact: true });
  const checked = await cm
    .waitForSelector('a[href^="/people/p-01/forms/mapped/"]', { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  await settle(cm);
  await sleep(2000);
  if (!checked) {
    console.log("  確認保存のあとに差込の一覧が出ない");
    await r.stop(recDir("R06"));
    process.exitCode = 1;
    return;
  }
  await scrollToSel(r, cm, 'a[href^="/people/p-01/forms/mapped/"]', 2, 300);
  await sleep(1500);
  r.mark("差込 山田");
  await clickSel(cm, 'a[href^="/people/p-01/forms/mapped/"]');
  await cm.waitForFunction(() => location.pathname.startsWith("/people/p-01/forms/mapped/"), { timeout: 120_000, polling: 250 });
  await settle(cm);
  await sleep(1500);
  r.mark("差し込んだ紙面");
  await checkWords(cm, "差し込んだ紙面", hits);
  await sleep(3000);
  r.mark("紙面を下へ");
  await r.scroll(1600, 12);
  await sleep(2500);
  await r.stop(recDir("R06"));
  writeWords(recDir("R06"), hits);
}

/** 撮らない録画（R09 だけ撮り直すときの R07 の代わり。印・一時止め・送りは何もしない） */
function quietRecorder(name) {
  return {
    name,
    active: false,
    page: null,
    mark() {},
    pause() {},
    tap() {},
    elapsed: () => 0,
    async start() {},
    async resume() {},
    async scroll() {},
    async stop() {
      return 0;
    },
  };
}

/** 訓練の画面の今の刻み（main の data-step）と状態 */
async function drillAt(page) {
  return page.evaluate(() => {
    const m = document.querySelector("main[data-drill]");
    const hour = document.querySelector("[data-now-hour]")?.getAttribute("data-now-hour");
    return { step: Number(m?.getAttribute("data-step") ?? -1), status: m?.getAttribute("data-status") ?? "", hour: hour == null ? -1 : Number(hour) };
  });
}

/**
 * 鳴っている着信に出て、声が終わるまで待って切る（来なくなるまで）。着信ごとに印（「着信 家族 娘 山田 ハナ」）と、声の道の鍵（安否の id）を返す。
 * 声（Gemini TTS）は出るを押すと流れる（components/drill/IncomingCall）。録画に音は入らない（声は collectVoices で別に保存）
 */
async function answerCalls(page, rec, calls, hits = []) {
  for (let n = 0; n < 6; n++) {
    const ringing = await page.waitForSelector('[data-incoming][data-phase="ringing"]', { visible: true, timeout: 4000 }).catch(() => null);
    if (!ringing) return;
    const info = await page.evaluate(() => {
      const el = document.querySelector('[data-incoming][data-phase="ringing"]');
      const t = (s) => el?.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return { signal: el?.getAttribute("data-incoming") ?? "", caller: t("[data-incoming-caller]"), name: t("[data-incoming-name]") };
    });
    const label = `着信 ${info.caller} ${info.name}`.trim();
    rec.mark(label);
    const call = { ...info, label, at: Math.round(rec.elapsed() * 10) / 10 };
    calls.push(call);
    await sleep(2500);
    rec.mark("出る");
    await clickSel(page, '[data-incoming-action="answer"]');
    // 声が流れて終わるまで（声が無ければ文字だけ。少し見せて切る）
    const voiced = await page.waitForSelector('[data-incoming-voice="playing"]', { timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (voiced) await page.waitForSelector('[data-incoming-voice="playing"]', { hidden: true, timeout: 60_000 }).catch(() => undefined);
    // 相手の言葉（本人役の Haiku が作る。字幕は撮れた言葉をそのまま出すので残す）
    call.speech = await page.$eval("[data-incoming-speech]", (e) => e.innerText.replace(/\s+/g, " ").trim()).catch(() => "");
    call.voiced = voiced;
    await checkWords(page, label, hits);
    await sleep(voiced ? 1500 : 5000);
    rec.mark("切る");
    call.end = Math.round(rec.elapsed() * 10) / 10;
    await clickSel(page, '[data-incoming-action="hangup"]');
    await sleep(1500);
  }
}

/** 対応の欄で手を 1 つ打つ（対象 → 手 → 要れば相手 → 実行）。結果が出るまで待つ */
async function act(page, rec, person, kind) {
  await scrollToSel(rec, page, "[data-action-panel]", 1.5, 70);
  await sleep(800);
  await clickSel(page, `[data-act-person="${person}"]`);
  await sleep(900);
  // 手の記録の行にも data-act-kind があるので、手の欄の中だけ
  await clickSel(page, `[data-action-panel] [data-act-kind="${kind}"]`);
  await sleep(900);
  // 相手の要る手で選んでいなければ、出ている最初の相手
  const disabled = await page.$eval('[data-action="act"]', (b) => b.disabled).catch(() => true);
  if (disabled && (await page.$("[data-act-target]"))) {
    await clickSel(page, "[data-act-target]");
    await sleep(700);
  }
  await clickSel(page, '[data-action="act"]');
  // 実行のボタンは打ったあと選び直すまで押せないままなので、通信が落ち着くのを待つ（手の結果と読み直し）
  await sleep(1000);
  await settleShort(page);
  await sleep(2500);
}

/**
 * 進める（1 刻み）。本人役（Haiku × 10）と監督が考える間は詰める。刻みが進んだら着信に出る。
 * 連続の時計の訓練（大雨想定。T90）は how で「次まで」（"next"）か分（180 など）のボタンを押す。先頭の「手の分」は押さない
 */
async function advance(page, rec, calls, label, hits = [], how = "next") {
  const before = await drillAt(page);
  await scrollToSel(rec, page, "main[data-drill]", 1.2, 0);
  rec.mark(label);
  const clock = await page.$('[data-controls="clock"]');
  // 分のボタン（30 分・1 時間・3 時間）は外す見込み（11/5 の作業中）。無ければ「次まで」
  const minutes = clock && how !== "next" ? await page.$(`[data-action="advance"][data-minutes="${how}"]`) : null;
  await clickSel(page, clock ? (minutes ? `[data-action="advance"][data-minutes="${how}"]` : '[data-action="advance"][data-next]') : '[data-action="advance"]');
  await waitCut(rec, page, (s) => Number(document.querySelector("main[data-drill]")?.getAttribute("data-step") ?? -1) > s || document.querySelector("main[data-drill]")?.getAttribute("data-status") !== "running", {
    keep: 3,
    timeout: 240_000,
    label: "本人役",
    arg: before.step,
  });
  await settleShort(page);
  const now = await drillAt(page);
  rec.mark(`刻み ${now.step}`);
  await checkWords(page, `刻み ${now.step}`, hits);
  await sleep(3500);
  await answerCalls(page, rec, calls, hits);
  return now;
}

/**
 * R07 訓練の大雨想定（連続の時計。10 分版は T124 でアプリから外した）・R08 着信（R07 から切り出す）・R09 採点と講評（ケアマネ）。
 * 手は docs/video/SHOOTING.md のとおり: 0 時間に小林へ訪問依頼、田中の透析調整はわざと 12 時間を過ぎてから（採点で後回しを見せるため）。
 * 12 時間までは「3 時間」で進め、残りは早送り（「次まで」を間を置いて繰り返す。72 時間で必ず終わる〔T123〕）
 */
async function aiDrill(browser, { scoreOnly = false } = {}) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");
  await prepSafe(cm);
  const keys = await aiKeys(cm);
  const voices = collectVoices(cm, /\/api\/drill\/voice\?/);
  // 講評（Opus）を作る要求の返事。訓練が終わって採点の欄が出たときに、画面が自分で 1 回だけ送る（components/drill/ReviewBox）
  let reviewAnswered = null;
  const reviewDone = new Promise((resolve) => {
    const on = (r) => {
      if (r.request().method() === "POST" && /\/api\/drill\/[^/]+\/review$/.test(new URL(r.url()).pathname)) {
        cm.off("response", on);
        reviewAnswered = r.status();
        resolve(r.status());
      }
    };
    cm.on("response", on);
  });
  await open(cm, base, "/drill");
  const calls = [];
  const hits = [];
  // R09 だけ撮り直すとき（ai-score）は、訓練は同じ手で回すが R07 は撮らない（印・一時止め・送りは何もしない）
  const r7 = scoreOnly ? quietRecorder("R07") : new Recorder(cm, "R07");
  await r7.start();
  await sleep(2500);
  r7.mark(`${KIND_LABEL}想定`);
  // 開始の画面の見込み（AI の回数）を残す（費用の上限を見るため）
  const estimate = await cm.$eval(`[data-estimate-scenario="${KIND}"][data-estimate-calls]`, (e) => e.getAttribute("data-estimate-calls")).catch(() => null);
  console.log(`  見込み（${KIND_LABEL}想定）: AI ${estimate ?? "?"} 回`);
  await clickSel(cm, `[data-scenario="${KIND}"]`);
  const opened = await waitCut(r7, cm, () => !!document.querySelector("main[data-drill]"), { keep: 3, timeout: 240_000, label: "開始" });
  if (!opened) throw new Error("訓練の画面が開かない");
  await settle(cm);
  r7.mark("訓練の画面");
  await checkWords(cm, "訓練の画面", hits);
  await sleep(4000);
  await answerCalls(cm, r7, calls, hits);
  // 0 時間: 小林（呼吸器）へ訪問依頼
  r7.mark("手 小林 訪問依頼");
  await act(cm, r7, "p-02", "dispatch");
  await checkWords(cm, "手 小林", hits);
  let at = await advance(cm, r7, calls, "進める 3 時間", hits, 180);
  for (let k = 0; k < 5 && at.status === "running" && at.hour >= 0 && at.hour < 12; k++) at = await advance(cm, r7, calls, "進める 3 時間", hits, 180);
  // 12 時間: 田中（透析）の透析調整（わざと遅く）
  if (at.status === "running") {
    r7.mark("手 田中 透析調整");
    await act(cm, r7, "p-03", "arrange_dialysis");
    await checkWords(cm, "手 田中", hits);
    await answerCalls(cm, r7, calls, hits);
  }
  // 残りは早送り（72 時間まで。大雨想定は「次まで」を繰り返す。着信が鳴ると止まるので、出てからもう一度）。
  // 大雨想定は 12 時間から 72 時間まで 20 刻みほど（11/5 の 4 回目は 16 回で 57 時間ほどに留まり、ai-finish で続けた）
  for (let k = 0; k < 40; k++) {
    at = await drillAt(cm);
    if (at.status !== "running") break;
    await scrollToSel(r7, cm, "main[data-drill]", 1.2, 0);
    r7.mark("早送り");
    const fast = await cm.$('[data-action="fast"]');
    if (fast && !(await fast.evaluate((e) => e.checked))) await clickSel(cm, '[data-action="fast"]');
    const moved = await waitCut(r7, cm, (s) => Number(document.querySelector("main[data-drill]")?.getAttribute("data-step") ?? -1) > s || document.querySelector("main[data-drill]")?.getAttribute("data-status") !== "running", {
      keep: 3,
      timeout: 120_000,
      label: "早送り",
      arg: at.step,
    });
    if (!moved) {
      // 手のあとの早送りが「読んだ刻みと違う」（409）で止まることがある（11/8）。頁を読み直して続ける
      console.log(`  早送りが進まない（刻み ${at.step}）。頁を読み直す`);
      await cm.reload({ waitUntil: "networkidle2" }).catch(() => undefined);
      await sleep(2000);
      continue;
    }
    await settleShort(cm);
    const step = (await drillAt(cm)).step;
    r7.mark(`刻み ${step}`);
    await checkWords(cm, `刻み ${step}`, hits);
    await sleep(3000);
    await answerCalls(cm, r7, calls, hits);
  }
  at = await drillAt(cm);
  r7.mark(`終了 ${at.status}`);
  await checkWords(cm, "終了", hits);
  await sleep(3000);
  if (!scoreOnly) {
    await r7.stop(recDir("R07"));
    writeWords(recDir("R07"), hits);
  }

  // R09 採点（数字）と講評（Opus。訓練が終わると採点の欄が開いたときに 1 回作る）。
  // 手元の next dev では、講評の欄（ReviewBox）が開発用の React の 2 回組み直しで「作成中」のまま替わらない（返事が来ても画面に出ない。
  // 11/5 の 1 回目は講評が 61 秒で保存されたのに 4 分「作成中」だった。本番では起きない）。だから講評の保存の返事を待ってから頁を読み直し、
  // 保存された講評が開いた時から出ている頁を撮る（講評の中身はアプリが保存した物のまま）。Opus の 1 回の待ちが 180 秒、やり直し 1 回なので 8 分まで待つ
  if (keys.anthropic) {
    const t0 = Date.now();
    const status = await Promise.race([reviewDone, sleep(480_000).then(() => null)]);
    console.log(`  講評の保存の返事: ${status ?? "来ない"}（${((Date.now() - t0) / 1000).toFixed(0)} 秒待った）`);
    await cm.reload({ waitUntil: "networkidle0", timeout: 180_000 }).catch(() => undefined);
    await settle(cm);
    await sleep(1500);
  }
  const r9 = new Recorder(cm, "R09");
  await r9.start();
  await scrollToSel(r9, cm, '[data-panel="score"]', 2, 70);
  r9.mark("採点");
  await sleep(4000);
  const reviewed = keys.anthropic && reviewAnswered === 200 ? await cm.$('[data-review="done"]').then((e) => !!e) : false;
  if (keys.anthropic && !reviewed) console.log(`  読み直しても講評が出ない（${await cm.$eval("[data-review]", (e) => e.getAttribute("data-review")).catch(() => "欄なし")}）`);
  const hits9 = [];
  if (reviewed) {
    await scrollToSel(r9, cm, "[data-review]", 2, 90);
    r9.mark("講評");
    await checkWords(cm, "講評", hits9);
    await sleep(5000);
    const basis = await cm.$("[data-basis]");
    if (basis) {
      await scrollToSel(r9, cm, "[data-basis]", 2.5, 300);
      r9.mark("出典");
      await sleep(4000);
    }
  } else {
    console.log("  講評は出ない（鍵待ちか失敗）");
    await sleep(2000);
  }
  await r9.stop(recDir("R09"));
  writeWords(recDir("R09"), hits9);
  // 講評の文（Opus。字幕と N19 の文を撮れた中身に合わせるため）
  const review = await cm.$eval('[data-panel="score"]', (e) => e.innerText).catch(() => "");
  if (review) writeFileSync(join(recDir("R09"), "score.txt"), review.replace(/\r\n/g, "\n") + "\n");
  if (scoreOnly) return;

  // アプリの声（娘役などの Gemini TTS）と着信の一覧を R07 に。R08 は山田の着信（無ければ最初の着信）を R07 から切り出す
  const saved = await voices.save(recDir("R07"), "voice");
  for (const c of calls) c.voice = saved.find((v) => c.signal && v.path.includes(encodeURIComponent(c.signal)))?.file ?? saved.find((v) => c.signal && v.path.includes(c.signal))?.file ?? null;
  writeFileSync(join(recDir("R07"), "calls.json"), JSON.stringify({ calls, voices: saved }, null, 2) + "\n");
  console.log(`  着信 ${calls.length} 件、声 ${saved.length} 本`);
  const pick = calls.find((c) => c.name.includes("山田")) ?? calls[0];
  if (pick?.end) {
    cut(recDir("R07"), Math.max(0, pick.at - 0.5), pick.end + 1.5, recDir("R08"), "R08");
    if (pick.voice) copyFileSync(join(recDir("R07"), pick.voice), join(recDir("R08"), "voice.wav"));
    writeFileSync(join(recDir("R08"), "call.json"), JSON.stringify(pick, null, 2) + "\n");
    writeWords(recDir("R08"), hits.filter((h) => h.where === pick.label));
  } else console.log("  着信が無いので R08 は切り出さない");
}

/**
 * 訓練を終わりまで進めて R09（採点と講評）だけを撮る（ai-finish。ai-drill の早送りが 72 時間の前で終わったときの続き）。
 * いちばん新しい訓練を開き、進行中なら着信に出ながら「次まで」で終わりまで進める（録らない）。講評（Opus）が保存されるのを待って
 * 頁を読み直し、採点 → 講評 → 出典を撮る。訓練を始め直さないので、AI は残りの刻みと講評の分だけ
 */
async function aiFinish(browser) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "judge", judgePw, "care_manager");
  const keys = await aiKeys(cm);
  const reviewDone = new Promise((resolve) => {
    const on = (r) => {
      if (r.request().method() === "POST" && /\/api\/drill\/[^/]+\/review$/.test(new URL(r.url()).pathname)) {
        cm.off("response", on);
        resolve(r.status());
      }
    };
    cm.on("response", on);
  });
  await open(cm, base, "/drill");
  // 進行中の訓練が先、無ければ記録の一番上
  const id =
    (await cm.$eval('tr[data-drill][data-status="running"]', (e) => e.getAttribute("data-drill")).catch(() => null)) ??
    (await cm.$eval("tr[data-drill]", (e) => e.getAttribute("data-drill")).catch(() => null));
  if (!id) throw new Error("訓練の記録が無い");
  await open(cm, base, `/drill/${id}`);
  const quiet = quietRecorder("R07");
  const calls = [];
  for (let k = 0; k < 40; k++) {
    const at = await drillAt(cm);
    console.log(`  刻み ${at.step}・${at.status}`);
    if (at.status !== "running") break;
    await answerCalls(cm, quiet, calls, []);
    await advance(cm, quiet, calls, "次まで", [], "next");
  }
  // 講評が無ければ、この頁の採点の欄が 1 回作る（Opus）。保存の返事を待ってから読み直す（ai-drill と同じ理由。8 分まで）
  if (keys.anthropic && !(await cm.$('[data-review="done"]'))) {
    const t0 = Date.now();
    const status = await Promise.race([reviewDone, sleep(480_000).then(() => null)]);
    console.log(`  講評の保存の返事: ${status ?? "来ない"}（${((Date.now() - t0) / 1000).toFixed(0)} 秒待った）`);
  }
  await cm.reload({ waitUntil: "networkidle0", timeout: 180_000 }).catch(() => undefined);
  await settle(cm);
  await sleep(1500);
  const r9 = new Recorder(cm, "R09");
  await r9.start();
  await scrollToSel(r9, cm, '[data-panel="score"]', 2, 70);
  r9.mark("採点");
  await sleep(4000);
  const hits9 = [];
  if (await cm.$('[data-review="done"]')) {
    await scrollToSel(r9, cm, "[data-review]", 2, 90);
    r9.mark("講評");
    await checkWords(cm, "講評", hits9);
    await sleep(5000);
    if (await cm.$("[data-basis]")) {
      await scrollToSel(r9, cm, "[data-basis]", 2.5, 300);
      r9.mark("出典");
      await sleep(4000);
    }
  } else {
    console.log(`  講評が出ない（${await cm.$eval("[data-review]", (e) => e.getAttribute("data-review")).catch(() => "欄なし")}）`);
    await sleep(2000);
  }
  await r9.stop(recDir("R09"));
  writeWords(recDir("R09"), hits9);
  const review = await cm.$eval('[data-panel="score"]', (e) => e.innerText).catch(() => "");
  if (review) writeFileSync(join(recDir("R09"), "score.txt"), review.replace(/\r\n/g, "\n") + "\n");
}

/** 平時 → 大雨（警戒レベル 4・停電 地区 かわなぎ町）。撮らない（disaster の R10 の頭と同じ操作） */
async function toHeavyRain(cm) {
  await open(cm, base, "/office");
  await clickText(cm, KIND_LABEL, { exact: true, within: "main" });
  await cm.waitForSelector('dialog[open] [data-dialog-action="ok"]', { visible: true, timeout: 15_000 });
  await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), clickText(cm, "切替", { exact: true, within: "dialog[open]" })]);
  await settle(cm);
  await cm.evaluate(() => {
    const pick = (sel) => document.querySelector(sel)?.click();
    pick('input[name="level"][value="4"]');
    pick('input[name="outage"][value="area"]');
    const town = Array.from(document.querySelectorAll('input[name="town"]')).find((x) => x.value === "かわなぎ町");
    if (town && !town.checked) town.click();
    const at = document.querySelector('input[name="outage_at"]');
    if (at) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      at.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  });
  await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), clickText(cm, "保存", { exact: true, within: 'form[action="/office/info"]' })]);
  await settle(cm);
  console.log(`${KIND_LABEL}にした（停電 かわなぎ町。警戒レベル 4 は大雨のときだけ）`);
}

/** 本人のページの「スマホ入口」のリンク（/s/<token>）。無ければ発行する。返すのは道だけ（手元の dev で開く） */
async function phoneLink(cm, person, kind) {
  await open(cm, base, `/people/${person}/phone`);
  const read = () => cm.$eval(`[data-phone-link="${kind}"] [data-phone-link-url]`, (e) => e.textContent?.trim() ?? "").catch(() => "");
  let url = await read();
  if (!url) {
    await Promise.all([cm.waitForNavigation({ waitUntil: "networkidle0", timeout: 120_000 }), cm.$eval("form[data-phone-link-issue]", (f) => f.requestSubmit())]);
    await settle(cm);
    url = await read();
  }
  if (!url) throw new Error(`スマホ入口のリンクが無い: ${person} ${kind}`);
  return new URL(url).pathname;
}

/**
 * R12 本人のスマホ（スマホ入口で入る）と R10-voice ケアマネの一覧。平時 → 大雨にしてから撮る。
 * 本人: 赤 → けが ある → 動けない → 定型文（Gemini TTS の声）→ 録音（偽のマイクの「足が痛くて動けない」を録り、Web Speech が文字にする）→
 * 60 秒で送る（話し終わって静かなので延ばさない。待つ間は詰める）。ケアマネ: 読み直しで至急、分類（Haiku）のあとにもう一度読み直し、行の詳細の録音・文字起こし・分類
 */
async function aiVoice() {
  const wav = micFile("R12", VOICE_LINES, 80);
  const browser = await launch({ fakeAudio: wav });
  try {
    const cm = await newPage(browser, PC);
    await login(cm, base, "judge", judgePw, "care_manager");
    watchRefresh(cm);
    await prepSafe(cm);
    const keys = await aiKeys(cm);
    await toHeavyRain(cm);
    const link = await phoneLink(cm, "p-01", "self");
    const self = await newPage(browser, PHONE);
    const prompts = collectVoices(self, /\/api\/signals\/voice/);
    await self.goto(base + link, { waitUntil: "networkidle0", timeout: 180_000 });
    await settle(self);
    if (!new URL(self.url()).pathname.startsWith("/me")) throw new Error(`本人のスマホに入れない（${new URL(self.url()).pathname}）`);
    await self.waitForSelector('[data-choice="red"]', { visible: true, timeout: 60_000 });

    await open(cm, base, "/");
    const r10 = new Recorder(cm, "R10-voice");
    const r12 = new Recorder(self, "R12");
    await r10.start();
    await sleep(3000);
    r10.mark("発災時の表");
    r10.pause();

    await r12.start();
    await sleep(2000);
    r12.mark("赤と緑");
    await sleep(3000);
    r12.mark("赤");
    await clickSel(self, '[data-choice="red"]', { rec: r12 });
    await sleep(2500);
    for (const [label, answer] of [
      ["けが", "ある"],
      ["動けますか", "動けない"],
    ]) {
      r12.mark(`${label} ${answer}`);
      await clickText(self, answer, { exact: true });
      await sleep(2200);
    }
    const prompted = await self.waitForSelector('[data-step="prompt"]', { timeout: 20_000 }).then(
      () => true,
      () => false,
    );
    if (prompted) r12.mark("定型文");
    else console.log("  定型文に入らない（マイクが使えない？）");
    const recording = await self.waitForSelector('[data-step="recording"]', { timeout: 90_000 }).then(
      () => true,
      () => false,
    );
    if (!recording) {
      console.log("  録音に入らない");
      await sleep(2000);
      await r12.stop(recDir("R12"));
      await r10.stop(recDir("R10-voice"));
      process.exitCode = 1;
      return;
    }
    r12.mark("録音");
    // 偽のマイクの声（1 秒あとに 2 秒ほど）を録って文字にする間と、そのあとの静けさを少し
    await sleep(9000);
    // 60 秒が来るまでは詰める（残り 3 秒で撮り直す）
    r12.mark("録音 待ち 一時止め");
    r12.pause();
    await self
      .waitForFunction(() => {
        const e = document.querySelector("[data-left]");
        return !e || Number(e.getAttribute("data-left")) <= 3;
      }, { timeout: 240_000, polling: 250 })
      .catch(() => undefined);
    await r12.resume();
    r12.mark("録音 待ち 再開");
    await self.waitForSelector('[data-step="done"]', { timeout: 90_000 }).catch(() => console.log("  届いたの画面が出ない"));
    r12.mark("届いた");
    const hits12 = [];
    await checkWords(self, "届いた", hits12);
    await sleep(3500);
    await r12.stop(recDir("R12"));
    writeWords(recDir("R12"), hits12);

    // ケアマネ: 読み直しで山田が至急・理由。録音の分類とまとめ（Haiku 2 回、応答のあとに走る）を待って、もう一度読み直す
    await waitRefresh(cm, r10, "本人の赤と録音");
    r10.pause();
    await sleep(keys.anthropic ? 15_000 : 3000);
    await waitRefresh(cm, r10, "録音の分類");
    r10.mark("行の詳細を開く");
    await clickSel(cm, 'tr[data-row="p-01"] button[aria-expanded]', { rec: r10 });
    await sleep(3500);
    r10.mark("録音と文字起こし");
    await scrollToSel(r10, cm, 'tr[data-detail="p-01"] [data-signal]', 2.5, 160);
    await sleep(6000);
    r10.mark("分類");
    const hits = [];
    await checkWords(cm, "行の詳細", hits);
    await sleep(4000);
    await cm.screenshot({ path: join(ROOT, "out", "look", "R10-voice-detail.png") }).catch(() => undefined);
    await r10.stop(recDir("R10-voice"));
    writeWords(recDir("R10-voice"), hits);
    // 行の詳細の安否の欄の文（文字起こし・まとめ・分類。字幕を撮れた中身に合わせるため）
    const detail = await cm.$eval('tr[data-detail="p-01"]', (e) => e.innerText).catch(() => "");
    if (detail) writeFileSync(join(recDir("R10-voice"), "detail.txt"), detail.replace(/\r\n/g, "\n") + "\n");

    // 定型文の声（Gemini TTS。録画に音は入らない）と、偽のマイクに流した声を R12 に
    const saved = await prompts.save(recDir("R12"), "prompt");
    copyFileSync(wav, join(recDir("R12"), "mic.wav"));
    writeFileSync(join(recDir("R12"), "voices.json"), JSON.stringify({ prompt: saved, mic: { file: "mic.wav", lines: VOICE_LINES } }, null, 2) + "\n");
  } finally {
    await browser.close();
  }
}

const browser = await launch();
try {
  if (scene === "prep") {
    const cm = await newPage(browser, PC);
    await login(cm, base, "judge", judgePw, "care_manager");
    await prep(cm);
  } else if (scene === "calm") {
    await calm(browser);
  } else if (scene === "page") {
    await page(browser);
  } else if (scene === "qr") {
    await qrScene(browser);
  } else if (scene === "log") {
    await logScene(browser);
  } else if (scene === "disaster") {
    await disaster(browser);
  } else if (scene === "staff") {
    await staff(browser);
  } else if (scene === "ai-intake") {
    await aiIntake();
  } else if (scene === "ai-form") {
    await aiForm(browser);
  } else if (scene === "ai-drill") {
    await aiDrill(browser);
  } else if (scene === "ai-score") {
    await aiDrill(browser, { scoreOnly: true });
  } else if (scene === "ai-finish") {
    await aiFinish(browser);
  } else if (scene === "ai-voice") {
    await aiVoice();
  } else {
    console.error(`場面が無い: ${scene}`);
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
