import "@/components/forms/paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MatsuyamaSheet } from "@/components/forms/MatsuyamaSheet";
import { PrintButton } from "@/components/forms/PrintButton";
import { StateTag } from "@/components/person/parts";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { buildMatsuyamaSheet } from "@/lib/forms/matsuyama";
import { BLANK_LABELS } from "@/lib/labels";
import { loadPersonPage } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: "計画書" };

type Props = { params: Promise<{ id: string }> };

// 松山市の様式の紙面（A4 表裏）。本人のページの「書類」から開く。
// 差し込みは台帳からサーバーで描く。Claude は呼ばない（氏名・住所・電話が入る）。
// 事業所の壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404）。
export default async function MatsuyamaFormPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, id);
  if (!rows) notFound();
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const sheet = buildMatsuyamaSheet(rows, { today: todayJst(), officeName: office?.name ?? null });
  const pending = sheet.pending.map((p) => p.label);

  return (
    <main className="py-4 print:p-0">
      <div className="screen-only mx-auto mb-4 flex max-w-[calc(210mm+2rem)] flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <Link href={`/people/${id}`} className="rounded px-2 py-1 text-sm text-muted" data-press>
          戻る
        </Link>
        <div className="font-bold">
          計画書 <span className="font-normal text-muted">{sheet.name}</span>
        </div>
        {pending.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2" data-pending={pending.length}>
            <StateTag tone="check">
              {BLANK_LABELS.unconfirmed} <span className="tabular-nums">{pending.length}</span>
            </StateTag>
            <span className="text-sm text-muted">{pending.join("・")}</span>
          </div>
        )}
        <div className="ml-auto">
          <PrintButton />
        </div>
      </div>
      <MatsuyamaSheet sheet={sheet} />
    </main>
  );
}
