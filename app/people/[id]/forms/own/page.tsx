import "@/components/forms/paper.css";
import "@/components/forms/medical-paper.css";
import "@/components/forms/own-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnSheetPaper, type OwnQr } from "@/components/forms/OwnSheet";
import { qrExpiryDate } from "@/components/forms/QrBlock";
import { StateTag } from "@/components/person/parts";
import { LinkPending } from "@/components/ui/LinkPending";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { buildOwnSheetMedical } from "@/lib/forms/medical-summary";
import { buildOwnSheet } from "@/lib/forms/own-sheet";
import { BLANK_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { loadPersonDocument } from "@/lib/consent/documents";
import { QR_LABELS, QR_STATUS_LABELS } from "@/lib/qr/labels";
import { currentQrToken, loadQrRow, qrState } from "@/lib/qr/store";
import { originFromHeaders, qrUrl } from "@/lib/qr/url";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: DOCUMENT_LABELS.own };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[] }> };

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
// 表は台帳から定型で組んだやさしい日本語（lib/forms/own-sheet.ts）、裏は医療要約（T07）と QR（T16）。Claude は呼ばない。
// 壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404）。医療班・行政の同意の範囲に本人の 1 枚は無いので 404（T24）。
// 上の帯（画面だけ）に、紙で「ケアマネジャーと 決めます」と出た所・手で書く電話・ふりがなの付かなかった漢字と、QR の状態を出す。
// QR はここでは作らない（作る・作り直すは QR の画面でケアマネが押す。作り直すと前に刷った紙の QR は無効）。
export default async function OwnFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const autoPrint = wantsPrint((await searchParams).print);
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "own");
  if (!opened) notFound();
  const { rows } = opened;
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const opts = { today: todayJst(), officeName: office?.name ?? null };
  const sheet = buildOwnSheet(rows, opts);
  // 裏の要約は、支援者提供の同意が無ければ表と同じく支援者の名前・電話を出さない（T37 の 5）
  const medical = buildOwnSheetMedical(rows, opts);
  const qrRow = (await loadQrRow(env.DB, rows.person.id)) ?? { qr_generation: 0, qr_issued_at: null };
  const qrNow = qrState(qrRow, nowSec());
  const token = qrNow.status === "active" ? await currentQrToken(rows.person.id, qrRow, sessionSecret(env)) : null;
  const origin = originFromHeaders(await headers());
  const qr: OwnQr = { status: qrNow.status, url: token && origin ? qrUrl(origin, token) : null, expiresAt: qrNow.expiresAt };
  const qrHref = `/people/${encodeURIComponent(rows.person.id)}/forms/qr`;

  return (
    <main className="py-4 print:p-0">
      <PaperBar back={`/people/${encodeURIComponent(id)}`} title={DOCUMENT_LABELS.own} name={sheet.name} autoPrint={autoPrint}>
        <Check
          label={BLANK_LABELS.unconfirmed}
          items={sheet.open.filter((o) => o.kind === "decide").map((o) => o.label)}
          data="decide"
        />
        <Check label="手書き" items={sheet.open.filter((o) => o.kind === "write").map((o) => o.label)} data="write" />
        <Check label="読み未登録" items={sheet.noReading} data="reading" />
        <Link href={qrHref} className="relative flex items-baseline gap-2 rounded px-1 text-sm" data-press data-qr-status={qr.status}>
          {qr.url && qr.expiresAt ? (
            <span className="text-muted">
              {QR_LABELS.title} {QR_LABELS.expires} <span className="tabular-nums">{qrExpiryDate(qr.expiresAt)}</span>
            </span>
          ) : (
            <StateTag tone="check">
              {QR_LABELS.title} {QR_STATUS_LABELS[qr.status === "expired" ? "expired" : "none"]}
            </StateTag>
          )}
          <LinkPending />
        </Link>
      </PaperBar>
      <OwnSheetPaper sheet={sheet} medical={medical} qr={qr} />
    </main>
  );
}
