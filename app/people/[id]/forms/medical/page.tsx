import "@/components/forms/paper.css";
import "@/components/forms/medical-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/forms/AutoPrint";
import { MedicalSummaryBasis } from "@/components/forms/MedicalSummaryBasis";
import { MedicalSummarySheet } from "@/components/forms/MedicalSummarySheet";
import { MedicalWithheld } from "@/components/forms/MedicalWithheld";
import { PrintButton } from "@/components/forms/PrintButton";
import { StateTag } from "@/components/person/parts";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { loadPersonDocument, medicalSummaryView } from "@/lib/consent/documents";
import { buildMedicalSummary } from "@/lib/forms/medical-summary";
import { wantsPrint } from "@/lib/forms/print";
import { BLANK_LABELS, DOCUMENT_LABELS } from "@/lib/labels";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: DOCUMENT_LABELS.medical };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[] }> };

// 医療要約の紙面（A4 1 枚、災害診療記録 2018 の順）。本人のページの「書類」から開く。医療班・行政も本人のページの書類から開いて印刷する（T24）。
// 組み立ては台帳からサーバーで。Claude は呼ばない（氏名・電話が入る）。
// 壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404。医療班・行政は受け持ちの間だけ）。
// 医療班・行政は同意の範囲（lib/consent/scope.ts）: 医療班への提供に同意の無い人は 404、ある人は住所・本人の電話を描かず、
// 支援者は役割名だけ（lib/consent/documents.ts）。ケアマネには同意の無い人は中身を作らず「同意なし」「未確認」だけ。
// 「なぜこの行があるか」の脇はケアマネ（審査員のケアマネの役を含む）の画面だけ。紙には出さない。
// ?print=1 で開くと、書体を読み終えてから印刷の窓を出す（要約を作った人だけ。AutoPrint、lib/forms/print.ts）。
export default async function MedicalFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "medical");
  if (!opened) notFound();
  const { rows, scope } = opened;
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const result = buildMedicalSummary(rows, {
    today: todayJst(),
    officeName: office?.name ?? null,
    view: medicalSummaryView(scope),
  });
  const sheet = result.kind === "sheet" ? result.sheet : null;
  const showBasis = principal.role === "care_manager";

  return (
    <main className="py-4 print:p-0">
      <div className="screen-only mx-auto mb-4 flex max-w-[calc(210mm+2rem)] flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <Link href={`/people/${id}`} className="rounded px-2 py-1 text-sm text-muted" data-press>
          戻る
        </Link>
        <div className="font-bold">
          {DOCUMENT_LABELS.medical} <span className="font-normal text-muted">{rows.person.name}</span>
        </div>
        {sheet && sheet.pending.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2" data-pending={sheet.pending.length}>
            <StateTag tone="check">
              {BLANK_LABELS.unconfirmed} <span className="tabular-nums">{sheet.pending.length}</span>
            </StateTag>
            <span className="text-sm text-muted">{sheet.pending.map((p) => p.label).join("・")}</span>
          </div>
        )}
        {sheet && (
          <div className="ml-auto">
            <PrintButton />
          </div>
        )}
      </div>
      {result.kind === "sheet" ? (
        <div className="flex flex-col items-center gap-4 xl:flex-row xl:items-start xl:justify-center print:block">
          <MedicalSummarySheet sheet={result.sheet} />
          {showBasis && (
            <div className="screen-only w-full max-w-xl px-4 xl:w-80 xl:shrink-0 xl:px-0 xl:pr-4">
              <MedicalSummaryBasis sheet={result.sheet} />
            </div>
          )}
        </div>
      ) : (
        <div className="px-4">
          <MedicalWithheld kind={result.kind} consent={result.consent} />
        </div>
      )}
      {sheet && wantsPrint(await searchParams) && <AutoPrint />}
    </main>
  );
}
