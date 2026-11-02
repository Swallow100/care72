// 入れる欄の変更 1 つの形。Claude の分け方（diff.ts）・問いの答え（ask.ts）・手入力の編集が同じ形を作り、
// 保存（save.ts）が受け取って、今の台帳に当て直す（埋まっている欄は上書きしない）。ブラウザでも読む。

import type { ClockUnit, ContactKind, Ledger, MedicationCategory, PendingStatus } from "../db/types.ts";
import {
  CLOCK_UNIT_LABELS,
  CONTACT_KIND_LABELS,
  DEVICE_LABELS,
  HAZARD_LABELS,
  MEDICATION_CATEGORY_LABELS,
  MED_PARTS,
  PENDING_STATUS_LABELS,
} from "../labels.ts";
import { NAME_MARK, PHONE_MARK, TOWN_MARK } from "../pseudonym/index.ts";
import { displayValue, intakeField } from "./fields.ts";

export type Device = Ledger["medical"]["devices"][number];
export type Hazard = Ledger["evacuation"]["hazards"][number];

/** 薬の追加・書き足し。index があれば今の台帳のその薬の空いた所だけを埋める */
export type MedicationValue = {
  name: string;
  category: MedicationCategory;
  schedule?: string;
  amount?: string;
  storage?: string;
};

/** 連絡先の追加・書き足し。名前と電話は人が画面で入れる（Claude には渡らない） */
export type ContactValue = {
  kind: Exclude<ContactKind, "self">;
  relation?: string;
  name?: string;
  phone?: string;
  /** 夜間に来られるか */
  nightOk?: boolean;
  note?: string;
};

export type IntakeChange =
  /** 台帳の欄（lib/intake/fields.ts）。overwrite は人が「既入力」を選んで上書きするときだけ */
  | { t: "field"; key: string; value: unknown; overwrite?: boolean }
  | { t: "medication"; index?: number; value: MedicationValue }
  | { t: "device"; value: Device }
  | { t: "hazard"; value: Hazard }
  /** 特記。本人の言葉のまま足す */
  | { t: "note"; value: string }
  /** 分からない・答えない・次回（空欄のまま、理由を残す） */
  | { t: "pending"; field: string; status: PendingStatus }
  /** 連絡先。id があれば今の行の空いた所だけを埋める */
  | { t: "contact"; id: string | null; value: ContactValue }
  /** 時計の値（残り）。人が問いに答えた物だけ。clockId が無ければ薬（medIndex）の時計を作る */
  | { t: "clock"; clockId: string | null; medIndex: number | null; label: string; value: number; unit: ClockUnit };

const join = (parts: Array<string | undefined | false>) => parts.filter((p): p is string => !!p && p.trim() !== "").join(" ");

export function medicationText(m: Partial<MedicationValue>): string {
  return join([
    m.name,
    m.category && MEDICATION_CATEGORY_LABELS[m.category],
    m.schedule,
    m.amount && `${MED_PARTS.amount} ${m.amount}`,
    m.storage && `${MED_PARTS.storage} ${m.storage}`,
  ]);
}

export function contactText(c: Partial<ContactValue>): string {
  return join([
    c.name,
    c.relation,
    c.kind && CONTACT_KIND_LABELS[c.kind],
    c.phone,
    c.nightOk === true ? "夜間可" : c.nightOk === false ? "夜間不可" : undefined,
    c.note,
  ]);
}

/** 変更の新しい値の言葉（差分の右側） */
export function changeText(c: IntakeChange): string {
  switch (c.t) {
    case "field": {
      const f = intakeField(c.key);
      return f ? displayValue(f, c.value) : String(c.value);
    }
    case "medication":
      return medicationText(c.value);
    case "device":
      return join([DEVICE_LABELS[c.value.kind], c.value.detail, c.value.schedule]);
    case "hazard":
      return join([HAZARD_LABELS[c.value.kind], c.value.depthM != null ? `${c.value.depthM} m` : undefined]);
    case "note":
      return c.value;
    case "pending":
      return PENDING_STATUS_LABELS[c.status];
    case "contact":
      return contactText(c.value);
    case "clock":
      return `${c.value} ${CLOCK_UNIT_LABELS[c.unit]}`;
  }
}

/** 伏せ字（仮名化の置き換えの印）が残っているか。残っていれば人が直す */
export const MASK_MARKS = [NAME_MARK, TOWN_MARK, PHONE_MARK] as const;

export function hasMask(text: string): boolean {
  return MASK_MARKS.some((m) => text.includes(m));
}
