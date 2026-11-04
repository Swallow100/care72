import "@/components/forms/paper.css";
import "@/components/forms/medical-paper.css";
import "@/components/forms/overlay-paper.css";
import "@/components/forms/mapped-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MedicalSummaryBasis } from "@/components/forms/MedicalSummaryBasis";
import { MedicalSource } from "@/components/forms/MedicalSource";
import { MedicalSummarySheet } from "@/components/forms/MedicalSummarySheet";
import { MedicalWithheld } from "@/components/forms/MedicalWithheld";
import { FillToggle, wantsFill } from "@/components/forms/FillToggle";
import { OriginalImport } from "@/components/forms/OriginalImport";
import { OverlaySheet } from "@/components/forms/OverlaySheet";
import { UnconfirmedFold } from "@/components/forms/UnconfirmedFold";
import { StateTag } from "@/components/person/parts";
import { FormAbout } from "@/components/forms/FormAbout";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { loadPersonDocument, medicalSummaryView } from "@/lib/consent/documents";
import { personDisaster } from "@/lib/disaster/person";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { buildMedicalSummary } from "@/lib/forms/medical-summary";
import { kirokuFrameSheet } from "@/lib/forms/frame-build";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { formsScope } from "@/lib/forms/mapping-db";
import { originalPageHref } from "@/lib/forms/originals";
import { loadOriginal } from "@/lib/forms/originals-http";
import { medicalUnconfirmed, unconfirmedView } from "@/lib/forms/unconfirmed";
import { BLANK_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { toPersonView } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: DOCUMENT_LABELS.medical };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[]; fill?: string | string[] }> };

// 医療要約の紙面（A4 1 枚、災害診療記録 2018 の順）。本人のページの「書類」から開く。医療班・行政も本人のページの書類から開いて印刷する（T24）。
// 組み立ては台帳からサーバーで。Claude は呼ばない（氏名・電話が入る）。
// 壁は本人のページと同じ（loadPersonPage が personInScope を通す。範囲の外は 404。医療班・行政は受け持ちの間だけ）。
// 医療班・行政は同意の範囲（lib/consent/scope.ts）: 医療班への提供に同意の無い人は 404、ある人は住所・本人の電話を描かず、
// 支援者は役割名だけ（lib/consent/documents.ts）。ケアマネには同意の無い人は中身を作らず「同意なし」「未確認」だけ。
// 「なぜこの行があるか」の脇はケアマネ（審査員のケアマネの役を含む）の画面だけ。紙には出さない。
// 右に「原本」（本人のページの 基本・医療・避難・人、見る人の範囲のまま）を並べ、要約と見比べられるようにする（docs/DECISIONS.md「書類」）。
// T101: 事業所（ケアマネの役）が災害診療記録2018 の原本を取り込んでいれば、原本の 1 頁目を下に敷いて欄の矩形に値を置く紙
// （医師が書く欄は空ける。様式に置き場の無い値は別紙。lib/forms/frame-build.ts）。帯の未確認はその紙が空ける欄、?fill=1 で塗った版。
// 医療班・行政（原本の頁を読む壁の外）と、取り込む前は前からの紙面（T85）
export default async function MedicalFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = wantsPrint(sp.print);
  const fill = wantsFill(sp.fill);
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
  const d = sheet ? await personDisaster(env.DB, rows) : null;
  const source = d ? toPersonView(rows, { today: todayJst(), mode: d.mode, triage: d.triage, situation: d.situation, scope }) : null;
  const forms = formsScope(principal);
  const ownOffice = forms !== null && forms.officeId === rows.person.office_id;
  const manifest = forms && ownOffice && sheet ? await loadOriginal({ get: (key) => env.RECORDINGS.get(key) }, forms.officeId, "kiroku") : null;
  const framed = sheet && manifest ? kirokuFrameSheet(sheet, manifest) : null;
  const here = `/people/${encodeURIComponent(id)}/forms/medical`;

  return (
    <main className="py-4 print:p-0">
      {/* 同意が無く紙面を作らない人は印刷を出さない */}
      <PaperBar
        back={`/people/${encodeURIComponent(id)}`}
        title={DOCUMENT_LABELS.medical}
        name={rows.person.name}
        print={sheet !== null}
        autoPrint={autoPrint && sheet !== null}
        actions={framed && <FillToggle here={here} fill={fill} />}
      >
        {/* 原本の枠の紙は、紙が空ける欄（色付けで塗る欄）を数える（T101）。前からの紙面は台帳の pending */}
        {framed && sheet && <UnconfirmedFold view={unconfirmedView(medicalUnconfirmed(sheet))} />}
        {framed && framed.annex.length > 0 && (
          <span className="text-sm" data-annex-count={framed.annex.length}>
            <span className="text-muted">{L.annex}</span> <span className="font-bold tabular-nums">{framed.annex.length}</span>{" "}
            <span className="text-xs text-muted">{framed.annex.map((r) => r.label).join("・")}</span>
          </span>
        )}
        {sheet && ownOffice && !manifest && <OriginalImport id="kiroku" />}
        {!framed && sheet && sheet.pending.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2" data-pending={sheet.pending.length}>
            <StateTag tone="check">
              {BLANK_LABELS.unconfirmed} <span className="tabular-nums">{sheet.pending.length}</span>
            </StateTag>
            <span className="text-sm text-muted">{sheet.pending.map((p) => p.label).join("・")}</span>
          </div>
        )}
      </PaperBar>
      <FormAbout entry={DOCUMENT_CATALOG.medical} />
      {result.kind === "sheet" ? (
        <div className="flex flex-col items-center gap-4 xl:flex-row xl:items-start xl:justify-center print:block">
          {/* 狭い画面では紙面の箱だけを横に送る（画面全体を横に送らない。印刷プレビューの例外） */}
          <div className="max-w-full min-w-0 print:max-w-none">
            {framed ? (
              <OverlaySheet sheet={framed} imageSrc={(page) => originalPageHref("kiroku", page)} checked="" fill={fill} kind="kiroku" />
            ) : (
              <MedicalSummarySheet sheet={result.sheet} />
            )}
          </div>
          <div className="screen-only grid w-full max-w-xl content-start gap-3 px-4 xl:w-[26rem] xl:shrink-0 xl:px-0 xl:pr-4">
            {source && <MedicalSource view={source} />}
            {showBasis && <MedicalSummaryBasis sheet={result.sheet} />}
          </div>
        </div>
      ) : (
        <div className="px-4">
          <MedicalWithheld kind={result.kind} consent={result.consent} />
        </div>
      )}
    </main>
  );
}
