// 紙面の印刷を確かめる道具（tools/print/samples.ts と lib/forms/print-pages.test.ts）。手元の Chrome・Edge を探し、PDF の頁を数える。
import { existsSync } from "node:fs";

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** CHROME_PATH か決まった場所の Chrome・Edge。無ければ null */
export function chromePath(): string | null {
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export function findChrome(): string {
  const p = chromePath();
  if (!p) throw new Error("Chrome か Edge が見つからない（CHROME_PATH で場所を渡す）");
  return p;
}

/** PDF の頁の数（頁の物 /Type /Page を数える。/Pages は数えない） */
export function pdfPageCount(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
}
