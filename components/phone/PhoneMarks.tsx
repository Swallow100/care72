// 本人・家族の画面の小さな印（T69a）。平時の頁の上の「ふだん」と、スマホ入口のリンクが通らなかったときの 1 画面。
// 本人・家族の画面は大きく少なく、なので、ケアマネの画面の部品（components/phone/PhoneLinkPanel.tsx）とは分けて軽く置く。
// 言葉はやさしい日本語（lib/qr/phone-labels.ts の PHONE_EASY）。状態を持たない。

import { EasyWords } from "@/components/forms/EasyText";
import { TONE_FILL } from "@/components/ui/Tag";
import { easy, yomi } from "@/lib/forms/easy-words";
import { PHONE_EASY } from "@/lib/qr/phone-labels";

/**
 * 本人・家族の平時の頁の上: 事業所名と「ふだん」の印（T69a）。印だけで、「いまは ふだん です」の文にしない。
 * 色は付けない（灰は「不明」の色なので使わない。ヘッダーの「平時」と同じ薄い文字）
 */
export function PhoneNormalMark({ office }: { office: string | null }) {
  return (
    <p className="phone-text mb-2 flex flex-wrap items-baseline gap-x-2 px-1 text-lg" data-mode="normal">
      {/* 事業所名は読みの表（yomi）でふりがな。本人の 1 枚の電話の段と同じ */}
      {office && (
        <span>
          <EasyWords words={yomi(office).words} />
        </span>
      )}
      <span className="text-muted">
        <EasyWords words={easy(PHONE_EASY.normal)} />
      </span>
    </p>
  );
}

/** 通らないリンクを開いたとき（/s/invalid）。どれで落ちたかも誰のリンクかも出さない */
export function PhoneLinkInvalid() {
  return (
    <section className="phone-text rounded-lg bg-panel px-4 py-4" data-phone-link-invalid>
      {/* 本人のスマホの頁の問いと同じ大きな字（2rem）。色は不明の灰の塗り（StateTag と同じ塗り）で、言葉は「無効」だけ */}
      <span className={`inline-block rounded-sm px-3 py-0.5 text-[2rem] leading-tight font-bold ${TONE_FILL.unknown}`} data-tone="unknown">
        <EasyWords words={easy(PHONE_EASY.invalid)} />
      </span>
      <p className="mt-3 text-[1.75rem] font-bold">
        <EasyWords words={easy(PHONE_EASY.callCareManager)} />
      </p>
    </section>
  );
}
