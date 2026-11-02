import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { ColorCounts, countColors } from "@/components/disaster/ColorCounts";
import { SidePane } from "@/components/list/SidePane";
import { UnlistedFold } from "@/components/office/UnlistedFold";
import { UnlistedRows } from "@/components/office/UnlistedRows";
import { PersonWithIntake } from "@/components/person/PersonWithIntake";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { todayJst } from "@/lib/age";
import type { Principal } from "@/lib/auth/principal";
import { caseloadScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";
import { hasAnthropicKey } from "@/lib/claude/client";
import { intakePropsOf, type IntakeProps } from "@/lib/intake/props";
import {
  caseloadHref,
  closeHref,
  loadCaseload,
  parseOpen,
  PLAN_TONES,
  rowLink,
  sortCaseload,
  SORT_KEYS,
  type Caseload,
  type CaseloadRow,
  type SortKey,
} from "@/lib/caseload";
import { personDisaster } from "@/lib/disaster/person";
import { CARE_LEVEL_LABELS, COLOR_LABELS, PLAN_STATUS_LABELS, TIER_LABELS } from "@/lib/labels";
import { buildSidePane, sideDisasterOf } from "@/lib/map/side";
import { parsePeopleError } from "@/lib/office/http";
import { NEW_PERSON_PATH } from "@/lib/office/http-paths";
import { OFFICE_ERROR_LABELS, OFFICE_LABELS } from "@/lib/office/labels";
import { COLOR_TONES, formatJst, loadPersonPage, toPersonView, type PersonView as View } from "@/lib/person";
import type { Color } from "@/lib/triage/index";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ sort?: string | string[]; open?: string | string[]; people_error?: string | string[] }>;
};

/** 利用者追加（T30）。操作の色の塗りのボタン。角は rounded-md（ピル型にしない） */
const ADD_BUTTON = "rounded-md bg-accent px-4 py-2 text-sm font-bold text-on-accent";

const SORT_LABELS: Record<SortKey, string> = { tier: "優先", kana: "氏名", age: "年齢", plan: "計画" };

function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && SORT_KEYS.includes(v as SortKey);
}

// 担当一覧。ケアマネは自分の担当、審査員（ケアマネの役）はデモ事業所の山本の担当。
// 行を押すと本人のページが右に開き（?open=<id>）、一覧は左に圧縮される。狭い幅は本人のページだけ。
// ログインしていなければ /login へ、行政・医療班・本人・家族・役を選ぶ前の審査員は、それぞれの入口へ送る（requirePage）
// 災害モード（lib/disaster）のときは、優先の列が色の印（至急・要確認・未知・無事）、氏名の下に理由の 1 行、既定の並びがルールの表の順。
// 今の時刻で当て直すので、ヘッダーの読み直し（1 分ごと）で色と並びが進む。発災時の列の増え方・行の詳細は T13
export default async function CaseloadPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const key: SortKey = isSortKey(q.sort) ? q.sort : "tier";
  const open = parseOpen(q.open);
  const scope = caseloadScope(principal);

  const now = new Date().toISOString();
  let data: Caseload | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = scope ? await loadCaseload(env.DB, scope, todayJst(), now) : null;
  } catch (e) {
    console.error("担当一覧を読めない", e);
    return <Message title="読込失敗" />;
  }
  if (!data) return <Message title="担当なし" />;

  const rows = sortCaseload(data.rows, key);
  const disaster = data.situation !== null;
  const peopleError = parsePeopleError(q.people_error);
  // 一覧から外した人（T30）。一覧の下の畳み「外した人 N」
  const unlisted = (
    <UnlistedFold count={data.unlisted.length}>
      <UnlistedRows rows={data.unlisted.map((u) => ({ ...u, href: rowLink(key, open, u.id).href }))} back="caseload" />
    </UnlistedFold>
  );

  if (open) {
    return (
      <main className="mx-auto grid max-w-[90rem] gap-3 px-4 py-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <section
          aria-labelledby="caseload-title"
          className="hidden self-start lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
        >
          <div className="flex items-baseline gap-3 px-1">
            <h1 id="caseload-title" className="text-xl font-bold">
              担当一覧
            </h1>
            <span className="text-sm text-muted">{rows.length} 人</span>
            <Link href={NEW_PERSON_PATH} className="ml-auto rounded px-1 text-sm font-bold text-accent" data-press>
              {OFFICE_LABELS.addPerson}
            </Link>
          </div>
          <CompactList rows={rows} sort={key} open={open} />
          {unlisted}
        </section>
        <PersonPanel principal={principal} id={open} sort={key} now={now} />
      </main>
    );
  }

  // 右の面（T14）: 平時は計画の内訳・見直し・未確認・地図。災害モード（T09）は地図が上で、ピンは行の lib/triage の色、
  // 雨雲・震度のデモは事業所の災害の種類と警戒レベルから
  const side = buildSidePane(rows, { sort: key, disaster: data.situation ? sideDisasterOf(rows, data.disaster) : null });
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="caseload-title" className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 id="caseload-title" className="text-2xl font-bold">
            担当一覧
          </h1>
          <span className="text-muted">{rows.length} 人</span>
          {/* 災害モードは色ごとの人数と時点（平時の計画の人数は右の面の「計画」） */}
          {disaster && (
            <>
              <ColorCounts counts={countColors(rows.flatMap((r) => (r.triage ? [r.triage.color] : [])))} />
              <span className="text-xs text-muted">{formatJst(now)} 時点</span>
            </>
          )}
          {/* 利用者追加（T30）は見出しの段の右上 */}
          <Link href={NEW_PERSON_PATH} className={`${ADD_BUTTON} ml-auto self-center`} data-press="overlay">
            {OFFICE_LABELS.addPerson}
          </Link>
        </div>
        {peopleError && (
          <p role="alert" className="mt-2 text-sm font-bold text-danger">
            {OFFICE_ERROR_LABELS[peopleError]}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="mt-4 rounded-lg bg-panel p-6 text-muted">なし</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <CaseloadTable rows={rows} sort={key} />
          </div>
        )}
        {unlisted}
      </section>
      <SidePane data={side} />
    </main>
  );
}

