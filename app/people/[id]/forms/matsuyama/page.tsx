import "@/components/forms/paper.css";
import "@/components/forms/overlay-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FillToggle, wantsFill } from "@/components/forms/FillToggle";
import { MatsuyamaSheet } from "@/components/forms/MatsuyamaSheet";
import { OriginalImport } from "@/components/forms/OriginalImport";
import { OverlaySheet } from "@/components/forms/OverlaySheet";
import { UnconfirmedFold } from "@/components/forms/UnconfirmedFold";
import { FormAbout } from "@/components/forms/FormAbout";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { matsuyamaFrameSheet, type RouteMapImage } from "@/lib/forms/frame-build";
import { buildMatsuyamaSheet } from "@/lib/forms/matsuyama";
import { formsScope } from "@/lib/forms/mapping-db";
import { originalPageHref } from "@/lib/forms/originals";
import { loadOriginal } from "@/lib/forms/originals-http";
import { matsuyamaUnconfirmed, unconfirmedView } from "@/lib/forms/unconfirmed";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { loadPersonDocument } from "@/lib/consent/documents";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: "計画書" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[]; fill?: string | string[] }> };

// 松山市の様式の紙面（A4 表裏）。本人のページの「書類」から開く。
// 差し込みは台帳からサーバーで描く。Claude は呼ばない（氏名・住所・電話が入る）。
// 事業所の壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404）。
// 医療班・行政の同意の範囲（lib/consent/scope.ts）に計画書は無いので 404（T24）。
// T101: 事業所が市の原本を取り込んでいれば、原本の頁を下に敷いて原本の欄の矩形に値を置く紙（枠は原本のまま。lib/forms/frame-build.ts）。
// 取り込んでいなければ前からの紙面（T85）と、帯に「原本取込」。?fill=1 で未記入の欄を塗った版（原本の紙だけ）
export default async function MatsuyamaFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = wantsPrint(sp.print);
  const fill = wantsFill(sp.fill);
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "matsuyama");
  if (!opened) notFound();
  const { rows } = opened;
  const scope = formsScope(principal);
  const ownOffice = scope !== null && scope.officeId === rows.person.office_id;
  const [office, manifest] = await Promise.all([
    env.DB.prepare("SELECT name FROM offices WHERE id = ?1").bind(rows.person.office_id).first<{ name: string }>(),
    scope && ownOffice ? loadOriginal({ get: (key) => env.RECORDINGS.get(key) }, scope.officeId, "matsuyama") : null,
  ]);
  const sheet = buildMatsuyamaSheet(rows, { today: todayJst(), officeName: office?.name ?? null });
  // 紙面が「未確認」と刷る欄（台帳の pending の欄も入る。理由を添える）。帯だけで、紙には刷らない（T87）。原本の紙は同じ欄を空けて刷る
  const unconfirmed = unconfirmedView(matsuyamaUnconfirmed(sheet));
  // 避難経路の地図（T102 がここに渡す。lib/forms/frame-build.ts の RouteMapImage・ROUTE_MAP_BOX_MM）
  const routeMap: RouteMapImage | null = null;
  const framed = manifest ? matsuyamaFrameSheet(sheet, manifest, { routeMap }) : null;
  const here = `/people/${encodeURIComponent(id)}/forms/matsuyama`;

  return (
    <main className="py-4 print:p-0">
      <PaperBar
        back={`/people/${encodeURIComponent(id)}`}
        title="計画書"
        name={sheet.name}
        autoPrint={autoPrint}
        actions={framed && <FillToggle here={here} fill={fill} />}
      >
        <UnconfirmedFold view={unconfirmed} />
        {framed && framed.annex.length > 0 && (
          <span className="text-sm" data-annex-count={framed.annex.length}>
            <span className="text-muted">{L.annex}</span> <span className="font-bold tabular-nums">{framed.annex.length}</span>{" "}
            <span className="text-xs text-muted">{framed.annex.map((r) => r.label).join("・")}</span>
          </span>
        )}
        {ownOffice && !manifest && <OriginalImport id="matsuyama" />}
      </PaperBar>
      <FormAbout entry={DOCUMENT_CATALOG.matsuyama} />
      {framed ? (
        <OverlaySheet sheet={framed} imageSrc={(page) => originalPageHref("matsuyama", page)} checked="" fill={fill} kind="matsuyama" />
      ) : (
        <MatsuyamaSheet sheet={sheet} routeMap={routeMap} />
      )}
    </main>
  );
}
