import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { todayJst } from "@/lib/age";
import { loadCaseload, sortCaseload, SORT_KEYS, type Caseload, type CaseloadRow, type SortKey } from "@/lib/caseload";
import { PLAN_STATUSES, type PlanStatus } from "@/lib/db/types";
import { CARE_LEVEL_LABELS, PLAN_STATUS_LABELS, TIER_LABELS } from "@/lib/labels";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sort?: string }> };

const SORT_LABELS: Record<SortKey, string> = { tier: "優先", kana: "氏名", age: "年齢", plan: "計画" };

function isSortKey(v: string | undefined): v is SortKey {
  return SORT_KEYS.includes(v as SortKey);
}

export default async function CaseloadPage({ searchParams }: Props) {
  const { sort } = await searchParams;
  const key: SortKey = isSortKey(sort) ? sort : "tier";

  let data: Caseload | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = await loadCaseload(env.DB, todayJst());
  } catch (e) {
    console.error("担当一覧を読めない", e);
    return <Message title="読込失敗" />;
  }
  if (!data) return <Message title="担当なし" />;

  const rows = sortCaseload(data.rows, key);
  const pendingRows = [...data.rows].filter((r) => r.pending > 0).sort((a, b) => b.pending - a.pending);

  return (
    <div className="min-h-dvh">
      <TopBar office={data.office.name} careManager={data.careManager.name} />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section aria-labelledby="caseload-title">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 id="caseload-title" className="text-2xl font-bold">
              担当一覧
            </h1>
            <span className="text-muted">{rows.length} 人</span>
            <PlanSummary rows={data.rows} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <CaseloadTable rows={rows} sort={key} />
          </div>
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
                <li key={r.id} className="flex items-baseline justify-between rounded-md bg-panel2 px-3 py-2">
                  <span>{r.name}</span>
                  <span className="text-caution tabular-nums">{r.pending} 件</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}

function TopBar({ office, careManager }: { office: string; careManager: string }) {
  return (
    <header className="bg-panel">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <span className="font-bold">ケア72</span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">平時</span>
          <span>
            {office} {careManager}
          </span>
        </div>
      </div>
    </header>
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
              <div className="font-bold">{r.name}</div>
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
                <span className="text-caution">なし</span>
              )}
            </td>
            <td className={CELL}>
              <div>{PLAN_STATUS_LABELS[r.plan]}</div>
              {r.pending > 0 && <div className="text-sm text-caution tabular-nums">未確認 {r.pending}</div>}
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
        href={{ query: { sort: k } }}
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
