// 入れる欄（T03）で扱う台帳の欄の表。鍵は台帳（lib/db/types.ts の Ledger）の中の場所で、pending の field と同じ書き方。
// Claude の分け方の検査（lib/intake/extract.ts）・差分（diff.ts）・手入力の編集（components/person/Intake.tsx）・
// 問いの答え（ask.ts）・保存（save.ts）が、この表だけを見る。ブラウザでも読む（サーバーの物を import しない）。
//
// 薬・機器・ハザードは形が入れ子なので、ここに無く diff.ts で扱う。連絡先と時計は台帳の外（表の行）。

import {
  ABILITIES,
  CARE_LEVELS,
  HOUSEHOLDS,
  MY_TIMELINES,
  SEXES,
  SMARTPHONE_USE,
  SUPPORT_KINDS,
  type Ledger,
} from "../db/types.ts";
import {
  ABILITY_ITEM_LABELS,
  ABILITY_LABELS,
  CARE_FLAG_LABELS,
  CARE_LEVEL_LABELS,
  HOUSEHOLD_LABELS,
  MY_TIMELINE_LABELS,
  SEX_LABELS,
  SMARTPHONE_LABELS,
  STRUCTURE_LABELS,
  SUPPORT_KIND_LABELS,
} from "../labels.ts";

/** 本人のページの区分（lib/person.ts の SectionId のうち、入れる欄が書く物） */
export type IntakeSection = "medical" | "evacuation" | "people" | "basic";

export const INTAKE_SECTIONS: readonly IntakeSection[] = ["medical", "evacuation", "people", "basic"];

type Options = ReadonlyArray<{ value: string; label: string }>;

/** 値の形。enum は選択肢の値、list は文字の配列（1 つずつ）、enumList は選択肢の値の配列 */
export type FieldShape =
  | { type: "enum"; options: Options }
  | { type: "enumList"; options: Options }
  | { type: "bool" }
  | { type: "int"; unit?: string }
  | { type: "text" }
  | { type: "list" };

export type IntakeField = {
  key: string;
  section: IntakeSection;
  /** 画面の欄の名前（2〜6 字） */
  label: string;
  shape: FieldShape;
  /** Claude に渡す説明（system の項目の一覧に出る） */
  hint?: string;
};

const opts = <T extends string>(values: readonly T[], labels: Record<T, string>): Options =>
  values.map((value) => ({ value, label: labels[value] }));

const STRUCTURES = ["wood", "steel", "concrete", "other"] as const;
const BOOL_TEXT = { yes: "あり", no: "なし" } as const;

const ability = (k: keyof typeof ABILITY_ITEM_LABELS): IntakeField => ({
  key: `care.${k}`,
  section: "basic",
  label: ABILITY_ITEM_LABELS[k],
  shape: { type: "enum", options: opts(ABILITIES, ABILITY_LABELS) },
});

