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
