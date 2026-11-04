// ケアマネの手（T20）への世界の返事。lib/drill/director.ts の末尾から分けた（T90 の準備）。director.ts は同じ名前を再び出す。
// 本人・家族・支援者の電話に「出るか」は本人役（lib/drill/persona.ts の decideCallPickup・personaCallReply）。
// ここは世界が答える所: 電話の線がつながるか、事業所・市役所につながるか、出向いて着けるか、出向いてもらえるか、福祉避難所が受けるか。
// 確率はこの表で先に決める（roll は 0 以上 1 未満。Math.random など）。文は固定で、Opus の言い換え（T20）があればそれ。

import type { ContactKind, DrillAction } from "../db/types.ts";
import { phoneOf, type PhoneState, type WorldState } from "./scenarios.ts";

/** 確率の表 */
export const WORLD_ODDS = {
  /** 事業所・市役所への電話がつながる（電話の様子ごと） */
  connect: { ok: 0.9, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 自分が出向いて着ける。警戒の中（警戒レベル 4 以上・津波の避難・浸水）は下がる。家の前の道が通行止なら着けない */
  reach: { clear: 0.95, warning: 0.7 },
  /** 訪問看護・介護の人に出向いてもらえる（頼む電話の様子ごと）。職員の空きなし・訪問看護が来られない・通行止なら出せない */
  dispatch: { ok: 0.8, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 福祉避難所が受け入れる（発災からの時間ごと。始めは開いていないことが多い）。電話が不通なら頼めない */
  accept: [
    { until: 24, odds: 0.3 },
    { until: 48, odds: 0.6 },
    { until: Infinity, odds: 0.8 },
  ],
  /** 市役所に報告できる（電話の様子ごと） */
  report: { ok: 0.9, busy: 0.6, down: 0 } satisfies Record<PhoneState, number>,
} as const;

/** 返事の状態（2〜4 字） */
export const WORLD_REPLY_LABELS = {
  ringing: "呼出",
  connected: "通話",
  noLine: "不通",
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
};

/** 本人・家族・支援者の区分（電話に出るかは本人役が決める相手） */
const PERSON_CALLEES: ReadonlySet<ContactKind> = new Set(["self", "family", "supporter", "welfare_commissioner"]);

export type WorldAsk = {
  action: DrillAction;
  /** 相手の本人（台帳の id）。市役所への報告・自分の避難は null */
  person: string | null;
  /**
   * 相手の区分。電話（call_contact）の相手、出向いてもらう人（dispatch: visiting_nurse か care_service。無ければ事業所の職員）。
   * call_person は本人（self）
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

/** 電話の線の様子。本人の家にかけるときは家の電話（不通の印）、ほかは世界の電話 */
export function callLine(w: WorldState, person: string | null, callee: ContactKind | null | undefined): PhoneState {
  return callee === "self" || callee == null ? phoneOf(w, person) : w.phone;
}

/** 福祉避難所が受け入れる確率（時間ごと） */
export function acceptOdds(hour: number): number {
  return WORLD_ODDS.accept.find((x) => hour < x.until)?.odds ?? 0;
}

/**
 * ケアマネの手 1 つへの世界の返事（固定の文）。確率は WORLD_ODDS、世界の事実（通行止・不通・休止・職員の空き・訪問看護）は先に見る。
 * 本人・家族・支援者への電話は線がつながるか（呼出・不通）だけ返す。出るか・何を言うかは本人役（T18）
 */
export function decideWorldReply(ask: WorldAsk, roll: number): WorldReply {
  const { action, person, world: w } = ask;
  const callee = action === "call_person" ? "self" : (ask.callee ?? null);
  switch (action) {
    case "call_person":
    case "call_contact": {
      const line = callLine(w, person, callee);
      if (line === "down") return reply(action, false, "noLine", w.phone === "down" ? "電話 不通" : "家の電話 不通");
      if (callee === null || PERSON_CALLEES.has(callee)) return reply(action, true, "ringing");
      if (callee === "dialysis_center" && person) {
        const f = w.facilities.find((x) => x.person === person && !x.open && x.depends === "dialysis_center");
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
      if (w.phone === "down") return reply(action, false, "noDispatch", "電話 不通");
      return roll < WORLD_ODDS.dispatch[w.phone] ? reply(action, true, "dispatched") : reply(action, false, "noDispatch");
    }
    case "request_welfare_shelter": {
      if (w.phone === "down") return reply(action, false, "noLine", "電話 不通");
      return roll < acceptOdds(ask.hour) ? reply(action, true, "accepted") : reply(action, false, "refused");
    }
    case "report_city": {
      if (w.phone === "down") return reply(action, false, "noLine", "電話 不通");
      return roll < WORLD_ODDS.report[w.phone] ? reply(action, true, "reported") : reply(action, false, "noLine");
    }
    case "evacuate_self":
      return reply(action, true, "evacuated");
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
