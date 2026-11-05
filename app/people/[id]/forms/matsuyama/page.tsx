import "@/components/forms/paper.css";
import "@/components/forms/overlay-paper.css";
import "@/components/forms/review-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FillToggle, wantsFill } from "@/components/forms/FillToggle";
import { MatsuyamaSheet } from "@/components/forms/MatsuyamaSheet";
import { OriginalImport } from "@/components/forms/OriginalImport";
import { OverlaySheet } from "@/components/forms/OverlaySheet";
import { PaperEdit } from "@/components/forms/PaperEdit";
import { PaperFill } from "@/components/forms/PaperFill";
import { matsuyamaPaper } from "@/lib/forms/paper-fill-server";
import { paperEditData } from "@/lib/forms/paper-edit";
import { UnconfirmedFold } from "@/components/forms/UnconfirmedFold";
import { FormAbout } from "@/components/forms/FormAbout";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { parseLedger } from "@/lib/db/ledger";
import { routeMapFor } from "@/lib/forms/frame-build";
import { buildMatsuyamaSheet } from "@/lib/forms/matsuyama";
import { formsScope } from "@/lib/forms/mapping-db";
import { originalPageHref } from "@/lib/forms/originals";
import { loadOriginal } from "@/lib/forms/originals-http";
import { matsuyamaUnconfirmed, unconfirmedView } from "@/lib/forms/unconfirmed";
import { matsuyamaAskableOf } from "@/lib/forms/form-asks";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { loadPersonDocument } from "@/lib/consent/documents";
import { PaperReview, ReviewPrintNote } from "@/components/forms/PaperReview";
import { matsuyamaSubject } from "@/lib/forms/review";
import { canReview } from "@/lib/forms/review-load";
import { paperReviewProps } from "@/lib/forms/review-view";

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
  const fillOn = wantsFill(sp.fill);
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
  // 紙面が「未確認」と刷る欄（台帳の pending の欄も入る。理由を添える）。帯だけで、紙には刷らない（T87）。原本の紙は同じ欄を空けて刷る
  // 未確認のうち問いで埋められる欄（T117。本人のページの「問い 残り N 問」と同じ問いの列から）
  const askable = matsuyamaAskableOf(rows);
  // 避難経路の地図（T106）。台帳の経路地図（T102）を欄の大きさで描く。経路地図か家の位置が無ければ欄を空ける
  const routeMap = routeMapFor(parseLedger(rows.person.ledger));
  // 書けるのはケアマネの役（審査員を含む）で、自分の事業所の人だけ（保存も同じ壁。lib/intake/save.ts・lib/forms/form-entries-http.ts）
  const canWrite = principal.role === "care_manager" && ownOffice;
  // 紙の手入れ（T135）: 様式だけの欄の値・置いた文字の枠と画像を紙に効かせる。原本の枠の紙の書ける人には、その場で入れる画面の中身
  const { sheet, framed, fill } = await matsuyamaPaper(env.DB, {
    rows,
    officeId: rows.person.office_id,
    sheet: buildMatsuyamaSheet(rows, { today: todayJst(), officeName: office?.name ?? null }),
    manifest,
    routeMap,
    edit: canWrite,
  });
  const unconfirmed = unconfirmedView(matsuyamaUnconfirmed(sheet, askable));
  // 見直し（T136）。原本の枠の紙だけ、ケアマネの役で自分の事業所の人。紙は手入れ（T135）を効かせた後の物
  const review =
    framed && canReview(principal, rows.person.office_id)
      ? await paperReviewProps(env.DB, { personId: id, formKey: "matsuyama", subject: matsuyamaSubject(sheet, framed), sheet: framed, consents: rows.consents })
      : null;
  const here = `/people/${encodeURIComponent(id)}/forms/matsuyama`;
  // 紙に直接書く窓の欄と今の値（T117）。前からの紙面（原本を取り込む前）だけ。原本の枠の紙はその場で入れる（T135）
  const edit = canWrite && !framed ? paperEditData(rows) : null;

  const paper = framed ? (
    <OverlaySheet sheet={framed} imageSrc={(page) => originalPageHref("matsuyama", page)} checked="" fill={fillOn} kind="matsuyama" layer={fill !== null} />
  ) : (
    <MatsuyamaSheet sheet={sheet} routeMap={routeMap} />
  );

  return (
    <main className="py-4 print:p-0">
      <PaperBar
        back={`/people/${encodeURIComponent(id)}`}
        title="計画書"
        name={sheet.name}
        autoPrint={autoPrint}
        actions={
          <>
            {review && <ReviewPrintNote confirmed={review.confirmed !== null} />}
            {framed && <FillToggle here={here} fill={fillOn} />}
          </>
        }
      >
        <UnconfirmedFold view={unconfirmed} />
        {review && <PaperReview {...review} />}
        {framed && framed.annex.length > 0 && (
          <span className="text-sm" data-annex-count={framed.annex.length}>
            <span className="text-muted">{L.annex}</span> <span className="font-bold tabular-nums">{framed.annex.length}</span>{" "}
            <span className="text-xs text-muted">{framed.annex.map((r) => r.label).join("・")}</span>
          </span>
        )}
        {ownOffice && !manifest && <OriginalImport id="matsuyama" />}
      </PaperBar>
      <FormAbout entry={DOCUMENT_CATALOG.matsuyama} />
      {fill ? <PaperFill data={fill}>{paper}</PaperFill> : edit ? <PaperEdit data={edit}>{paper}</PaperEdit> : paper}
    </main>
  );
}
