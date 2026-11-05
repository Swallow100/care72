// 声の聞き取りの会話（docs/tasks/T137.md）の欄。担当一覧の行の詳細（RowDetail）の安否の行ごとに、問いと本人の答えを全部並べる。
// AI が作った問いには AI の印（決まった問いは印なし）。本人の言葉は言い換えずにそのまま。聞き取れなかった回は「無音」「不明瞭」。
// 決まった問いのまま取れた答え・ボタンで押した答えは「取得 けが あり」（言葉の一致かボタン。Claude ではない）。
// 応答不明瞭の印はコードが付けた事実（無音・うめき声・短すぎるが続いてボタンに替えた）。色と連絡の順には使わない（中立の印で、状態の 4 色を使わない）。

import { AiMark } from "@/components/person/parts";
import { DANGER_LABELS, TALK_END_LABELS, TALK_LABELS } from "@/lib/signals/labels";
import { questionOf } from "@/lib/signals/questions";
import { buttonLine, type TalkLog, type TalkTurn } from "@/lib/signals/talk";

/** ボタンの答え方の問いの文の終わり（問いの文のあとの「はいなら みどり…」。どの問いでも同じ） */
const YES_NO_HINT = buttonLine("injured").slice(buttonLine("injured").indexOf("。") + 1);

function replyText(t: TalkTurn): string {
  if (t.reply) return t.reply;
  if (t.heard === "press") return TALK_LABELS.pressed;
  if (t.heard === "skip") return TALK_LABELS.skipped;
  if (t.heard === "unclear") return TALK_LABELS.mumble;
  // ボタンの答え方の回（読んだ文が lib/signals/talk.ts の buttonLine。後ろに TALK_PHRASES.yesNoHint）で押さなかった物は「未押下」、聞いた回は「無音」
  return t.ask.endsWith(YES_NO_HINT) ? TALK_LABELS.noPress : TALK_LABELS.silent;
}

function answerText(a: NonNullable<TalkTurn["answer"]>): string {
  const q = questionOf(a.id);
  return `${q.label} ${q.choices.find((c) => c.id === a.choice)?.label ?? ""}`.trim();
}

/** 中立の小さな印（状態の色を使わない） */
function Mark({ children, data }: { children: React.ReactNode; data: string }) {
  return (
    <span className="rounded bg-base px-1 py-px text-xs font-bold text-ink" data-talk-mark={data}>
      {children}
    </span>
  );
}

export function Talk({ log }: { log: TalkLog }) {
  return (
    <div className="space-y-1" data-talk>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
        <span className="font-bold text-ink">{TALK_LABELS.title}</span>
        {log.unclear && <Mark data="unclear">{TALK_LABELS.unclear}</Mark>}
        {log.danger && <Mark data="danger">{`${TALK_LABELS.danger} ${DANGER_LABELS[log.danger]}`}</Mark>}
        {log.end && <span data-talk-end={log.end}>{`${TALK_LABELS.end} ${TALK_END_LABELS[log.end]}`}</span>}
        {log.aiCalls > 0 && <span className="tabular-nums">{`${TALK_LABELS.aiCalls} ${log.aiCalls}`}</span>}
      </p>
      <ol className="space-y-1">
        {log.turns.map((t, i) => (
          <li key={i} className="grid grid-cols-[auto_1fr] gap-x-1.5 text-sm" data-talk-turn={t.by}>
            <span className="text-xs text-muted">{TALK_LABELS.ask}</span>
            <span>
              {t.by === "ai" && (
                <>
                  <AiMark small />{" "}
                </>
              )}
              {t.ask}
            </span>
            <span className="text-xs text-muted">{TALK_LABELS.reply}</span>
            <span className={t.reply ? "" : "text-muted"} data-heard={t.heard}>
              {replyText(t)}
              {t.answer && <span className="ml-2 text-xs text-muted">{`${TALK_LABELS.got} ${answerText(t.answer)}`}</span>}
            </span>
          </li>
        ))}
      </ol>
      {log.closing && (
        <p className="grid grid-cols-[auto_1fr] gap-x-1.5 text-sm text-muted">
          <span className="text-xs">{TALK_LABELS.closing}</span>
          <span>{log.closing}</span>
        </p>
      )}
    </div>
  );
}
