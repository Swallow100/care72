import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { PersonWithIntake } from "@/components/person/PersonWithIntake";
import { BackLink, Page } from "@/components/ui/Panel";
import { todayJst } from "@/lib/age";
import { homePath } from "@/lib/auth/roles";
import { requirePage } from "@/lib/auth/server";
import { hasAnthropicKey } from "@/lib/claude/client";
import { scopeOfRows } from "@/lib/consent/scope";
import { personDisaster } from "@/lib/disaster/person";
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
  const view = toPersonView(rows, { today: todayJst(), mode: d.mode, triage: d.triage, scope });
  // 入れる欄（T03）はケアマネの役だけ。鍵が無ければ「AI 未設定」と手入力
  const intake = principal.role === "care_manager" ? intakePropsOf(rows, hasAnthropicKey(env)) : null;

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
