import "@/components/forms/paper.css";
import "@/components/forms/mapped-paper.css";
import "@/components/forms/overlay-paper.css";
import "@/components/forms/medical-paper.css";
import "@/components/forms/paper-batch.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FillToggle, wantsFill } from "@/components/forms/FillToggle";
import { PaperBatch, type BatchPaper } from "@/components/forms/PaperBatch";
import { Panel } from "@/components/ui/Panel";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { StateTag } from "@/components/ui/Tag";
import { todayJst } from "@/lib/age";
import { caseloadScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";
import { loadCaseload } from "@/lib/caseload";
import { parseLedger } from "@/lib/db/ledger";
import { hasFillablePaper, matsuyamaBatchPaper, medicalBatchPaper } from "@/lib/forms/batch";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { buildPlanSheet, FORMS_BATCH_PATH, listHref, planUnconfirmed, resolvePlanForm, selectDocument } from "@/lib/forms/document-list";
import { EXPORT_LABELS } from "@/lib/forms/export-paths";
import { buildMedicalSummary } from "@/lib/forms/medical-summary";
import { buildOverlaySheet, canOverlay } from "@/lib/forms/overlay-sheet";
import { loadOriginal } from "@/lib/forms/originals-http";
import { loadOfficeSheetRows } from "@/lib/forms/own-sheets";
import { pageImageHref } from "@/lib/forms/page-images";
import { listPlanForms, loadPlanForm } from "@/lib/forms/plan-form";
import { UNCONFIRMED_LABELS } from "@/lib/forms/unconfirmed";
import { warekiText } from "@/lib/forms/wareki";
import { BLANK_LABELS } from "@/lib/labels";
import { listView } from "@/lib/list/view";
import { formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: "書類一括" };

type Param = string | string[];
type Props = { searchParams: Promise<{ form?: Param; doc?: Param; print?: Param; fill?: Param }> };

// 書類の一括印刷（docs/tasks/T87.md の 2）。書類の一覧（/forms）の「一括印刷」から、担当の利用者の全員を担当一覧の既定の並びで。
// 計画書（?form= の様式。使用様式でなくてよい。事業所の候補に無い様式は 404）と医療要約（?doc=medical）。本人の 1 枚は /caseload/own-sheets。
// 作りは本人の 1 枚の一括（app/caseload/own-sheets、T62）と同じ: 読みは D1 の batch 1 回、1 人ずつは 1 人の頁と同じ組み方（Claude は呼ばない）、
// 紙面を人数分並べ人の間で頁を割る。医療要約は同意の無い人を飛ばして数える。上の帯（紙には出さない）に人数・未入力のある人・飛ばした人。
// ?print=1 で開くとすぐ印刷の窓。印刷したことは経過に残さない（1 人の頁・様式 9 と同じ）。
// T106: 事業所が原本を取り込んでいれば（T101）、計画書（松山市）と医療要約も 1 人ずつの紙と同じ原本の枠の紙、?fill=1 で未記入の色付けの版
// （1 人分は lib/forms/batch.ts）。計画書はどちらの紙でも台帳の経路地図を避難経路の欄に。
export default async function FormsBatchPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const scope = caseloadScope(principal);
  if (!scope) notFound();
  // 一括にできるのは計画書と医療要約
  if (q.form === undefined && q.doc !== "medical") notFound();
  const { env } = await getCloudflareContext({ async: true });
  const today = todayJst();

  const [options, current, data] = await Promise.all([
    listPlanForms(env.DB, scope.officeId),
    loadPlanForm(env.DB, scope.officeId),
    loadCaseload(env.DB, scope, today),
  ]);
  if (!data) notFound();
  const sel = selectDocument(options, current.id, { form: q.form, doc: q.doc });
  if (!sel || (sel.doc !== "plan" && sel.doc !== "medical")) notFound();
  const form = sel.doc === "plan" ? await resolvePlanForm(env.DB, scope.officeId, sel.form) : null;
  if (sel.doc === "plan" && !form) notFound();

  const ids = listView(data, {}).rows.map((r) => r.id);
  // 事業所が取り込んだ原本（T101）。あれば計画書（松山市）・医療要約を 1 人ずつの紙と同じ原本の枠の紙に（T106）
  const original = form?.kind === "matsuyama" ? "matsuyama" : sel.doc === "medical" ? "kiroku" : null;
  const [read, manifest] = await Promise.all([
    loadOfficeSheetRows(env.DB, scope.officeId, ids),
    original ? loadOriginal({ get: (key) => env.RECORDINGS.get(key) }, scope.officeId, original) : null,
  ]);
  const fill = wantsFill(q.fill);
  const opts = { today, officeName: data.office.name };
  const stored = form?.kind === "mapped" ? form.stored : null;
  const images = stored?.pageImages ?? null;
  const overlay = form?.kind === "mapped" && stored !== null && canOverlay(form.mapping.fields, images);
  const checked = stored
    ? `${stored.checked_at ? formatJst(stored.checked_at).slice(0, 10) : ""} ${stored.checked_by_name ?? ""}`.trim()
    : "手作成・未確認";

  const papers: BatchPaper[] = [];
  /** 台帳で直せる未確認（未入力）のある人と数 */
  const blanks: string[] = [];
  let skipped = 0;
  for (const id of ids) {
    const hit = read.get(id);
    if (!hit) {
      skipped += 1;
      continue;
    }
    const rows = hit.rows;
    if (form) {
      const plan = buildPlanSheet(rows, form, opts);
      const n = planUnconfirmed(plan).fields.filter((f) => !f.noSource).length;
      if (n > 0) blanks.push(`${rows.person.name} ${n}`);
      if (plan.kind === "matsuyama") {
        papers.push(matsuyamaBatchPaper({ personId: id, sheet: plan.sheet, ledger: parseLedger(rows.person.ledger), manifest, fill }));
      } else if (overlay && form.kind === "mapped" && images) {
        papers.push({
          kind: "overlay",
          personId: id,
          sheet: buildOverlaySheet(plan.sheet, images, form.mapping.typeface),
          mappingId: form.mappingId,
          checked,
          imageSrc: (page) => pageImageHref(form.mappingId, page),
          fill,
        });
      } else {
        papers.push({
          kind: "mapped",
          personId: id,
          sheet: plan.sheet,
          meta: { date: warekiText(today), checked, office: data.office.name, author: rows.careManagerName },
        });
      }
    } else {
      // 医療要約。同意の無い人は 1 人の頁でも紙面を作らない（T07・T24）ので飛ばす
      const r = buildMedicalSummary(rows, opts);
      if (r.kind !== "sheet") {
        skipped += 1;
        continue;
      }
      const one = medicalBatchPaper({ personId: id, sheet: r.sheet, manifest, fill });
      if (one.blank > 0) blanks.push(`${rows.person.name} ${one.blank}`);
      papers.push(one.paper);
    }
  }
  const entry = sel.doc === "plan" ? sel.form.entry : DOCUMENT_CATALOG.medical;
  const any = papers.length > 0;
  // 未記入の色付け（T101）は原本の枠の紙と添付の様式の上の紙に効く。1 人ずつの紙と同じ切替
  const fillKeep: Record<string, string> = sel.doc === "plan" ? { form: sel.form.id } : { doc: "medical" };

  return (
    <main className="py-4 print:p-0">
      <PaperBar
        back={sel.doc === "plan" ? listHref({ doc: "plan", id: sel.form.id }) : listHref({ doc: "medical" })}
        title={entry.short}
        name={`${papers.length} 人`}
        print={any}
        autoPrint={any && wantsPrint(q.print)}
        actions={hasFillablePaper(papers) && <FillToggle here={FORMS_BATCH_PATH} fill={fill} keep={fillKeep} />}
      >
        {blanks.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2" data-blank-people={blanks.length}>
            <StateTag tone="check">
              {UNCONFIRMED_LABELS.blank} <span className="tabular-nums">{blanks.length}</span> 人
            </StateTag>
            <span className="text-sm text-muted">{blanks.join("・")}</span>
          </div>
        )}
        {skipped > 0 && (
          <span data-skipped={skipped}>
            <StateTag tone="check">
              {EXPORT_LABELS.skipped} <span className="tabular-nums">{skipped}</span> 人
            </StateTag>
          </span>
        )}
      </PaperBar>
      {any ? (
        <PaperBatch papers={papers} />
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
