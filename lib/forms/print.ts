// 紙面の印刷の道（1 押しで印刷）。紙面の URL に ?print=1 を付けて開くと、書体を読み終えてから 1 回だけ印刷の窓を出す。
// 本人のページの書類の行の「印刷」が ?print=1 を開き（components/person/PersonView の printHref）、
// 紙面の画面の印刷のボタン（components/ui/PrintButton の auto。ページが components/ui/PaperBar の wantsPrint で決める）がこれを呼ぶ。
// ここはブラウザの物を引数で受ける形にして、テストで確かめる（lib/forms/print-pages.test.ts）。

/** autoPrint が使うブラウザの物（テストでは偽物を渡す） */
export type PrintWindow = {
  location: { href: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  document: {
    fonts?: { ready: Promise<unknown> };
    images?: ArrayLike<{ complete: boolean; decode?: () => Promise<void> }>;
    querySelectorAll?(selector: string): ArrayLike<{ getAttribute(name: string): string | null }>;
  };
  print(): void;
};

/** SVG の中の画像（避難経路の地図の地理院タイル。T106）。<img> でないので document.images に入らない */
export const SVG_IMAGE_SELECTOR = "svg image[href]";

/** SVG の中の画像を待つ上限（ms）。読めない・遅いタイルで印刷を止めない（タイルが無くても線・印・出典は刷れる） */
export const SVG_IMAGE_WAIT_MS = 6000;

/** 画像を先に読む（同じ URL の SVG の中の画像も同じ読み込みで済む）。読めても読めなくても終わる */
export type Preload = (href: string) => Promise<void>;

function browserPreload(href: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = href;
  });
}

/** 頁の中の SVG の中の画像を読み終えるまで待つ（上限 waitMs）。待った URL の数を返す */
export async function waitSvgImages(doc: PrintWindow["document"], preload: Preload = browserPreload, waitMs = SVG_IMAGE_WAIT_MS): Promise<number> {
  const hrefs = [...new Set(Array.from(doc.querySelectorAll?.(SVG_IMAGE_SELECTOR) ?? [], (el) => el.getAttribute("href") ?? ""))].filter((h) => h !== "");
  if (hrefs.length === 0) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  await Promise.race([Promise.all(hrefs.map((h) => preload(h).catch(() => undefined))), limit]);
  clearTimeout(timer);
  return hrefs.length;
}

/**
 * URL に print=1 があれば、書体と画像を読み終えてから URL の印を外して印刷の窓を 1 回出す
 * （読み終える前に出すと、紙の字が仮の書体になり頁の割れ方も変わる）。
 * 印は窓を出す直前に読み直す（ほかの部品が先に出して印を外していれば出さない。2 回出さない）。
 * 読み直しで何度も出さないよう、出す前に URL から外す。出したかを返す
 */
export async function autoPrint(win: PrintWindow, preload?: Preload): Promise<boolean> {
  if (!hasPrintMark(win.location.href)) return false;
  await (win.document.fonts?.ready ?? Promise.resolve());
  // 画像（元の様式の上の紙の頁の画像。T86）も読み終えてから。読めない画像は待たない
  await Promise.all(Array.from(win.document.images ?? []).map((img) => (img.complete || !img.decode ? null : img.decode().catch(() => null))));
  // 避難経路の地図の SVG の中のタイル（T106）も。上限まで
  await waitSvgImages(win.document, preload);
  if (!hasPrintMark(win.location.href)) return false;
  const url = new URL(win.location.href);
  url.searchParams.delete("print");
  win.history.replaceState(null, "", url.toString());
  win.print();
  return true;
}

function hasPrintMark(href: string): boolean {
  try {
    return new URL(href).searchParams.get("print") === "1";
  } catch {
    return false;
  }
}
