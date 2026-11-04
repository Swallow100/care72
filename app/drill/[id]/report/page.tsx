import "@/components/forms/paper.css";
import "@/components/drill/drill-paper.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { DrillPaper } from "@/components/drill/DrillPaper";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { todayJst } from "@/lib/age";
import { aiStatusFor } from "@/lib/claude/cloudflare";
import type { AiStatus } from "@/lib/claude/status";
import { requirePage } from "@/lib/auth/server";
import { drillScope } from "@/lib/drill/db";
import { isDrillId } from "@/lib/drill/http";
import { SCENARIO_LABELS } from "@/lib/drill/labels";
import { drillHref, DRILL_PATH } from "@/lib/drill/paths";
import { loadDrillRecord, type DrillRecord } from "@/lib/drill/record";
import { SCORE_LABELS } from "@/lib/drill/score-labels";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: `${SCORE_LABELS.paper} | ケア72` };

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[] }> };

// 訓練記録の紙面（docs/tasks/T22.md）。A4 縦、印刷で PDF（components/drill/DrillPaper、components/drill/drill-paper.css）。
// 終わった・中断した訓練だけ（進行中は採点が無いので訓練の画面へ戻す案内だけ）。採点がまだなら数えて残す（lib/drill/record.ts）。
// 訓練の画面の上の帯の「訓練記録」「印刷」から開く。「印刷」は ?print=1 で、開いてすぐ 1 回だけ印刷の画面（components/ui/PrintButton）。
// 壁は訓練の画面と同じ（ケアマネの役、事業所の中だけ。範囲の外・無い訓練は該当なし）。
export default async function DrillReportPage({ params, searchParams }: Props) {
  const principal = await requirePage("drill");
  const scope = drillScope(principal);
  const { id } = await params;
  const autoPrint = wantsPrint((await searchParams).print);
  if (!scope || !isDrillId(id)) return <Message back={DRILL_PATH} title="該当なし" />;

  let record: DrillRecord | "running" | null;
  let office = "";
  // AI の今の状態（T76。作っていない講評を「AI 停止（未設定）」と書く）。読めなければ null
  let ai: AiStatus | null = null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    record = await loadDrillRecord(env.DB, scope, id, new Date().toISOString());
    office = (await env.DB.prepare("SELECT name FROM offices WHERE id = ?1").bind(scope.officeId).first<{ name: string }>())?.name ?? "";
    ai = await aiStatusFor(scope.officeId).catch(() => null);
  } catch (e) {
    console.error("訓練記録を読めない", e);
    return <Message back={drillHref(id)} title="読込失敗" />;
  }
  if (record === null) return <Message back={DRILL_PATH} title="該当なし" />;
  if (record === "running") return <Message back={drillHref(id)} title="進行中" />;

  return (
    <main className="py-4 print:p-0">
      <PaperBar back={drillHref(id)} title={SCORE_LABELS.paper} name={SCENARIO_LABELS[record.screen.drill.scenario]} autoPrint={autoPrint} />
      <div className="paper-scroll">
        <div className="paper-stack">
          <DrillPaper record={record} office={office} today={todayJst()} ai={ai} />
        </div>
      </div>
    </main>
  );
}

function Message({ back, title }: { back: string; title: string }) {
  return (
    <main className="py-4">
      <PaperBar back={back} title={title} print={false} />
    </main>
  );
}
