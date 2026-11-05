// 添付の様式（T86 の対応表）の欄の台帳の項目 → 台帳のどこで埋めるか（T135）。計画書（松山市）の MATSUYAMA_INPUTS（lib/forms/form-inputs.ts）と
// 同じ形で、台帳の項目（lib/forms/mapping.ts の LEDGER_ITEMS）ごとに値の元の場所を 1 つの表に持つ。
// - 紙の上でその場で入れる（components/forms/PaperFill.tsx）: 元が 1 つの欄（field・contact）ならその場で、ほかは入力の窓（T117）
// - 紙から質問（lib/forms/paper-slots.ts の paperQuestions）: 空いた欄のうち、問いの列のどれかが元に当たる物
// 表に無い項目（年齢・作成日・計画作成者・事業所名・担当ケアマネ・別紙）は台帳の別の値から作るので、紙からは書けない。
// 定型で Claude は呼ばない。ブラウザでも読む（サーバーの物を import しない）。

import type { FormContactRole, FormInput } from "./form-inputs.ts";
import type { ContactPart } from "../intake/contact-parts.ts";
import type { EditSection } from "../intake/edit.ts";
import type { LedgerItemKey } from "./mapping.ts";

const f = (...keys: string[]): FormInput[] => keys.map((key) => ({ kind: "field" as const, key }));
const c = (role: FormContactRole, part: ContactPart | "phone"): FormInput => ({ kind: "contact", role, part });
const page = (section: EditSection, ...asks: string[]): FormInput => (asks.length > 0 ? { kind: "page", section, asks } : { kind: "page", section });

/** 連絡先の 5 つの項目（氏名・フリガナ・続柄・電話・住所） */
function contact(prefix: "emergency1" | "emergency2" | "supporter1" | "supporter2"): Partial<Record<LedgerItemKey, readonly FormInput[]>> {
  const role: FormContactRole = prefix === "emergency1" ? "kin" : prefix === "emergency2" ? "kin2" : prefix;
  const asks = prefix === "emergency1" ? ["people.emergency"] : prefix === "supporter1" ? ["people.supporter1"] : [];
  return {
    [`${prefix}.name`]: [page("people", ...asks)],
    [`${prefix}.kana`]: [c(role, "kana")],
    [`${prefix}.relation`]: [page("people")],
    // 電話の欄は電話と携帯の 2 行（lib/forms/mapped-sheet.ts）。その場では書かず窓で 2 つ
    [`${prefix}.phone`]: [c(role, "phone"), c(role, "mobile")],
    [`${prefix}.address`]: [c(role, "address")],
  } as Partial<Record<LedgerItemKey, readonly FormInput[]>>;
}

const CARE_ISSUES = f(
  "care.walking",
  "care.hearing",
  "care.vision",
  "care.understanding",
  "care.judgment",
  "care.orientation",
  "care.bedridden",
  "care.dementia",
  "evacuation.barriers",
);

/** 台帳の項目ごとの元（LEDGER_ITEMS の順）。押せる欄は全部ここにある */
export const ITEM_INPUTS: Partial<Record<LedgerItemKey, readonly FormInput[]>> = {
  // ---- 本人 ----
  "person.name": [page("basic")],
  "person.kana": [page("basic")],
  "person.birth": [page("basic")],
  "basic.sex": f("basic.sex"),
  "basic.address": [page("basic")],
  "basic.town": [page("basic")],
  "self.phone": [page("people")],
  "self.mobile": [page("people")],
  "basic.contactMeans": f("basic.contactMeans.landline", "basic.contactMeans.mobile", "basic.contactMeans.email", "basic.contactMeans.smartphone"),
  "basic.household": f("basic.household", "basic.householdNote"),
  "people.together": [page("people")],
  // ---- 介護・障害 ----
  "care.careLevel": f("care.careLevel"),
  "care.handbook": f("care.handbook"),
  "care.intractableDisease": f("care.intractableDisease"),
  "care.walking": f("care.walking"),
  "care.hearing": f("care.hearing"),
  "care.vision": f("care.vision"),
  "care.understanding": f("care.understanding"),
  "care.judgment": f("care.judgment"),
  "care.orientation": f("care.orientation"),
  "care.bedridden": f("care.bedridden"),
  "care.dementia": f("care.dementia"),
  "care.issues": CARE_ISSUES,
  // ---- 医療 ----
  "medical.devices": [page("medical", "medical.devices", "clocks")],
  "medical.medications": [page("medical", "medical.medications", "clocks")],
  "medical.doctor": [page("people")],
  "medical.dialysis": [page("people")],
  "medical.allergies": f("medical.allergies"),
  "medical.history": f("medical.history"),
  "medical.vaccinations": f("medical.vaccinations"),
  "medical.notes": [...f("medical.allergies", "medical.history", "medical.vaccinations"), page("medical", "medical.devices", "clocks")],
  // ---- 避難 ----
  "evacuation.hazards": [page("evacuation", "evacuation.hazards")],
  "evacuation.destination1": f("evacuation.destination1"),
  "evacuation.destination2": f("evacuation.destination2"),
  "evacuation.transport": f("evacuation.transportKind", "evacuation.transport"),
  "evacuation.route": f("evacuation.route"),
  "evacuation.barriers": f("evacuation.barriers"),
  "evacuation.support": f("evacuation.support", "evacuation.supportNote"),
  "evacuation.carryItems": f("evacuation.carryItems"),
  "evacuation.pets": f("evacuation.pets"),
  "evacuation.myTimeline": f("evacuation.myTimeline"),
  "evacuation.destination1Minutes": f("evacuation.destination1Minutes"),
  "evacuation.destination2Minutes": f("evacuation.destination2Minutes"),
  "evacuation.nearest": f("evacuation.nearest"),
  "evacuation.destination2Means": f("evacuation.destination2Means"),
  "evacuation.nearestMeans": f("evacuation.nearestMeans"),
  "evacuation.nearestMinutes": f("evacuation.nearestMinutes"),
  // ---- 住まい ----
  "basic.housing.structure": f("basic.housing.structure", "basic.housing.builtYear"),
  "basic.housing.floors": f("basic.housing.floors"),
  "basic.housing.floor": f("basic.housing.floor"),
  "basic.housing.bedroom": f("basic.housing.bedroom"),
  "basic.housing.type": f("basic.housing.type"),
  // ---- 連絡先・支援者 ----
  ...contact("emergency1"),
  ...contact("emergency2"),
  ...contact("supporter1"),
  ...contact("supporter2"),
  "people.night": [page("people", "people.night_supporter")],
  "people.welfare": [page("people")],
  "local.watcher": f("local.watcher"),
  "people.offices": [page("people")],
  "org.name": f("local.orgName"),
  "org.phone": f("local.orgPhone"),
  // ---- 同意 ----
  "consent.registry": [page("consent")],
  "consent.plan_share": [page("consent")],
  "consent.supporters": [page("consent")],
  "consent.medical": [page("consent")],
  // ---- 計画・特記 ----
  "notes.words": [page("basic")],
  "notes.other": f("evacuation.carryItems", "evacuation.pets"),
};
