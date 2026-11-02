// 画面の言葉。2〜4 字の漢語を基本にする（CLAUDE.md「画面の決まり」）。

import type {
  Ability,
  AuthorRole,
  CareLevel,
  CheckStatus,
  ClockCategory,
  ClockKind,
  ClockSource,
  ClockStart,
  ClockUnit,
  ConsentKind,
  ConsentStatus,
  ContactKind,
  ContactReach,
  DependsOn,
  DeviceKind,
  HazardKind,
  Household,
  Ledger,
  MedicationCategory,
  PendingStatus,
  PlanStatus,
  Sex,
  SmartphoneUse,
  TimelineKind,
} from "./db/types.ts";
import type { Color, Tier } from "./triage/index.ts";

export const CARE_LEVEL_LABELS: Record<CareLevel, string> = {
  support1: "要支援1",
  support2: "要支援2",
  care1: "要介護1",
  care2: "要介護2",
  care3: "要介護3",
  care4: "要介護4",
  care5: "要介護5",
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  none: "未作成",
  draft: "下書き",
  consented: "同意済",
  trained: "訓練済",
};

/** 医療依存の短い印。並びは優先の骨格の順 */
export const DEPENDENCE_MARKS: ReadonlyArray<[ClockCategory, string]> = [
  ["ventilator", "呼吸器"],
  ["suction", "吸引"],
  ["oxygen", "酸素"],
  ["dialysis", "透析"],
  ["insulin", "インスリン"],
  ["tube_feeding", "経管栄養"],
  ["anticoagulant", "抗凝固"],
  ["steroid", "ステロイド"],
  ["antiepileptic", "抗てんかん"],
  ["dementia", "認知症"],
];

/** 外の物に頼る時計の頼り先。理由の 1 行は「透析先 未確認」の形 */
export const DEPENDS_ON_LABELS: Record<DependsOn, string> = {
  dialysis_center: "透析先",
  refrigeration: "冷蔵",
  delivery: "配達",
};

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  confirmed: "確認済",
  unconfirmed: "未確認",
};

export const HAZARD_LABELS: Record<HazardKind, string> = {
  flood: "浸水",
  landslide: "土砂",
  tsunami: "津波",
};

/** 安否の 4 色 */
export const COLOR_LABELS: Record<Color, string> = {
  red: "至急",
  yellow: "要確認",
  gray: "未知",
  green: "無事",
};

/** 優先の骨格の名前（docs/SPEC.md「医療の芯」） */
export const TIER_LABELS: Record<Tier, string> = {
  1: "人工呼吸器・吸引",
  2: "在宅酸素",
  3: "透析",
  4: "インスリン・経管栄養",
  5: "抗凝固薬・ステロイド・抗てんかん薬",
  6: "認知症で独居",
  7: "寝たきりで支援者なし",
  8: "それ以外",
};

// ---------- 本人のページ（T02） ----------

/** 本人のページの区分。並びは lib/person.ts の sectionOrder */
export const SECTION_LABELS = {
  medical: "医療",
  evacuation: "避難",
  people: "人",
  basic: "基本",
  consent: "同意",
  documents: "書類",
  timeline: "経過",
} as const;

export const SEX_LABELS: Record<Sex, string> = { female: "女", male: "男", other: "その他" };

export const HOUSEHOLD_LABELS: Record<Household, string> = {
  alone: "独居",
  with_spouse: "夫婦",
  with_child: "子と同居",
  with_family: "家族と同居",
};

/** スマホ: 使える・見るだけ・持たない */
export const SMARTPHONE_LABELS: Record<SmartphoneUse, string> = { uses: "使用可", views: "閲覧のみ", none: "なし" };

/** 内閣府様式の裏の 6 項目 */
export const ABILITY_ITEM_LABELS: Record<
  "walking" | "hearing" | "vision" | "understanding" | "judgment" | "orientation",
  string
> = {
  walking: "歩行",
  hearing: "聴覚",
  vision: "視覚",
  understanding: "理解",
  judgment: "判断",
  orientation: "見当識",
};

export const ABILITY_LABELS: Record<Ability, string> = { ok: "問題なし", some: "一部", hard: "困難" };

type Structure = NonNullable<NonNullable<Ledger["basic"]["housing"]>["structure"]>;
export const STRUCTURE_LABELS: Record<Structure, string> = {
  wood: "木造",
  steel: "鉄骨",
  concrete: "鉄筋",
  other: "その他",
};

