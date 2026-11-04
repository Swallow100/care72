// 状況（世界の出来事）と監督（T19）の型と、監督の返した物を状況にする所。lib/drill/engine.ts から分けた（T90 の準備）。
// engine.ts は同じ名前を再び出す。監督の呼び方・指示は lib/drill/director.ts。

import type { ContactKind, DrillAction, DrillScenario } from "../db/types.ts";
import { isSourceId, type SourceId } from "../sources/index.ts";
import type { ActionRecord, ActionStatus } from "./action-types.ts";
import { AI_STOP_LABELS } from "./labels.ts";
import type { PersonState } from "./persona-types.ts";
import { afterOf, EVENT_CATALOG, isInjectKind, type EventFacts, type EventPlace, type InjectKind } from "./event-catalog.ts";
import { AI_STOPS, type AiStop, type WorldEvent, type WorldState } from "./scenarios.ts";
import type { DrillScale } from "./scale.ts";
import type { SelfInput } from "./self.ts";

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
  /** 仮想の訓練の規模（T104、lib/drill/scale.ts）。仮想だけ。世界に「決まっている災害」の 1 行を渡す */
  scale?: DrillScale;
  /**
   * 訓練する人（自分）の住む所（T104、lib/drill/self.ts）。連続の時計の大雨想定・地震想定だけ。
   * 無ければ監督は自分の出来事を差し込まない（10 分版・仮想・前からの訓練）
   */
  self?: SelfInput;
  /**
   * 訓練ごとの起きやすさの種（T121、lib/drill/time-odds.ts の drillSeed。開始の時刻と想定から）。監督と世界に「この時間帯に起きやすい物・
   * 起きにくい物」とこの訓練の傾向を渡し、差し込める種類の並びも揺らす。無ければ揺らさない（前と同じ）
   */
  seed?: string;
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
 * 監督の差し込み 1 つ。種類（出来事の表 lib/drill/event-catalog.ts）と相手だけを選び、世界の変化は表の build（コード）が組む。
 * text は画面の 1 行（氏名を書かない。画面が名前を添える）。
 * 本人の種類は person、全体の種類（T92）は person なし。persons・place・facts・after はコード（lib/drill/director.ts）が付ける物で、
 * ここでも表と参加者で確かめる
 */
export type DirectorEvent = {
  inject: InjectKind;
  /** 本人の種類の相手（台帳の id）。全体の種類は無し */
  person?: string;
  text: string;
  reason?: string;
  basis?: SourceId;
  /** Claude（Opus）が選んだ物 */
  ai: boolean;
  /** 予定の種類の何時間後（表の範囲。外なら捨てる。無ければ表の既定） */
  after?: number;
  /** 全体の種類で印の付く人（訪問看護ステーションの休止。参加者でない人は外す） */
  persons?: ReadonlyArray<string>;
  /** 全体の種類の場所（満員になる避難所。世界にある物） */
  place?: EventPlace;
  /** 変化を組むのに要る本人の事実（病院の休止で透析の人か） */
  facts?: EventFacts;
};

/** 監督の返す物。差し込みと、頼まれた世界の返事の言い換え */
export type DirectorResult = { events: DirectorEvent[]; words?: ReadonlyArray<ReplyWords> };

/** 差し込む状況（0〜差し込める数）と言い換え。差し込みだけの配列も受ける。投げたら差し込みなし・言い換えなしで進む */
export type DirectorHook = (input: DirectorInput) => Promise<DirectorEvent[] | DirectorResult>;

/** 監督の差し込みは 1 刻みに 2 つまで（T90 の区切りでは DirectorInput.budget。無ければこれ） */
export const DIRECTOR_MAX = 2;

/** 場所の形（id は世界の避難所の形、名前は短い文字）。違えば無し */
function placeOf(v: unknown): EventPlace | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<EventPlace>;
  if (typeof p.id !== "string" || !/^sh-[\w-]{1,40}$/.test(p.id)) return null;
  if (typeof p.label !== "string" || !p.label.trim() || Array.from(p.label).length > 20) return null;
  return { id: p.id, label: p.label.trim() };
}

/**
 * 監督の返した物を状況にする。表の外の種類・参加者でない本人・空の文・範囲の外の何時間後は捨て、同じ本人に 2 つは当てない。
 * 全体の出来事は 1 区切りに 1 つ。数は max（T90 の budget。無ければ DIRECTOR_MAX）まで。
 * 1 つの差し込みが 2 行以上の状況になる種類がある（携帯不通と回復見込・土砂の警戒と道・訪問看護ステーションと来られない人）。
 * 理由と根拠は最初の行にだけ付ける。
 * 世界の変化は種類からコードが組むので、監督が表の外の変化（警戒・断水・全域の停電など）を起こす道は無い
 */
export function directorIncidents(
  events: ReadonlyArray<DirectorEvent>,
  members: ReadonlySet<string>,
  hour: number,
  max: number = DIRECTOR_MAX,
): DrillIncident[] {
  const out: DrillIncident[] = [];
  const used = new Set<string>();
  let areaUsed = false;
  let n = 0;
  for (const e of events) {
    if (n >= max) break;
    if (!isInjectKind(e.inject)) continue;
    const row = EVENT_CATALOG[e.inject];
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!text) continue;
    const after = afterOf(row, e.after);
    if (after === undefined) continue;
    let person: string | null = null;
    if (row.scope === "person") {
      if (typeof e.person !== "string" || !members.has(e.person) || used.has(e.person)) continue;
      person = e.person;
    } else if (areaUsed) {
      continue;
    }
    const persons = Array.isArray(e.persons) ? e.persons.filter((p): p is string => typeof p === "string" && members.has(p)) : [];
    const facts = e.facts && typeof e.facts === "object" ? { dialysis: e.facts.dialysis === true } : undefined;
    const parts = row.build({ person, persons, place: placeOf(e.place), ...(facts ? { facts } : {}) }, hour, after);
    if (parts.length === 0) continue;
    n += 1;
    if (person) used.add(person);
    else areaUsed = true;
    parts.forEach((part, i) => {
      out.push({
        change: part.change,
        // 文をコードが書く種類（何時間後・震度・避難所の名前）は表の文。ほかは最初の行だけ監督の文
        text: i === 0 && !row.ownText ? text : part.text,
        ...(part.person ? { person: part.person } : {}),
        inject: e.inject,
        ...(i === 0 && typeof e.reason === "string" && e.reason.trim() ? { reason: e.reason.trim() } : {}),
        ...(i === 0 && e.basis && isSourceId(e.basis) ? { basis: e.basis } : {}),
        actor: "director",
        at: hour,
        ai: e.ai === true,
      });
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
