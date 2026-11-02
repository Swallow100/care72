// 入れる欄の手入力（components/person/IntakeManual.tsx）の値から、保存の変更を作る。変えた欄だけ。ブラウザで使う。

import type { DEVICE_KINDS, HAZARD_KINDS, Ledger, MedicationCategory } from "../db/types.ts";
import { MED_PARTS } from "../labels.ts";
import type { IntakeChange } from "./changes.ts";
import { INTAKE_FIELDS, isFilled, ledgerValue, normalizeValue } from "./fields.ts";

export type NewMed = { name: string; category: MedicationCategory; schedule: string; amount: string; storage: string };

export const MED_FILL = [
  ["schedule", "回数"],
  ["amount", MED_PARTS.amount],
  ["storage", MED_PARTS.storage],
] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 手入力の値から変更を作る（変えた欄だけ） */
export function manualChanges(
  ledger: Ledger,
  values: Record<string, unknown>,
  medFill: Record<string, string>,
  newMeds: readonly NewMed[],
  devices: readonly string[],
  hazards: readonly string[],
  note: string,
): IntakeChange[] {
  const out: IntakeChange[] = [];
  for (const f of INTAKE_FIELDS) {
    const raw = values[f.key];
    const cur = ledgerValue(ledger, f.key);
    if (same(raw, cur)) continue;
    const value = normalizeValue(f, raw);
    if (value === null || same(value, cur)) continue;
    out.push({ t: "field", key: f.key, value, ...(isFilled(cur) ? { overwrite: true } : {}) });
  }
  ledger.medical.medications.forEach((m, index) => {
    const fill: Partial<Record<(typeof MED_FILL)[number][0], string>> = {};
    for (const [part] of MED_FILL) {
      const v = medFill[`${index}.${part}`]?.trim();
      if (v && !isFilled(m[part])) fill[part] = v;
    }
    if (Object.keys(fill).length > 0) out.push({ t: "medication", index, value: { name: m.name, category: m.category, ...fill } });
  });
  for (const m of newMeds) {
    if (!m.name.trim()) continue;
    out.push({
      t: "medication",
      value: {
        name: m.name.trim(),
        category: m.category,
        ...(m.schedule.trim() ? { schedule: m.schedule.trim() } : {}),
        ...(m.amount.trim() ? { amount: m.amount.trim() } : {}),
        ...(m.storage.trim() ? { storage: m.storage.trim() } : {}),
      },
    });
  }
  for (const kind of devices) out.push({ t: "device", value: { kind: kind as (typeof DEVICE_KINDS)[number] } });
  for (const kind of hazards) out.push({ t: "hazard", value: { kind: kind as (typeof HAZARD_KINDS)[number] } });
  if (note.trim()) out.push({ t: "note", value: note.trim() });
  return out;
}

