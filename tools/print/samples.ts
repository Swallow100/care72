// node tools/print/samples.ts <名前> [出力のフォルダ] [--count]
// 手元の next dev に山本で入り、書類の紙面をブラウザの印刷（headless Chrome の printToPDF、A4・CSS の @page）で PDF にする。
// 見本は 山田 ハナ・加藤 正・渡辺 清 の 3 人を 1 つの PDF にまとめる（書類ごとに 1 つ、様式 9 は事業所で 1 つ）。
// まとめた PDF が 400KB（400,000 バイト）を超える書類は、1 人ずつの PDF に分ける（<名前>-<書類>-<本人>.pdf）。
// 容量のため読み上げの構造（tagged PDF）は外す（見た目は同じ）。
// --count で 10 人全員の頁数を書類ごとに数えて出す（本物の書体で数える。npm test の頁数のテストは手元の書体）。
//
// 手元だけで使う。環境変数:
//   CARE72_BASE      既定 http://localhost:3136（next dev -p 3136）
//   CARE72_PASSWORD  山本のパスワード（next dev に CAREMANAGER_DEMO_PASSWORD で渡した使い捨ての値）。ファイルに書かない
//   CHROME_PATH      無ければ Chrome・Edge の決まった場所を探す
// 差し込みの見本は確認済の対応表が要る: node tools/print/sample-mapping.ts <sql> → npx wrangler d1 execute DB --local --file=<sql>
// QR が未作成の人は、QR の画面の「作成」と同じ要求で作る（手元の D1 だけ）。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { findChrome, pdfPageCount } from "./chrome.ts";

const args = process.argv.slice(2);
const count = args.includes("--count");
const [label, outDir = "docs/progress/t36"] = args.filter((a) => !a.startsWith("--"));
const base = process.env.CARE72_BASE ?? "http://localhost:3136";
const password = process.env.CARE72_PASSWORD;
if (!label || !password) {
  console.error("使い方: CARE72_PASSWORD=… node tools/print/samples.ts <名前> [出力のフォルダ] [--count]");
  process.exit(1);
}

const SAMPLE_PEOPLE = ["p-01", "p-07", "p-09"];
const ALL_PEOPLE = Array.from({ length: 10 }, (_, i) => `p-${String(i + 1).padStart(2, "0")}`);
const MAPPING_ID = process.env.CARE72_MAPPING_ID ?? "map-sample-cao";
/** 見本の PDF 1 つの上限（docs/progress/t36 に置く物） */
const MAX_BYTES = 400_000;

const DOCS: Array<{ key: string; path: (id: string) => string }> = [
  { key: "matsuyama", path: (id) => `/people/${id}/forms/matsuyama` },
  { key: "medical", path: (id) => `/people/${id}/forms/medical` },
  { key: "own", path: (id) => `/people/${id}/forms/own` },
  { key: "mapped", path: (id) => `/people/${id}/forms/mapped/${MAPPING_ID}` },
  { key: "qr", path: (id) => `/people/${id}/forms/qr` },
];

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 20_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function open(page: Page, path: string) {
  const res = await page.goto(base + path, { waitUntil: "networkidle0", timeout: 120_000 });
  if (!res || !res.ok()) throw new Error(`${path} を開けない（${res?.status()}）`);
  await settle(page);
}

/** 今の頁の main の後ろに、ほかの人の同じ書類の main の中身を足す（画面だけの物は落とす） */
async function appendOthers(page: Page, paths: string[]) {
  await page.evaluate(async (urls: string[]) => {
    const main = document.querySelector("main");
    if (!main) throw new Error("main が無い");
    for (const url of urls) {
      const html = await (await fetch(url, { credentials: "same-origin" })).text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const other = doc.querySelector("main");
      if (!other) throw new Error(`${url} に main が無い`);
      other.querySelectorAll(".screen-only, .qr-screen-only, script").forEach((n) => n.remove());
      for (const child of Array.from(other.children)) main.appendChild(document.importNode(child, true));
    }
  }, paths);
  await settle(page);
}

async function pdf(page: Page): Promise<Uint8Array> {
  // 見本は容量のため読み上げの構造（tagged）を外す。見た目は変わらない
  return page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false });
}

async function ensureQr(page: Page, id: string) {
  await open(page, `/people/${id}/forms/qr`);
  const status = await page.$eval("[data-qr-status]", (n) => n.getAttribute("data-qr-status"));
  if (status === "active") return;
  await page.evaluate(async (pid: string) => {
    await fetch(`/api/people/${pid}/qr`, { method: "POST", credentials: "same-origin", redirect: "manual" });
  }, id);
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle0", timeout: 120_000 });
  const login = await page.evaluate(async (pw: string) => {
    const body = new FormData();
    body.set("id", "yamamoto");
    body.set("password", pw);
    const r = await fetch("/api/auth/login", { method: "POST", body, credentials: "same-origin", redirect: "follow" });
    return r.url;
  }, password);
  if (login.includes("/login")) throw new Error("ログインできない（CARE72_PASSWORD と next dev の CAREMANAGER_DEMO_PASSWORD を合わせる）");

  for (const id of SAMPLE_PEOPLE) await ensureQr(page, id);

  mkdirSync(outDir, { recursive: true });
  const save = (name: string, buf: Uint8Array) => {
    const file = join(outDir, `${name}.pdf`);
    writeFileSync(file, buf);
    console.log(`${file} ${pdfPageCount(buf)} 頁 ${Math.round(buf.byteLength / 1024)} KB`);
  };
  for (const d of DOCS) {
    const paths = SAMPLE_PEOPLE.map(d.path);
    await open(page, paths[0]);
    await appendOthers(page, paths.slice(1));
    const buf = await pdf(page);
    if (buf.byteLength <= MAX_BYTES) {
      save(`${label}-${d.key}`, buf);
      continue;
    }
    for (const id of SAMPLE_PEOPLE) {
      await open(page, d.path(id));
      save(`${label}-${d.key}-${id}`, await pdf(page));
    }
  }
  await open(page, "/office/form9");
  save(`${label}-form9`, await pdf(page));

  if (count) {
    for (const d of DOCS) {
      const pages: string[] = [];
      for (const id of ALL_PEOPLE) {
        await open(page, d.path(id));
        pages.push(`${id}:${pdfPageCount(await pdf(page))}`);
      }
      console.log(`${d.key} ${pages.join(" ")}`);
    }
  }
} finally {
  await browser.close();
}
