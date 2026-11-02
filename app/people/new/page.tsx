import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NewPersonForm } from "@/components/office/NewPersonForm";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { listCareManagers, type CareManagerItem } from "@/lib/office/people";
import { officeActor } from "@/lib/office/scope";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 利用者追加（docs/tasks/T30.md）。担当一覧の右上の「利用者追加」から開く。ケアマネの役だけ（管理者でなくても）。
// 最小の項目で作ると本人のページ（担当一覧の右の面）が開き、計画は「未作成」、続きは入れる欄（T03）。
// 担当の既定は自分（審査員は山本）。選べるのは同じ事業所のケアマネだけ
export default async function NewPersonPage() {
  const principal = await requirePage("caseload");
  const actor = officeActor(principal);
  if (!actor || !principal.office) return <Message title="事業所なし" />;

  let careManagers: CareManagerItem[];
  try {
    const { env } = await getCloudflareContext({ async: true });
    careManagers = await listCareManagers(env.DB, actor.officeId);
  } catch (e) {
    console.error("ケアマネの一覧を読めない", e);
    return <Message title="読込失敗" />;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <section aria-labelledby="new-title" className="rounded-lg bg-panel p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 id="new-title" className="text-xl font-bold">
            {OFFICE_LABELS.addPerson}
          </h1>
          <span className="text-sm">{principal.office.name}</span>
        </div>
        <div className="mt-3">
          <NewPersonForm
            careManagers={careManagers.map((c) => ({ id: c.id, name: c.name }))}
            defaultCareManagerId={actor.defaultCareManagerId}
            today={todayJst()}
          />
        </div>
      </section>
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
