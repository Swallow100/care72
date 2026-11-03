"use client";

// 入れる欄の「手入力」: 区分ごとに台帳の欄を直接埋める。AI 未設定・上限到達のときの道で、AI があっても使える。
// 保存は Claude の分け方と同じ道（/api/intake/save）。変えた欄だけを送り、今の値を変えた欄は人が選んだ上書きとして送る。
// 連絡先は夜間の支援者の問い（質問）で、名前と電話の追加は Claude の分け方の「変更点」で入れる。

import { useState } from "react";
import { DEVICE_KINDS, HAZARD_KINDS, MEDICATION_CATEGORIES, type Ledger, type MedicationCategory } from "@/lib/db/types";
import { DEVICE_LABELS, HAZARD_LABELS, INTAKE_LABELS, MED_PARTS, MEDICATION_CATEGORY_LABELS, SECTION_LABELS } from "@/lib/labels";
import type { IntakeChange } from "@/lib/intake/changes";
import { INTAKE_FIELDS, INTAKE_SECTIONS, isFilled, ledgerValue } from "@/lib/intake/fields";
import { MED_FILL, manualChanges, type NewMed } from "@/lib/intake/manual";
import { FieldInput } from "./IntakeChanges";
import { BTN_IN, BTN_MAIN, CHECK, FIELD_ROW, INPUT_IN } from "./intake-ui";
import { Select } from "@/components/ui/Select";

const blankMed = (): NewMed => ({ name: "", category: "other", schedule: "", amount: "", storage: "" });

export function IntakeManual({ ledger, busy, onSave }: { ledger: Ledger; busy: boolean; onSave: (changes: IntakeChange[]) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(INTAKE_FIELDS.map((f) => [f.key, ledgerValue(ledger, f.key)])),
  );
  const [medFill, setMedFill] = useState<Record<string, string>>({});
  const [newMeds, setNewMeds] = useState<NewMed[]>([]);
  const [devices, setDevices] = useState<string[]>([]);
  const [hazards, setHazards] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const changes = manualChanges(ledger, values, medFill, newMeds, devices, hazards, note);
  const hasDevice = (k: string) => ledger.medical.devices.some((d) => d.kind === k);
  const hasHazard = (k: string) => ledger.evacuation.hazards.some((h) => h.kind === k);

  return (
    <form
      className="space-y-2"
      data-intake="manual"
      onSubmit={(e) => {
        e.preventDefault();
        if (changes.length > 0) onSave(changes);
      }}
    >
      {/* 内側で送らない（送るのは画面全体の縦 1 本）。欄はページの流れに置く */}
      <div className="space-y-2">
        {INTAKE_SECTIONS.map((section) => (
          <section key={section} className="rounded bg-panel2 px-2 py-1.5" data-section={section}>
            <h4 className="text-sm font-bold">{SECTION_LABELS[section]}</h4>
            <div className="mt-1 space-y-1">
              {section === "medical" && (
                <>
                  {ledger.medical.medications.map((m, i) => {
                    const empty = MED_FILL.filter(([part]) => !isFilled(m[part]));
                    return (
                      <div key={`${m.name}-${i}`} className={FIELD_ROW}>
                        <span className="truncate text-xs">{m.name}</span>
                        <div className="flex gap-1">
                          {empty.length === 0 ? (
                            <span className="text-xs text-muted">{[m.schedule, m.amount, m.storage].filter(Boolean).join(" ")}</span>
                          ) : (
                            empty.map(([part, label]) => (
                              <input
                                key={part}
                                className={INPUT_IN}
                                placeholder={label}
                                aria-label={`${m.name} ${label}`}
                                value={medFill[`${i}.${part}`] ?? ""}
                                onChange={(e) => setMedFill({ ...medFill, [`${i}.${part}`]: e.target.value })}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {newMeds.map((m, i) => {
                    const set = (patch: Partial<NewMed>) => setNewMeds(newMeds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <div key={`new-${i}`} className="grid grid-cols-2 gap-1">
                        <input className={INPUT_IN} placeholder="薬の名前" aria-label="薬の名前" value={m.name} onChange={(e) => set({ name: e.target.value })} />
                        <Select className={INPUT_IN} aria-label="薬の区分" value={m.category} onChange={(e) => set({ category: e.target.value as MedicationCategory })}>
                          {MEDICATION_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {MEDICATION_CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </Select>
                        <input className={INPUT_IN} placeholder="回数" aria-label="回数" value={m.schedule} onChange={(e) => set({ schedule: e.target.value })} />
                        <input className={INPUT_IN} placeholder={MED_PARTS.amount} aria-label={MED_PARTS.amount} value={m.amount} onChange={(e) => set({ amount: e.target.value })} />
                        <input className={`${INPUT_IN} col-span-2`} placeholder={MED_PARTS.storage} aria-label={MED_PARTS.storage} value={m.storage} onChange={(e) => set({ storage: e.target.value })} />
                      </div>
                    );
                  })}
                  <button type="button" className={BTN_IN} data-press onClick={() => setNewMeds([...newMeds, blankMed()])}>
                    {INTAKE_LABELS.addMedication}
                  </button>
                  <div className={FIELD_ROW}>
                    <span className="text-xs text-muted">機器</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {DEVICE_KINDS.map((k) => (
                        <label key={k} className="inline-flex items-center gap-1 text-sm">
                          <input
                            type="checkbox"
                            className={CHECK}
                            checked={hasDevice(k) || devices.includes(k)}
                            disabled={hasDevice(k)}
                            onChange={(e) => setDevices(e.target.checked ? [...devices, k] : devices.filter((x) => x !== k))}
                          />
                          {DEVICE_LABELS[k]}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {section === "evacuation" && (
                <div className={FIELD_ROW}>
                  <span className="text-xs text-muted">ハザード</span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {HAZARD_KINDS.map((k) => (
                      <label key={k} className="inline-flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          className={CHECK}
                          checked={hasHazard(k) || hazards.includes(k)}
                          disabled={hasHazard(k)}
                          onChange={(e) => setHazards(e.target.checked ? [...hazards, k] : hazards.filter((x) => x !== k))}
                        />
                        {HAZARD_LABELS[k]}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {INTAKE_FIELDS.filter((f) => f.section === section).map((f) => (
                <label key={f.key} className={FIELD_ROW} data-field={f.key}>
                  <span className="text-xs text-muted">{f.label}</span>
                  <FieldInput field={f} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
                </label>
              ))}
              {section === "basic" && (
                <label className={FIELD_ROW}>
                  <span className="text-xs text-muted">{INTAKE_LABELS.addNote}</span>
                  <textarea className={INPUT_IN} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              )}
            </div>
          </section>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_MAIN} data-press="overlay" disabled={busy || changes.length === 0}>
          {INTAKE_LABELS.save}
        </button>
        <span className="text-xs text-muted tabular-nums">{changes.length} 件</span>
      </div>
    </form>
  );
}
