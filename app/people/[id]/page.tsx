import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ageOn, todayJst } from "@/lib/age";
import { homePath } from "@/lib/auth/roles";
import { personInScope } from "@/lib/auth/scope";
import { requirePage } from "@/lib/auth/server";
import { parseLedger } from "@/lib/db/ledger";
import { CARE_LEVEL_LABELS, PLAN_STATUS_LABELS } from "@/lib/labels";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// 本人のページ（T01 の時点は一覧の行の中身まで。区分ごとの表示は T02）。
// 事業所の壁: 範囲の外の id は、在っても無くても同じ 404（lib/auth/scope.ts）
export default async function PersonPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const person = await personInScope(env.DB, principal, id);
  if (!person) notFound();

  const ledger = parseLedger(person.ledger);
  const age = person.birth_date ? ageOn(person.birth_date, todayJst()) : null;
  const careLevel = ledger.care.careLevel;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Link href={homePath(principal.role)} className="inline-block rounded px-2 py-1 text-sm text-muted" data-press>
        戻る
      </Link>
      <section aria-labelledby="person-title" className="mt-2 rounded-lg bg-panel p-6">
        <h1 id="person-title" className="text-2xl font-bold">
          {person.name}
        </h1>
        <p className="text-muted">{person.kana}</p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2">
          <dt className="text-muted">年齢</dt>
          <dd className="tabular-nums">{age === null ? "未確認" : `${age} 歳`}</dd>
          <dt className="text-muted">介護度</dt>
          <dd>{careLevel ? CARE_LEVEL_LABELS[careLevel] : "未確認"}</dd>
          <dt className="text-muted">計画</dt>
          <dd>{PLAN_STATUS_LABELS[person.plan_status]}</dd>
          <dt className="text-muted">未確認</dt>
          <dd className="tabular-nums">{ledger.pending.length} 件</dd>
        </dl>
      </section>
    </main>
  );
}
