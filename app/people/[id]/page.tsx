import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonView } from "@/components/person/PersonView";
import { todayJst } from "@/lib/age";
import { homePath } from "@/lib/auth/roles";
import { requirePage } from "@/lib/auth/server";
import { loadPersonPage, toPersonView } from "@/lib/person";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// 本人のページ（単独で開く形）。担当一覧の右の面（/?open=<id>）と同じ物を出す。
// 事業所の壁: 範囲の外の id は、在っても無くても同じ 404（lib/auth/scope.ts の personInScope）。
// 災害モード（T09）が入るまでは平時の形だけ。
export default async function PersonPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, id);
  if (!rows) notFound();
  const view = toPersonView(rows, { today: todayJst(), mode: "normal" });

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <Link href={homePath(principal.role)} className="inline-block rounded px-2 py-1 text-sm text-muted" data-press>
        戻る
      </Link>
      <div className="mt-2">
        <PersonView view={view} level={1} />
      </div>
    </main>
  );
}
