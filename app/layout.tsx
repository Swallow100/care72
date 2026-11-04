import type { Metadata } from "next";
import { BIZ_UDPGothic, BIZ_UDPMincho, Inter } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { CallQueueProvider } from "@/components/CallQueue";
import { OfflineBand } from "@/components/OfflineBand";
import { SwRegister } from "@/components/SwRegister";
import { DialogHost } from "@/components/ui/DialogHost";
import { callQueueOwnerOfRequest } from "@/lib/offline/owner";
import { INSTALL_SCRIPT, PRESS_SCRIPT } from "@/lib/ui/head-scripts";
import "./globals.css";

// 画面の書体は Inter（英数字。OFL）＋ OS の日本語書体（Hiragino Sans・Yu Gothic UI・Meiryo。globals.css の --font-sans）。
// Web の日本語書体（M PLUS 2 など）は「AI が作った画面」の顔になるので使わない。英数字だけ Inter で、日本語は端末の書体に
// 任せると、端末のアプリと同じ顔になる。
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

// 書類の紙面で、元の様式が明朝の字だけ BIZ UDP明朝（OFL。T85。書類は元の様式に合わせる）。松山市の計画書の題・
// 同意の問い・注など（components/forms/paper.css の .mc）。原本の游明朝・MS 明朝は配信に入れられないので置き換えた。画面には使わない。
// preload しないので、紙面の頁で明朝の字を描くときだけ読む。
const bizMincho = BIZ_UDPMincho({
  weight: ["400", "700"],
  subsets: ["latin"],
  preload: false,
  display: "swap",
  variable: "--font-biz-mincho",
});

export const metadata: Metadata = {
  title: "ケア72",
  description: "ケアマネの手元の道具。個別避難計画、72 時間の訓練、発災時の安否の整理",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 通話の記録を端末に貯める持ち主（T71。ケアマネの役だけ。ヘッダーと同じ 1 回の読み）
  const callOwner = await callQueueOwnerOfRequest();
  return (
    <html lang="ja" className={`${inter.variable} ${bizUd.variable} ${bizMincho.variable}`}>
      <head>
        {/* 押したときの灰色と、ホーム画面に追加の受け口（T44。lib/ui/head-scripts.ts）。部品が描かれる前に動かす */}
        <script dangerouslySetInnerHTML={{ __html: PRESS_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-base text-ink">
        <CallQueueProvider owner={callOwner}>
          <AppHeader />
          {/* 写し・通信なし・保留の帯（T71）。stamp が変われば中身はネットの物 */}
          <OfflineBand stamp={new Date().toISOString()} />
          {children}
        </CallQueueProvider>
        {/* アプリ内の確認・お知らせの窓（T44。lib/ui/dialog.ts） */}
        <DialogHost />
        {/* 最後の写しの Service Worker（T71。public/sw.js） */}
        <SwRegister />
      </body>
    </html>
  );
}