/** 並びは本人のページの区分の中の並び（手入力の編集もこの順） */
export const INTAKE_FIELDS: readonly IntakeField[] = [
  // 医療（薬・機器は diff.ts）
  { key: "medical.allergies", section: "medical", label: "アレルギー", shape: { type: "list" }, hint: "アレルギー・禁忌食物。1 つずつ" },
  { key: "medical.history", section: "medical", label: "既往", shape: { type: "list" }, hint: "既往症・今の病名。1 つずつ" },
  { key: "medical.vaccinations", section: "medical", label: "予防接種", shape: { type: "list" }, hint: "1 つずつ" },
  // 避難（ハザードは diff.ts）
  { key: "evacuation.destination1", section: "evacuation", label: "避難先1", shape: { type: "text" }, hint: "市の指定避難所など" },
  { key: "evacuation.destination2", section: "evacuation", label: "避難先2", shape: { type: "text" }, hint: "事前に行く所（親族の家など）" },
  {
    key: "evacuation.stayHome",
    section: "evacuation",
    label: "在宅避難",
    shape: { type: "bool" },
    hint: "住まいが安全で、計画で家に留まると決めたと入力にはっきり書かれているときだけ true。決めていなければ入れない",
  },
  { key: "evacuation.transport", section: "evacuation", label: "手段", shape: { type: "text" }, hint: "徒歩・車いす・家族の車など" },
  {
    key: "evacuation.support",
    section: "evacuation",
    label: "支援内容",
    shape: { type: "enumList", options: opts(SUPPORT_KINDS, SUPPORT_KIND_LABELS) },
    hint: "支援者がすること。call 声掛け・guide 誘導・assist 移動介助・other その他",
  },
  { key: "evacuation.supportNote", section: "evacuation", label: "支援補記", shape: { type: "text" }, hint: "支援の内容の書き足し" },
  { key: "evacuation.route", section: "evacuation", label: "経路", shape: { type: "text" } },
  { key: "evacuation.barriers", section: "evacuation", label: "段差", shape: { type: "text" }, hint: "段差・階段・エレベーター" },
  { key: "basic.housing.floor", section: "evacuation", label: "居室階", shape: { type: "int", unit: "階" }, hint: "住んでいる階" },
  { key: "basic.housing.floors", section: "evacuation", label: "階数", shape: { type: "int", unit: "階建" }, hint: "建物の階数。平屋は 1" },
  {
    key: "basic.housing.structure",
    section: "evacuation",
    label: "構造",
    shape: { type: "enum", options: opts(STRUCTURES, STRUCTURE_LABELS) },
  },
  { key: "basic.housing.builtYear", section: "evacuation", label: "築年", shape: { type: "int", unit: "年" }, hint: "西暦" },
  { key: "basic.housing.bedroom", section: "evacuation", label: "寝室", shape: { type: "text" }, hint: "寝室の場所（1 階 奥の和室 など）" },
  { key: "evacuation.carryItems", section: "evacuation", label: "持出品", shape: { type: "list" }, hint: "1 つずつ" },
  { key: "evacuation.pets", section: "evacuation", label: "ペット", shape: { type: "text" } },
  {
    key: "evacuation.myTimeline",
    section: "evacuation",
    label: "タイムライン",
    shape: { type: "enum", options: opts(MY_TIMELINES, MY_TIMELINE_LABELS) },
    hint: "マイ・タイムラインの作成。app アプリ・paper 紙・none なし",
  },
  // 人（連絡先は表の行。ここは台帳に持つ物だけ）
  { key: "local.watcher", section: "people", label: "みまもり員", shape: { type: "text" }, hint: "いれば「あり」と書き足しだけ（名前は伏せ字のまま）" },
  // 基本
  { key: "basic.sex", section: "basic", label: "性別", shape: { type: "enum", options: opts(SEXES, SEX_LABELS) } },
  { key: "basic.household", section: "basic", label: "世帯", shape: { type: "enum", options: opts(HOUSEHOLDS, HOUSEHOLD_LABELS) } },
  { key: "basic.contactMeans.landline", section: "basic", label: "固定電話", shape: { type: "bool" } },
  { key: "basic.contactMeans.mobile", section: "basic", label: "携帯", shape: { type: "bool" } },
  { key: "basic.contactMeans.email", section: "basic", label: "メール", shape: { type: "bool" } },
  {
    key: "basic.contactMeans.smartphone",
    section: "basic",
    label: "スマホ",
    shape: { type: "enum", options: opts(SMARTPHONE_USE, SMARTPHONE_LABELS) },
  },
  { key: "care.careLevel", section: "basic", label: "介護度", shape: { type: "enum", options: opts(CARE_LEVELS, CARE_LEVEL_LABELS) } },
  ability("walking"),
  ability("hearing"),
  ability("vision"),
  ability("understanding"),
  ability("judgment"),
  ability("orientation"),
  { key: "care.bedridden", section: "basic", label: CARE_FLAG_LABELS.bedridden, shape: { type: "bool" } },
  { key: "care.dementia", section: "basic", label: CARE_FLAG_LABELS.dementia, shape: { type: "bool" }, hint: "入力に認知症とはっきり書かれているときだけ" },
  { key: "care.handbook", section: "basic", label: "手帳", shape: { type: "text" }, hint: "障害者手帳の種類と等級" },
  { key: "care.intractableDisease", section: "basic", label: "難病", shape: { type: "text" } },
];

export const INTAKE_KEYS = INTAKE_FIELDS.map((f) => f.key) as [string, ...string[]];

/** 欄の表に無いが「分からない」を残せる場所（薬・機器・ハザードの有無、連絡先から出る欄） */
export const EXTRA_PENDING_KEYS = [
  "medical.medications",
  "medical.devices",
  "evacuation.hazards",
  "people.night_supporter",
  "people.supporter1",
  "people.emergency",
] as const;

