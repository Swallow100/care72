// 台帳（people.ledger の JSON）を読む・入れる欄（T03）の変更を当てる。
//
// 変更の当て方（applyLedgerChanges）:
// - 埋まっている欄は変えない。人が「既入力」を選んで上書きしたとき（overwrite）だけ変える
// - 配列の欄（アレルギー・持出品・支援の内容など）は、無い物だけを後ろに足す
// - 薬・機器・ハザードは同じ物（薬は名前、機器・ハザードは種類）があれば空いた所だけを埋め、無ければ足す
// - 特記は本人の言葉のまま後ろに足す（同じ文は重ねない）
// - 値が入った欄の pending（未確認）は消す。分からない・答えない・次回は pending に残す
// 連絡先と時計は台帳の外（表の行）なので lib/intake/save.ts が当てる。

import type { IntakeChange, MedicationValue } from "../intake/changes.ts";
import { intakeField, isFilled, ledgerValue, normalizeValue, withLedgerValue } from "../intake/fields.ts";
import type { Ledger, MedicationCategory } from "./types.ts";

/**
 * 中断注意の印（薬の interruptionRisk）を機械的に付ける区分。骨格の 5 段（抗凝固薬・ステロイド・抗てんかん薬）。
 * 入れる欄で足した薬に、区分から付ける（Claude は決めない。lib/intake/marks.ts）
 */
export const INTERRUPTION_RISK_CATEGORIES: ReadonlySet<MedicationCategory> = new Set(["anticoagulant", "steroid", "antiepileptic"]);

/** people.ledger の JSON を読む。欠けた群は空で補う */
export function parseLedger(text: string): Ledger {
  const raw = JSON.parse(text) as Partial<Ledger>;
  return {
    basic: raw.basic ?? {},
    care: raw.care ?? {},
    medical: { devices: [], medications: [], ...raw.medical },
    evacuation: { hazards: [], ...raw.evacuation },
    ...(raw.local ? { local: raw.local } : {}),
    notes: raw.notes ?? [],
    pending: raw.pending ?? [],
  };
}

