// 画面を移る途中の印（components/NavPending.tsx）の決め方。押したリンクで画面が移るときだけ印を出す。
// 新しい窓・別のサイト・書き出し（download の a）・/api の受け口・同じ画面の中の印（# だけ違う）では出さない。
// どれを数えるかだけをここに持ち、DOM には触らない（lib/ui/nav-pending.test.ts）。

/** 画面を移る途中の言葉（読み上げ） */
export const NAV_WAIT_LABEL = "読込中";

/** 押してからこれだけ待っても画面が移らなければ印を解く（components/ui/SubmitButton.tsx と同じ） */
export const NAV_WAIT_MAX_MS = 15_000;

/** 押してから帯を出すまで（すぐ移る画面で帯がちらつかないように。押した物の灰色はすぐ残す） */
export const NAV_BAR_DELAY_MS = 150;

export type NavClick = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

export type NavAnchor = {
  /** a の href（相対でもよい） */
  href: string;
  /** a の target */
  target: string;
  /** download の印があるか */
  download: boolean;
};

/** 押したリンクで、この窓の画面が別の画面へ移るか。here は今の location.href */
export function startsNavigation(click: NavClick, a: NavAnchor, here: string): boolean {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (a.target !== "" && a.target !== "_self") return false;
  if (a.download) return false;
  let to: URL;
  let now: URL;
  try {
    now = new URL(here);
    to = new URL(a.href, now);
  } catch {
    return false;
  }
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;
  if (to.origin !== now.origin) return false;
  if (to.pathname === "/api" || to.pathname.startsWith("/api/")) return false;
  return to.pathname !== now.pathname || to.search !== now.search;
}
