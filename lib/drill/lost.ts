// 行き先の分からない人を世界が扱う（T141）。評価の 5 回目で、監督が「本人が家を出て行き先が分からない」を差し込んだ人が、そのあと
// 72 時間の終わりまで誰にも拾われず、帳面のいる所も家のままだった。
//
// - 家の外へ出た印（wandering）の付いた人は、決まった時間のうちに近くの人が見つけ、家に戻る（found の印）。時間は訓練の種と本人で揺らす
//   （回ごとに違い、同じ訓練の作り直しでは同じ）
// - 見つかった事は世界の出来事（AI でない、印の出来事）。その人を指すので、次の区切りで本人役（家族・支援者）が理由つきで呼ばれ、
//   見つかった事を伝えられる
// - Claude を呼ばない。色と連絡の順（lib/triage）は決めない

import type { DrillIncident } from "./incident-types.ts";
import type { WorldState } from "./scenarios.ts";
import { seededRandom } from "./time-odds.ts";

/** 家を出てから見つかるまでの分の幅（種と本人で揺らす） */
export const LOST_MIN_MINUTES = 90;
export const LOST_MAX_MINUTES = 360;

/** 見つけた人の言い方（種と本人で選ぶ。名前・町名を書かない） */
const FOUND_TEXTS = ["近所の人が本人を見つけ、家に戻った", "探していた家族が本人を見つけ、家に戻った", "近くの避難所で本人が見つかり、家に戻った"] as const;

/** その人の見つかる時刻（発災からの分）。家の外へ出た印が無い・もう見つかっていれば null */
export function foundMinute(world: WorldState, person: string, seed: string | null | undefined): number | null {
  const m = world.marks?.[person];
  if (!m || typeof m.wandering !== "number") return null;
  if (typeof m.found === "number" && m.found >= m.wandering) return null;
  const lost = Math.round(m.wandering * 60);
  const r = seededRandom(`${seed ?? ""}|lost|${person}|${lost}`)();
  return lost + LOST_MIN_MINUTES + Math.round(r * (LOST_MAX_MINUTES - LOST_MIN_MINUTES));
}

/** 見つけた人の文（種と本人で選ぶ） */
export function foundText(person: string, seed: string | null | undefined, at: number): string {
  const r = seededRandom(`${seed ?? ""}|found|${person}|${at}`)();
  return FOUND_TEXTS[Math.min(FOUND_TEXTS.length - 1, Math.floor(r * FOUND_TEXTS.length))];
}

/**
 * この区切り（from より後、to まで。発災からの分）に見つかる人の出来事。参加者だけ。区切りの中の時刻（at は時間）で、
 * 表の出来事・予定の出来事と同じ道（変わり方の決まりの門）を通す
 */
export function lostFollowUps(world: WorldState, from: number, to: number, members: ReadonlySet<string>, seed: string | null | undefined): DrillIncident[] {
  const out: DrillIncident[] = [];
  for (const person of Object.keys(world.marks ?? {})) {
    if (!members.has(person)) continue;
    const at = foundMinute(world, person, seed);
    if (at === null || at <= from || at > to) continue;
    out.push({ actor: "world", at: at / 60, ai: false, person, change: { kind: "mark", mark: "found" }, text: foundText(person, seed, at) });
  }
  return out.sort((a, b) => a.at - b.at);
}
