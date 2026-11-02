import "@/components/phone/phone.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/disaster/AutoRefresh";
import { PhoneDisaster } from "@/components/phone/PhoneDisaster";
import { PhoneSheet } from "@/components/phone/PhoneSheet";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { loadDisasterState } from "@/lib/disaster/db";
import { isDisaster } from "@/lib/disaster/state";
import { buildOwnSheet } from "@/lib/forms/own-sheet";
import { loadPersonPage } from "@/lib/person";

// 事業所の災害モードと本人の 1 枚を毎回読む
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "本人 | ケア72" };

/** 平時に、災害モードに替わったかを見に行く間（秒） */
const NORMAL_REFRESH_SEC = 30;

// 本人のスマホ（docs/tasks/T10.md）。審査員の「本人スマホ」は山田 ハナ（T16 の QR のトークンで開く形はあとで）。
// 平時は本人の 1 枚（T06）の文を大きな字で。事業所が災害モードなら、画面全体が「無事」緑と「無事じゃない」赤の 2 つだけ。
// 壁は本人のページと同じ（loadPersonPage が personInScope を通す。本人は自分だけ）。Claude は呼ばない。
export default async function MePage() {
  const principal = await requirePage("me");
  if (!principal.personId) notFound();
  const { env } = await getCloudflareContext({ async: true });
  const rows = await loadPersonPage(env.DB, principal, principal.personId);
  if (!rows) notFound();
  const disaster = await loadDisasterState(env.DB, rows.person.office_id);

  if (isDisaster(disaster)) {
    return (
      <main className="mx-auto max-w-md">
        {/* 新しい災害モードに入ったら、前の流れを持ち越さない */}
        <PhoneDisaster key={disaster.startedAt ?? "disaster"} personId={rows.person.id} />
      </main>
    );
  }

  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();
  const sheet = buildOwnSheet(rows, { today: todayJst(), officeName: office?.name ?? null });
  return (
    <main className="mx-auto max-w-md px-3 py-4">
      <PhoneSheet sheet={sheet} />
      <AutoRefresh seconds={NORMAL_REFRESH_SEC} />
    </main>
  );
}
