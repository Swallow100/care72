import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import type { Principal } from "@/lib/auth/principal";
import {
  ADMIN_LABEL,
  canViewPage,
  homePath,
  JUDGE_LABEL,
  LOGIN_PATH,
  ROLE_LABELS,
  ROLE_SELECT_PATH,
} from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";
import { SessionSecretMissing } from "@/lib/auth/session";
import { NavLinks } from "./NavLinks";

// 全部の画面の上の帯。左に名前と画面の切替、右上に 事業所名・役・ログアウト。
// 審査員は役の横に「審査員」と「役変更」。ログインしていなければ名前だけ（ログインの画面にいる）。
export async function AppHeader() {
  let p: Principal | null = null;
  try {
    p = await getPrincipal();
  } catch (e) {
    unstable_rethrow(e);
    // 配信で SESSION_SECRET が無いときは止める（画面を出さない）
    if (e instanceof SessionSecretMissing) throw e;
    console.error("ヘッダーの役を読めない", e);
  }

  const desk = p !== null && canViewPage(p.role, "caseload");
  return (
    <header className="bg-panel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href={p ? homePath(p.role) : LOGIN_PATH} className="rounded px-1 font-bold" data-press>
            ケア72
          </Link>
          {desk && <NavLinks />}
        </div>
        {p && <Who p={p} desk={desk} />}
      </div>
    </header>
  );
}

const ACTION = "rounded px-2 py-1";

function Who({ p, desk }: { p: Principal; desk: boolean }) {
  const role = p.admin ? ADMIN_LABEL : ROLE_LABELS[p.role];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {desk && <span className="text-muted">平時</span>}
      {p.office && <span>{p.office.name}</span>}
      <span>
        <span className="font-bold">{role}</span>
        {p.displayName && <span> {p.displayName}</span>}
      </span>
      {p.judge && <span className="text-muted">{JUDGE_LABEL}</span>}
      {p.judge && p.role !== "unselected" && (
        <Link href={ROLE_SELECT_PATH} className={ACTION} data-press>
          役変更
        </Link>
      )}
      <form method="post" action="/api/auth/logout">
        <button type="submit" className={ACTION} data-press>
          ログアウト
        </button>
      </form>
    </div>
  );
}
