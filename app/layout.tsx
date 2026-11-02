import type { Metadata } from "next";
import { BIZ_UDPGothic, IBM_Plex_Sans_JP } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

// 画面の書体は IBM Plex Sans JP: 数字が等幅で、表の時刻・残り時間・人数の縦が揃う（BIZ UDPGothic は tabular-nums が効かない）。
// 字が締まって密度の高い表に収まる。globals.css の --font-sans。
const plex = IBM_Plex_Sans_JP({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  // 日本語の書体は切れ端が多く、全部を先読みすると 70 以上の要求になる。使う所だけ読ませる。
  preload: false,
  display: "swap",
  variable: "--font-plex",
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
    <html lang="ja" className={`${plex.variable} ${bizUd.variable}`}>
      <body className="min-h-dvh bg-base text-ink">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
