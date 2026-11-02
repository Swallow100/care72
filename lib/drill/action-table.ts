// ケアマネの 7 つの手の表（docs/tasks/T20.md）。所要時間と、手ごとに要る相手。
// 画面（components/drill/ActionPanel、ブラウザ）と手の所（lib/drill/actions.ts、サーバー）が同じ表を読む。
// ここは型と定数だけ（Claude を呼ぶ層を読まない。ブラウザの束に入る）。

import type { ContactKind, DrillAction } from "../db/types.ts";

/** 手ごとの所要時間（分）。出向く 40 分（仕様書「画面 4」）。電話は 5 分、手配・報告は電話の分と取り次ぎ */
export const ACTION_MINUTES: Readonly<Record<DrillAction, number>> = {
  call_person: 5,
  call_contact: 5,
  visit: 40,
  dispatch: 10,
  request_welfare_shelter: 15,
  report_city: 10,
  evacuate_self: 30,
};

/** 本人の相手が要る手 */
const NEEDS_PERSON: ReadonlySet<DrillAction> = new Set(["call_person", "call_contact", "visit", "dispatch", "request_welfare_shelter"]);

export function needsPerson(kind: DrillAction): boolean {
  return NEEDS_PERSON.has(kind);
}

/** 電話の相手になる区分（本人電話は本人、連絡先電話は本人のほかの全部） */
export const CALL_CONTACT_KINDS: ReadonlyArray<ContactKind> = [
  "family",
  "supporter",
  "welfare_commissioner",
  "visiting_nurse",
  "care_service",
  "home_doctor",
  "pharmacy",
  "dialysis_center",
  "city_office",
];

/** 出向いてもらえる相手の区分（無ければ事業所の職員） */
export const DISPATCH_KINDS: ReadonlyArray<ContactKind> = ["visiting_nurse", "care_service"];

/** 相手の連絡先が選べる手と、その区分。無い手は相手を受けない */
export function targetKinds(kind: DrillAction): ReadonlyArray<ContactKind> {
  switch (kind) {
    case "call_person":
      return ["self"];
    case "call_contact":
      return CALL_CONTACT_KINDS;
    case "dispatch":
      return DISPATCH_KINDS;
    case "report_city":
      return ["city_office"];
    default:
      return [];
  }
}

/** 相手の連絡先が無ければ受けない手（連絡先電話）。本人電話は本人の連絡先を自動で選ぶ */
export function needsTarget(kind: DrillAction): boolean {
  return kind === "call_contact";
}

/** 画面で相手を選ばせる手（連絡先電話は要る、訪問依頼は任意で無ければ事業所の職員） */
export function picksTarget(kind: DrillAction): boolean {
  return kind === "call_contact" || kind === "dispatch";
}
