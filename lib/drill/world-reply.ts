// ケアマネの手（T20・T91）への世界の返事。lib/drill/director.ts の末尾から分けた（T90 の準備）。director.ts は同じ名前を再び出す。
// 本人・家族・支援者の電話に「出るか」は本人役（lib/drill/persona.ts の decideCallPickup・personaCallReply）。
// ここは世界が答える所: 電話の線がつながるか、事業所・市役所につながるか、出向いて着けるか、出向いてもらえるか、受け入れるか、手配できるか。
// 決め方は手の表（lib/drill/action-catalog.ts）の decide の種類で分ける（電話型・訪問型・訪問依頼・手配型・受入型・報告型・記録型）。
// 世界の事実（通行止・通話不可・休止・職員の空き・訪問看護が来られない）を先に見て、確率はこの表で決める（roll は 0 以上 1 未満。Math.random など）。
// 文は固定で、Opus の言い換え（T20）があればそれ。Claude は結果を決めない。

import type { ContactKind, DependsOn, DrillAction } from "../db/types.ts";
import { actionRow, type ArrangeOdds } from "./action-catalog.ts";
import { NO_CALL } from "./event-catalog.ts";
import { phoneOf, type PhoneState, type WorldState } from "./scenarios.ts";

/** 確率の表 */
export const WORLD_ODDS = {
  /** 事業所・市役所への電話がつながる（電話の様子ごと） */
  connect: { ok: 0.9, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 自分が出向いて着ける。警戒の中（警戒レベル 4 以上・津波の避難・浸水）は下がる。家の前の道が通行止なら着けない */
  reach: { clear: 0.95, warning: 0.7 },
  /** 訪問看護・介護の人に出向いてもらえる（頼む電話の様子ごと）。職員の空きなし・訪問看護が来られない・通行止なら出せない */
  dispatch: { ok: 0.8, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 福祉避難所・病院が受け入れる（発災からの時間ごと。始めは開いていないことが多い）。電話が通話不可なら頼めない */
  accept: [
    { until: 24, odds: 0.3 },
    { until: 48, odds: 0.6 },
    { until: Infinity, odds: 0.8 },
  ],
  /** 市役所に報告できる（電話の様子ごと） */
  report: { ok: 0.9, busy: 0.6, down: 0 } satisfies Record<PhoneState, number>,
  /** 薬・透析・移送・電源の手配を受けてもらえる（頼む電話の様子ごと。T91） */
  arrange: { ok: 0.8, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 業者（酸素・電力・その他）に来てもらえる（T91） */
  vendor: { ok: 0.7, busy: 0.4, down: 0 } satisfies Record<PhoneState, number>,
  /** ほかの事業所が応援を出せる（T91） */
  backup: { ok: 0.6, busy: 0.3, down: 0 } satisfies Record<PhoneState, number>,
} as const;

/** 手配型の確率の行（表の decide.odds） */
const ARRANGE_ODDS: Readonly<Record<ArrangeOdds, Record<PhoneState, number>>> = {
  arrange: WORLD_ODDS.arrange,
  vendor: WORLD_ODDS.vendor,
  backup: WORLD_ODDS.backup,
};

/** 返事の状態（2〜4 字）。T19 の 13 と記録（T91） */
export const WORLD_REPLY_LABELS = {
  ringing: "呼出",
  connected: "通話",
  noLine: NO_CALL,
  closed: "休止",
  arrived: "到着",
  blocked: "通行止",
  turnedBack: "到着不可",
  dispatched: "手配済",
  noDispatch: "手配不可",
  accepted: "受入",
  refused: "受入不可",
  reported: "報告済",
  evacuated: "避難済",
  noted: "記録済",
  /** 自由対応のそのままの手（T110）。結果は AI の起きたこと（世界は変えない） */
  done: "実施",
} as const;
export type WorldReplyStatus = keyof typeof WORLD_REPLY_LABELS;

/** 固定の文（T20 で Opus が言い換えるまでの物。画面の 1 文） */
export const WORLD_REPLY_TEXTS: Readonly<Record<WorldReplyStatus, string>> = {
  ringing: "呼び出している",
  connected: "つながった",
  noLine: "電話がつながらない",
  closed: "休止していて受けられない",
  arrived: "家に着いた",
  blocked: "道が通れず近づけない",
  turnedBack: "途中で引き返した",
  dispatched: "向かってもらえる",
  noDispatch: "向かえる人がいない",
  accepted: "受け入れてもらえる",
  refused: "受け入れられない",
  reported: "報告した",
  evacuated: "避難した",
  noted: "記録した",
  done: "対応した",
};

/** 本人・家族・支援者の区分（電話に出るかは本人役が決める相手） */
const PERSON_CALLEES: ReadonlySet<ContactKind> = new Set(["self", "family", "supporter", "welfare_commissioner"]);

export type WorldAsk = {
  action: DrillAction;
  /** 相手の本人（台帳の id）。市役所への報告・自分の避難・応援依頼は null */
  person: string | null;
  /**
   * 相手の区分。電話の相手、出向いてもらう人（dispatch: visiting_nurse か care_service。無ければ事業所の職員）、手配の相手。
   * call_person は本人（self）。固定の相手（事業所の職員・市役所・福祉避難所・ほかの事業所）は null
   */
  callee?: ContactKind | null;
  world: WorldState;
  /** 手を打った時刻（発災からの時間） */
  hour: number;
};

export type WorldReply = {
  action: DrillAction;
  ok: boolean;
  status: WorldReplyStatus;
  /** そうなった世界の事実（表から組む。「家の前の道 通行止」）。確率で外れたときは null */
  because: string | null;
  /** 画面の 1 文。固定の文か、Opus の言い換え（ai: true） */
  text: string;
  ai: boolean;
};

function reply(action: DrillAction, ok: boolean, status: WorldReplyStatus, because: string | null = null): WorldReply {
  return { action, ok, status, because, text: WORLD_REPLY_TEXTS[status], ai: false };
}

const closedRoad = (w: WorldState, person: string | null) => (person ? w.roads.find((r) => r.person === person && !r.open) ?? null : null);

/** 本人の頼り先の施設の休止（透析施設の浸水など） */
const closedFacility = (w: WorldState, person: string | null, depends: DependsOn) =>
  person ? (w.facilities.find((x) => x.person === person && !x.open && x.depends === depends) ?? null) : null;

/** 電話の線の様子。本人の家にかけるときは家の電話（通話不可の印）、ほかは世界の電話 */
export function callLine(w: WorldState, person: string | null, callee: ContactKind | null | undefined): PhoneState {
  return callee === "self" || callee == null ? phoneOf(w, person) : w.phone;
}

/** 福祉避難所・病院が受け入れる確率（時間ごと） */
export function acceptOdds(hour: number): number {
  return WORLD_ODDS.accept.find((x) => hour < x.until)?.odds ?? 0;
}

/**
 * ケアマネの手 1 つへの世界の返事（固定の文）。手の表の decide の種類で決める。確率は WORLD_ODDS、世界の事実は先に見る。
 * 本人・家族・支援者への電話は線がつながるか（呼出・通話不可）だけ返す。出るか・何を言うかは本人役（T18）。
 * roll は 1 回だけ使う（今までの 7 つの手と同じ。向かう人の着く分の幅は手の所が別に決める）
 */
export function decideWorldReply(ask: WorldAsk, roll: number): WorldReply {
  const { action, person, world: w } = ask;
  const row = actionRow(action);
  const callee = action === "call_person" ? "self" : (ask.callee ?? null);
  const decide = row.decide;
  switch (decide.type) {
    case "call": {
      // 電話型（本人電話・連絡先電話・119勧奨・見守依頼）
      const line = callLine(w, person, callee);
      if (line === "down") return reply(action, false, "noLine", w.phone === "down" ? `電話 ${NO_CALL}` : `家の電話 ${NO_CALL}`);
      if (callee === null || PERSON_CALLEES.has(callee)) return reply(action, true, "ringing");
      if (callee === "dialysis_center") {
        const f = closedFacility(w, person, "dialysis_center");
        if (f) return reply(action, false, "closed", `${f.label} 休止`);
      }
      return roll < WORLD_ODDS.connect[line] ? reply(action, true, "connected") : reply(action, false, "noLine");
    }
    case "visit": {
      const road = closedRoad(w, person);
      if (road) return reply(action, false, "blocked", `${road.label} 通行止`);
      const warning = (w.alertLevel ?? 0) >= 4 || w.tsunami === "evacuate" || w.flood;
      const odds = warning ? WORLD_ODDS.reach.warning : WORLD_ODDS.reach.clear;
      return roll < odds ? reply(action, true, "arrived") : reply(action, false, "turnedBack");
    }
    case "dispatch": {
      if (callee === "visiting_nurse" && person && w.marks[person]?.nurseAway !== undefined) {
        return reply(action, false, "noDispatch", "訪問看護 来られない");
      }
      if (callee !== "visiting_nurse" && w.staff <= 0) return reply(action, false, "noDispatch", "職員の空き なし");
      const road = closedRoad(w, person);
      if (road) return reply(action, false, "blocked", `${road.label} 通行止`);
      if (w.phone === "down") return reply(action, false, "noDispatch", `電話 ${NO_CALL}`);
      return roll < WORLD_ODDS.dispatch[w.phone] ? reply(action, true, "dispatched") : reply(action, false, "noDispatch");
    }
    case "arrange": {
      // 手配型（薬手配・透析調整・移送手配・電源手配・業者連絡・応援依頼）
      const failed = decide.ok === "accepted" ? "refused" : "noDispatch";
      if (decide.closedBy && callee === decide.closedBy) {
        const f = closedFacility(w, person, decide.closedBy);
        if (f) return reply(action, false, "closed", `${f.label} 休止`);
      }
      if (w.phone === "down") return reply(action, false, "noLine", `電話 ${NO_CALL}`);
      // 本人の家へ向かう手配（薬・移送・電源・業者）は、家の前の道が通行止なら届かない
      const road = row.effects.some((e) => e.kind === "arrival") ? closedRoad(w, person) : null;
      if (road) return reply(action, false, "blocked", `${road.label} 通行止`);
      return roll < ARRANGE_ODDS[decide.odds][w.phone] ? reply(action, true, decide.ok) : reply(action, false, failed);
    }
    case "accept": {
      // 受入型（受入依頼・病院受入）
      if (w.phone === "down") return reply(action, false, "noLine", `電話 ${NO_CALL}`);
      return roll < acceptOdds(ask.hour) ? reply(action, true, "accepted") : reply(action, false, "refused");
    }
    case "report": {
      if (w.phone === "down") return reply(action, false, "noLine", `電話 ${NO_CALL}`);
      return roll < WORLD_ODDS.report[w.phone] ? reply(action, true, "reported") : reply(action, false, "noLine");
    }
    case "record":
      return reply(action, true, decide.status);
  }
}

/** 返事の文を言い換える口（T20 で Opus。文だけ返す。決まった ok・status・because は変えない）。失敗・空は固定の文 */
export type WorldReplyWords = (reply: WorldReply, ask: WorldAsk) => Promise<string | null>;

/** 世界の返事。確率と事実は表で先に決め、words があれば文だけ言い換える（失敗は固定の文、AI の印なし） */
export async function worldReply(ask: WorldAsk, roll: number, words?: WorldReplyWords): Promise<WorldReply> {
  const fixed = decideWorldReply(ask, roll);
  if (!words) return fixed;
  try {
    const t = (await words(fixed, ask))?.trim();
    return t ? { ...fixed, text: t, ai: true } : fixed;
  } catch {
    return fixed;
  }
}
