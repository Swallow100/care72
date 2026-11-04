import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { AutoRefresh } from "@/components/disaster/AutoRefresh";
import { DisasterBadge } from "@/components/disaster/DisasterBadge";
import { ButtonLink } from "@/components/ui/Button";
import { RoleIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { RoleMenu, type RoleChoice } from "@/components/ui/RoleMenu";
import { loadDisasterState } from "@/lib/disaster/db";
import { disasterMark, type DisasterMark } from "@/lib/disaster/state";
import type { Principal } from "@/lib/auth/principal";
import { judgeChoices } from "@/lib/auth/choices";
import { ADMIN_LABEL, canViewPage, homePath, JUDGE_LABEL, LOGIN_PATH, ROLE_LABELS, ROLE_SELECT_PATH, showsLogout } from "@/lib/auth/roles";
import { getPrincipal } from "@/lib/auth/server";
import { SessionSecretMissing } from "@/lib/auth/session";
import { canChooseRole } from "@/lib/auth/wall";
import { LogoutButton } from "./LogoutButton";
import { NavLinks } from "./NavLinks";

// 全部の画面の上の帯。
// 左: 印と名前（印は components/brand/BrandMark の 1 か所から。動かない満ちた形。T66）と画面の切替（担当一覧・訓練・事業所・様式）、その右に事業所の状態（大雨 レベル 4 停電 3 時間。押すと事業所の画面）。
// 右: 自分のこと 事業所名 → 今の役（ケアマネ 山本）→ 役変更（審査員だけ。押すとその下に役の一覧）→ ログアウト（赤。本人・家族の頁には置かない）。
// 事業所の状態を左に置くのは、右を「自分は誰か・出る」だけにして、事業所名と災害の状態が並んで読み違えないため。
// ログインしていなければ名前だけ（ログインの画面にいる）。押せる高さは 32px 以上、押してから移るまで灰色を残す。
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
  // 役変更は審査員と見本のケアマネの山本（T95。lib/auth/wall.ts の canChooseRole）
  const choices = canChooseRole(p) ? await roleChoices() : null;
  return (
    <header className="bg-panel">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href={p ? homePath(p.role) : LOGIN_PATH}
            className="relative -mx-1 inline-flex h-8 items-center gap-1.5 rounded px-1 text-[1.0625rem] font-bold whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
            data-press
            data-brand
          >
            <BrandMark size={24} still className="shrink-0" />
            ケア72
            <LinkPending />
          </Link>
          {desk && <NavLinks />}
          {mark && <DisasterBadge mark={mark} link />}
        </div>
        {p && <Who p={p} choices={choices} />}
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

/** 審査員の役の一覧（役変更の Menu に先に入れておく）。読めなければ役変更の画面へのリンクにする */
async function roleChoices(): Promise<RoleChoice[] | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return await judgeChoices(env.DB);
  } catch (e) {
    console.error("役の一覧を読めない", e);
    return null;
  }
}

function Who({ p, choices }: { p: Principal; choices: RoleChoice[] | null }) {
  const role = p.admin ? ADMIN_LABEL : ROLE_LABELS[p.role];
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm sm:gap-x-3">
      {p.office && <span className="hidden whitespace-nowrap text-muted sm:inline">{p.office.name}</span>}
      <span className="whitespace-nowrap">
        <span className="font-bold">{role}</span>
        {p.displayName && <span> {p.displayName}</span>}
        {p.judge && <span className="ml-1.5 hidden text-xs text-muted sm:inline">{JUDGE_LABEL}</span>}
      </span>
      <div className="flex items-center gap-1.5">
        {canChooseRole(p) && p.role !== "unselected" &&
          (choices ? (
            <RoleMenu choices={choices} current={p.role} label="役変更" />
          ) : (
            <ButtonLink href={ROLE_SELECT_PATH} icon={RoleIcon}>
              役変更
            </ButtonLink>
          ))}
        {/* 本人・家族の頁にはログアウトを置かない（T69a。lib/auth/roles.ts の showsLogout） */}
        {showsLogout(p.role) && (
          <form method="post" action="/api/auth/logout">
            {/* 送れていない通話の記録があれば送信待ちか破棄かを選ぶ（T71 の続き） */}
            <LogoutButton />
          </form>
        )}
      </div>
    </div>
  );
}
