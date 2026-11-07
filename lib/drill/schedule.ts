// 予定の出来事（T90 の準備）。監督の見込み（復旧の見込み・業者の巡回、T92）やケアマネの手（届く時刻、T91）が world.scheduled に積み、
// 時刻が来たらここで取り出して状況にする。世界には当てない（当てるのは engine。表の出来事と同じ順で applyEvent を通す）。
// Claude を呼ばない。色と順位はここで決めない（lib/triage だけ）。

import type { DrillIncident } from "./incident-types.ts";
import type { Scheduled, WorldState } from "./scenarios.ts";

/**
 * 時刻（発災からの分）までに来た予定の出来事を取り出す。返す world は取り出した物を除いた予定の一覧を持ち、
 * incidents は時刻の順の状況（actor director、AI の印なし、at は発災からの時間）。予定が無ければ同じ世界と空の配列
 */
export function fireScheduled(world: WorldState, toMinute: number): { world: WorldState; incidents: DrillIncident[] } {
  const list = world.scheduled;
  if (!list || !list.some((s) => s.at <= toMinute)) return { world, incidents: [] };
  const due = list.filter((s) => s.at <= toMinute).sort((a, b) => a.at - b.at);
  const rest = list.filter((s) => s.at > toMinute);
  return { world: { ...world, scheduled: rest }, incidents: due.map(incidentOf) };
}

function incidentOf(s: Scheduled): DrillIncident {
  return {
    change: s.change,
    text: s.text,
    ...(s.person ? { person: s.person } : {}),
    ...(s.basis ? { basis: s.basis } : {}),
    actor: "director",
    at: s.at / 60,
    // 区切りの終わりから次へ回した監督の出来事（T178）は AI の印と種類をそのまま持つ
    ...(s.inject ? { inject: s.inject } : {}),
    ai: s.ai === true,
  };
}
