import "@/components/forms/paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MatsuyamaSheet } from "@/components/forms/MatsuyamaSheet";
import { UnconfirmedFold } from "@/components/forms/UnconfirmedFold";
import { FormAbout } from "@/components/forms/FormAbout";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { buildMatsuyamaSheet } from "@/lib/forms/matsuyama";
import { matsuyamaUnconfirmed, unconfirmedView } from "@/lib/forms/unconfirmed";
import { loadPersonDocument } from "@/lib/consent/documents";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: "計画書" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[] }> };

// 松山市の様式の紙面（A4 表裏）。本人のページの「書類」から開く。
// 差し込みは台帳からサーバーで描く。Claude は呼ばない（氏名・住所・電話が入る）。
// 事業所の壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404）。
// 医療班・行政の同意の範囲（lib/consent/scope.ts）に計画書は無いので 404（T24）。
export default async function MatsuyamaFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const autoPrint = wantsPrint((await searchParams).print);
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "matsuyama");
  if (!opened) notFound();
  const { rows } = opened;
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const sheet = buildMatsuyamaSheet(rows, { today: todayJst(), officeName: office?.name ?? null });
  // 紙面が「未確認」と刷る欄（台帳の pending の欄も入る。理由を添える）。帯だけで、紙には刷らない（T87）
  const unconfirmed = unconfirmedView(matsuyamaUnconfirmed(sheet));

  return (
    <main className="py-4 print:p-0">
      <PaperBar back={`/people/${encodeURIComponent(id)}`} title="計画書" name={sheet.name} autoPrint={autoPrint}>
        <UnconfirmedFold view={unconfirmed} />
      </PaperBar>
      <FormAbout entry={DOCUMENT_CATALOG.matsuyama} />
      <MatsuyamaSheet sheet={sheet} />
    </main>
  );
}
