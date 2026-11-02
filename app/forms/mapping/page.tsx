import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { FormReadPanel } from "@/components/forms/mapping/FormReadPanel";
import { StateTag } from "@/components/person/parts";
import { requirePage } from "@/lib/auth/server";
import { hasAnthropicKey } from "@/lib/claude/client";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { formsScope, listMappings, type MappingSummary } from "@/lib/forms/mapping-db";
import { formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "様式対応" };

const SOURCE_LABELS = { image: "写真", pdf: "PDF", manual: "手作成" } as const;

// 様式対応（docs/tasks/T08.md）。松山市以外の様式を写真・PDF から読み（Opus）、対応表を確かめてから差し込みに使う。
// 開けるのはケアマネの役（管理者・審査員のケアマネの役を含む）。範囲は事業所の対応表。
// AI 未設定のときは読取を押せず、手作成（欄を手で足す）の道だけ残す
export default async function FormMappingListPage() {
  const principal = await requirePage("caseload");
  const scope = formsScope(principal);
  if (!scope || !principal.office) return <Message title="事業所なし" />;

  let list: MappingSummary[];
  let aiReady: boolean;
  try {
    const { env } = await getCloudflareContext({ async: true });
    aiReady = hasAnthropicKey(env);
    list = await listMappings(env.DB, scope.officeId);
  } catch (e) {
    console.error("様式対応を読めない", e);
    return <Message title="読込失敗" />;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold">{L.title}</h1>
        <span className="text-sm">{principal.office.name}</span>
        <span className="text-sm">
          <span className="text-muted">対応表</span> <span className="font-bold tabular-nums">{list.length}</span>
        </span>
        {!aiReady && <StateTag tone="check">{L.aiNotConfigured}</StateTag>}
      </div>

      <div className="mt-3">
        <FormReadPanel aiReady={aiReady} />
      </div>

      <section aria-labelledby="list-title" className="mt-3 rounded-lg bg-panel p-3">
        <h2 id="list-title" className="font-bold">
          対応表
        </h2>
        {list.length === 0 ? (
          <p className="mt-1 text-sm text-muted">なし</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-separate [border-spacing:0_1px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-2 py-1">題名</th>
                  <th className="px-2 py-1">発行元</th>
                  <th className="px-2 py-1">状態</th>
                  <th className="px-2 py-1">元</th>
                  <th className="px-2 py-1 text-right">欄</th>
                  <th className="px-2 py-1 text-right">自動対応</th>
                  <th className="px-2 py-1 text-right">{L.changed}</th>
                  <th className="px-2 py-1 text-right">{L.added}</th>
                  <th className="px-2 py-1">確認</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="bg-panel2" data-mapping={m.id}>
                    <td className="px-2 py-1.5">
                      <Link href={`/forms/mapping/${encodeURIComponent(m.id)}`} className="font-bold text-accent underline underline-offset-2" data-press>
                        {m.title}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{m.issuer || <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-1.5">
                      {m.status === "checked" ? <StateTag tone="ok">{L.checked}</StateTag> : <StateTag tone="check">{L.draft}</StateTag>}
                    </td>
                    <td className="px-2 py-1.5">{SOURCE_LABELS[m.sourceKind]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m.stats.fields}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m.stats.read > 0 ? `${m.stats.autoMapped}/${m.stats.read}` : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m.stats.changed}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m.stats.added}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {m.checkedAt ? (
                        <>
                          {formatJst(m.checkedAt)} <span className="text-muted">{m.checkedByName ?? ""}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <h1 className="text-2xl font-bold">{L.title}</h1>
      <p className="mt-2 text-sm">{title}</p>
    </main>
  );
}
