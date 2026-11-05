// 評価の台（docs/tasks/T108.md）: 1 回の訓練の選び方。種から、想定・規模・参加する人の組・夜間・職員・進め方・手の混ぜ方を決める。
// 固定の種だけで回すと作り物の表を測ってしまうので、種は回ごとに変える（run.ts が新しい種を作り、記録する）。

import { SCALE_CHOICES, type DrillScale } from "../../../lib/drill/scale.ts";
import { rngOf } from "./rng.ts";

// 10 分版（short）は T124 でアプリから外したので、台の想定の組にも入れない（開始の API が断る）
export const SCENARIOS = ["heavy_rain", "earthquake", "virtual"] as const;
export type EvalScenario = (typeof SCENARIOS)[number];

export const isEvalScenario = (v: string): v is EvalScenario => (SCENARIOS as readonly string[]).includes(v);

/**
 * 参加する人の組（T124）。all は担当一覧の全員（種の 10 人。既定）、vary は回ごとに 3 人〜全員の部分集合（--people vary）。
 * どちらでも種から引く数は同じ（同じ種なら人の組のほかは同じ回になる）
 */
export const PEOPLE_MODES = ["all", "vary"] as const;
export type PeopleMode = (typeof PEOPLE_MODES)[number];
export const isPeopleMode = (v: string): v is PeopleMode => (PEOPLE_MODES as readonly string[]).includes(v);

/** 進め方（連続の時計の訓練）。30 分・1 時間・3 時間・次まで の重み */
export type Pace = { m30: number; h1: number; h3: number; next: number };

export type RunPlan = {
  index: number;
  /** この回の種（基の種と回の番号から。--seed で同じ回を作り直せる） */
  seed: string;
  scenario: EvalScenario;
  /** 仮想だけ（大雨 3〜5・地震 5強〜7 から等しく）。ほかの想定は表の規模 */
  scale: DrillScale | null;
  /** 参加する人（担当一覧の並びのまま、部分集合） */
  participants: string[];
  night: boolean;
  /** 職員の空き（選ばなければ表の値） */
  staff: number | null;
  pace: Pace;
  /** 1 区切りに手を打つ割合と、1 区切りの手の数の上限 */
  actRate: number;
  actMax: number;
  /** 手のうち自由文の手の割合 */
  freeRate: number;
  /** 通話に出たあとに往復する割合 */
  talkRate: number;
  /** 自由文に本人の氏名を混ぜる割合（仮名化の門の試し。門が伏せるか断るかを見る） */
  probeRate: number;
  /** 左の表の順位の上の人を選ぶ割合（残りは参加者から等しく） */
  followRank: number;
};

/** 回の種（基の種と番号） */
export const runSeed = (base: string, index: number) => `${base}-${index}`;

/** 1 回の選び方。caseload は担当一覧の人の id（並びのまま）。scenarios は選んでよい想定、people は人の組（既定は全員） */
export function planRun(
  base: string,
  index: number,
  caseload: ReadonlyArray<string>,
  scenarios: ReadonlyArray<EvalScenario> = SCENARIOS,
  people: PeopleMode = "all",
): RunPlan {
  const seed = runSeed(base, index);
  const rng = rngOf(`${seed}/plan`);
  const scenario = rng.pick(scenarios);
  const size = rng.int(Math.min(3, caseload.length), caseload.length);
  const subset = new Set(rng.shuffle(caseload).slice(0, size));
  const chosen = people === "all" ? new Set(caseload) : subset;
  const pace: Pace = rng.pick<Pace>([
    { m30: 4, h1: 3, h3: 1, next: 2 },
    { m30: 1, h1: 2, h3: 3, next: 3 },
    { m30: 1, h1: 1, h3: 1, next: 6 },
    { m30: 0, h1: 1, h3: 4, next: 1 },
    { m30: 3, h1: 3, h3: 3, next: 3 },
  ]);
  return {
    index,
    seed,
    scenario,
    scale: scenario === "virtual" ? rng.pick(SCALE_CHOICES) : null,
    participants: caseload.filter((p) => chosen.has(p)),
    night: rng.chance(0.25),
    staff: rng.chance(0.3) ? rng.int(0, 5) : null,
    pace,
    actRate: rng.pick([0.2, 0.4, 0.6, 0.8]),
    actMax: rng.int(1, 3),
    freeRate: rng.pick([0.1, 0.2, 0.35]),
    talkRate: rng.pick([0.2, 0.4, 0.7]),
    probeRate: rng.pick([0.1, 0.2, 0.3]),
    followRank: rng.pick([0.3, 0.6, 0.9]),
  };
}
