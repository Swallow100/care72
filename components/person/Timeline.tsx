// 本人のページの経過（時系列。誰が・いつ・何を）。見る人の範囲の行を全部出す（lib/person.ts）。書き足す欄は TimelineComposer（T24）。
// 並びは新しい順（上がいちばん新しい。T79、11/4 の点検の低: 古い順だと発災時に今の連絡が下に埋もれた）。lib/person.ts の timelineItems は古い順のまま
// （紙・CSV・テストが古い順で読む）で、ここで逆にする。書き足す欄は経過の上なので、書いた行がすぐ下に出る。
// 1 行目に小さく 時刻・種類・誰が、2 行目に何を。区分が細い段に入っても読める形。
// 撤回した行（T63）も元の時刻の所に残し、種類と本文に取り消し線と薄い字、下に「撤回 山本 11/3 22:10 理由」。
// 撤回できる行（見ている人が撤回できる物）だけ、誰がの右に「撤回」（components/person/RetractButton.tsx。開いた欄は行の一番下）。

import type { TimelineItem } from "@/lib/person";
import { BLANK_LABELS } from "@/lib/labels";
import { RETRACT_LABELS } from "@/lib/timeline/labels";
import { AiMark, StateText } from "./parts";
import { RetractButton } from "./RetractButton";

/** 撤回した行の種類と本文（色を変えず、薄い字に取り消し線） */
const STRUCK = "text-muted line-through decoration-1";

export function Timeline({ items }: { items: readonly TimelineItem[] }) {
  if (items.length === 0) return <p className="text-muted">{BLANK_LABELS.none}</p>;
  return (
    <ol className="space-y-1" data-order="newest">
      {[...items].reverse().map((t) => (
        <li
          key={t.id}
          className="flex flex-wrap items-baseline gap-x-2 rounded bg-panel2 px-2 py-1"
          data-entry={t.derived ? undefined : t.id}
          data-retracted={t.retracted ? "" : undefined}
        >
          <time dateTime={t.at} className="text-xs text-muted tabular-nums">
            {t.when}
          </time>
          {t.retracted ? (
            <span className={`text-xs font-bold ${STRUCK}`}>{t.kind}</span>
          ) : t.tone ? (
            <StateText tone={t.tone} className="text-xs">
              {t.kind}
            </StateText>
          ) : (
            <span className="text-xs font-bold">{t.kind}</span>
          )}
          {t.ai && <AiMark />}
          {/* 撤回できる行は、誰がと撤回のボタンを 1 つの塊で右に（components/person/RetractButton.tsx） */}
          {t.retractable ? <RetractButton id={t.id} who={t.who} /> : <span className="ml-auto text-xs text-muted">{t.who}</span>}
          {t.body && <div className={`mt-0.5 basis-full ${t.retracted ? STRUCK : ""}`}>{t.body}</div>}
          {t.retracted && (
            <div className="mt-0.5 basis-full text-xs text-muted" data-retracted-line>
              {[RETRACT_LABELS.done, t.retracted.who, t.retracted.when, t.retracted.note].filter((s) => s).join(" ")}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
