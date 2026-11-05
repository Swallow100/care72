// 区域の出来事の対象（docs/tasks/T128.md の 4）。津波・避難指示・浸水・土砂の警戒・停電の地区など、区域に効く出来事が
// どの人（台帳のハザード・町）と、事業所に効くかを返す。被害状況の行・上の帯の印・地図のピンが読む。
//
// 決まりの正本は T125 の 1 つの関数（lib/drill/targets.ts の targetsOf。出来事 → 対象の人の id と事業所が対象か）で、areaTargetOf は
// それを呼ぶ（区域の出来事でなければ null の形と、事業所の区域を渡さないときの null はここ）。
//
// - 津波（避難）: 津波のハザードの人
// - 警戒レベル 3〜5（高齢者等避難・避難指示）: 浸水か土砂のハザードの人
// - 川の氾濫（浸水）: 浸水 3 m 以上のハザードの人（想定の表の文「浸水 3 m の地区で浸水」と同じ線。停電の地区 FLOOD_AREA と同じ深さ）
// - 土砂の警戒（情報 landslide_warn）: 土砂のハザードの人
// - 停電: 範囲（全域・ハザードの地区・町）に入る人（lib/drill/persona.ts の inOutageArea と同じ決め。persona.ts は Claude を呼ぶ層を
//   読むので、ブラウザにも入るここからは読まずに同じ 3 行を持つ。t128.test.ts で同じ答えを確かめる）
// - 町の出来事（仮想の浸水・土砂・断水・電話・道路・施設）: 出来事が持つ persons
// - 事業所: 事業所の区域（offices.hazards の写し）を渡せば区域で決める。渡さなければ全域の停電だけ対象で、ほかは null（対象外と言い切らない）
//
// 色と連絡の順（lib/triage）には使わない。D1 を読まない。Claude を呼ばない。

import type { HazardKind } from "../db/types.ts";
import type { WorldChange } from "./scenarios.ts";
import type { Homes } from "./comms.ts";
import { FLOOD_DEPTH_M, targetsOf } from "./targets.ts";

/** 対象を決めるのに読む本人の所（台帳のハザードと町名） */
export type AreaPerson = {
  id: string;
  hazards: ReadonlyArray<{ kind: HazardKind; depthM?: number | null }>;
  town: string | null;
};

/** 区域の出来事の対象。persons は対象の本人の id（台帳の並び）、office は事業所が対象か（分からなければ null） */
export type AreaTarget = { persons: string[]; office: boolean | null };

/** 川の氾濫の浸水の地区（m）。想定の表の文と停電の地区 FLOOD_AREA と同じ（lib/drill/targets.ts の FLOOD_DEPTH_M） */
export const FLOOD_TARGET_DEPTH_M = FLOOD_DEPTH_M;

/** 区域に効く出来事か（解除・復旧・全体の出来事・本人の出来事は区域でない） */
function isAreaChange(c: WorldChange): boolean {
  switch (c.kind) {
    case "tsunami":
      return c.state === "evacuate";
    case "alert":
      return c.level !== null;
    case "note":
      return c.topic === "landslide_warn";
    case "flood":
    case "outage":
    case "town_flood":
    case "landslide":
    case "town_water":
    case "town_line":
    case "town_road":
    case "town_facility":
      return true;
    default:
      return false;
  }
}

/**
 * 区域の出来事の対象。区域に効く出来事でなければ null（解除・復旧・全体の出来事も null）。決まりは T125 の 1 つの関数
 * （lib/drill/targets.ts の targetsOf）を読む。office は事業所の区域（offices.hazards の写し DrillState.officeZones）を渡せば
 * 区域で決め、渡さなければ全域の停電だけ対象（ほかは null。対象外と言い切らない）
 */
export function areaTargetOf(change: WorldChange, people: ReadonlyArray<AreaPerson>, office?: ReadonlyArray<HazardKind> | null): AreaTarget | null {
  if (!isAreaChange(change)) return null;
  const homes: Homes = Object.fromEntries(
    people.map((p) => [p.id, { zones: p.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })), town: p.town, landline: true, mobile: false }]),
  );
  const t = targetsOf({ change }, { participants: people.map((p) => p.id), homes, officeZones: office ?? [] });
  const all = change.kind === "outage" && change.area.scope === "office";
  return { persons: t.persons, office: all ? true : office ? t.office : null };
}

/** 対象の言い方に使う姓（「伊藤 フミ」→「伊藤」）。空白の無い名前はそのまま */
export function familyName(name: string): string {
  return name.trim().split(/[ 　]+/)[0] ?? name;
}

/** 対象の言葉（2〜4 字） */
export const TARGET_LABELS = {
  target: "対象",
  people: "人",
  office: "事業所",
  officeIn: "対象",
  officeOut: "対象外",
  all: "全員",
  /** 「他 2 人」 */
  more: "他",
} as const;

/**
 * 区域の対象の 1 行（「対象 3 人 伊藤・田中・加藤 事業所 対象外」）。多いときは max 人と「他 N 人」、参加者の全員（4 人以上）なら「全員」。
 * office が null なら事業所を出さない（対象外と言い切らない）
 */
export function targetText(t: AreaTarget, names: Readonly<Record<string, string>>, total: number, max = 3): string {
  const n = t.persons.length;
  const who =
    n > 0 && n === total && total > 3
      ? TARGET_LABELS.all
      : [
          t.persons.slice(0, max).map((p) => familyName(names[p] ?? p)).join("・"),
          n > max ? `${TARGET_LABELS.more} ${n - max} ${TARGET_LABELS.people}` : "",
        ]
          .filter(Boolean)
          .join(" ");
  const office = t.office === null ? "" : ` ${TARGET_LABELS.office} ${t.office ? TARGET_LABELS.officeIn : TARGET_LABELS.officeOut}`;
  return `${TARGET_LABELS.target} ${n} ${TARGET_LABELS.people}${who ? ` ${who}` : ""}${office}`;
}
