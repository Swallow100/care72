import "@/components/forms/paper.css";
import "@/components/forms/form9-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TONE_TEXT } from "@/components/person/parts";
import { AutoPrint } from "@/components/forms/AutoPrint";
import { Form9Paper } from "@/components/forms/Form9Paper";
import { Form9Report } from "@/components/forms/Form9Report";
import { Form9Table } from "@/components/forms/Form9Table";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { colorCounts, FORM9_TITLE, NORMAL_ORDER_LABELS } from "@/lib/forms/form9";
import { form9Scope, loadForm9, loadSituation, type Form9Data } from "@/lib/forms/form9-db";
import { FORM9_CSV_PATH, parseEdit, parseError, parseSort, sortRows } from "@/lib/forms/form9-href";
import { form9Report, REPORT_COLORS, tally } from "@/lib/forms/form9-report";
import { wantsPrint } from "@/lib/forms/print";
import { warekiText } from "@/lib/forms/wareki";
import { COLOR_LABELS } from "@/lib/labels";
import { COLOR_TONES, formatJst } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ sort?: string | string[]; edit?: string | string[]; error?: string | string[]; print?: string | string[] }>;
};

// 様式 9（災害時利用者一覧表 安否確認優先順位）。事業所の全員を優先順位で並べ、順位を手で直せる。CSV で落とせる。
// 開けるのはケアマネの役（管理者・審査員のケアマネの役を含む）。ほかの役はそれぞれの入口へ送る（requirePage）。
// 発災時（災害モード、T09）は色と順位で並び、結果の列と市町村への報告の下書きが出る
// 印刷は様式 9 の紙（Form9Paper: A4 横、順位の順、報告の下書きつき）。画面の表と操作は紙に出さない。?print=1 で開くとすぐ印刷の窓。
export default async function Form9Page({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const sort = parseSort(q.sort);
  const scope = form9Scope(principal);

  let data: Form9Data | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = scope ? await loadForm9(env.DB, scope, { today: todayJst(), situation: await loadSituation(env.DB, scope.officeId) }) : null;
  } catch (e) {
    console.error("様式 9 を読めない", e);
    return <Message title="読込失敗" />;
  }
  if (!data) return <Message title="事業所なし" />;

  const { sheet, situation } = data;
  const disaster = sheet.mode === "disaster";
  const rows = sortRows(sheet.rows, sort);
  const edit = parseEdit(q.edit);
  const editing = edit && rows.some((r) => r.id === edit) ? edit : null;
  const manualCount = sheet.rows.filter((r) => r.manual).length;
  const counts = colorCounts(sheet.rows);
  const report = disaster && situation ? form9Report(sheet, { officeName: data.office.name, at: situation.now }) : null;
  const order =
    disaster && situation
      ? `発災時 色 → 時計の残り → 支援者なし → 骨格（${formatJst(situation.now)} 時点）`
      : `平時 ${NORMAL_ORDER_LABELS.join(" → ")}`;

  return (
    <main className="mx-auto max-w-[120rem] px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold">様式9</h1>
        <span className="text-sm text-muted">{FORM9_TITLE.replace(/^様式9：/, "")}</span>
        <span className="text-sm">{data.office.name}</span>
        <span className="text-sm">
          <span className="font-bold tabular-nums">{sheet.rows.length}</span> 人
        </span>
        {disaster ? (
          <dl className="flex flex-wrap gap-x-3 text-sm">
            {REPORT_COLORS.map((c) => (
              <div key={c} className="flex items-baseline gap-1">
                <dt className="text-muted">{COLOR_LABELS[c]}</dt>
                <dd className={`font-bold tabular-nums ${counts[c] > 0 ? TONE_TEXT[COLOR_TONES[c]] : "text-muted"}`}>{counts[c]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="text-sm text-muted">平時</span>
        )}
        <span className="text-sm">
          <span className="text-muted">手直し</span> <span className="font-bold tabular-nums">{manualCount}</span>
        </span>
        <a
          href={FORM9_CSV_PATH}
          download
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-on-accent"
          data-press="overlay"
        >
          CSV出力
        </a>
      </div>
      <p className="mt-1 text-xs text-muted">
        並び {disaster && situation ? `色 → 時計の残り → 支援者なし → 骨格（${formatJst(situation.now)} 時点）` : NORMAL_ORDER_LABELS.join(" → ")}
      </p>

      <div className="mt-3 grid gap-3">
        {report && <Form9Report text={report} tally={tally(sheet.rows)} />}
        <section aria-label="様式9 の表" className="min-w-0 overflow-x-auto">
          {rows.length === 0 ? (
            <p className="rounded-lg bg-panel p-6 text-muted">なし</p>
          ) : (
            <Form9Table rows={rows} sort={sort} edit={editing} error={editing ? parseError(q.error) : null} disaster={disaster} />
          )}
        </section>
      </div>
      <Form9Paper sheet={sheet} office={data.office.name} date={warekiText(todayJst())} order={order} report={report} />
      {wantsPrint(q) && <AutoPrint />}
    </main>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-lg bg-panel p-6">
        <h1 className="text-xl font-bold">{title}</h1>
      </section>
    </main>
  );
}
