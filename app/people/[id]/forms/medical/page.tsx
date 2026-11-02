import "@/components/forms/paper.css";
import "@/components/forms/medical-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MedicalSummaryBasis } from "@/components/forms/MedicalSummaryBasis";
import { MedicalSummarySheet } from "@/components/forms/MedicalSummarySheet";
import { MedicalWithheld } from "@/components/forms/MedicalWithheld";
import { PrintButton } from "@/components/forms/PrintButton";
import { StateTag } from "@/components/person/parts";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { buildMedicalSummary } from "@/lib/forms/medical-summary";
import { BLANK_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { loadPersonPage } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: DOCUMENT_LABELS.medical };

type Props = { params: Promise<{ id: string }> };

// 医療要約の紙面（A4 1 枚、災害診療記録 2018 の順）。本人のページの「書類」から開く。医療班の画面（T24）からも開く予定。
// 組み立ては台帳からサーバーで。Claude は呼ばない（氏名・電話が入る）。
// 壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404。医療班の受け持ちは T23 で広がる）。
// 医療班提供の同意が無い人は中身を作らず「同意なし」「未確認」だけ。
// 「なぜこの行があるか」の脇はケアマネ（審査員のケアマネの役を含む）の画面だけ。紙には出さない。
export default async function MedicalFormPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, id);
  if (!rows) notFound();
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const result = buildMedicalSummary(rows, { today: todayJst(), officeName: office?.name ?? null });
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
    </main>
  );
}
