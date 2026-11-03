import "@/components/phone/phone.css";
import type { Metadata } from "next";
import { PhoneLinkInvalid } from "@/components/phone/PhoneMarks";
import { PHONE_LINK_LABELS } from "@/lib/qr/phone-labels";

// 検索に載せない。前の頁（トークンを持った /s/<token>）を Referer で漏らさない
export const metadata: Metadata = {
  title: `${PHONE_LINK_LABELS.invalid} | ケア72`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// スマホ入口のリンクが通らなかったとき（docs/tasks/T69a.md）。期限切れ・作り直した前のリンク・署名が合わない・一覧から外した人。
// どれで落ちたかも、誰のリンクかも出さない（QR の無効の頁と同じ）。「無効」と「ケアマネに連絡」だけ。
// /s/<token> の route が 303 で送る（静的な道なので /s/[token] より先に当たる）。
export default function PhoneLinkInvalidPage() {
  return (
    <main className="mx-auto max-w-md px-3 py-4 font-ud">
      <PhoneLinkInvalid />
    </main>
  );
}
