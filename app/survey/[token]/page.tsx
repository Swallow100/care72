import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SurveyForm, SurveyNotice } from "@/components/survey/SurveyForm";
import { sessionSecret } from "@/lib/auth/session";
import { SURVEY_DONE_COOKIE } from "@/lib/survey/paths";
import { lookupSurveyShare } from "@/lib/survey/store";
import { SURVEY_CLOSED_TEXT, SURVEY_DONE_TEXT, SURVEY_LABELS, SURVEY_TITLE } from "@/lib/survey/text";
import { openStamp } from "@/lib/survey/token";
import { turnstileKeys } from "@/lib/survey/turnstile";

// D1 を毎回読み、開いた時刻の印を毎回作る
export const dynamic = "force-dynamic";

// 検索に載せない。token の入った URL を、ほかのサイトへの Referer で漏らさない
export const metadata: Metadata = {
  title: `${SURVEY_TITLE} | ケア72`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

// アンケートの答えの頁（docs/tasks/T42.md・T65.md）。ログインなしで開ける頁はこれだけ（壁は token。ログインの cookie は見ない）。
// 共有のリンク（事業所の画面で作り、紙の QR で配る）の token が無ければ 404。期限を過ぎた・30 件に届いた・T42 の 1 人 1 本のリンクは「受付終了」。
// この端末から送ったことがあれば（印の cookie。頁の部品は localStorage も見る）「回答済」。
// 頁を出した時刻を署名して埋める（送信で 15 秒たったかを見る。共有なのでリンクの行に開いた時刻を持てない）。
// 本人・家族のスマホと同じ作り: 大きな字、縦 1 本、BIZ UDPGothic。案内の文 → 問い → 送る → お礼
export default async function SurveyPage({ params }: Props) {
  const { token } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const now = new Date();
  const found = await lookupSurveyShare(env.DB, token, now.toISOString());
  if (found.kind === "missing") notFound();
  const done = (await cookies()).get(SURVEY_DONE_COOKIE)?.value === "1";
  return (
    <main className="mx-auto max-w-xl px-4 pt-4 pb-16 font-ud">
      {done ? (
        <SurveyNotice state="done" heading={SURVEY_LABELS.done} text={SURVEY_DONE_TEXT} />
      ) : found.kind === "closed" ? (
        <SurveyNotice state="closed" heading={SURVEY_LABELS.closed} text={SURVEY_CLOSED_TEXT} />
      ) : (
        <SurveyForm
          token={found.share.token}
          opened={await openStamp(found.share.token, now, sessionSecret(env))}
          turnstileSiteKey={turnstileKeys(env)?.siteKey ?? null}
        />
      )}
    </main>
  );
}
