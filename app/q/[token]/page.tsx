import "@/components/qr/qr-view.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { QrSummary } from "@/components/qr/QrSummary";
import { QrInvalid, QrReceive, QrWithheld } from "@/components/qr/QrStates";
import { todayJst } from "@/lib/age";
import { getPrincipal } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { staffActor } from "@/lib/custody/actor";
import { lastShelter } from "@/lib/custody/store";
import { QR_LABELS } from "@/lib/qr/labels";
import { resolveQrToken } from "@/lib/qr/store";
import { buildQrPage, loadQrPerson, medicalConsentOf, recordQrView } from "@/lib/qr/view";

// D1 を毎回読み、開くたびに経過へ書く
export const dynamic = "force-dynamic";

// 検索に載せない。トークンを持った URL を、ほかのサイトへの Referer で漏らさない
export const metadata: Metadata = {
  title: QR_LABELS.title,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

// QR の頁（docs/tasks/T16.md）。本人の 1 枚の裏の QR から、ログインなしで開く読み取り専用の頁。
// 壁はトークン（署名・期限 90 日・今の版。lib/qr/store.ts）。出すのは医療要約の範囲から氏名の全部と住所を除いた物（lib/qr/view.ts）。
// 医療班提供の同意が無い人は「同意なし」「未確認」だけ。無効のトークンは「無効」だけで、経過にも残さない。
// 開いたら経過に「QR 閲覧」（相手・範囲・時刻）。医療班・行政でログインしていれば「受入」（避難所を入れて受け持ちに入れる。T23）。
export default async function QrViewPage({ params }: Props) {
  const { token } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const hit = await resolveQrToken(env.DB, sessionSecret(env), token, nowSec());
  const person = hit ? await loadQrPerson(env.DB, hit.p) : null;
  if (!hit || !person) {
    return (
      <main className="qr-view mx-auto max-w-xl px-4 py-4">
        <QrInvalid />
      </main>
    );
  }

  const principal = await getPrincipal();
  const page = buildQrPage(person.rows, { today: todayJst(), officeName: person.officeName });
  await recordQrView(env.DB, {
    personId: hit.p,
    generation: hit.g,
    principal,
    page,
    consent: medicalConsentOf(person.rows),
    nowIso: new Date().toISOString(),
  });
  // 医療班・行政なら「受入」（T23）。避難所の既定は自分がいちばん最近に受け入れた所
  const staff = staffActor(principal);
  const shelter = staff ? await lastShelter(env.DB, staff) : null;
  const expiresAt = new Date(hit.exp * 1000).toISOString();

  return (
    <main className="qr-view mx-auto max-w-xl space-y-3 px-4 py-4">
      {staff && <QrReceive token={token} shelter={shelter} />}
      {page.kind === "sheet" ? <QrSummary sheet={page.sheet} expiresAt={expiresAt} /> : <QrWithheld kind={page.kind} />}
    </main>
  );
}
