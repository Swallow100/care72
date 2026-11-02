import "@/components/forms/paper.css";
import "@/components/forms/medical-paper.css";
import "@/components/forms/own-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnSheetPaper } from "@/components/forms/OwnSheet";
import { PrintButton } from "@/components/forms/PrintButton";
import { StateTag } from "@/components/person/parts";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { buildMedicalSummary } from "@/lib/forms/medical-summary";
import { buildOwnSheet } from "@/lib/forms/own-sheet";
import { BLANK_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { loadPersonPage } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: DOCUMENT_LABELS.own };

type Props = { params: Promise<{ id: string }> };

/** 上の帯の確かめの印（紙には出さない） */
function Check({ label, items, data }: { label: string; items: readonly string[]; data: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2" data-check={data} data-count={items.length}>
      <StateTag tone="check">
        {label} <span className="tabular-nums">{items.length}</span>
      </StateTag>
      <span className="text-sm text-muted">{items.join("・")}</span>
    </div>
  );
}

// 本人の 1 枚の紙面（A4 の表と裏）。本人のページの「書類」から開く。
// 表は台帳から定型で組んだやさしい日本語（lib/forms/own-sheet.ts）、裏は医療要約（T07）と QR の枠。Claude は呼ばない。
// 壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404）。
// 上の帯（画面だけ）に、紙で「ケアマネジャーと 決めます」と出た所・手で書く電話・ふりがなの付かなかった漢字を出す。
export default async function OwnFormPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, id);
  if (!rows) notFound();
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const opts = { today: todayJst(), officeName: office?.name ?? null };
  const sheet = buildOwnSheet(rows, opts);
  const medical = buildMedicalSummary(rows, opts);

  return (
    <main className="py-4 print:p-0">
      <div className="screen-only mx-auto mb-4 flex max-w-[calc(210mm+2rem)] flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <Link href={`/people/${id}`} className="rounded px-2 py-1 text-sm text-muted" data-press>
          戻る
        </Link>
        <div className="font-bold">
          {DOCUMENT_LABELS.own} <span className="font-normal text-muted">{sheet.name}</span>
        </div>
        <Check
          label={BLANK_LABELS.unconfirmed}
          items={sheet.open.filter((o) => o.kind === "decide").map((o) => o.label)}
          data="decide"
        />
        <Check label="手書き" items={sheet.open.filter((o) => o.kind === "write").map((o) => o.label)} data="write" />
        <Check label="読み未登録" items={sheet.noReading} data="reading" />
        <div className="ml-auto">
          <PrintButton />
        </div>
      </div>
      <OwnSheetPaper sheet={sheet} medical={medical} />
    </main>
  );
}
