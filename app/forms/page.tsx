import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentMenu, DocumentPeople } from "@/components/forms/DocumentList";
import { FormsTabs } from "@/components/ui/Tabs";
import { todayJst } from "@/lib/age";
import { caseloadScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";
import { loadCaseload } from "@/lib/caseload";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import {
  batchHref,
  documentMenu,
  FORMS_LIST_LABELS as L,
  personDocRow,
  planRow,
  resolvePlanForm,
  selectDocument,
  type PersonDocRow,
} from "@/lib/forms/document-list";
import { loadOfficeSheetRows } from "@/lib/forms/own-sheets";
import { listPlanForms, loadPlanForm } from "@/lib/forms/plan-form";
import { listView } from "@/lib/list/view";
import { listMappings } from "@/lib/forms/mapping-db";
import { FORM9_CSV_PATH, FORM9_PATH } from "@/lib/forms/form9-href";
import { StateTag } from "@/components/ui/Tag";
import { DownloadIcon } from "@/components/ui/Icon";

// D1 を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: L.title };

type Param = string | string[];
type Props = { searchParams: Promise<{ form?: Param; doc?: Param; added?: Param; form_error?: Param }> };

// 書類の一覧（docs/tasks/T87.md）。ヘッダーの「書類」。書類と様式を選び、担当の利用者の 1 人か全員の一括で出す。
// 計画書は事業所の使える様式を全部（使用様式は「既定」の印だけ。選ぶのは事業所の画面）。?form= で使用様式でない様式も出せる。
// 事業所の候補に無い様式（ほかの事業所の対応表・下書き）・知らない値は 404。
// 人の並びは担当一覧の既定の並び（lib/list/view.ts の listView、一括印刷と同じ）。読みは本人の 1 枚の一括と同じ D1 の batch 1 回
// （lib/forms/own-sheets.ts の loadOfficeSheetRows）で、紙面は 1 人の頁と同じ組み方（Claude は呼ばない）。
// 開けるのはケアマネの役（担当一覧と同じ入口）。
// T147: 事業所が足した様式（確認済）は計画書の段の上に「追加済」、確認保存の前の下書きは「下書き」で確かめの画面へ。
// 確認保存の直後（?added=1）はその様式を選んだ形で開き、題の横に「追加済」。使用様式の選び（前は事業所の画面）は「既定設定」、
// 様式 9 の CSV 出力（前は事業所の画面）は事業所の段に。
export default async function FormsListPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const scope = caseloadScope(principal);
  if (!scope) return <Message title="事業所なし" />;
  const q = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const today = todayJst();

  const [options, current, data, mappings] = await Promise.all([
    listPlanForms(env.DB, scope.officeId),
    loadPlanForm(env.DB, scope.officeId),
    loadCaseload(env.DB, scope, today),
    listMappings(env.DB, scope.officeId),
  ]);
  const drafts = mappings.filter((m) => m.status === "draft").map((m) => ({ id: m.id, title: m.title, issuer: m.issuer }));
  if (!data) return <Message title="事業所なし" />;
  const sel = selectDocument(options, current.id, q);
  if (!sel) notFound();
  const form = sel.doc === "plan" ? await resolvePlanForm(env.DB, scope.officeId, sel.form) : null;
  if (sel.doc === "plan" && !form) notFound();

  const ids = listView(data, {}).rows.map((r) => r.id);
  const read = await loadOfficeSheetRows(env.DB, scope.officeId, ids);
  const opts = { today, officeName: data.office.name };
  const rows: PersonDocRow[] = ids.flatMap((id) => {
    const hit = read.get(id);
    if (!hit) return [];
    return [form ? planRow(hit.rows, form, opts) : personDocRow(sel.doc as Exclude<typeof sel.doc, "plan">, hit.rows, opts)];
  });

  const menu = documentMenu(options, current.id, sel, drafts);
  // 確認保存の直後に開いた様式（?added=1）
  const added = q.added === "1" && sel.doc === "plan" && sel.form.id.startsWith("mapping:") ? sel.form.entry.short : null;
  const entry = sel.doc === "plan" ? sel.form.entry : sel.entry;
  const counted = sel.doc === "plan" || sel.doc === "medical" || sel.doc === "own";

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <FormsTabs current="list" />
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-xl leading-8 font-bold">{L.title}</h1>
        <span className="text-sm">{data.office.name}</span>
        <span className="text-sm">
          <span className="text-muted">{L.people}</span> <span className="font-bold tabular-nums">{rows.length}</span> 人
        </span>
        {added && (
          <span role="status" className="text-sm" data-added-notice>
            <StateTag tone="ok">{L.added}</StateTag> {added}
          </span>
        )}
        {q.form_error === "bad" && (
          <span role="alert" className="text-sm font-bold text-danger">
            {L.saveFailed}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <DocumentMenu
          plan={menu.plan}
          person={menu.person}
          office={[
            {
              key: "form9",
              label: DOCUMENT_CATALOG.form9.short,
              note: DOCUMENT_CATALOG.form9.version,
              href: FORM9_PATH,
              current: false,
              isDefault: false,
            },
          ]}
          officeAction={
            <a href={FORM9_CSV_PATH} download className="-mx-0.5 inline-flex items-center gap-1 rounded px-0.5 text-xs text-accent underline underline-offset-2" data-press data-form9-csv>
              <DownloadIcon aria-hidden className="size-3.5 shrink-0" />
              {L.csv}
            </a>
          }
        />
        <DocumentPeople
          entry={entry}
          isDefault={sel.doc === "plan" && sel.form.id === current.id}
          rows={rows}
          batch={batchHref(sel)}
          counted={counted}
          setDefault={sel.doc === "plan" && sel.form.id !== current.id ? sel.form.id : null}
        />
      </div>
    </main>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <FormsTabs current="list" />
      <h1 className="mt-2 text-xl leading-8 font-bold">{L.title}</h1>
      <p className="mt-2 text-sm">{title}</p>
    </main>
  );
}
