// 訓練の画面の上の帯の印（docs/tasks/T125.md の 2）。訓練の画面では、事業所の今の状態（「大雨 レベル 4 停電 11 時間」）の代わりに、
// 訓練の想定・規模・経過を出す（components/HeaderMarkSlot.tsx が出し分ける）。事業所の状態と混ぜない。Claude を呼ばない。
// 評価の台（tools/eval/drill/checks.ts）も同じ関数の文を想定の表で見る（帯に想定に合わない物が出ないか）。

import type { DrillScenario } from "../db/types.ts";
import { elapsedClockLabel, SCENARIO_LABELS } from "./labels.ts";
import type { DrillScale } from "./scale.ts";
import { scaleLabel } from "./scale.ts";
import type { WorldState } from "./scenarios.ts";

/** 上の帯の印。label は想定（「地震想定」）、details は規模と経過（「震度 6強」「経過 6 時間」） */
export type DrillHeaderMark = { label: string; details: string[] };

/** 上の帯の頭の言葉（事業所の状態の印と見分ける） */
export const DRILL_HEADER_LABEL = "訓練";

/**
 * 訓練の想定・規模・経過。規模は仮想なら開始で決めた規模、固定の筋は世界の今（地震は震度、大雨は警戒レベル）。
 * 世界に無ければ規模は出さない（事業所の今の状態は混ぜない）
 */
export function drillHeaderMark(s: {
  scenario: DrillScenario;
  options?: { scale?: DrillScale | null } | null;
  world: Pick<WorldState, "quake" | "alertLevel">;
  minute: number;
}): DrillHeaderMark {
  const scale = s.options?.scale ? scaleLabel(s.options.scale) : s.world.quake ? `震度 ${s.world.quake}` : s.world.alertLevel ? `警戒レベル ${s.world.alertLevel}` : null;
  return { label: SCENARIO_LABELS[s.scenario], details: [...(scale ? [scale] : []), elapsedClockLabel(s.minute)] };
}

/** 帯の文（評価の台が想定の表で見る） */
export const headerMarkText = (m: DrillHeaderMark): string => [DRILL_HEADER_LABEL, m.label, ...m.details].join(" ");
