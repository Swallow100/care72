import "@/components/forms/paper.css";
import "@/components/forms/mapped-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MappedSheet } from "@/components/forms/MappedSheet";
import { StateTag } from "@/components/person/parts";
import { ButtonLink } from "@/components/ui/Button";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { canViewPage } from "@/lib/auth/roles";
import { requirePage } from "@/lib/auth/server";
import { buildMappedSheet } from "@/lib/forms/mapped-sheet";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { loadCheckedMapping } from "@/lib/forms/mapping-db";
import { warekiText } from "@/lib/forms/wareki";
import { CONSENT_KIND_LABELS } from "@/lib/labels";
import { formatJst, loadPersonPage } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: "様式差込" };

type Props = {
  params: Promise<{ id: string; mappingId: string }>;
  searchParams: Promise<{ print?: string | string[] }>;
};

// 汎用の差し込み（docs/tasks/T08.md）。確かめた対応表（確認済だけ）と台帳から、様式の欄の順に値を並べた紙面（A4、表の形）。
// 差し込みは台帳からサーバーで描く。Claude は呼ばない（氏名・住所・電話が入る）。同意の範囲は松山市の様式と同じ。
// 本人の壁は本人のページと同じ（loadPersonPage が personInScope を通す）。対応表は本人の事業所の物だけ（ほかの事業所・下書きは 404）
export default async function MappedFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id, mappingId } = await params;
  const autoPrint = wantsPrint((await searchParams).print);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mappingId)) notFound();
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, id);
  if (!rows) notFound();
  const [stored, office] = await Promise.all([
    loadCheckedMapping(env.DB, rows.person.office_id, mappingId),
    env.DB.prepare("SELECT name FROM offices WHERE id = ?1").bind(rows.person.office_id).first<{ name: string }>(),
  ]);
  if (!stored) notFound();

  const today = todayJst();
  const sheet = buildMappedSheet(rows, stored.mapping, { today, officeName: office?.name ?? null });
  const checked = `${stored.checked_at ? formatJst(stored.checked_at).slice(0, 10) : ""} ${stored.checked_by_name ?? ""}`.trim();
  const editable = canViewPage(principal.role, "caseload");

  return (
    <main className="py-4 print:p-0">
      <PaperBar
        back={`/people/${encodeURIComponent(id)}`}
        title={sheet.title}
        name={sheet.name}
        autoPrint={autoPrint}
        actions={
          editable && (
            <ButtonLink href={`/forms/mapping/${encodeURIComponent(stored.id)}`} kind="plain">
              対応表
            </ButtonLink>
          )
        }
      >
        {sheet.unconfirmed.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2" data-unconfirmed={sheet.unconfirmed.length}>
            <StateTag tone="check">
              {L.unconfirmed} <span className="tabular-nums">{sheet.unconfirmed.length}</span>
            </StateTag>
            <span className="text-xs text-muted">{sheet.unconfirmed.join("・")}</span>
          </div>
        )}
        {sheet.unmapped.length > 0 && (
          <span className="text-sm">
            <span className="text-muted">{L.unmapped}</span> <span className="font-bold tabular-nums">{sheet.unmapped.length}</span>
          </span>
        )}
        {sheet.withheld.map((k) => (
          <StateTag key={k} tone="check">
            {L.withheld} {CONSENT_KIND_LABELS[k]}
          </StateTag>
        ))}
      </PaperBar>
      <MappedSheet sheet={sheet} meta={{ date: warekiText(today), checked }} />
    </main>
  );
}
