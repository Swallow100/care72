// 状況（世界の出来事）と監督（T19）の型と、監督の返した物を状況にする所。lib/drill/engine.ts から分けた（T90 の準備）。
// engine.ts は同じ名前を再び出す。監督の呼び方・指示は lib/drill/director.ts。

import type { ContactKind, DrillAction, DrillScenario } from "../db/types.ts";
import { isSourceId, type SourceId } from "../sources/index.ts";
import type { ActionRecord, ActionStatus } from "./action-types.ts";
import { AI_STOP_LABELS } from "./labels.ts";
import type { PersonState } from "./persona-types.ts";
import { AI_STOPS, injectChange, isInjectKind, type AiStop, type InjectKind, type WorldEvent, type WorldState } from "./scenarios.ts";

/**
 * 状況（世界の出来事）1 つ。表の世界の出来事は world、監督（T19）の差し込みは director（想定の表の固定の物と Opus の物）。
 * 監督の物は inject（種類）・reason（判断の理由。採点 T22 が読む）・basis（根拠の出典）を持てる
 */
export type DrillIncident = Omit<WorldEvent, "by"> & {
  actor: "world" | "director";
  at: number;
  /** Claude（監督）が作った物。画面で AI の印。想定の表の固定の差し込みは false */
  ai: boolean;
};

/** 監督（T19）に渡す物。表の状況（固定の差し込みも）を当てたあとの世界 */
export type DirectorInput = {
  scenario: DrillScenario;
  step: number;
  hour: number;
  world: WorldState;
  /** この刻みの表の状況 */
  incidents: ReadonlyArray<DrillIncident>;
  participants: ReadonlyArray<string>;
  people: Readonly<Record<string, PersonState>>;
  actions: ReadonlyArray<ActionRecord>;
  /**
   * 言い換えてほしい世界の返事（T20）。手の途中でこの刻みに着いたとき、その手の返事（固定の文）をこの 1 回の監督に相乗りさせる。
   * 無ければ差し込みだけ
   */
  replies?: ReadonlyArray<ReplyAsk>;
  /** 夜間発災（T59）。監督・世界に「発災は深夜 2 時ごろ。今は N 時ごろ」の 1 行を足す */
  night?: boolean;
  /** 前に進めた時刻（発災からの分、T90）。この区切りは since から hour まで。無ければ刻みの道（今までと同じ） */
  since?: number;
  /** この区切りで差し込んでよい数（T90）。無ければ DIRECTOR_MAX */
  budget?: number;
};

/** 監督に言い換えを頼む世界の返事 1 つ。結果（status・because）は決まっていて、監督は文だけ返す */
export type ReplyAsk = {
  /** 手の番号（a1…） */
  id: string;
  action: DrillAction;
  person: string | null;
  callee: ContactKind | null;
  status: ActionStatus;
  because: string | null;
  /** 固定の文 */
  text: string;
};

/** 監督の言い換え 1 つ（手の番号と文） */
export type ReplyWords = { id: string; text: string };

/**
 * 監督の差し込み 1 つ。種類（表の 6 つ）と相手の本人だけを選び、世界の変化は engine が種類から組む（injectChange）。
 * text は画面の 1 行（氏名を書かない。画面が名前を添える）
 */
export type DirectorEvent = {
  inject: InjectKind;
  person: string;
  text: string;
  reason?: string;
  basis?: SourceId;
  /** Claude（Opus）が選んだ物 */
  ai: boolean;
};

/** 監督の返す物。差し込みと、頼まれた世界の返事の言い換え */
export type DirectorResult = { events: DirectorEvent[]; words?: ReadonlyArray<ReplyWords> };

/** 差し込む状況（0〜2 個）と言い換え。差し込みだけの配列も受ける。投げたら差し込みなし・言い換えなしで進む */
export type DirectorHook = (input: DirectorInput) => Promise<DirectorEvent[] | DirectorResult>;

/** 監督の差し込みは 1 刻みに 2 つまで */
export const DIRECTOR_MAX = 2;

/**
 * 監督の返した物を状況にする。表の 6 つの外の種類・参加者でない本人・空の文は捨て、同じ本人に 2 つは当てない。
 * 世界の変化は種類からコードが組むので、監督が表の外の変化（警戒・断水・全域の停電など）を起こす道は無い
 */
export function directorIncidents(
  events: ReadonlyArray<DirectorEvent>,
  members: ReadonlySet<string>,
  hour: number,
): DrillIncident[] {
  const out: DrillIncident[] = [];
  const used = new Set<string>();
  for (const e of events) {
    if (out.length >= DIRECTOR_MAX) break;
    if (!isInjectKind(e.inject) || typeof e.person !== "string" || !members.has(e.person) || used.has(e.person)) continue;
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!text) continue;
    used.add(e.person);
    out.push({
      change: injectChange(e.inject, e.person),
      text,
      person: e.person,
      inject: e.inject,
      ...(typeof e.reason === "string" && e.reason.trim() ? { reason: e.reason.trim() } : {}),
      ...(e.basis && isSourceId(e.basis) ? { basis: e.basis } : {}),
      actor: "director",
      at: hour,
      ai: e.ai === true,
    });
  }
  return out;
}

/** 停止の印の状況（無ければ空）。世界を変えない */
export function stopIncidents(stopped: ReadonlyArray<AiStop>, hour: number): DrillIncident[] {
  if (stopped.length === 0) return [];
  return [{ actor: "world", at: hour, change: { kind: "ai_stop", stopped: [...stopped] }, text: stopped.map((x) => AI_STOP_LABELS[x]).join("・"), ai: false }];
}

/** 刻みの停止の印（状況の ai_stop から。無ければ空） */
export function aiStoppedOf(tick: { incidents: ReadonlyArray<DrillIncident> }): AiStop[] {
  const set = new Set(tick.incidents.flatMap((e) => (e.change.kind === "ai_stop" ? e.change.stopped : [])));
  return AI_STOPS.filter((x) => set.has(x));
}
