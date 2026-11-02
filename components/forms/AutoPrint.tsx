"use client";

// 紙面を ?print=1 で開いたとき、書体を読み終えてから 1 回だけ印刷の窓を出す（1 押しで印刷）。何も描かない。
// 手順は lib/forms/print.ts の autoPrint（URL の印を外してから出す。読み直しで何度も出さない）。
// 各紙面のページが searchParams を見て、print=1 のときだけ置く（wantsPrint）。
// T35 の PrintButton の auto も同じ働き。両方を置くと 2 回出ることがあるので、merge のときにどちらか 1 つにする（docs/progress/t36.md）。

import { useEffect, useRef } from "react";
import { autoPrint } from "@/lib/forms/print";

export function AutoPrint() {
  const done = useRef(false);
  useEffect(() => {
    // 開発の Strict Mode で 2 回走っても 1 回だけ
    if (done.current) return;
    done.current = true;
    void autoPrint(window);
  }, []);
  return null;
}
