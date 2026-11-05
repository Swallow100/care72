// 訓練の着信（docs/tasks/T21.md）。刻みの安否のうち電話の形の物を選ぶ。D1 を使わない所（ブラウザの束にも入る）。
//
// 電話の形: 家族・支援者（民生委員を含む）が言う事を持って連絡してきた物。本人（本人役）の連絡は赤緑のボタンと録音
// （発災時の本人の画面と同じ）で、赤の 4 問に答えた物もボタン。言う事の無い連絡はボタン（緑の 1 問）。
// 1 刻みに 2 件まで（多いと鳴りっぱなしになる）。同じ人は 1 刻みに 1 件（10 分版で寄せた刻みに同じ人の連絡が 2 つ来ても 1 回）。
// 並びは 赤 → 時刻の早い順 → 表の順。外れた連絡も安否としては今までどおり左の表と状況に入る（着信の画面に出さないだけ）。
// 保存（lib/drill/db.ts）は選んだ物を drill_events の call_in に残し、画面（components/drill/IncomingCall）は同じ関数で選び直す。

import type { ContactKind } from "../db/types.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import type { DrillTurn } from "./engine.ts";

/** 1 刻みの着信の上限 */
export const CALLS_PER_TICK = 2;

type PhoneShape = Pick<DrillTurn, "source" | "saying" | "color" | "injured" | "atHome" | "canMove" | "hasMedicine"> & Partial<Pick<DrillTurn, "via">>;

/** 電話の形の連絡か（家族・支援者の言う事のある連絡。本人と、赤の 4 問に答えた物はボタン）。経路（T125）が着信でなければ電話でない */
export function isPhoneTurn(t: PhoneShape): boolean {
  if (t.via !== undefined && t.via !== "call") return false;
  if (t.source === "agent") return false;
  if (!t.saying?.trim()) return false;
  const answered = [t.injured, t.atHome, t.canMove, t.hasMedicine].some((v) => v === true || v === false);
  return !(t.color === "red" && answered);
}

/** 刻みの安否のうち着信にする物の添字（turns の中の位置、並びは鳴らす順）。2 件まで、同じ人は 1 件 */
export function callIndexes(turns: ReadonlyArray<PhoneShape & Pick<DrillTurn, "person" | "at">>): number[] {
  const order = turns
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isPhoneTurn(t))
    .sort((a, b) => Number(b.t.color === "red") - Number(a.t.color === "red") || a.t.at - b.t.at || a.i - b.i);
  const out: number[] = [];
  const people = new Set<string>();
  for (const { t, i } of order) {
    if (out.length >= CALLS_PER_TICK) break;
    if (people.has(t.person)) continue;
    people.add(t.person);
    out.push(i);
  }
  return out;
}

/** 刻みの安否のうち着信にする物（鳴らす順） */
export function callsOf<T extends PhoneShape & Pick<DrillTurn, "person" | "at">>(turns: ReadonlyArray<T>): T[] {
  return callIndexes(turns).map((i) => turns[i]);
}

/**
 * 不在着信（T127）: 電話の形の連絡のうち鳴らさなかった物（1 刻み 2 件を超えた分と、同じ人の 2 件目）の添字。時刻の早い順。
 * 着信の記録（drill_events の call_in）には入れない（採点の着信の数・未応答の意味を変えない）。画面と経過が turns から出す
 */
export function missedIndexes(turns: ReadonlyArray<PhoneShape & Pick<DrillTurn, "person" | "at">>): number[] {
  const rung = new Set(callIndexes(turns));
  return turns
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => isPhoneTurn(t) && !rung.has(i))
    .sort((a, b) => a.t.at - b.t.at || a.i - b.i)
    .map(({ i }) => i);
}

/**
 * 安否がケアマネにどう届いたか（T127。経過の把握の行の印）。call 着信（鳴らした電話）・missed 不在（鳴らさなかった電話）・
 * button 安否のボタン（本人の連絡と、赤の 4 問に答えた物・言う事の無い物）・message 伝言（通話の規制の間の家族・支援者のメッセージ。T125）。
 * 世界の状態の側（T125、lib/drill/comms.ts）が安否に付けた経路（via）を先に読む: 伝言は不在着信にしない。経路の無い前からの安否は
 * 出どころと電話の形（isPhoneTurn）から出す
 */
export type TurnRoute = "call" | "missed" | "button" | "message";

export function turnRoute(t: PhoneShape, rung: boolean): TurnRoute {
  if (t.via === "message") return "message";
  if (!isPhoneTurn(t)) return "button";
  return rung ? "call" : "missed";
}

