// 医療依存の印（優先の骨格の段）を、台帳の機器・薬の区分から機械的に付ける。Claude には決めさせない（CLAUDE.md「守ること」）。
// 印と骨格の段は時計の区分から出る（lib/triage の tierOf・lib/labels の DEPENDENCE_MARKS）ので、
// 機器・薬を入れて時計が無ければ、値の空いた時計（未確認）を 1 つ作る。時計の長さは人が問いに答えて入れる。
// 中断注意の印（薬の interruptionRisk）も区分から付ける（lib/db/ledger.ts の INTERRUPTION_RISK_CATEGORIES）。
// ブラウザでも読む（保存前の見せ方）。

import { sameMedication } from "../db/ledger.ts";
import type { ClockRow, DeviceKind, Ledger, MedicationCategory } from "../db/types.ts";
import { DEPENDENCE_MARKS } from "../labels.ts";
import { categoryTier, type Tier } from "../triage/index.ts";

export type MarkClock = Pick<ClockRow, "kind" | "category" | "label" | "starts_on">;

/** 機器ごとの時計。電源で動く物は停電で走る（種の時計と同じ名前） */
export const DEVICE_CLOCKS: Readonly<Record<DeviceKind, MarkClock>> = {
  oxygen: { kind: "device", category: "oxygen", label: "酸素 内蔵電池", starts_on: "outage" },
  ventilator: { kind: "device", category: "ventilator", label: "人工呼吸器 内蔵電池", starts_on: "outage" },
  suction: { kind: "device", category: "suction", label: "吸引 内蔵電池", starts_on: "outage" },
  tube_feeding: { kind: "supply", category: "tube_feeding", label: "栄養剤", starts_on: "disaster" },
  dialysis: { kind: "supply", category: "dialysis", label: "透析 次の回まで", starts_on: "disaster" },
};

/** 薬の区分ごとの時計（骨格に入る区分だけ）。名前は薬の名前。インスリンは冷蔵が切れると走る（種と同じ） */
export const MEDICATION_CLOCKS: Readonly<Partial<Record<MedicationCategory, Omit<MarkClock, "label">>>> = {
  insulin: { kind: "supply", category: "insulin", starts_on: "outage" },
  anticoagulant: { kind: "medication", category: "anticoagulant", starts_on: "disaster" },
  steroid: { kind: "medication", category: "steroid", starts_on: "disaster" },
  antiepileptic: { kind: "medication", category: "antiepileptic", starts_on: "disaster" },
};

/** 認知症（台帳の care.dementia）。走らない状態の時計 */
export const DEMENTIA_CLOCK: MarkClock = { kind: "condition", category: "dementia", label: "認知症", starts_on: "none" };

type ExistingClock = Pick<ClockRow, "category" | "label">;

/** 台帳の機器・薬・認知症のうち、時計がまだ無い物の時計（作る物）。並びは機器 → 薬 → 認知症 */
export function planMarkClocks(ledger: Ledger, clocks: ReadonlyArray<ExistingClock>): MarkClock[] {
  const out: MarkClock[] = [];
  const has = (pred: (k: ExistingClock) => boolean) => clocks.some(pred) || out.some(pred);
  for (const d of ledger.medical.devices) {
    const spec = DEVICE_CLOCKS[d.kind];
    if (!has((k) => k.category === spec.category)) out.push(spec);
  }
  for (const m of ledger.medical.medications) {
    const spec = MEDICATION_CLOCKS[m.category];
    if (!spec) continue;
    if (!has((k) => k.category === spec.category && sameMedication(k.label, m.name))) out.push({ ...spec, label: m.name });
  }
  if (ledger.care.dementia === true && !has((k) => k.category === "dementia")) out.push(DEMENTIA_CLOCK);
  return out;
}

export type MarkPreview = { label: string; tier: Tier | null };

/** 作る時計から付く印（担当一覧・本人のページの医療の印と同じ言葉）と骨格の段 */
export function markPreview(planned: ReadonlyArray<MarkClock>): MarkPreview[] {
  const seen = new Set<string>();
  const out: MarkPreview[] = [];
  for (const [category, label] of DEPENDENCE_MARKS) {
    if (seen.has(category) || !planned.some((k) => k.category === category)) continue;
    seen.add(category);
    out.push({ label, tier: categoryTier(category) });
  }
  return out;
}
