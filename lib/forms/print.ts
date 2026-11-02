// 紙面の印刷の道（1 押しで印刷）。紙面の URL に ?print=1 を付けて開くと、書体を読み終えてから 1 回だけ印刷の窓を出す。
// 本人のページの書類の行の「印刷」は printHref(紙面の URL) を開く（画面の側の部品は T35。docs/progress/t36.md）。
// 窓を出すのは components/forms/AutoPrint.tsx（client）。ここはブラウザに触らない形で、テストで確かめる。

/** 紙面の URL に印刷の印を付ける（/people/p-01/forms/matsuyama → /people/p-01/forms/matsuyama?print=1） */
export function printHref(href: string): string {
  const [path, hash = ""] = href.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}print=1${hash ? `#${hash}` : ""}`;
}

/** ページの searchParams に印刷の印があるか（print=1 だけ。print=0・print=yes・複数は印刷しない） */
export function wantsPrint(searchParams: { print?: string | string[] | undefined } | null | undefined): boolean {
  return searchParams?.print === "1";
}

/** autoPrint が使うブラウザの物（テストでは偽物を渡す） */
export type PrintWindow = {
  location: { href: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  document: { fonts?: { ready: Promise<unknown> } };
  print(): void;
};

/**
 * URL に print=1 があれば、書体を読み終えてから URL の印を外して印刷の窓を 1 回出す。
 * 印は窓を出す直前に読み直す（ほかの部品が先に出して印を外していれば出さない。2 回出さない）。
 * 読み直しで何度も出さないよう、出す前に URL から外す。出したかを返す
 */
export async function autoPrint(win: PrintWindow): Promise<boolean> {
  if (!hasPrintMark(win.location.href)) return false;
  await (win.document.fonts?.ready ?? Promise.resolve());
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
