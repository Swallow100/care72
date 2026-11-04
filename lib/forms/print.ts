// 紙面の印刷の道（1 押しで印刷）。紙面の URL に ?print=1 を付けて開くと、書体を読み終えてから 1 回だけ印刷の窓を出す。
// 本人のページの書類の行の「印刷」が ?print=1 を開き（components/person/PersonView の printHref）、
// 紙面の画面の印刷のボタン（components/ui/PrintButton の auto。ページが components/ui/PaperBar の wantsPrint で決める）がこれを呼ぶ。
// ここはブラウザの物を引数で受ける形にして、テストで確かめる（lib/forms/print-pages.test.ts）。

/** autoPrint が使うブラウザの物（テストでは偽物を渡す） */
export type PrintWindow = {
  location: { href: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  document: { fonts?: { ready: Promise<unknown> }; images?: ArrayLike<{ complete: boolean; decode?: () => Promise<void> }> };
  print(): void;
};

/**
 * URL に print=1 があれば、書体と画像を読み終えてから URL の印を外して印刷の窓を 1 回出す
 * （読み終える前に出すと、紙の字が仮の書体になり頁の割れ方も変わる）。
 * 印は窓を出す直前に読み直す（ほかの部品が先に出して印を外していれば出さない。2 回出さない）。
 * 読み直しで何度も出さないよう、出す前に URL から外す。出したかを返す
 */
export async function autoPrint(win: PrintWindow): Promise<boolean> {
  if (!hasPrintMark(win.location.href)) return false;
  await (win.document.fonts?.ready ?? Promise.resolve());
  // 画像（元の様式の上の紙の頁の画像。T86）も読み終えてから。読めない画像は待たない
  await Promise.all(Array.from(win.document.images ?? []).map((img) => (img.complete || !img.decode ? null : img.decode().catch(() => null))));
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
