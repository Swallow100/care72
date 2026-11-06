// 飛んだ先の案内（T169）の 1 か所の表。台帳の未確認の場所（pending の field）→ 面の編集のどこに入れるか。
// 見る側の行は lib/person.ts の FIELDS（matchField）が決める。ここは編集側だけ。
// 優先の順: 時計に付く未確認は時計の行 → 連絡先の問いの場所（contacts.<id>.<所>）はその連絡先の行 → 欄の表の欄はその欄 → 下の表。
// 表は FIELDS の全部の鍵を持つ（足りないと lib/intake/t169.test.ts で落ちる）。null は面の編集に入れる所が無い欄
// （生年月日は面の上の段で直さない、本人の報告の扱いは台帳の外）。ブラウザでも読める（サーバーの物を import しない）。

import { intakeField } from "./fields.ts";

/**
 * 面の編集のどこに紫を付けるか。items は組の鍵（SectionForm の項目）、groups は組の箱、clocks・contacts は行の id、
 * night は家族と支援者の連絡先の行の「夜間」の選ぶ欄（夜間支援の未確認。組ごと紫にすると何を入れるか分からない）
 */
export type EditTargets = { items: string[]; groups: string[]; clocks: string[]; contacts: string[]; night: boolean };

type Place = { items?: string[]; groups?: string[]; night?: true };

const item = (...items: string[]): Place => ({ items });
const group = (...groups: string[]): Place => ({ groups });

/** FIELDS の鍵 → 編集の場所。薬の残りと時計は clockId、連絡先の問いは contacts.<id> で行まで絞る */
export const FIELD_PLACES: Readonly<Record<string, Place | null>> = {
  "medical.medications": item("medical.medications"),
  "medical.devices": item("medical.devices"),
  clocks: item("clocks"),
  // かかりつけ・薬局・透析施設は連絡先の行で、直すのは関係者の面（lib/intake/fields.ts の FIELD_GROUPS の注）
  "medical.doctor": group("people-others"),
  "medical.dialysis_center": group("people-others"),
  "medical.allergies": item("medical.allergies"),
  "medical.history": item("medical.history"),
  "medical.vaccinations": item("medical.vaccinations"),
  "evacuation.hazards": item("evacuation.hazards"),
  "evacuation.destination1": item("evacuation.destination1"),
  "evacuation.destination2": item("evacuation.destination2"),
  "evacuation.destination1Minutes": item("evacuation.destination1Minutes"),
  "evacuation.destination2Means": item("evacuation.destination2Means"),
  "evacuation.destination2Minutes": item("evacuation.destination2Minutes"),
  "evacuation.nearest": item("evacuation.nearest"),
  "evacuation.nearestMeans": item("evacuation.nearestMeans"),
  "evacuation.nearestMinutes": item("evacuation.nearestMinutes"),
  "evacuation.stayHome": item("evacuation.stayHome"),
  "evacuation.transport": item("evacuation.transportKind", "evacuation.transport"),
  "evacuation.support": item("evacuation.support"),
  "evacuation.route": item("evacuation.route"),
  "evacuation.barriers": item("evacuation.barriers"),
  "basic.housing": group("evacuation-housing"),
  "basic.housing.bedroom": item("basic.housing.bedroom"),
  "basic.housing.type": item("basic.housing.type"),
  "evacuation.carryItems": item("evacuation.carryItems"),
  "evacuation.pets": item("evacuation.pets"),
  "evacuation.myTimeline": item("evacuation.myTimeline"),
  "people.family": group("people-family"),
  "people.emergency": group("people-family"),
  "people.supporter1": group("people-supporter"),
  "people.supporter2": group("people-supporter"),
  "people.welfare_commissioner": group("people-local"),
  "local.watcher": item("local.watcher"),
  "local.orgName": item("local.orgName"),
  "local.orgPhone": item("local.orgPhone"),
  // 連絡先の問いの場所。行の id が分からないとき（消した連絡先）だけ、連絡先の組の全部
  contacts: group("people-family", "people-supporter", "people-local", "people-others"),
  // 夜間に来られるかは連絡先ごとの選ぶ欄。支援者と家族のどちらの行で答えても消える（lib/db/ledger.ts の contact）
  "people.night_supporter": { night: true },
  "people.others": group("people-others"),
  "basic.address": item("basic.address"),
  "basic.birth": null,
  "basic.sex": item("basic.sex"),
  "basic.contactMeans": group("basic-contact"),
  "basic.contactMeans.smartphone": item("basic.contactMeans.smartphone"),
  "basic.household": item("basic.household"),
  "basic.selfReport": null,
  care: group("basic-cert", "basic-move", "basic-sense", "basic-mind"),
  "care.handbook": item("care.handbook"),
  "care.intractableDisease": item("care.intractableDisease"),
  notes: item("notes"),
  "consent.registry": item("consent.registry"),
  "consent.plan_share": item("consent.plan_share"),
  "consent.supporters": item("consent.supporters"),
  "consent.medical": item("consent.medical"),
  "consent.ai_overseas": item("consent.ai_overseas"),
};

const CONTACT_FIELD = /^contacts\.([^.]+)/;

/** URL の field の値: 全部の未確認（ほかは区分「section:medical」と欄の鍵。lib/person.ts の parseFieldFocus） */
export const FOCUS_ALL = "all";

export const NO_EDIT_TARGETS: EditTargets = { items: [], groups: [], clocks: [], contacts: [], night: false };

/**
 * 未確認の場所 1 つ → 面の編集の場所。fieldKey は FIELDS の鍵（無ければ null）、clockId はその未確認が付く時計（lib/person.ts の pendingClockId）。
 * 入れる所が無ければ null
 */
export function editTargetOf(field: string, fieldKey: string | null, clockId: string | null): EditTargets | null {
  if (clockId) return { ...NO_EDIT_TARGETS, clocks: [clockId] };
  const contact = CONTACT_FIELD.exec(field);
  if (contact) return { ...NO_EDIT_TARGETS, contacts: [contact[1]] };
  if (intakeField(field)) return { ...NO_EDIT_TARGETS, items: [field] };
  const place = fieldKey ? FIELD_PLACES[fieldKey] : undefined;
  return place ? { ...NO_EDIT_TARGETS, items: place.items ?? [], groups: place.groups ?? [], night: place.night === true } : null;
}

/** いくつかの場所を 1 つに（重ねない） */
export function mergeEditTargets(list: ReadonlyArray<EditTargets>): EditTargets {
  const uniq = (k: "items" | "groups" | "clocks" | "contacts") => [...new Set(list.flatMap((t) => t[k]))];
  return { items: uniq("items"), groups: uniq("groups"), clocks: uniq("clocks"), contacts: uniq("contacts"), night: list.some((t) => t.night) };
}
