import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SurveyForm } from "@/components/survey/SurveyForm";
import { openSurveyLink } from "@/lib/survey/store";
import { SURVEY_TITLE } from "@/lib/survey/text";
import { turnstileKeys } from "@/lib/survey/turnstile";

// D1 を毎回読み、最初に開いた時刻を残す
export const dynamic = "force-dynamic";

// 検索に載せない。token の入った URL を、ほかのサイトへの Referer で漏らさない
export const metadata: Metadata = {
  title: `${SURVEY_TITLE} | ケア72`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

// アンケートの答えの頁（docs/tasks/T42.md）。ログインなしで開ける頁はこれだけ（壁は token。ログインの cookie は見ない）。
// 招待のリンク（事業所の画面で作る）の token が無い・使用済み・期限切れなら 404。開いたら最初の時刻を残す（15 秒の守り）。
// 本人・家族のスマホと同じ作り: 大きな字、縦 1 本、BIZ UDPGothic。案内の文 → 問い → 送る → お礼
export default async function SurveyPage({ params }: Props) {
  const { token } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const link = await openSurveyLink(env.DB, token, new Date().toISOString());
  if (!link) notFound();
  const keys = turnstileKeys(env);
  return (
    <main className="mx-auto max-w-xl px-4 pt-4 pb-16 font-ud">
      <SurveyForm token={link.token} turnstileSiteKey={keys?.siteKey ?? null} />
    </main>
  );
}