export const EXTRA_PENDING_LABELS: Record<(typeof EXTRA_PENDING_KEYS)[number], string> = {
  "medical.medications": "薬",
  "medical.devices": "機器",
  "evacuation.hazards": "ハザード",
  "people.night_supporter": "夜間支援",
  "people.supporter1": "支援者1",
  "people.emergency": "緊急連絡先",
};

const BY_KEY = new Map(INTAKE_FIELDS.map((f) => [f.key, f]));

export function intakeField(key: string): IntakeField | undefined {
  return BY_KEY.get(key);
}

// ---------- 値の読み書き（台帳の中の場所） ----------

/** 台帳の中の場所の値。無ければ undefined */
export function ledgerValue(ledger: Ledger, key: string): unknown {
  let v: unknown = ledger;
  for (const part of key.split(".")) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

/** 台帳の中の場所に値を置いた写し（元は変えない）。途中の群が無ければ作る */
export function withLedgerValue(ledger: Ledger, key: string, value: unknown): Ledger {
  const copy = structuredClone(ledger) as unknown as Record<string, unknown>;
  const parts = key.split(".");
  let cur = copy;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (next === null || typeof next !== "object") cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return copy as unknown as Ledger;
}

/** 埋まっているか。文字は空白だけなら空、配列は空でも埋まっている（「なし」と答えた） */
export function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

// ---------- 値の形をそろえる ----------

/** 1 つの値（Claude・手入力の文字）を欄の形にする。合わなければ null */
export function normalizeValue(field: IntakeField, raw: unknown): unknown {
  const s = typeof raw === "string" ? raw.trim() : raw;
  switch (field.shape.type) {
    case "enum": {
      if (typeof s !== "string") return null;
      const hit = field.shape.options.find((o) => o.value === s || o.label === s);
      return hit ? hit.value : null;
    }
    case "enumList": {
      const items = Array.isArray(s) ? s : typeof s === "string" ? splitList(s) : [];
      const out: string[] = [];
      for (const item of items) {
        const hit = field.shape.options.find((o) => o.value === String(item).trim() || o.label === String(item).trim());
        if (!hit) return null;
        if (!out.includes(hit.value)) out.push(hit.value);
      }
      return out.length > 0 ? out : null;
    }
    case "bool": {
      if (typeof s === "boolean") return s;
      if (s === "true" || s === BOOL_TEXT.yes || s === "はい") return true;
      if (s === "false" || s === BOOL_TEXT.no || s === "いいえ") return false;
      return null;
    }
    case "int": {
      const n = typeof s === "number" ? s : typeof s === "string" ? Number(s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))) : NaN;
      return Number.isInteger(n) && n >= 0 && n < 10000 ? n : null;
    }
    case "text":
      return typeof s === "string" && s !== "" ? s.slice(0, 200) : null;
    case "list": {
      const items = Array.isArray(s) ? s.map((x) => String(x).trim()) : typeof s === "string" ? splitList(s) : [];
      const out = [...new Set(items.filter((x) => x !== "").map((x) => x.slice(0, 100)))];
      return out.length > 0 ? out : null;
    }
  }
}

/** 「、」「,」「・」改行で分ける（手入力の配列の欄） */
export function splitList(s: string): string[] {
  return s
    .split(/[、,，・\n]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

/** 値の画面の言葉 */
export function displayValue(field: IntakeField, value: unknown): string {
  if (value === undefined || value === null) return "";
  const label = (v: string) =>
    field.shape.type === "enum" || field.shape.type === "enumList" ? (field.shape.options.find((o) => o.value === v)?.label ?? v) : v;
  switch (field.shape.type) {
    case "enum":
      return label(String(value));
    case "enumList":
    case "list":
      // 打っている途中（「、」区切りの文字）はそのまま
      if (typeof value === "string") return value;
      return Array.isArray(value) ? (value.length > 0 ? value.map((v) => label(String(v))).join("・") : BOOL_TEXT.no) : "";
    case "bool":
      return value === true ? BOOL_TEXT.yes : BOOL_TEXT.no;
    case "int":
      return `${String(value)}${field.shape.unit ? ` ${field.shape.unit}` : ""}`;
    case "text":
      return String(value);
  }
}
