"use client";

// 準備の欄（T98）のケアマネの行の「後で」。1 人で回す事業所が押して閉じる。端末の cookie（値は事業所の id、/office の下だけ）に印を書き、
// 画面を読み直すとサーバーがその行を出さない（lib/office/setup.ts）。cookie の文字列はサーバーの部品（SetupPanel）が作って渡す。

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { LaterIcon } from "@/components/ui/Icon";

export function SetupLater({ cookie, children }: { cookie: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Button
      kind="quiet"
      size="sm"
      icon={LaterIcon}
      onClick={() => {
        document.cookie = cookie;
        router.refresh();
      }}
      data-setup-later
    >
      {children}
    </Button>
  );
}