/** 右の面。範囲の外（違う事業所・無い id）は面に「該当なし」と出し、一覧は残す。災害モードなら経過が上、色と理由 */
async function PersonPanel({ principal, id, sort, now }: { principal: Principal; id: string; sort: SortKey; now: string }) {
  let view: View | null = null;
  let intake: IntakeProps | null = null;
  let failed = false;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const rows = await loadPersonPage(env.DB, principal, id);
    const d = rows ? await personDisaster(env.DB, rows, now) : null;
    view = rows && d ? toPersonView(rows, { today: todayJst(), mode: d.mode, triage: d.triage }) : null;
    // 入れる欄（T03）はケアマネの役だけ（担当一覧はケアマネの役しか開けない）
    intake = rows && principal.role === "care_manager" ? intakePropsOf(rows, hasAnthropicKey(env)) : null;
  } catch (e) {
    console.error("本人のページを読めない", e);
    failed = true;
  }
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <Link href={closeHref(sort)} className="rounded px-2 py-1 text-sm text-muted" data-press>
          閉じる
        </Link>
      </div>
      {view ? (
        <PersonWithIntake view={view} level={2} intake={intake} />
      ) : (
        <section className="rounded-lg bg-panel p-6">
          <h2 className="text-xl font-bold">{failed ? "読込失敗" : "該当なし"}</h2>
        </section>
      )}
    </div>
  );
}

