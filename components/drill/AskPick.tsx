"use client";

// 頼み事の印の押せる形（T166）。押すと対応の欄でその本人を選び、頼み事の手を選ぶ（act-pick の pickAct。手が 1 つならその手、2 つ以上なら候補の欄のその行へ。
// 決めるのは対応の欄 lib/drill/action-hints.ts の askPick。ここは本人と頼み事を渡すだけ）。

import { Button, type ButtonKind } from "@/components/ui/Button";
import { GoToIcon } from "@/components/ui/Icon";
import { ASK_LABELS, TALK_UI } from "@/lib/drill/dialogue";
import type { AskKind } from "@/lib/drill/scenarios";
import { pickAct } from "./act-pick";

export function AskPick({ ask, person, kind = "plain" }: { ask: AskKind; person: string; kind?: ButtonKind }) {
  return (
    <Button
      kind={kind}
      size="sm"
      icon={GoToIcon}
      aria-label={`${TALK_UI.asks} ${ASK_LABELS[ask]}`}
      onClick={() => pickAct({ person, ask })}
      data-ask-mark={ask}
      data-ask-pick={ask}
    >
      {ASK_LABELS[ask]}
    </Button>
  );
}
