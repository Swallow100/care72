// 出来事 1 つが誰に効くか（docs/tasks/T125.md の 6）。区域の出来事（津波警報・避難指示・川の氾濫・土砂の警戒）は、区域にいる人
// （開始の時の台帳のハザードの写し DrillState.homes）と区域の事業所（DrillState.officeZones）にだけ効く。全体の出来事（地震の揺れ・
// 全域の停電・電話・電波・断水）は参加者の全員と事業所、本人の出来事はその人。画面で「誰が対象か」を出す作業（T128）が読む。
// Claude を呼ばない。色と連絡順（lib/triage）には使わない。

import type { HazardKind } from "../db/types.ts";
import { homeInOutage, type Homes } from "./comms.ts";
import type { DrillIncident } from "./incident-types.ts";
import type { WorldState } from "./scenarios.ts";

/** 出来事の対象。persons は参加者の id（並びは参加者の順）、office は事業所に効くか */
export type IncidentTargets = { persons: string[]; office: boolean };

export type TargetContext = {
  participants: ReadonlyArray<string>;
  homes?: Homes;
  officeZones?: ReadonlyArray<HazardKind>;
  /** 出来事を当てる前の世界（停電の復旧は前の停電の範囲で見る） */
  world?: Pick<WorldState, "outage">;
};

const NONE: IncidentTargets = { persons: [], office: false };

/** 川の氾濫の浸水の地区（m）。想定の表の文と停電の地区（FLOOD_AREA）と同じ */
export const FLOOD_DEPTH_M = 3;

/** 区域（台帳のハザードの種類）にいる参加者と、事業所がその区域か */
function inZones(ctx: TargetContext, zones: ReadonlyArray<HazardKind>): IncidentTargets {
  const persons = ctx.participants.filter((p) => (ctx.homes?.[p]?.zones ?? []).some((z) => zones.includes(z.kind)));
  return { persons, office: (ctx.officeZones ?? []).some((z) => zones.includes(z)) };
}

const everyone = (ctx: TargetContext): IncidentTargets => ({ persons: [...ctx.participants], office: true });

/** 本人の id の一覧（参加者の順、重ねない） */
const only = (ctx: TargetContext, ids: ReadonlyArray<string | null | undefined>): IncidentTargets => {
  const set = new Set(ids.filter((x): x is string => !!x));
  return { persons: ctx.participants.filter((p) => set.has(p)), office: false };
};

/** 出来事 1 つの対象（区域の出来事は区域の人と区域の事業所だけ）。予定の出来事は中身で見る */
export function targetsOf(e: Pick<DrillIncident, "change" | "person">, ctx: TargetContext): IncidentTargets {
  const c = e.change.kind === "schedule" && e.change.then.kind === "event" ? e.change.then.change : e.change;
  switch (c.kind) {
    case "tsunami":
      // 津波警報・解除は津波の区域
      return inZones(ctx, ["tsunami"]);
    case "alert":
      // 大雨の警戒レベル（避難指示など）は洪水・土砂の区域。解除（null）は誰にも新しく効かない
      return c.level === null ? NONE : inZones(ctx, ["flood", "landslide"]);
    case "flood": {
      // 川の氾濫は洪水の区域の深い所（想定の表の文「浸水 3 m の地区で浸水」と停電の地区と同じ線。lib/drill/area-targets.ts の FLOOD_TARGET_DEPTH_M）
      const persons = ctx.participants.filter((p) => (ctx.homes?.[p]?.zones ?? []).some((z) => z.kind === "flood" && (z.depthM ?? 0) >= FLOOD_DEPTH_M));
      return { persons, office: (ctx.officeZones ?? []).includes("flood") };
    }
    case "note":
      // 土砂の警戒は土砂の区域（と、差し込みが指した人）。ほかの話題（給水所・情報の混乱・自分の身の回り）は全体
      if (c.topic === "landslide_warn") {
        const z = inZones(ctx, ["landslide"]);
        return { persons: only(ctx, [...z.persons, e.person]).persons, office: z.office };
      }
      return c.topic.startsWith("self_") ? { persons: [], office: false } : everyone(ctx);
    case "quake":
    case "phone":
    case "radio":
    case "water":
    case "weather":
      return everyone(ctx);
    case "outage":
    case "outage_restored": {
      const area = c.kind === "outage" ? c.area : ctx.world?.outage?.area;
      if (!area || area.scope === "office") return everyone(ctx);
      return { persons: ctx.participants.filter((p) => ctx.homes?.[p] && homeInOutage(area, ctx.homes[p])), office: false };
    }
    case "town_flood":
    case "landslide":
    case "town_road":
    case "town_water":
    case "town_line":
    case "town_facility":
      return only(ctx, [...c.persons, e.person]);
    default:
      return e.person ? only(ctx, [e.person]) : NONE;
  }
}
