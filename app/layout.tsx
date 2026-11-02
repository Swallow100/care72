import type { Metadata } from "next";
import { BIZ_UDPGothic, M_PLUS_2 } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

// 画面の書体は M PLUS 2（T35 で IBM Plex Sans JP から替えた。比較は docs/progress/t35.md）。
// 数字がもともと等幅で、tabular-nums を当てなくても表の時刻・残り時間・人数の縦が揃う（「0000」と「1111」が同じ 81px）。
// 可変の太さで、見出し・本文・小さな字の段を太さでも分けられる。漢字とかなの太さの釣り合いがよく、12〜13px でも潰れない。
// globals.css の --font-sans。
const mplus2 = M_PLUS_2({
  subsets: ["latin"],
  // 日本語の書体は切れ端が多く、全部を先読みすると 70 以上の要求になる。使う所だけ読ませる。
  preload: false,
  display: "swap",
  variable: "--font-mplus2",
});

// 本人・家族のスマホと本人の 1 枚だけ BIZ UDPGothic（UD の書体。大きな字とふりがなで読み違えにくい）。globals.css の --font-ud。
const bizUd = BIZ_UDPGothic({
  weight: ["400", "700"],
  subsets: ["latin"],
  preload: false,
  display: "swap",
  variable: "--font-biz-ud",
});

export const metadata: Metadata = {
  title: "ケア72",
  description: "ケアマネの手元の道具。個別避難計画、72 時間の訓練、発災時の安否の整理",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={`${mplus2.variable} ${bizUd.variable}`}>
      <body className="min-h-dvh bg-base text-ink">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
