import "@/components/phone/phone.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/disaster/AutoRefresh";
import { FamilyDisaster } from "@/components/phone/FamilyDisaster";
import { PhoneSheet } from "@/components/phone/PhoneSheet";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { loadDisasterState } from "@/lib/disaster/db";
import { isDisaster } from "@/lib/disaster/state";
import { buildOwnSheet } from "@/lib/forms/own-sheet";
import { loadPersonPage } from "@/lib/person";
import { buildFamilyScreen, FAMILY_SHEET_BLOCKS, familyWriterOf } from "@/lib/signals/family";

// 事業所の災害モードと本人の経過を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "家族 | ケア72" };

/** 平時に、災害モードに替わったかを見に行く間（秒） */
const NORMAL_REFRESH_SEC = 30;

// 家族・支援者のスマホ（docs/tasks/T11.md）。審査員の「家族スマホ」は山田 ハナの娘（連絡先の行 c-01-1）。
// 本人はログインの連絡先の行から決まる（壁は本人のページと同じ personInScope と、連絡先の行が本人の物か）。
// 平時は本人の 1 枚（T06）のうち 逃げるところ・来てくれる人・持っていく物・電話を大きな字で（住所は出さない）。
// 事業所が災害モードなら「お母さん（山田 ハナ）は 無事ですか」と 3 つのボタン。経過は支援者への提供の同意がある人だけ。
// Claude は呼ばない。
export default async function FamilyPage() {
  const principal = await requirePage("family");
  if (!principal.personId) notFound();
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, principal.personId);
  if (!rows) notFound();
  const writer = familyWriterOf(rows, principal.contactId);
  if (!writer) notFound();

  const [disaster, office] = await Promise.all([
    loadDisasterState(env.DB, rows.person.office_id),
    env.DB.prepare("SELECT name FROM offices WHERE id = ?1").bind(rows.person.office_id).first<{ name: string }>(),
  ]);
  const sheet = buildOwnSheet(rows, { today: todayJst(), officeName: office?.name ?? null });

  if (isDisaster(disaster)) {
    return (
      <main className="mx-auto max-w-md">
        {/* 新しい災害モードに入ったら、前の流れを持ち越さない */}
        <FamilyDisaster key={disaster.startedAt ?? "disaster"} screen={buildFamilyScreen(rows, writer, sheet)} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-3 py-4">
      <PhoneSheet sheet={sheet} only={FAMILY_SHEET_BLOCKS} />
      <AutoRefresh seconds={NORMAL_REFRESH_SEC} />
    </main>
  );
}
