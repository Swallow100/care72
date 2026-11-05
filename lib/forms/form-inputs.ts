// 様式の欄 → 台帳のどこで埋めるか（T117）。計画書（松山市）の欄ごとに、その欄の値の元になる台帳の場所を 1 つの表に持つ。
// この表を 3 か所が使う（同じ元から数え、同じ所へ書く）:
// - 紙に直接書く窓（components/forms/PaperEdit.tsx）: 欄を押すと、ここに書いた場所の入力が開き、保存で台帳のその場所に入る
// - 紙の帯の未確認の分け方（lib/forms/unconfirmed.ts）: 未確認の欄のうち、問い（lib/intake/ask.ts の questionQueue）で埋められる物
// - 棚卸しの B（docs/progress/t117.md）のテスト: 台帳の置き場・問い・様式の元・書類に直接書く入口の 4 つが揃うか
// 表に無い欄（作成日・区分・避難のタイミング・別紙・署名・受付印・まつやま総合防災マップからの引用・計画作成者）は押せない。
// どれも定型で、Claude は呼ばない。ブラウザでも読む（サーバーの物を import しない）。

import type { EditSection } from "../intake/edit.ts";
import type { ContactPart } from "../intake/contact-parts.ts";
import type { MatsuyamaKey } from "./matsuyama.ts";

/** 計画書の連絡先の欄の人（近親者＝緊急連絡先 1、避難支援等実施者 1・2）。kin2 は緊急連絡先 2（添付の様式の欄、T135） */
export type FormContactRole = "kin" | "kin2" | "supporter1" | "supporter2";

/**
 * 欄の値の元の 1 つ。
 * - field: 入れる欄の表（lib/intake/fields.ts の INTAKE_FIELDS）の欄。窓で直接書ける
 * - contact: 連絡先のフリガナ・住所・携帯・電話。窓で直接書ける（人がいなければ書けない）
 * - page: 入れ子の値（薬・機器・連絡先の人・同意・住所など）。窓から本人のページのその面の「編集」へ。asks は問いの場所の頭（問いで埋められるかを見る）
 */
export type FormInput =
  | { kind: "field"; key: string }
  | { kind: "contact"; role: FormContactRole; part: ContactPart | "phone" }
  | { kind: "page"; section: EditSection; asks?: readonly string[] };

/** 様式のみの値をその場で打てる計画書の欄の形（字の欄。選ぶ欄・同意・手書きは除く。T147） */
export const MATSUYAMA_TEXT_SHAPES: ReadonlySet<string> = new Set(["text", "lines", "phone", "date"]);

const f = (...keys: string[]): FormInput[] => keys.map((key) => ({ kind: "field" as const, key }));
const c = (role: FormContactRole, part: ContactPart | "phone"): FormInput => ({ kind: "contact", role, part });
const page = (section: EditSection, ...asks: string[]): FormInput => (asks.length > 0 ? { kind: "page", section, asks } : { kind: "page", section });

/** 計画書の欄ごとの元（様式の順）。押せる欄は全部ここにある */
export const MATSUYAMA_INPUTS: Partial<Record<MatsuyamaKey, readonly FormInput[]>> = {
  // ---- 1 頁 ----
  "target.kana": [page("basic")],
  "target.name": [page("basic")],
  "target.sex": f("basic.sex"),
  "target.birth": [page("basic")],
  "target.district": [page("basic")],
  "target.address": [page("basic")],
  "target.phone": [...f("basic.contactMeans.landline"), page("people")],
  "target.mobile": [...f("basic.contactMeans.mobile"), page("people")],
  "target.category": f("care.careLevel", "care.handbook", "care.intractableDisease"),
  "local.welfare": [page("people")],
  "local.watcher": f("local.watcher"),
  "local.office": [page("people")],
  "local.other": [page("people")],
  "target.household": f("basic.household", "basic.householdNote"),
  "target.timeline": f("evacuation.myTimeline"),
  "consent.registry": [page("consent")],
  "consent.planShare": [page("consent")],
  "kin.kana": [c("kin", "kana")],
  "kin.name": [page("people", "people.emergency")],
  "kin.relation": [page("people")],
  "kin.phone": [c("kin", "phone")],
  "kin.mobile": [c("kin", "mobile")],
  "kin.address": [c("kin", "address")],
  "supporter1.kana": [c("supporter1", "kana")],
  "supporter1.name": [page("people", "people.supporter1")],
  "supporter1.address": [c("supporter1", "address")],
  "supporter1.phone": [c("supporter1", "phone")],
  "supporter1.mobile": [c("supporter1", "mobile")],
  "supporter1.relation": [page("people")],
  "supporter1.consent": [page("consent")],
  "supporter2.kana": [c("supporter2", "kana")],
  "supporter2.name": [page("people")],
  "supporter2.address": [c("supporter2", "address")],
  "supporter2.phone": [c("supporter2", "phone")],
  "supporter2.mobile": [c("supporter2", "mobile")],
  "supporter2.relation": [page("people")],
  "supporter2.consent": [page("consent")],
  "org.name": f("local.orgName"),
  "org.phone": f("local.orgPhone"),
  "org.consent": [page("consent")],
  // ---- 2 頁 ----
  "medical.doctor": [page("people")],
  "medical.drugs": [page("medical", "medical.medications", "clocks")],
  "risk.home": [page("evacuation", "evacuation.hazards")],
  "risk.issues": f(
    "care.walking",
    "care.hearing",
    "care.vision",
    "care.understanding",
    "care.judgment",
    "care.orientation",
    "care.bedridden",
    "care.dementia",
    "evacuation.barriers",
  ),
  "shelter.pre.place": f("evacuation.destination2"),
  "shelter.pre.means": f("evacuation.destination2Means"),
  "shelter.pre.minutes": f("evacuation.destination2Minutes"),
  "shelter.near.place": f("evacuation.nearest"),
  "shelter.near.means": f("evacuation.nearestMeans"),
  "shelter.near.minutes": f("evacuation.nearestMinutes"),
  "shelter.city.place": f("evacuation.destination1"),
  "shelter.city.means": f("evacuation.transportKind", "evacuation.transport"),
  "shelter.city.minutes": f("evacuation.destination1Minutes"),
  "housing.type": f("basic.housing.type"),
  "housing.structure": f("basic.housing.structure", "basic.housing.builtYear"),
  "housing.floors": f("basic.housing.floors"),
  "housing.room": f("basic.housing.floor"),
  "housing.bedroom": f("basic.housing.bedroom"),
  "support.kinds": f("evacuation.support", "evacuation.supportNote"),
  "notes.medical": [...f("medical.allergies", "medical.history", "medical.vaccinations"), page("medical", "medical.devices", "clocks")],
  "notes.words": [page("basic")],
  "notes.other": f("evacuation.carryItems", "evacuation.pets"),
  "supporter.night": [page("people", "people.night_supporter")],
  "route.text": [...f("evacuation.route"), page("evacuation")],
};

