import "@/components/forms/paper.css";
import "@/components/forms/mapped-paper.css";
import "@/components/forms/overlay-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FillToggle, wantsFill } from "@/components/forms/FillToggle";
import { MappedSheet } from "@/components/forms/MappedSheet";
import { OverlaySheet } from "@/components/forms/OverlaySheet";
import { StateTag } from "@/components/person/parts";
import { UnconfirmedFold } from "@/components/forms/UnconfirmedFold";
import { ButtonLink } from "@/components/ui/Button";
import { FormAbout } from "@/components/forms/FormAbout";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { canViewPage } from "@/lib/auth/roles";
import { requirePage } from "@/lib/auth/server";
import { MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { CAO_ENTRY, mappingEntry } from "@/lib/forms/catalog";
import { loadCheckedMapping } from "@/lib/forms/mapping-db";
import { CAO_MAPPING_ID, caoMapping } from "@/lib/forms/plan-form";
import { canOverlay } from "@/lib/forms/overlay-sheet";
import { mappedPaper } from "@/lib/forms/paper-fill-server";
import { formsScope } from "@/lib/forms/mapping-db";
import { PaperFill } from "@/components/forms/PaperFill";
import { pageImageHref } from "@/lib/forms/page-images";
import { mappedUnconfirmed, unconfirmedView } from "@/lib/forms/unconfirmed";
import { warekiText } from "@/lib/forms/wareki";
import { CONSENT_KIND_LABELS } from "@/lib/labels";
import { loadPersonDocument } from "@/lib/consent/documents";
import { formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: "様式差込" };

type Props = {
  params: Promise<{ id: string; mappingId: string }>;
  searchParams: Promise<{ print?: string | string[]; view?: string | string[]; fill?: string | string[] }>;
};

// 汎用の差し込み（docs/tasks/T08.md）。確かめた対応表（確認済だけ）と台帳から、様式の欄の順に値を並べた紙面（A4、表の形）。
// 差し込みは台帳からサーバーで描く。Claude は呼ばない（氏名・住所・電話が入る）。同意の範囲は松山市の様式と同じ。
// 本人の壁は本人のページと同じ（loadPersonPage が personInScope を通す）。対応表は本人の事業所の物だけ（ほかの事業所・下書きは 404）
// 医療班・行政の同意の範囲に差し込みの書類は無いので 404（T24、lib/consent/scope.ts）
// mappingId が builtin-cao なら内閣府の様式例（コードに持つ対応表。T08 で手で起こした物で、ケアマネの確認は経ていない。T47）
// T86: 対応表に元の様式の頁の画像と欄の場所があれば、元の様式の頁を下に敷いて欄の場所に値を置いた紙（OverlaySheet）。
// 無ければ（T86 の前の対応表・場所を読めなかった・内閣府の様式例）前からの「欄名｜値」の 2 列の紙。?view=list でいつでも 2 列に
export default async function MappedFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id, mappingId } = await params;
  const sp = await searchParams;
  const autoPrint = wantsPrint(sp.print);
  const listView = sp.view === "list";
  // 未記入の欄（帯の未確認と同じ欄）を塗った版（T101。元の様式の上の紙だけ）
  const fillOn = wantsFill(sp.fill);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mappingId)) notFound();
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "mapped");
  if (!opened) notFound();
  const { rows } = opened;
  const builtin = mappingId === CAO_MAPPING_ID;
  const [stored, office] = await Promise.all([
    builtin ? null : loadCheckedMapping(env.DB, rows.person.office_id, mappingId),
    env.DB.prepare("SELECT name FROM offices WHERE id = ?1").bind(rows.person.office_id).first<{ name: string }>(),
  ]);
  if (!builtin && !stored) notFound();
  const mapping = stored ? stored.mapping : caoMapping();
  const entry = stored
    ? mappingEntry({ id: stored.id, title: stored.title, issuer: stored.mapping.issuer, checkedAt: stored.checked_at })
    : CAO_ENTRY;

  const today = todayJst();
  const checked = stored
    ? `${stored.checked_at ? formatJst(stored.checked_at).slice(0, 10) : ""} ${stored.checked_by_name ?? ""}`.trim()
    : "手作成・未確認";
  const editable = canViewPage(principal.role, "caseload") && stored !== null;
  const images = stored?.pageImages ?? null;
  // 紙の手入れ（T135）: 様式だけの欄の値・置いた文字の枠と画像を紙に効かせる。書けるのはケアマネの役で自分の事業所の人（保存も同じ壁）
  const scope = formsScope(principal);
  const { sheet, overlay, fill } = await mappedPaper(env.DB, {
    rows,
    officeId: rows.person.office_id,
    mappingId,
    mapping,
    images,
    opts: { today, officeName: office?.name ?? null },
    overlay: !listView && stored !== null,
    edit: principal.role === "care_manager" && scope !== null && scope.officeId === rows.person.office_id && stored !== null,
  });
  const here = `/people/${encodeURIComponent(id)}/forms/mapped/${encodeURIComponent(mappingId)}`;

  return (
    <main className="py-4 print:p-0">
      <PaperBar
        back={`/people/${encodeURIComponent(id)}`}
        title={sheet.title}
        name={sheet.name}
        autoPrint={autoPrint}
        actions={
          <>
            {overlay && <FillToggle here={here} fill={fillOn} />}
            {/* 元の様式の上の紙と、欄名｜値の 2 列の紙の切替（T86） */}
            {overlay && (
              <ButtonLink href={`${here}?view=list`} kind="plain">
                一覧
              </ButtonLink>
            )}
            {listView && canOverlay(mapping.fields, images) && (
              <ButtonLink href={here} kind="plain">
                元様式
              </ButtonLink>
            )}
            {editable && (
              <ButtonLink href={`/forms/mapping/${encodeURIComponent(stored!.id)}`} kind="plain">
                対応表
              </ButtonLink>
            )}
          </>
        }
      >
        {/* 未確認の欄（元の様式の上の紙は空けて刷る欄）。押すと欄の一覧。帯だけで、紙には刷らない（T87） */}
        <UnconfirmedFold view={unconfirmedView(mappedUnconfirmed(sheet))} />
        {sheet.unmapped.length > 0 && (
          <span className="text-sm">
            <span className="text-muted">{L.unmapped}</span> <span className="font-bold tabular-nums">{sheet.unmapped.length}</span>
          </span>
        )}
        {sheet.withheld.map((k) => (
          <StateTag key={k} tone="check">
            {L.withheld} {CONSENT_KIND_LABELS[k]}
          </StateTag>
        ))}
        {overlay && overlay.annex.length > 0 && (
          <span className="text-sm" data-annex-count={overlay.annex.length}>
            <span className="text-muted">{L.annex}</span> <span className="font-bold tabular-nums">{overlay.annex.length}</span>{" "}
            <span className="text-xs text-muted">{overlay.annex.map((r) => r.label).join("・")}</span>
          </span>
        )}
      </PaperBar>
      <FormAbout entry={entry} />
      {overlay && fill ? (
        <PaperFill data={fill}>
          <OverlaySheet sheet={overlay} imageSrc={(page) => pageImageHref(stored!.id, page)} checked={checked} fill={fillOn} layer />
        </PaperFill>
      ) : overlay ? (
        <OverlaySheet sheet={overlay} imageSrc={(page) => pageImageHref(stored!.id, page)} checked={checked} fill={fillOn} />
      ) : (
        <MappedSheet sheet={sheet} meta={{ date: warekiText(today), checked, office: office?.name ?? null, author: rows.careManagerName }} />
      )}
    </main>
  );
}
