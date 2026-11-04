// 訓練を始める前の AI の呼び出しの見込み（docs/tasks/T70.md の 5）。画面（components/drill/StartButtons）とテストで同じ物を使う。Claude を呼ばない。
//
// 見込み = 刻みの数 ×（監督 1 + 本人役を呼ぶ人の数）+ 講評 1 + 声（着信ごとに TTS 1 回。着信は 本人役を呼ぶ人の数 × 刻み の半分と見る）。
// 本人役を呼ぶ人は、スマホで押せる人がいるか、想定の表の行が当たりうる人（lib/drill/cast.ts の mayBeCalled。上限の側に数える）。
// 仮想モードは監督の代わりに世界が 1 刻み 1 回で、本人役は押せる人だけ（表の行が無い）。
// 1 日の上限（lib/claude/usage.ts）は本人役・監督・世界・講評・声・台帳の入力・様式の読み取り・録音の分類で同じ数。
// 見込みが残りを超えても開始は止めない（途中で当たれば刻みに「停止」の印。lib/drill/engine.ts の stopIncidents）

import type { DrillScenario } from "../db/types.ts";
import { SCENARIOS } from "./scenarios.ts";
import { DIRECTOR_DRILL_MAX } from "./clock.ts";

/** 見込みに使う人の形。callable は本人役を呼びうる想定 */
export type EstimatePerson = { id: string; callable?: ReadonlyArray<DrillScenario> };

/** 本人役を呼ぶ人の数（参加者のうち、その想定で callable の人） */
export function personaCallers(scenario: DrillScenario, participants: ReadonlyArray<EstimatePerson>): number {
  return participants.filter((p) => p.callable?.includes(scenario) ?? true).length;
}

/** 想定 1 回の AI の呼び出しの見込み（回） */
export function estimateDrillCalls(scenario: DrillScenario, participants: ReadonlyArray<EstimatePerson>): number {
  const steps = SCENARIOS[scenario].hours.length;
  const callers = personaCallers(scenario, participants);
  return steps * (1 + callers) + 1 + Math.ceil((callers * steps) / 2);
}

/** 見込みが残りを超えるか（残りが読めなければ超えない扱い） */
export function overLimit(estimate: number, remaining: number | null): boolean {
  return remaining !== null && estimate > remaining;
}

/**
 * 連続の時計の訓練（T90。大雨・地震・仮想の新しい訓練）の見込み（回）。監督 20 + 本人役（呼ばれうる人 × 9）+ 講評 1 + 声（本人役の半分）。
 * 本人役はその区切りで理由のある人だけを呼ぶので、1 人 9 回ほど（表の行・手の返事・時計・12 時間の巡回）と見る。
 * 1 訓練の上限（lib/drill/clock.ts の DRILL_CALL_CAP 150）は講評と声を数えないので、10 人で約 160 回でも訓練の呼び出しは 150 に収まる
 */
export function estimateClockCalls(scenario: DrillScenario, participants: ReadonlyArray<EstimatePerson>): number {
  const persona = personaCallers(scenario, participants) * CLOCK_PERSONA_PER_PERSON;
  return DIRECTOR_DRILL_MAX + persona + 1 + Math.ceil(persona / 2);
}

/** 連続の時計の訓練で、本人役を 1 人あたり何回呼ぶと見るか */
export const CLOCK_PERSONA_PER_PERSON = 9;