/** 欄の連絡先の人（近親者は緊急連絡先 1、実施者は支援の順 1・2）。いなければ null */
export function formContactOf<C extends { id: string; kind: string; emergency_order: number | null; supporter_order: number | null }>(
  contacts: ReadonlyArray<C>,
  role: FormContactRole,
): C | null {
  const hit =
    role === "kin" || role === "kin2"
      ? contacts.find((x) => x.emergency_order === (role === "kin" ? 1 : 2))
      : contacts.find((x) => x.supporter_order === (role === "supporter1" ? 1 : 2));
  return hit && hit.kind !== "self" ? hit : null;
}

/** 問いの場所（lib/intake/ask.ts の Question の key）と、問いの答えが入る欄の鍵（手段の選ぶ欄は前からの手段の場所に pending を残す） */
const QUESTION_KEY_OF: Record<string, string> = { "evacuation.transportKind": "evacuation.transport" };

const under = (prefix: string) => (key: string) => key === prefix || key.startsWith(`${prefix}.`);

/**
 * 欄の元が、問いの場所のどれかに当たるか。field は欄の鍵（手段は前からの場所）、contact は contacts.<id>.<所>（電話は携帯の問いで聞く）、
 * page は asks の頭
 */
export function inputAsks(input: FormInput, questionKey: string, contacts: ReadonlyArray<Parameters<typeof formContactOf>[0][number]>): boolean {
  switch (input.kind) {
    case "field":
      return questionKey === (QUESTION_KEY_OF[input.key] ?? input.key);
    case "contact": {
      const who = formContactOf(contacts, input.role);
      if (!who) return false;
      const part = input.part === "phone" ? "mobile" : input.part;
      return questionKey === `contacts.${who.id}.${part}`;
    }
    case "page":
      return (input.asks ?? []).some((a) => under(a)(questionKey));
  }
}

/**
 * 問いで埋められる計画書の欄（T117）。問いの列（lib/intake/ask.ts の questionQueue。本人のページの「問い 残り N 問」と同じ物）の
 * どれかが、その欄の元に当たる欄。紙の帯は未確認の欄をこれで「問い」と「未入力」に分ける（同じ元から数える）
 */
export function matsuyamaAskable(
  questionKeys: readonly string[],
  contacts: ReadonlyArray<Parameters<typeof formContactOf>[0][number]>,
): Set<MatsuyamaKey> {
  return askableOf(MATSUYAMA_INPUTS, questionKeys, contacts);
}

/** 欄の元の表（欄の鍵 → 元）のうち、問いの列のどれかが元に当たる欄の鍵（計画書と添付の様式で同じ数え方。T135） */
export function askableOf<K extends string>(
  table: Partial<Record<K, readonly FormInput[]>>,
  questionKeys: readonly string[],
  contacts: ReadonlyArray<Parameters<typeof formContactOf>[0][number]>,
): Set<K> {
  const out = new Set<K>();
  for (const [key, inputs] of Object.entries(table) as Array<[K, readonly FormInput[]]>) {
    if (inputs.some((input) => questionKeys.some((q) => inputAsks(input, q, contacts)))) out.add(key);
  }
  return out;
}

/** 欄の元に、窓で直接書ける物（field・contact）があるか */
export const writable = (inputs: readonly FormInput[] | undefined): boolean => (inputs ?? []).some((i) => i.kind !== "page");

