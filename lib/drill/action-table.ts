// ケアマネの手の表の薄い包み（T20 の名前を T91 の lib/drill/action-catalog.ts から引く）。
// 画面（components/drill/ActionPanel、ブラウザ）と手の所（lib/drill/actions.ts、サーバー）が同じ表を読む。
// ここは型と定数だけ（Claude を呼ぶ層を読まない。ブラウザの束に入る）。

import type { ContactKind, DrillAction } from "../db/types.ts";
import { actionRow, CATALOG_MINUTES } from "./action-catalog.ts";

/** 手ごとの所要時間（分）。出向く 40 分（仕様書「画面 4」）。電話は 5 分、手配・報告は電話の分と取り次ぎ。自由対応は 0（読み替えた手の分） */
export const ACTION_MINUTES: Readonly<Record<DrillAction, number>> = CATALOG_MINUTES;

/** 本人の相手が要る手 */
export function needsPerson(kind: DrillAction): boolean {
  return actionRow(kind).needsPerson;
}

/** 電話の相手になる区分（本人電話は本人、連絡先電話は本人のほかの全部） */
export const CALL_CONTACT_KINDS: ReadonlyArray<ContactKind> = actionRow("call_contact").targetKinds;

/** 出向いてもらえる相手の区分（無ければ事業所の職員） */
export const DISPATCH_KINDS: ReadonlyArray<ContactKind> = actionRow("dispatch").targetKinds;

/** 相手の連絡先が選べる手と、その区分。無い手は相手を受けない */
export function targetKinds(kind: DrillAction): ReadonlyArray<ContactKind> {
  return actionRow(kind).targetKinds;
}

/** 相手の連絡先が無ければ受けない手（連絡先電話・119勧奨・見守依頼・薬手配など）。本人電話は本人の連絡先を自動で選ぶ */
export function needsTarget(kind: DrillAction): boolean {
  return actionRow(kind).needsTarget;
}

/**
 * 画面で相手を選ばせる手（相手の区分がある手。固定の相手のある手は、選ばなければ固定の相手）。
 * 本人電話は自動で本人、行政報告は今までどおり選ばせない（相手なしで市役所）
 */
export function picksTarget(kind: DrillAction): boolean {
  return kind !== "call_person" && kind !== "report_city" && actionRow(kind).targetKinds.length > 0;
}
