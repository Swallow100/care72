import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { AutoRefresh } from "@/components/disaster/AutoRefresh";
import { DisasterBadge } from "@/components/disaster/DisasterBadge";
import { loadDisasterState } from "@/lib/disaster/db";
import { disasterMark, type DisasterMark } from "@/lib/disaster/state";
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

// 全部の画面の上の帯。左に名前と画面の切替、右上に 事業所の状態（平時・大雨 レベル 4 停電 3 時間）・事業所名・役・ログアウト。
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
  const mark = desk && p?.office ? await officeMark(p.office.id) : null;
  return (
    <header className="bg-panel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href={p ? homePath(p.role) : LOGIN_PATH} className="rounded px-1 font-bold" data-press>
            ケア72
          </Link>
          {desk && <NavLinks />}
        </div>
        {p && <Who p={p} mark={mark} />}
      </div>
      {/* 災害モードの間は 1 分ごとに読み直す（担当一覧・本人のページ・様式 9 の色と並びが今の時刻で変わる） */}
      {mark?.kind === "disaster" && <AutoRefresh seconds={60} />}
    </header>
  );
}

/** 事業所の状態の印。読めなければ出さない（ヘッダーは落とさない） */
async function officeMark(officeId: string): Promise<DisasterMark | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return disasterMark(await loadDisasterState(env.DB, officeId), new Date().toISOString());
  } catch (e) {
    console.error("事業所の状態を読めない", e);
    return null;
  }
}

const ACTION = "rounded px-2 py-1";

function Who({ p, mark }: { p: Principal; mark: DisasterMark | null }) {
  const role = p.admin ? ADMIN_LABEL : ROLE_LABELS[p.role];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {mark && <DisasterBadge mark={mark} link />}
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
