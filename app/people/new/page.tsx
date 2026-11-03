import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NewPersonForm } from "@/components/office/NewPersonForm";
import { Page, PageHead, Panel, PanelHead } from "@/components/ui/Panel";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { ASSIGN_ANCHOR } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { activeCareManagers, listCareManagers, type CareManagerItem } from "@/lib/office/people";
import { officeActor } from "@/lib/office/scope";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ back?: string | string[] }> };

/** 戻り先。事業所の担当の区分から来たら（?back=office）そこへ、ほかは担当一覧 */
function backOf(v: unknown): string {
  return v === "office" ? `/office#${ASSIGN_ANCHOR}` : "/";
}

// 利用者追加（docs/tasks/T30.md）。担当一覧の右上と事業所の担当の区分の「利用者追加」から開く。ケアマネの役だけ（管理者でなくても）。
// 最小の項目で作ると本人のページ（担当一覧の右の面）が開き、計画は「未作成」、続きは入れる欄（T03）。
// 担当の既定は自分（審査員は山本）。選べるのは同じ事業所のケアマネだけ。読む画面の列（720/880px）
export default async function NewPersonPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const actor = officeActor(principal);
  const back = backOf((await searchParams).back);
  if (!actor || !principal.office) return <Message title="事業所なし" back={back} />;

  let careManagers: CareManagerItem[];
  try {
    const { env } = await getCloudflareContext({ async: true });
    // 停止した人（T61）は担当に選べないので一覧にも出さない
    careManagers = activeCareManagers(await listCareManagers(env.DB, actor.officeId));
  } catch (e) {
    console.error("ケアマネの一覧を読めない", e);
    return <Message title="読込失敗" back={back} />;
  }

  return (
    <Page width="text">
      <PageHead id="new-title" title={OFFICE_LABELS.addPerson} back={back} sub={<span className="text-sm text-muted">{principal.office.name}</span>} />
      <div className="mt-3 grid gap-3">
        <Panel aria-labelledby="new-title">
          <NewPersonForm
            careManagers={careManagers.map((c) => ({ id: c.id, name: c.name }))}
            defaultCareManagerId={actor.defaultCareManagerId}
            today={todayJst()}
            back={back}
          />
        </Panel>
        {/* 担当を選ぶときに見る: ケアマネごとの担当の人数（一覧にいる人） */}
        <Panel aria-labelledby="cm-title">
          <PanelHead id="cm-title" title={OFFICE_LABELS.careManagers} count={careManagers.length} />
          <ul className="mt-2 grid gap-px text-sm sm:grid-cols-2 sm:gap-1">
            {careManagers.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 rounded bg-panel2 px-2 py-1.5">
                <span className="font-bold">{c.name}</span>
                {c.id === actor.defaultCareManagerId && <span className="text-xs text-muted">{OFFICE_LABELS.defaultCm}</span>}
                <span className="ml-auto">
                  {c.people}
                  <span className="text-xs text-muted"> {OFFICE_LABELS.people}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}

function Message({ title, back }: { title: string; back: string }) {
  return (
    <Page width="text">
      <PageHead title={title} back={back} />
    </Page>
  );
}