/** 右に開いている間の一覧。優先・氏名・医療の印だけに圧縮する。選んだ行は枠と太字 */
function CompactList({ rows, sort, open }: { rows: CaseloadRow[]; sort: SortKey; open: string }) {
  return (
    <ul className="mt-3 space-y-0.5">
      {rows.map((r) => {
        const link = rowLink(sort, open, r.id);
        return (
          <li key={r.id}>
            <Link
              href={link.href}
              replace={link.replace}
              aria-current={link.current ? "true" : undefined}
              className={`grid ${r.triage ? "grid-cols-[3rem_minmax(0,1fr)]" : "grid-cols-[2rem_minmax(0,1fr)]"} items-baseline gap-x-2 rounded-md bg-panel px-3 py-2 ${
                link.current ? "font-bold ring-2 ring-inset ring-accent" : ""
              }`}
              data-press="overlay"
            >
              {r.triage ? (
                <span className="text-center">
                  <TriageTag color={r.triage.color} />
                </span>
              ) : (
                <span className="text-center tabular-nums" title={TIER_LABELS[r.tier]}>
                  {r.tier}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                {r.triage ? (
                  <span className={`block truncate text-sm ${TONE_TEXT[COLOR_TONES[r.triage.color]]}`} title={r.triage.reason}>
                    {r.triage.reason}
                  </span>
                ) : (
                  r.marks.length > 0 && <span className="block truncate text-sm font-normal text-muted">{r.marks.join("・")}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const CELL = "bg-panel px-3 py-3 align-top first:rounded-l-md last:rounded-r-md";

function CaseloadTable({ rows, sort }: { rows: CaseloadRow[]; sort: SortKey }) {
  return (
    <table className="w-full min-w-[46rem] border-separate border-spacing-y-0.5 text-left">
      <thead>
        <tr className="whitespace-nowrap text-sm text-muted">
          <SortHeader k="tier" sort={sort} className="w-20 text-center" />
          <SortHeader k="kana" sort={sort} />
          <SortHeader k="age" sort={sort} label="年齢・介護度" />
          <th className="px-3 py-2 font-normal">医療</th>
          <th className="px-3 py-2 font-normal">ハザード</th>
          <th className="px-3 py-2 font-normal">支援者</th>
          <SortHeader k="plan" sort={sort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={`${CELL} text-center`}>
              {r.triage ? (
                <>
                  <TriageTag color={r.triage.color} size="md" />
                  <div className="mt-1 text-xs text-muted tabular-nums" title={TIER_LABELS[r.tier]}>
                    骨格 {r.tier}
                  </div>
                </>
              ) : (
                <span className="text-lg font-bold tabular-nums" title={TIER_LABELS[r.tier]}>
                  {r.tier}
                </span>
              )}
            </td>
            <td className={CELL}>
              <Link href={rowLink(sort, null, r.id).href} className="-mx-1 block rounded px-1 font-bold" data-press>
                {r.name}
              </Link>
              <div className="text-sm text-muted">{r.kana}</div>
              {/* 災害モード: ルールの表の理由の 1 行（色と同じ意味の色） */}
              {r.triage && (
                <div className={`mt-0.5 text-sm font-bold ${TONE_TEXT[COLOR_TONES[r.triage.color]]}`}>{r.triage.reason}</div>
              )}
            </td>
            <td className={CELL}>
              <span className="tabular-nums">{r.age ?? "—"}</span>
              <span className="text-muted"> 歳</span>
              <div className="text-sm">{r.careLevel ? CARE_LEVEL_LABELS[r.careLevel] : "—"}</div>
            </td>
            <td className={CELL}>
              {r.marks.length === 0 ? (
                <span className="text-muted">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {r.marks.map((m) => (
                    <span key={m} className="rounded bg-panel2 px-1.5 py-0.5 text-sm">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </td>
            <td className={CELL}>
              {r.hazards.length === 0 ? <span className="text-muted">なし</span> : r.hazards.join("・")}
            </td>
            <td className={CELL}>
              {r.supporters > 0 ? (
                <span className="tabular-nums">{r.supporters} 人</span>
              ) : (
                <span className="text-state-check">なし</span>
              )}
            </td>
            <td className={CELL}>
              <StateTag tone={PLAN_TONES[r.plan]} size="md">
                {PLAN_STATUS_LABELS[r.plan]}
              </StateTag>
              {r.pending > 0 && <div className="mt-1 text-sm font-bold text-state-check tabular-nums">未確認 {r.pending}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** ルールの表の色の印（至急・要確認・未知・無事）。色だけにせず文字を添える */
function TriageTag({ color, size = "sm" }: { color: Color; size?: "sm" | "md" }) {
  return (
    <StateTag tone={COLOR_TONES[color]} size={size}>
      {COLOR_LABELS[color]}
    </StateTag>
  );
}

function SortHeader({ k, sort, label, className = "" }: { k: SortKey; sort: SortKey; label?: string; className?: string }) {
  const active = k === sort;
  return (
    <th
      className={`px-3 py-2 font-normal ${className}`}
      aria-sort={active ? (k === "age" ? "descending" : "ascending") : undefined}
    >
      <Link
        href={caseloadHref({ sort: k })}
        data-press
        className={`rounded px-1 py-0.5 ${active ? "text-ink underline underline-offset-4" : "text-muted"}`}
      >
        {label ?? SORT_LABELS[k]}
      </Link>
    </th>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-lg bg-panel p-6">
        <h1 className="text-xl font-bold">{title}</h1>
      </section>
    </main>
  );
}
