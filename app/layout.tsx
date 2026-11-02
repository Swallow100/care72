import type { Metadata } from "next";
import { BIZ_UDPGothic } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const bizUd = BIZ_UDPGothic({
  weight: ["400", "700"],
  subsets: ["latin"],
  // 日本語の書体は切れ端が多く、全部を先読みすると 70 以上の要求になる。使う所だけ読ませる。
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
    <html lang="ja" className={bizUd.variable}>
      <body className="min-h-dvh bg-base text-ink">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
