"use client";

// 紙面の印刷（ブラウザの印刷の画面。PDF にするのもここから）。主の操作なので操作の色、プリンターのアイコン。
// auto を付けると、開いたときに 1 回だけ印刷の画面を出す（本人のページの書類の行の「印刷」から ?print=1 で来たとき）。
// 書体を読み終えてから出す（読み終える前に出すと、紙の字が仮の書体になる）。

import { useEffect, useRef } from "react";
import { autoPrint } from "@/lib/forms/print";
import { Button } from "./Button";
import { PrintIcon } from "./Icon";

export function PrintButton({ auto = false, label = "印刷" }: { auto?: boolean; label?: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (!auto || done.current) return;
    // 開発の Strict Mode で 2 回走っても 1 回だけ（ref で止める）
    done.current = true;
    // URL から print=1 を外してから出す（読み直しで何度も出さない。手順は lib/forms/print.ts、テストあり）
    void autoPrint(window);
  }, [auto]);
  return (
    <Button kind="main" icon={PrintIcon} onClick={() => window.print()}>
      {label}
    </Button>
  );
}
