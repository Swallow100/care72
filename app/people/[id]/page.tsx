import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { PersonWithIntake } from "@/components/person/PersonWithIntake";
import { BackLink, Page } from "@/components/ui/Panel";
import { todayJst } from "@/lib/age";
import { homePath } from "@/lib/auth/roles";
import { requirePage } from "@/lib/auth/server";
import { aiStatusFor } from "@/lib/claude/cloudflare";
import { scopeOfRows } from "@/lib/consent/scope";
import { personDisaster } from "@/lib/disaster/person";
import { loadPlanForm, planFormView } from "@/lib/forms/plan-form";
import { intakePropsOf } from "@/lib/intake/props";
import { loadPersonPage, toPersonView } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// 本人のページ（単独で開く形）。担当一覧の右の面（/?open=<id>）と同じ物を出す。
// 事業所の壁: 範囲の外の id は、在っても無くても同じ 404（lib/auth/scope.ts の personInScope）。
// 災害モード（T09）のときは経過が一番上、優先の所にルールの表の色と理由。ケアマネの役には右に入れる欄（T03）。
// 医療班・行政は同じ形で、見える区分は同意の範囲（T24、lib/consent/scope.ts）。経過の書き足しはケアマネ・医療班・行政。
export default async function PersonPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, id);
  if (!rows) notFound();
  // 本人の事業所が災害モードなら経過が一番上、上に色と理由の 1 行（lib/disaster/person.ts）。色は台帳の全部から出す
  const d = await personDisaster(env.DB, rows);
  // 見える区分は役と同意で（lib/consent/scope.ts）。医療班・行政は医療・避難・人の一部、同意が無ければ本人確認と医療班・行政の経過だけ
  const scope = scopeOfRows(principal.role, rows);
  // 災害モードは上の医療の印と時計の欄を今の残りに（situation を渡す）
  // 書類の行の計画書は事業所の選んだ様式（T47）
  const planForm = planFormView(await loadPlanForm(env.DB, rows.person.office_id));
  // 経過の撤回のボタン（T63）は見ている人が撤回できる行だけ（lib/timeline/retract.ts。押せるかはサーバーがもう一度決める）
  // reading: 見る方の画面（当たり前の値・未入力の添え・時計の重なりを出さない。T143）。面の編集（SectionEdit）は台帳の値を別に読む
  const view = toPersonView(rows, { today: todayJst(), mode: d.mode, triage: d.triage, situation: d.situation, scope, planForm, viewer: principal, reading: true });
  // 入れる欄（T03）はケアマネの役だけ。AI が使えなければ「AI 未設定」「AI 上限到達」と手入力（AI の状態は lib/claude/status.ts の 1 か所。T76）
  const intake = principal.role === "care_manager" ? intakePropsOf(rows, await aiStatusFor(rows.person.office_id)) : null;

  return (
    <Page width="full" className="max-w-6xl">
      {/* 戻るは左上に 1 つ */}
      <BackLink href={homePath(principal.role)} />
      <div className="mt-1">
        <PersonWithIntake view={view} level={1} intake={intake} />
      </div>
    </Page>
  );
}
