import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MappingEditor } from "@/components/forms/mapping/MappingEditor";
import { AiMark, StateTag } from "@/components/person/parts";
import { LinkPending } from "@/components/ui/LinkPending";
import { BackLink, Panel, PanelHead } from "@/components/ui/Panel";
import { FormsTabs } from "@/components/ui/Tabs";
import { requirePage } from "@/lib/auth/server";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { formsScope, getMapping, officePeople, type StoredMapping } from "@/lib/forms/mapping-db";
import { formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "様式対応" };

type Props = { params: Promise<{ id: string }> };

const SOURCE_LABELS = { image: "写真", pdf: "PDF", manual: "手作成" } as const;

// 対応表を確かめる画面。AI が読んだ欄と台帳の項目の対応を欄ごとに見せ、ケアマネが直す・外す・足す。確認保存で差し込みに使える。
// 差込は確認済の対応表だけ（事業所の本人ごとの紙面へ）。範囲は事業所（ほかの事業所の対応表は 404）
export default async function FormMappingPage({ params }: Props) {
  const principal = await requirePage("caseload");
  const scope = formsScope(principal);
  if (!scope) notFound();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();

  const { env } = await getCloudflareContext({ async: true });
  const [stored, people] = await Promise.all([getMapping(env.DB, scope.officeId, id), officePeople(env.DB, scope.officeId)]);
  if (!stored) notFound();
  const ai = stored.mapping.fields.some((f) => f.ai !== null);

  return (
    <main className="mx-auto max-w-[96rem] px-4 py-4">
      <FormsTabs current="mapping" />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackLink href="/forms/mapping" label={L.back} />
        <h1 className="text-xl leading-8 font-bold">{stored.title}</h1>
        <span className="text-sm text-muted">{SOURCE_LABELS[stored.source_kind]}</span>
        {ai && (
          <span className="flex items-baseline gap-1 text-xs text-muted">
            <AiMark title="AI の読取。人が確認" />
            {stored.ai_model}
            <span className="tabular-nums">{formatJst(stored.created_at)}</span>
          </span>
        )}
        <Checked m={stored} />
      </div>

      {/* 1 列のときも列の幅を 0 から（広い表は面の中で横に送り、画面を横に送らない） */}
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <MappingEditor id={stored.id} version={stored.version} status={stored.status} initial={stored.mapping} />
        <FillSection m={stored} people={people} />
      </div>
    </main>
  );
}

function Checked({ m }: { m: StoredMapping }) {
  if (!m.checked_at) return null;
  return (
    <span className="text-sm tabular-nums">
      <span className="text-muted">確認</span> {formatJst(m.checked_at)} {m.checked_by_name ?? ""}
    </span>
  );
}

/** 差込: 確認済の対応表で、事業所の本人ごとの紙面を開く。人の一覧はページの流れに置く（内側で送らない） */
function FillSection({ m, people }: { m: StoredMapping; people: Array<{ id: string; name: string }> }) {
  return (
    <Panel aria-labelledby="fill-title" className="content-start">
      <PanelHead
        id="fill-title"
        title={L.fill}
        sub={m.status !== "checked" ? <StateTag tone="check">確認待ち</StateTag> : undefined}
        count={m.status === "checked" ? people.length : undefined}
      />
      {m.status === "checked" && (
        <ul className="mt-2 grid gap-px overflow-hidden rounded bg-base text-sm">
          {people.map((p) => (
            <li key={p.id} className="bg-panel">
              <Link
                href={`/people/${encodeURIComponent(p.id)}/forms/mapped/${encodeURIComponent(m.id)}`}
                className="relative flex items-baseline justify-between px-2 py-1.5"
                data-press
              >
                {p.name}
                <span className="text-xs text-muted">{L.fill}</span>
                <LinkPending />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
