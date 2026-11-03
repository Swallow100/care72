// 通話の記録を貯める持ち主（T71）。layout が読み、components/CallQueue.tsx に渡す。
// ケアマネの役のときだけ「cm:<アカウントの id>」（審査員は acct-judge）。ほかの役・ログインしていなければ null。
// getPrincipal は 1 つの要求の中で 1 回だけ読む（ヘッダーと同じ物）ので、読みは増えない。

import { unstable_rethrow } from "next/navigation";
import { getPrincipal } from "@/lib/auth/server";
import { callQueueOwner } from "./queue.ts";

export async function callQueueOwnerOfRequest(): Promise<string | null> {
  try {
    const p = await getPrincipal();
    return p && p.role === "care_manager" && p.accountId ? callQueueOwner(p.accountId) : null;
  } catch (e) {
    unstable_rethrow(e);
    // 役を読めない（鍵が無い配信など）。ヘッダーの方が止めるので、ここは貯めないだけ
    return null;
  }
}
