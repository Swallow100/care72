import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MappingEditor } from "@/components/forms/mapping/MappingEditor";
import { AiMark, StateTag } from "@/components/person/parts";
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
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <Link href="/forms/mapping" className="rounded px-2 py-1 text-sm text-muted" data-press>
          {L.back}
        </Link>
        <h1 className="text-2xl font-bold">{stored.title}</h1>
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

/** 差込: 確認済の対応表で、事業所の本人ごとの紙面を開く */
function FillSection({ m, people }: { m: StoredMapping; people: Array<{ id: string; name: string }> }) {
  return (
    <section aria-labelledby="fill-title" className="content-start rounded-lg bg-panel p-3">
      <h2 id="fill-title" className="flex items-baseline gap-2 font-bold">
        {L.fill}
        {m.status !== "checked" && <StateTag tone="check">確認待ち</StateTag>}
      </h2>
      {m.status === "checked" && (
        <ul className="mt-2 grid max-h-[60vh] gap-px overflow-y-auto rounded bg-panel2 text-sm">
          {people.map((p) => (
            <li key={p.id} className="bg-panel">
              <Link
                href={`/people/${encodeURIComponent(p.id)}/forms/mapped/${encodeURIComponent(m.id)}`}
                className="flex items-baseline justify-between px-2 py-1.5"
                data-press
              >
                {p.name}
                <span className="text-xs text-muted">{L.fill}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