/** 不在着信の一覧の言葉（2〜4 字） */
export const MISSED_LABELS = {
  title: "不在着信",
  callback: "折返",
  calling: "発信中",
  /** 出しきれない分（「他 3 件」） */
  more: "他",
  count: "件",
} as const;

/** 一覧に出す数（新しい物から） */
export const MISSED_SHOWN = 4;

/** 不在着信の 1 件（T127。画面の対応の欄の上の一覧） */
export type MissedCall<T> = { turn: T; step: number; minute: number };

/** 折返に数える手（その人に電話した・会いに行った） */
const CALLBACK_KINDS: ReadonlySet<string> = new Set(["call_person", "call_contact", "visit"]);

/**
 * まだ折返していない不在着信（新しい順）。不在の連絡が入った刻みから後（同じ刻みを含む。手の刻み step は手を打った時の刻みで、
 * 不在の連絡はその刻みを当てた時に画面に出ている）に、その人へ本人電話・連絡先電話・訪問を打った物と、その人からの着信に応答した物は外す。
 * 色と順には使わない（画面の一覧だけ）
 */
export function openMissedCalls<T extends PhoneShape & Pick<DrillTurn, "person" | "at">>(
  ticks: ReadonlyArray<{ step: number; turns: ReadonlyArray<T> }>,
  acts: ReadonlyArray<{ person: string | null; kind: string; step: number }>,
  answered: ReadonlyArray<{ person: string; step: number; response: string | null }> = [],
): Array<MissedCall<T>> {
  const out: Array<MissedCall<T>> = [];
  for (const t of ticks) {
    for (const i of missedIndexes(t.turns)) {
      const turn = t.turns[i];
      const minute = Math.round(turn.at * 60);
      const done =
        acts.some((a) => a.person === turn.person && CALLBACK_KINDS.has(a.kind) && a.step >= t.step) ||
        answered.some((c) => c.person === turn.person && c.response === "answer" && c.step >= t.step);
      if (!done) out.push({ turn, step: t.step, minute });
    }
  }
  return out.sort((a, b) => b.minute - a.minute);
}

/** 刻みの安否ごとの経路（turns と同じ並び） */
export function turnRoutes(turns: ReadonlyArray<PhoneShape & Pick<DrillTurn, "person" | "at">>): TurnRoute[] {
  const rung = new Set(callIndexes(turns));
  return turns.map((t, i) => turnRoute(t, rung.has(i)));
}

/** 連絡先の言い方（lib/drill/view.ts の DrillContact と同じ形の一部） */
export type CallerContact = { kind: ContactKind; label: string };

const FAMILY: ReadonlyArray<ContactKind> = ["family"];
const SUPPORTERS: ReadonlyArray<ContactKind> = ["supporter", "welfare_commissioner"];

/**
 * 着信の相手の言い方（名前と番号は出さない）。家族が 1 人なら「家族 夫」（lib/list/calls.ts の callTargetText）、
 * 何人かいれば区分だけ（誰が掛けてきたかは本人役の安否に無い）。本人は「本人」
 */
export function callerLabel(source: DrillTurn["source"], contacts: ReadonlyArray<CallerContact>): string {
  if (source === "agent") return CONTACT_KIND_LABELS.self;
  const kinds = source === "family" ? FAMILY : SUPPORTERS;
  const own = contacts.filter((c) => kinds.includes(c.kind));
  if (own.length === 1) return own[0].label;
  return source === "family" ? CONTACT_KIND_LABELS.family : CONTACT_KIND_LABELS.supporter;
}

/**
 * 掛けてきた人の連絡先（T127）。着信の往復の本人役の話し手・往復の声・不在着信の折返の相手が、全部ここを読んで同じ人になる。
 * その区分（家族、または支援者と民生委員）が 1 人ならその人、何人かならスマホのある最初の人（安否を送れる人。声の
 * lib/drill/voice.ts の familyRelation と同じ）、次に電話のある最初の人、無ければ最初の人。区分の人がいなければ null。
 * 本人（agent）の連絡は電話の形にならないので null
 */
export type CallerTarget = { id: string; kind: ContactKind; label: string; hasPhone: boolean; smartphone?: boolean };

export function callerContact<T extends CallerTarget>(source: DrillTurn["source"], contacts: ReadonlyArray<T>): T | null {
  if (source === "agent") return null;
  const kinds = source === "family" ? FAMILY : SUPPORTERS;
  const own = contacts.filter((c) => kinds.includes(c.kind));
  if (own.length <= 1) return own[0] ?? null;
  return own.find((c) => c.smartphone === true) ?? own.find((c) => c.hasPhone) ?? own[0];
}
