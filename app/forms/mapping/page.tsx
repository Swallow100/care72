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
import { FORMS_LIST_LABELS } from "@/lib/forms/document-list";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { formsScope, listMappings, type MappingSummary } from "@/lib/forms/mapping-db";
import { allMunicipalEntries, cityForOffice, municipalEntry } from "@/lib/forms/municipal-forms";
import { officeCatalogMappings, sharedCatalogIds } from "@/lib/forms/shared-mapping";
import { formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: FORMS_LIST_LABELS.add };

const SOURCE_LABELS = { image: "写真", pdf: "PDF", manual: "手作成" } as const;

type Own = Record<string, { id: string; status: "draft" | "checked"; sha256: string }>;

// 様式追加（docs/tasks/T08.md の様式対応。T87 でヘッダーの「書類」の下の名前を「様式追加」に。URL は同じ）。松山市以外の様式を写真・PDF から読み（Opus）、対応表を確かめてから差し込みに使う。
// 開けるのはケアマネの役（管理者・審査員のケアマネの役を含む）。範囲は事業所の対応表。
// AI が使えない（未設定・上限到達）ときは読取を押せず、手作成（欄を手で足す）の道だけ残す。AI の状態は lib/claude/status.ts の 1 か所（T76）
export default async function FormMappingListPage() {
  const principal = await requirePage("caseload");
  const scope = formsScope(principal);
  if (!scope || !principal.office) return <Message title="事業所なし" />;

  let list: MappingSummary[];
  let ai: AiStatus;
  let shared: Set<string>;
  let own: Own;
  let officeCity: string | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    ai = await aiStatusFor(scope.officeId);
    // 地域選択（T134）: 同じ版の共有の対応表がある様式と、この事業所が一覧の様式から作った対応表
    [list, shared, own, officeCity] = await Promise.all([
      listMappings(env.DB, scope.officeId),
      sharedCatalogIds(
        env.DB,
        allMunicipalEntries().map((e) => ({ id: e.form.id, sha256: e.form.sha256 })),
      ),
      officeCatalogMappings(env.DB, scope.officeId),
      // 事業所の市（T68 の地域）。地域選択の初めの市
      env.DB.prepare("SELECT city FROM offices WHERE id = ?1")
        .bind(scope.officeId)
        .first<{ city: string }>()
        .then((r) => r?.city ?? null),
    ]);
  } catch (e) {
    console.error("様式対応を読めない", e);
    return <Message title="読込失敗" />;
  }

  const aiReady = aiUsable(ai);
  // 一覧の様式から作った対応表は「元」に市の名前（T134）
  const catalogOf = new Map(Object.entries(own).map(([cid, m]) => [m.id, municipalEntry(cid)]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <FormsTabs current="mapping" />
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-xl leading-8 font-bold">{FORMS_LIST_LABELS.add}</h1>
        <span className="text-sm">{principal.office.name}</span>
        <span className="text-sm">
          <span className="text-muted">対応表</span> <span className="font-bold tabular-nums">{list.length}</span>
        </span>
        {/* AI の状態は中立の地の印（状態の 4 色を使わない。T76）。地の上なので白の地。使えるときは本日残り */}
        <AiStatusMark status={ai} size="md" inPanel2 />
      </div>

      <div className="mt-3">
        <FormReadPanel
          aiReady={aiReady}
          municipal={{
            shared: [...shared],
            own: Object.fromEntries(Object.entries(own).map(([cid, m]) => [cid, { id: m.id, status: m.status }])),
            defaultCity: cityForOffice(officeCity)?.id ?? null,
          }}
        />
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
                    <td className={TD}>
                      {SOURCE_LABELS[m.sourceKind]}
                      {catalogOf.get(m.id) && <span className="block text-xs text-muted">公式 {catalogOf.get(m.id)!.city.name}</span>}
                    </td>
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
      <h1 className="mt-2 text-xl leading-8 font-bold">{FORMS_LIST_LABELS.add}</h1>
      <p className="mt-2 text-sm">{title}</p>
    </main>
  );
}
