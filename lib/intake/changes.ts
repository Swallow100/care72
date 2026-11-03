// 入れる欄の変更 1 つの形。Claude の分け方（diff.ts）・問いの答え（ask.ts）・手入力の編集が同じ形を作り、
// 保存（save.ts）が受け取って、今の台帳に当て直す（埋まっている欄は上書きしない）。ブラウザでも読む。

import type { CheckStatus, ClockUnit, ConsentKind, ConsentStatus, ContactKind, Ledger, MedicationCategory, PendingStatus } from "../db/types.ts";
import {
  CHECK_STATUS_LABELS,
  CLOCK_UNIT_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_STATUS_LABELS,
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
  /** 夜間に来られるか。null は「未確認」に戻す（手で直すときだけ） */
  nightOk?: boolean | null;
  note?: string;
  /**
   * 緊急連絡先の順・避難支援等実施者の順（T57）。null は順を外す。人が手で直すときだけ（AI の分け方・問いの答えは付けない。
   * ルールの表は支援者の順のある連絡先を「支援者」と数える）
   */
  emergencyOrder?: number | null;
  supporterOrder?: number | null;
};

// overwrite（埋まっている所も変える）は人が選んだときだけ: 変更点の「既入力」を選んだとき（欄）と、
// 本人のページの面の「編集」で手で直したとき（欄・薬・機器・ハザード・連絡先・時計。T45）。Claude の分け方は付けない。
export type IntakeChange =
  /** 台帳の欄（lib/intake/fields.ts）。overwrite は人が「既入力」を選んで上書きするときだけ */
  | { t: "field"; key: string; value: unknown; overwrite?: boolean }
  /** overwrite は index の薬の回数・用量・保管・区分を手で直す（空にした所は消す） */
  | { t: "medication"; index?: number; value: MedicationValue; overwrite?: boolean }
  | { t: "device"; value: Device; overwrite?: boolean }
  | { t: "hazard"; value: Hazard; overwrite?: boolean }
  /** 特記。本人の言葉のまま足す */
  | { t: "note"; value: string }
  /** 分からない・答えない・次回（空欄のまま、理由を残す） */
  | { t: "pending"; field: string; status: PendingStatus }
  /** 連絡先。id があれば今の行の空いた所だけを埋める（overwrite なら渡した所を直す。空の文字は消す） */
  | { t: "contact"; id: string | null; value: ContactValue; overwrite?: boolean }
  /** 時計の値（残り）。人が入れた物だけ。clockId が無ければ薬（medIndex）の時計を作る。overwrite なら値の入った時計も直す */
  | { t: "clock"; clockId: string | null; medIndex: number | null; label: string; value: number; unit: ClockUnit; overwrite?: boolean }
  /** 時計の頼り先の確認（確認済・未確認）。人が付ける（lib/ledger-marks.ts の経過の行） */
  | { t: "clockCheck"; clockId: string; to: CheckStatus }
  /** 同意（得た・断った・未確認）。人が記録する */
  | { t: "consent"; kind: ConsentKind; status: ConsentStatus }
  /** 外す（欄を空にする・薬・機器・ハザード・特記・連絡先の行を外す）。手で直すときだけ（確認の窓のあと） */
  | { t: "remove"; target: RemoveTarget }
  /** 時計の値を今日確かめた（値は同じまま、確認の日付を今日に）。手で直すときだけ */
  | { t: "clockSeen"; clockId: string };

export type RemoveTarget =
  | { what: "field"; key: string }
  /** name は外す薬の名前（番号がずれていたら外さない） */
  | { what: "medication"; index: number; name: string }
  | { what: "device"; kind: Device["kind"] }
  | { what: "hazard"; kind: Hazard["kind"] }
  | { what: "note"; value: string }
  | { what: "contact"; id: string };

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
    c.emergencyOrder != null ? `緊急 ${c.emergencyOrder}` : undefined,
    c.supporterOrder != null ? `支援 ${c.supporterOrder}` : undefined,
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
    case "clockCheck":
      return CHECK_STATUS_LABELS[c.to];
    case "consent":
      return `${CONSENT_KIND_LABELS[c.kind]} ${CONSENT_STATUS_LABELS[c.status]}`;
    case "remove":
      return "外す";
    case "clockSeen":
      return "確認";
  }
}

/** 伏せ字（仮名化の置き換えの印）が残っているか。残っていれば人が直す */
export const MASK_MARKS = [NAME_MARK, TOWN_MARK, PHONE_MARK] as const;

export function hasMask(text: string): boolean {
  return MASK_MARKS.some((m) => text.includes(m));
}
