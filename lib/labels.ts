// 画面の言葉。2〜4 字の漢語を基本にする（CLAUDE.md「画面の決まり」）。

import type { CareLevel, CheckStatus, ClockCategory, DependsOn, HazardKind, PlanStatus } from "./db/types.ts";
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

/** 医療依存の短い印。並びは緊急度の骨格の順 */
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
  red: "危険",
  yellow: "要確認",
  gray: "未知",
  green: "無事",
};

/** 緊急度の骨格の名前（docs/SPEC.md「医療の芯」） */
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
