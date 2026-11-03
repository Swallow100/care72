import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { FormAbout } from "@/components/forms/FormAbout";
import { PhoneLinkIssueForm, PhoneLinkPanel, PhoneLinkStatusLine } from "@/components/phone/PhoneLinkPanel";
import { Page, PageHead } from "@/components/ui/Panel";
import { requirePage } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { loadPersonDocument } from "@/lib/consent/documents";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { PHONE_LINK_LABELS } from "@/lib/qr/phone-labels";
import { loadPhoneLinkRow } from "@/lib/qr/phone-link-store";
import { buildPhoneLinkView } from "@/lib/qr/phone-link-view";
import { originFromHeaders } from "@/lib/qr/url";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 氏名は題に入れない。画面にリンクを出すので検索に載せず、Referer にも載せない
export const metadata: Metadata = {
  title: PHONE_LINK_LABELS.title,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ id: string }> };

// 本人のページの書類の「スマホ入口」（docs/tasks/T69a.md）。本人と家族が自分のスマホで開くリンク（/s/<token>）と QR を出し、
// 発行・再発行（前のリンクは全部無効）する。紙に刷る・LINE で送るのはケアマネの手（アプリは送らない）。
// ケアマネの役だけ（医療班・行政は範囲〔lib/consent/scope.ts の documents〕に無く 404）。壁は本人のページと同じ。Claude は呼ばない。
export default async function PhoneLinkPage({ params }: Props) {
  const principal = await requirePage("person");
  if (principal.role !== "care_manager") notFound();
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "phone");
  if (!opened) notFound();
  const { rows } = opened;
  const link = (await loadPhoneLinkRow(env.DB, rows.person.id)) ?? {
    phone_link_generation: 0,
    phone_link_issued_at: null,
    unlisted_at: null,
  };
  const view = await buildPhoneLinkView(rows, link, {
    now: nowSec(),
    origin: originFromHeaders(await headers()),
    secret: sessionSecret(env),
  });

  return (
    <Page width="text">
      <PageHead
        back={`/people/${encodeURIComponent(rows.person.id)}`}
        title={PHONE_LINK_LABELS.title}
        sub={
          <>
            <span className="font-bold">{rows.person.name}</span>
            <PhoneLinkStatusLine view={view} />
          </>
        }
        actions={<PhoneLinkIssueForm view={view} />}
      />
      <FormAbout entry={DOCUMENT_CATALOG.phone} className="mt-1" />
      <div className="mt-3">
        <PhoneLinkPanel view={view} />
      </div>
    </Page>
  );
}
