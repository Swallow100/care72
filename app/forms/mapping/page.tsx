import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { FormReadPanel } from "@/components/forms/mapping/FormReadPanel";
import { StateTag } from "@/components/person/parts";
import { LinkPending } from "@/components/ui/LinkPending";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { FormsTabs } from "@/components/ui/Tabs";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/server";
import { AiStatusMark } from "@/components/ui/AiStatus";
import { aiStatusFor } from "@/lib/claude/cloudflare";
import { aiUsable, type AiStatus } from "@/lib/claude/status";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { formsScope, listMappings, type MappingSummary } from "@/lib/forms/mapping-db";
import { formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "様式対応" };

const SOURCE_LABELS = { image: "写真", pdf: "PDF", manual: "手作成" } as const;

// 様式対応（docs/tasks/T08.md）。松山市以外の様式を写真・PDF から読み（Opus）、対応表を確かめてから差し込みに使う。
// 開けるのはケアマネの役（管理者・審査員のケアマネの役を含む）。範囲は事業所の対応表。
// AI が使えない（未設定・上限到達）ときは読取を押せず、手作成（欄を手で足す）の道だけ残す。AI の状態は lib/claude/status.ts の 1 か所（T76）
export default async function FormMappingListPage() {
  const principal = await requirePage("caseload");
  const scope = formsScope(principal);
  if (!scope || !principal.office) return <Message title="事業所なし" />;

  let list: MappingSummary[];
  let ai: AiStatus;
  try {
    const { env } = await getCloudflareContext({ async: true });
    ai = await aiStatusFor(scope.officeId);
    list = await listMappings(env.DB, scope.officeId);
  } catch (e) {
    console.error("様式対応を読めない", e);
    return <Message title="読込失敗" />;
  }

  const aiReady = aiUsable(ai);

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <FormsTabs current="mapping" />
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-xl leading-8 font-bold">{L.title}</h1>
        <span className="text-sm">{principal.office.name}</span>
        <span className="text-sm">
          <span className="text-muted">対応表</span> <span className="font-bold tabular-nums">{list.length}</span>
        </span>
        {/* AI の状態は中立の地の印（状態の 4 色を使わない。T76）。使えるときは本日残り */}
        <AiStatusMark status={ai} size="md" />
      </div>

      <div className="mt-3">
        <FormReadPanel aiReady={aiReady} />
      </div>

      <Panel aria-labelledby="list-title" className="mt-3">
        <PanelHead id="list-title" title="対応表" count={list.length} />
        {list.length === 0 ? (
          <p className="mt-1 text-sm text-muted">なし</p>
        ) : (
          <div className={`mt-2 ${TABLE_BOX}`}>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>題名</th>
                  <th className={TH}>発行元</th>
                  <th className={TH}>状態</th>
                  <th className={TH}>元</th>
                  <th className={`${TH} text-right`}>欄</th>
                  <th className={`${TH} text-right`}>自動対応</th>
                  <th className={`${TH} text-right`}>{L.changed}</th>
                  <th className={`${TH} text-right`}>{L.added}</th>
                  <th className={TH}>確認</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} data-mapping={m.id}>
                    <td className={TD}>
                      <Link
                        href={`/forms/mapping/${encodeURIComponent(m.id)}`}
                        className="relative -mx-1 rounded px-1 font-bold underline underline-offset-2"
                        data-press
                      >
                        {m.title}
                        <LinkPending />
                      </Link>
                    </td>
                    <td className={TD}>{m.issuer || <span className="text-muted">—</span>}</td>
                    <td className={TD}>
                      {m.status === "checked" ? <StateTag tone="ok">{L.checked}</StateTag> : <StateTag tone="check">{L.draft}</StateTag>}
                    </td>
                    <td className={TD}>{SOURCE_LABELS[m.sourceKind]}</td>
                    <td className={`${TD} text-right tabular-nums`}>{m.stats.fields}</td>
                    <td className={`${TD} text-right tabular-nums`}>{m.stats.read > 0 ? `${m.stats.autoMapped}/${m.stats.read}` : "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>{m.stats.changed}</td>
                    <td className={`${TD} text-right tabular-nums`}>{m.stats.added}</td>
                    <td className={`${TD} tabular-nums`}>
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
      </Panel>
    </main>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <FormsTabs current="mapping" />
      <h1 className="mt-2 text-xl leading-8 font-bold">{L.title}</h1>
      <p className="mt-2 text-sm">{title}</p>
    </main>
  );
}
