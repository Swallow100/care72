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
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { Recorder, clickText, launch, login, newPage, open, PC, PHONE, settle, sleep } from "./record-lib.mjs";

const base = process.env.CARE72_BASE ?? "http://localhost:3073";
const cmPw = process.env.CARE72_CM_PASSWORD;
const judgePw = process.env.CARE72_JUDGE_PASSWORD;
const [scene, take = "1"] = process.argv.slice(2);
const recDir = (id) => join(ROOT, "assets", "rec", `${id}-${take}`);

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

/** 最初に戻す → 平時に戻す（撮らない） */
async function prep(cm) {
  await open(cm, base, "/office?reset=confirm");
  await submitForm(cm, "/office/reset", '[name="confirm"]');
  await open(cm, base, "/office?confirm=normal");
  const normal = await cm.evaluate(() => !!Array.from(document.querySelectorAll("form")).find((x) => x.getAttribute("action") === "/office/mode" && x.querySelector('[name="confirm"]')));
  if (!normal) throw new Error("平時に戻す確認の欄が無い");
  // 大雨・地震のボタンも同じ action のフォームなので、確認の欄（confirm と kind=normal）の物を送る
  await submitForm(cm, "/office/mode", '[name="confirm"]');
  console.log("最初に戻し、平時にした");
}

/** 平時: 担当一覧・本人のページ・3 つの紙面 */
async function calm(browser) {
  const cm = await newPage(browser, PC);
  await login(cm, base, "yamamoto", cmPw);

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


/** 発災時: 平時 → 大雨。ケアマネ（R10）・家族のスマホ（R11）・本人のスマホ（R12）を同時に、続いて医療班の受入（R13） */
async function disaster(browser) {
  const cm = await newPage(browser, PC);
  const fam = await newPage(browser, PHONE);
  const self = await newPage(browser, PHONE);
  await login(cm, base, "yamamoto", cmPw);
  await login(fam, base, "judge", judgePw, "family");
  await login(self, base, "judge", judgePw, "self");
  watchRefresh(cm);
  await prep(cm);
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
  r10.mark("大雨を押す");
  await clickText(cm, "大雨", { exact: true, within: "main" });
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
  await med.type('[data-field="shelter"]', "かわなぎ小学校", { delay: 90 });
  await sleep(800);
  r13.mark("検索");
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

const browser = await launch();
try {
  if (scene === "prep") {
    const cm = await newPage(browser, PC);
    await login(cm, base, "yamamoto", cmPw);
    await prep(cm);
  } else if (scene === "calm") {
    await calm(browser);
  } else if (scene === "disaster") {
    await disaster(browser);
  } else if (scene === "staff") {
    await staff(browser);
  } else {
    console.error(`場面が無い: ${scene}`);
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
