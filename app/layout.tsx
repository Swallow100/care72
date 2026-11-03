import type { Metadata } from "next";
import { BIZ_UDPGothic, Inter } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { DialogHost } from "@/components/ui/DialogHost";
import { INSTALL_SCRIPT, PRESS_SCRIPT } from "@/lib/ui/head-scripts";
import "./globals.css";

// 画面の書体は Inter（英数字。OFL）＋ OS の日本語書体（Hiragino Sans・Yu Gothic UI・Meiryo。globals.css の --font-sans）。
// 作者の判断（11/3 10:3x）: Web の日本語書体（M PLUS 2 など）は「AI が作った画面」の顔になる。作者の別のアプリと
// Claude Code の画面と同じく、英数字だけ Inter で、日本語は端末の書体に任せると、端末のアプリと同じ顔になる。
// Inter は数字を等幅にできる（tabular-nums）ので、表の時刻・残り時間・人数の縦が揃う。日本語の書体は配信に入れない（要求が増えない）。
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
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
    <html lang="ja" className={`${inter.variable} ${bizUd.variable}`}>
      <head>
        {/* 押したときの灰色と、ホーム画面に追加の受け口（T44。lib/ui/head-scripts.ts）。部品が描かれる前に動かす */}
        <script dangerouslySetInnerHTML={{ __html: PRESS_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-base text-ink">
        <AppHeader />
        {children}
        {/* アプリ内の確認・お知らせの窓（T44。lib/ui/dialog.ts） */}
        <DialogHost />
      </body>
    </html>
  );
}