/** 薬の時計と薬の名前が同じ物か（時計の名前は薬の名前の一部のことがある: DOAC と 抗凝固薬（DOAC）） */
export function sameMedication(clockLabel: string, medicationName: string): boolean {
  const a = clockLabel.trim();
  const b = medicationName.trim();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export type Applied = {
  ledger: Ledger;
  /** 値の入った場所（経過の payload と、どの pending を消すか） */
  fields: string[];
  /** 当てなかった変更（埋まっていた・形が違う）の数 */
  skipped: number;
  /** 空欄の理由として残した物（分からない・答えない・次回） */
  pending: Ledger["pending"];
};

type Medication = Ledger["medical"]["medications"][number];

const MED_PARTS = ["schedule", "amount", "storage"] as const;

/** 空いた所だけを埋めた薬と、埋めた所 */
function fillMedication(cur: Medication, next: MedicationValue): { med: Medication; filled: string[] } {
  const med = { ...cur };
  const filled: string[] = [];
  for (const part of MED_PARTS) {
    const v = next[part]?.trim();
    if (v && !isFilled(med[part])) {
      med[part] = v;
      filled.push(part);
    }
  }
  return { med, filled };
}

function newMedication(v: MedicationValue): Medication {
  const med: Medication = { name: v.name.trim(), category: v.category };
  for (const part of MED_PARTS) {
    const s = v[part]?.trim();
    if (s) med[part] = s;
  }
  // 中断注意の印は区分から機械的に付ける（Claude は決めない。lib/intake/marks.ts）
  if (INTERRUPTION_RISK_CATEGORIES.has(v.category)) med.interruptionRisk = true;
  return med;
}

/** 入れる欄の変更を台帳に当てる（元は変えない）。連絡先・時計の変更は飛ばす */
export function applyLedgerChanges(ledger: Ledger, changes: ReadonlyArray<IntakeChange>): Applied {
  let out = structuredClone(ledger);
  const fields: string[] = [];
  const pendingSet: Array<{ field: string; status: Ledger["pending"][number]["status"] }> = [];
  let skipped = 0;

  for (const c of changes) {
    switch (c.t) {
      case "field": {
        const f = intakeField(c.key);
        const value = f ? normalizeValue(f, c.value) : null;
        if (!f || value === null) {
          skipped++;
          break;
        }
        const cur = ledgerValue(out, c.key);
        if (f.shape.type === "list" || f.shape.type === "enumList") {
          const list = Array.isArray(cur) ? (cur as string[]) : [];
          const add = (value as string[]).filter((x) => !list.includes(x));
          if (Array.isArray(cur) && add.length === 0) {
            skipped++;
            break;
          }
          out = withLedgerValue(out, c.key, c.overwrite ? (value as string[]) : [...list, ...add]);
        } else {
          if (isFilled(cur) && (!c.overwrite || cur === value)) {
            skipped++;
            break;
          }
          out = withLedgerValue(out, c.key, value);
        }
        fields.push(c.key);
        break;
      }
      case "medication": {
        const name = c.value.name.trim();
        if (!name) {
          skipped++;
          break;
        }
        const meds = out.medical.medications;
        const i = c.index != null && meds[c.index] ? c.index : meds.findIndex((m) => sameMedication(m.name, name));
        if (i >= 0) {
          const { med, filled } = fillMedication(meds[i], c.value);
          if (filled.length === 0) {
            skipped++;
            break;
          }
          meds[i] = med;
          for (const part of filled) fields.push(`medical.medications.${i}.${part}`, `medical.medications.${meds[i].name}.${part}`);
        } else {
          meds.push(newMedication(c.value));
          fields.push("medical.medications");
        }
        break;
      }
      case "device": {
        const devices = out.medical.devices;
        const i = devices.findIndex((d) => d.kind === c.value.kind);
        if (i >= 0) {
          const d = { ...devices[i] };
          let changed = false;
          for (const part of ["detail", "schedule"] as const) {
            const v = c.value[part]?.trim();
            if (v && !isFilled(d[part])) {
              d[part] = v;
              changed = true;
            }
          }
          if (!changed) {
            skipped++;
            break;
          }
          devices[i] = d;
        } else {
          devices.push({
            kind: c.value.kind,
            ...(c.value.detail?.trim() ? { detail: c.value.detail.trim() } : {}),
            ...(c.value.schedule?.trim() ? { schedule: c.value.schedule.trim() } : {}),
          });
        }
        fields.push("medical.devices");
        break;
      }
      case "hazard": {
        const hazards = out.evacuation.hazards;
        const i = hazards.findIndex((h) => h.kind === c.value.kind);
        if (i >= 0) {
          if (hazards[i].depthM != null || c.value.depthM == null) {
            skipped++;
            break;
          }
          hazards[i] = { ...hazards[i], depthM: c.value.depthM };
        } else {
          hazards.push(c.value.depthM != null ? { kind: c.value.kind, depthM: c.value.depthM } : { kind: c.value.kind });
        }
        fields.push("evacuation.hazards");
        break;
      }
      case "note": {
        const v = c.value.trim();
        if (!v || out.notes.includes(v)) {
          skipped++;
          break;
        }
        out.notes.push(v);
        fields.push("notes");
        break;
      }
      case "pending": {
        // 値の入っている欄に「分からない」は付けない
        const f = intakeField(c.field);
        if (f && isFilled(ledgerValue(out, c.field))) {
          skipped++;
          break;
        }
        pendingSet.push({ field: c.field, status: c.status });
        break;
      }
      case "contact":
        // 夜間に来られるかを答えたら、夜間支援の未確認は消える（値は連絡先の行に入る。lib/intake/save.ts）
        if (c.value.nightOk !== undefined) fields.push("people.night_supporter");
        break;
      case "clock":
        break;
    }
  }

  // 値の入った欄の pending を消し、分からない・答えない・次回を残す（同じ欄は置き換え）
  // 薬・機器を足したときは、その配列の pending だけを消す（ほかの薬の残りの pending は残す）
  const exactOnly = new Set(["medical.medications", "medical.devices"]);
  const resolved = (field: string) => fields.some((k) => field === k || (!exactOnly.has(k) && field.startsWith(`${k}.`)));
  const kept = out.pending.filter((p) => !resolved(p.field) && !pendingSet.some((s) => s.field === p.field));
  const added = pendingSet.filter((s) => !resolved(s.field));
  out = { ...out, pending: [...kept, ...added] };
  return { ledger: out, fields: [...new Set(fields)], skipped, pending: added };
}
