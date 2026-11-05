// 計画の状態の欄（T146）: 段階（未作成・下書き・作成済、意味色の文字）と、その下に別に「訓練 11/5」（最後に出た訓練の日）。
// 担当一覧の平時・発災時の表と事業所の画面が同じ部品を使う。言い方は lib/plan-status.ts。
// 訓練は計画の段階でないので色を付けない（日付は本文色、未実施は薄い字）。

import { StateText } from "@/components/ui/Tag";
import type { PlanStatus } from "@/lib/db/types";
import { PLAN_DRILL_LABELS, PLAN_STATUS_LABELS } from "@/lib/labels";
import { drillMark, PLAN_TONES, planStage } from "@/lib/plan-status";

/** 段階の言葉（色の文字） */
export function PlanStage({ plan }: { plan: PlanStatus }) {
  return (
    <span data-plan={planStage(plan)}>
      <StateText tone={PLAN_TONES[plan]}>{PLAN_STATUS_LABELS[plan]}</StateText>
    </span>
  );
}

/** 「訓練 11/5」「訓練 未実施」。inline なら前に間を空けて同じ行に */
export function PlanDrill({ plan, drill, inline = false }: { plan: PlanStatus; drill: string | null | undefined; inline?: boolean }) {
  const m = drillMark(drill, plan);
  const Tag = inline ? "span" : "div";
  return (
    <Tag className={`text-xs whitespace-nowrap ${inline ? "ml-1.5" : "mt-0.5"}`} data-drill={m.done ? "done" : "none"}>
      <span className="text-muted">{PLAN_DRILL_LABELS.head}</span>{" "}
      <span className={m.done ? "tabular-nums" : "text-muted"}>{m.text}</span>
    </Tag>
  );
}

/** 段階と訓練を縦に（表の欄） */
export function PlanState({ plan, drill }: { plan: PlanStatus; drill: string | null | undefined }) {
  return (
    <>
      <PlanStage plan={plan} />
      <PlanDrill plan={plan} drill={drill} />
    </>
  );
}