export const DEVICE_LABELS: Record<DeviceKind, string> = {
  oxygen: "在宅酸素",
  ventilator: "人工呼吸器",
  suction: "吸引",
  tube_feeding: "経管栄養",
  dialysis: "透析",
};

/** 災害診療記録 2018 の【特記事項（常用薬等）】の区分 */
export const MEDICATION_CATEGORY_LABELS: Record<MedicationCategory, string> = {
  antiplatelet: "抗血小板薬",
  anticoagulant: "抗凝固薬",
  insulin: "インスリン",
  oral_diabetes: "経口糖尿病薬",
  steroid: "ステロイド",
  antiepileptic: "抗てんかん薬",
  other: "その他",
};

/** 薬の印。中断すると危ない薬と、冷蔵が要る薬 */
export const MEDICATION_FLAG_LABELS = { interruptionRisk: "中断注意", needsRefrigeration: "要冷蔵" } as const;

/** 時計の 4 つ: A 機器・B 物・C 薬・D 本人の状態 */
export const CLOCK_KIND_LABELS: Record<ClockKind, string> = {
  device: "機器",
  supply: "物",
  medication: "薬",
  condition: "状態",
};

export const CLOCK_UNIT_LABELS: Record<ClockUnit, string> = { minute: "分", hour: "時間", day: "日", week: "週" };

/** 時計が走り出すきっかけ */
export const CLOCK_START_LABELS: Record<ClockStart, string> = { outage: "停電", disaster: "発災", none: "なし" };

/** 時計の値の出典 */
export const CLOCK_SOURCE_LABELS: Record<ClockSource, string> = {
  doctor: "主治医",
  device_manual: "説明書",
  pharmacy: "薬局",
  facility: "施設",
  family: "家族",
  self: "本人",
  care_manager: "ケアマネ",
};

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  self: "本人",
  family: "家族",
  supporter: "支援者",
  welfare_commissioner: "民生委員",
  visiting_nurse: "訪問看護",
  care_service: "介護事業所",
  home_doctor: "かかりつけ",
  pharmacy: "薬局",
  dialysis_center: "透析施設",
  city_office: "市役所",
};

export const CONTACT_REACH_LABELS: Record<ContactReach, string> = {
  together: "同居",
  nearby: "近所",
  in_city: "市内",
  out_of_pref: "県外",
  far: "遠方",
};

/** 連絡先の持ち物・夜間 */
export const CONTACT_FLAG_LABELS = { hasCar: "車", nightOk: "夜間可", hasSmartphone: "スマホ" } as const;

/** 同意 4 つ */
export const CONSENT_KIND_LABELS: Record<ConsentKind, string> = {
  registry: "名簿登録",
  plan_share: "計画共有",
  supporters: "支援者提供",
  medical: "医療班提供",
};

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  granted: "同意",
  refused: "不同意",
  unconfirmed: "未確認",
};

/** 空欄の理由（分からない・まだ聞いていない・答えない）。どれも画面には「未確認」と出し、横に添える */
export const PENDING_STATUS_LABELS: Record<PendingStatus, string> = {
  unknown: "不明",
  not_asked: "未聴取",
  declined: "無回答",
};

/** 空欄の言い方 */
export const BLANK_LABELS = { unconfirmed: "未確認", none: "なし" } as const;

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  signal: "信号",
  called: "電話",
  pickup: "迎え決定",
  safety_check: "安否確認",
  examined: "診察",
  medication_given: "配薬",
  transported: "搬送",
  arrived_shelter: "到着",
  received: "受領",
  released: "受持解除",
  override: "優先修正",
  consent: "同意",
  clock_check: "時計確認",
  self_report_mark: "印変更",
  note: "記録",
};

/** 種の表から作る経過の種類（台帳を作った・同意を記録した） */
export const DERIVED_TIMELINE_LABELS = { created: "入力", consent: "同意" } as const;

export const AUTHOR_ROLE_LABELS: Record<AuthorRole, string> = {
  self: "本人",
  family: "家族",
  supporter: "支援者",
  care_manager: "ケアマネ",
  medical: "医療班",
  government: "行政",
  system: "自動",
};

/** 書類（T05〜T07 で作る）の入口 */
export const DOCUMENT_LABELS = { matsuyama: "計画書", medical: "医療要約", own: "本人の1枚" } as const;
export const DOCUMENT_STATUS_LABELS = { pending: "準備中", ready: "表示" } as const;
