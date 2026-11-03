import "@/components/forms/paper.css";
import "@/components/forms/medical-paper.css";
import "@/components/forms/own-paper.css";
import "@/components/forms/own-batch.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OwnSheetBatch } from "@/components/forms/OwnSheetBatch";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { Panel } from "@/components/ui/Panel";
import { StateTag } from "@/components/ui/Tag";
import { todayJst } from "@/lib/age";
import { caseloadScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { caseloadHref, loadCaseload } from "@/lib/caseload";
import { loadOwnSheets } from "@/lib/forms/own-sheets";
import { EXPORT_LABELS } from "@/lib/forms/export-paths";
import { BLANK_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { filterWords, listView } from "@/lib/list/view";
import { originFromHeaders } from "@/lib/qr/url";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: DOCUMENT_LABELS.own };

type Param = string | string[];
type Props = {
  searchParams: Promise<{ print?: Param; sort?: Param; dir?: Param; color?: Param; area?: Param; mark?: Param; q?: Param }>;
};

// 本人の 1 枚の一括印刷（T62）。担当一覧の「一括印刷」から、今の並びと絞込のまま（「至急の人だけ刷る」）。
// 行は担当一覧と同じ listView（lib/list/view.ts）、1 人ずつは本人の 1 枚の頁と同じ道（lib/forms/own-sheets.ts）で組み、
// 紙面（OwnSheetPaper、1 人 2 頁）を人数分並べる。人の間で頁を割る（components/forms/own-batch.css）。Claude は呼ばない。
// 開けるのはケアマネの役だけ（1 人の頁は医療班・行政も開けるが、同意の範囲に本人の 1 枚は無い。一括は担当一覧の入口と同じ役）。
// 上の帯（紙には出さない）に人数・未確認のある人・飛ばした人（範囲の外・同意で開けない）・絞込。?print=1 で開くとすぐ印刷の窓。
// 印刷したことは経過に残さない（様式 9 の CSV・印刷と同じ）。QR はここでは作らない（作る・作り直すは QR の画面）
export default async function OwnSheetsPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const scope = caseloadScope(principal);
  if (!scope) notFound();
  const { env } = await getCloudflareContext({ async: true });
  const now = new Date().toISOString();
  const today = todayJst();
  const data = await loadCaseload(env.DB, scope, today, now);
  if (!data) notFound();

  const view = listView(data, q);
  const batch = await loadOwnSheets(
    env.DB,
    principal,
    view.rows.map((r) => r.id),
    { today, officeName: data.office.name, secret: sessionSecret(env), origin: originFromHeaders(await headers()), nowSec: nowSec() },
  );
  const any = batch.items.length > 0;

  return (
    <main className="py-4 print:p-0">
      <PaperBar
        back={caseloadHref({ sort: view.key, dir: view.dir, filter: view.filter })}
        title={DOCUMENT_LABELS.own}
        name={`${batch.items.length} 人`}
        print={any}
        autoPrint={any && wantsPrint(q.print)}
      >
        {batch.unconfirmed.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2" data-check="decide" data-count={batch.unconfirmed.length}>
            <StateTag tone="check">
              {BLANK_LABELS.unconfirmed} <span className="tabular-nums">{batch.unconfirmed.length}</span> 人
            </StateTag>
            <span className="text-sm text-muted">{batch.unconfirmed.join("・")}</span>
          </div>
        )}
        {batch.skipped > 0 && (
          <span data-skipped={batch.skipped}>
            <StateTag tone="check">
              {EXPORT_LABELS.skipped} <span className="tabular-nums">{batch.skipped}</span> 人
            </StateTag>
          </span>
        )}
        <span className="text-sm text-muted" data-filter-words>
          {filterWords(view.filter)}
        </span>
      </PaperBar>
      {any ? (
        <OwnSheetBatch items={batch.items} />
      ) : (
        <div className="mx-auto max-w-[calc(210mm+2rem)] px-4">
          <Panel>
            <p className="text-muted" data-empty>
              {BLANK_LABELS.none}
            </p>
          </Panel>
        </div>
      )}
    </main>
  );
}
