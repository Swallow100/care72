import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { PersonView } from "@/components/person/PersonView";
import { todayJst } from "@/lib/age";
import type { Principal } from "@/lib/auth/principal";
import { caseloadScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";
import {
  caseloadHref,
  closeHref,
  loadCaseload,
  parseOpen,
  rowLink,
  sortCaseload,
  SORT_KEYS,
  type Caseload,
  type CaseloadRow,
  type SortKey,
} from "@/lib/caseload";
import { PLAN_STATUSES, type PlanStatus } from "@/lib/db/types";
import { CARE_LEVEL_LABELS, PLAN_STATUS_LABELS, TIER_LABELS } from "@/lib/labels";
import { loadPersonPage, toPersonView, type PersonView as View } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sort?: string | string[]; open?: string | string[] }> };

const SORT_LABELS: Record<SortKey, string> = { tier: "優先", kana: "氏名", age: "年齢", plan: "計画" };

function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && SORT_KEYS.includes(v as SortKey);
}

// 担当一覧。ケアマネは自分の担当、審査員（ケアマネの役）はデモ事業所の山本の担当。
// 行を押すと本人のページが右に開き（?open=<id>）、一覧は左に圧縮される。狭い幅は本人のページだけ。
// ログインしていなければ /login へ、行政・医療班・本人・家族・役を選ぶ前の審査員は、それぞれの入口へ送る（requirePage）
export default async function CaseloadPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const key: SortKey = isSortKey(q.sort) ? q.sort : "tier";
  const open = parseOpen(q.open);
  const scope = caseloadScope(principal);

  let data: Caseload | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = scope ? await loadCaseload(env.DB, scope, todayJst()) : null;
  } catch (e) {
    console.error("担当一覧を読めない", e);
    return <Message title="読込失敗" />;
  }
  if (!data) return <Message title="担当なし" />;

  const rows = sortCaseload(data.rows, key);

  if (open) {
    return (
      <main className="mx-auto grid max-w-6xl gap-3 px-4 py-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <section
          aria-labelledby="caseload-title"
          className="hidden self-start lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
        >
          <div className="flex items-baseline gap-3 px-1">
            <h1 id="caseload-title" className="text-xl font-bold">
              担当一覧
            </h1>
            <span className="text-sm text-muted">{rows.length} 人</span>
          </div>
          <CompactList rows={rows} sort={key} open={open} />
        </section>
        <PersonPanel principal={principal} id={open} sort={key} />
      </main>
    );
  }

  const pendingRows = [...data.rows].filter((r) => r.pending > 0).sort((a, b) => b.pending - a.pending);
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section aria-labelledby="caseload-title">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 id="caseload-title" className="text-2xl font-bold">
            担当一覧
          </h1>
          <span className="text-muted">{rows.length} 人</span>
          <PlanSummary rows={data.rows} />
        </div>
        {rows.length === 0 ? (
          <p className="mt-4 rounded-lg bg-panel p-6 text-muted">なし</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <CaseloadTable rows={rows} sort={key} />
          </div>
        )}
      </section>
      <aside aria-labelledby="pending-title" className="self-start rounded-lg bg-panel p-4">
        <h2 id="pending-title" className="font-bold">
          未確認
        </h2>
        {pendingRows.length === 0 ? (
          <p className="mt-3 text-muted">なし</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {pendingRows.map((r) => (
              <li key={r.id}>
                <Link
                  href={rowLink(key, null, r.id).href}
                  className="flex items-baseline justify-between rounded-md bg-panel2 px-3 py-2"
                  data-press="overlay"
                >
                  <span>{r.name}</span>
                  <span className="text-state-check tabular-nums">{r.pending} 件</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}

/** 右の面。範囲の外（違う事業所・無い id）は面に「該当なし」と出し、一覧は残す */
async function PersonPanel({ principal, id, sort }: { principal: Principal; id: string; sort: SortKey }) {
  let view: View | null = null;
  let failed = false;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const rows = await loadPersonPage(env.DB, principal, id);
    view = rows ? toPersonView(rows, { today: todayJst(), mode: "normal" }) : null;
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
        <PersonView view={view} level={2} />
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
              className={`grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md bg-panel px-3 py-2 ${
                link.current ? "font-bold ring-2 ring-inset ring-accent" : ""
              }`}
              data-press="overlay"
            >
              <span className="text-center tabular-nums" title={TIER_LABELS[r.tier]}>
                {r.tier}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                {r.marks.length > 0 && (
                  <span className="block truncate text-sm font-normal text-muted">{r.marks.join("・")}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PlanSummary({ rows }: { rows: CaseloadRow[] }) {
  const count = (s: PlanStatus) => rows.filter((r) => r.plan === s).length;
  return (
    <dl className="flex flex-wrap gap-x-4 text-sm">
      {PLAN_STATUSES.map((s) => (
        <div key={s} className="flex items-baseline gap-1">
          <dt className="text-muted">{PLAN_STATUS_LABELS[s]}</dt>
          <dd className="font-bold tabular-nums">{count(s)}</dd>
        </div>
      ))}
    </dl>
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
              <span className="text-lg font-bold tabular-nums" title={TIER_LABELS[r.tier]}>
                {r.tier}
              </span>
            </td>
            <td className={CELL}>
              <Link href={rowLink(sort, null, r.id).href} className="-mx-1 block rounded px-1 font-bold" data-press>
                {r.name}
              </Link>
              <div className="text-sm text-muted">{r.kana}</div>
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
              <div>{PLAN_STATUS_LABELS[r.plan]}</div>
              {r.pending > 0 && <div className="text-sm text-state-check tabular-nums">未確認 {r.pending}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
