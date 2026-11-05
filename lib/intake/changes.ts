// 入れる欄の変更 1 つの形。Claude の分け方（diff.ts）・問いの答え（ask.ts）・手入力の編集が同じ形を作り、
// 保存（save.ts）が受け取って、今の台帳に当て直す（埋まっている欄は上書きしない）。ブラウザでも読む。

import type {
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
  GeoPoint,
  Ledger,
  MedicationCategory,
  PendingStatus,
} from "../db/types.ts";
import {
  CHECK_STATUS_LABELS,
  CLOCK_START_LABELS,
  CLOCK_UNIT_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_FLAG_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEVICE_LABELS,
  HAZARD_LABELS,
  MEDICATION_CATEGORY_LABELS,
  MED_PARTS,
  PENDING_STATUS_LABELS,
  PLACE_LABELS,
} from "../labels.ts";
import { clockText } from "../ledger-words.ts";
import { evacMapText, type EvacMapValue } from "../map/route-edit.ts";
import { hasMaskMark, MASK_MARKS as PSEUDONYM_MARKS } from "../pseudonym/index.ts";
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

/**
 * 連絡先の追加・書き足し。名前と電話は人が画面で入れる（Claude には渡らない）。
 * 本人の電話（self）は手で直すときだけ（T68。AI の分け方の候補 CONTACT_KINDS_FOR_INTAKE には無く、保存も edit でないと断る）
 */
export type ContactValue = {
  kind: ContactKind;
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
  /** 距離（同居・近所・市内・県外・遠方）。null は未確認に戻す。人が手で直すときだけ（T57） */
  reach?: ContactReach | null;
  /**
   * スマホ・車の有無（T68。contacts.has_smartphone・has_car）。null は未確認に戻す。人が手で直すときだけ。
   * スマホ ありの家族・支援者は訓練の「押せる人」になる（lib/drill/persona.ts の reportersOf）
   */
  hasSmartphone?: boolean | null;
  hasCar?: boolean | null;
  /**
   * フリガナ・住所（市町村と町名まで）・携帯番号（T117、contacts.kana・address・mobile）。問いの答え・面の編集・紙に直接書く道だけ。
   * AI の分け方には無く、AI の保存に混ざるとサーバーが断る（save.ts の aiHandOnly。docs/progress/t117.md の問い 5）
   */
  kana?: string;
  address?: string;
  mobile?: string;
};

/** 本人の住所（市・町名。番地は持たない）。台帳の basic.address */
export type AddressValue = { city: string; town: string };

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
  | { t: "clockSeen"; clockId: string }
  /** 時計を手で足す（T57）。値が null なら未確認。手で直すときだけ */
  | { t: "clockAdd"; value: ClockAddValue }
  /** 時計の起点（停電・発災）を変える（T57）。走らない状態の時計は変えない。手で直すときだけ */
  | { t: "clockStart"; clockId: string; to: Exclude<ClockStart, "none"> }
  /**
   * 本人の住所（市・町名）を置く・外す（null）。手で直すときだけ（T68）。AI の分け方には無い:
   * 入れる欄の文に新しい町名が混ざると、仮名化の門（lib/pseudonym）が知る前に Claude へ届くため
   */
  | { t: "address"; value: AddressValue | null }
  /** 地図の位置（緯度経度）を置く・外す（null）。手で直すときだけ（T68）。Claude には渡さない（lib/pseudonym の ClaudePerson に無い） */
  | { t: "location"; value: GeoPoint | null }
  /**
   * 避難先 1・2 の位置と避難経路の地図（T102。lib/map/route-edit.ts）。手で直すときだけ（経路地図の画面の保存）。
   * 位置なので Claude には渡さない（lib/pseudonym の ClaudePerson に無い）
   */
  | { t: "evacMap"; value: EvacMapValue };

export type ClockAddValue = {
  label: string;
  kind: Exclude<ClockKind, "condition">;
  category: Exclude<ClockCategory, "dementia">;
  value: number | null;
  unit: ClockUnit | null;
  startsOn: Exclude<ClockStart, "none">;
  source: ClockSource | null;
  sourceNote?: string;
};

export type RemoveTarget =
  | { what: "field"; key: string }
  /** name は外す薬の名前（番号がずれていたら外さない） */
  | { what: "medication"; index: number; name: string }
  | { what: "device"; kind: Device["kind"] }
  | { what: "hazard"; kind: Hazard["kind"] }
  | { what: "note"; value: string }
  | { what: "contact"; id: string }
  /** 時計だけを外す（T57）。印の時計（機器・薬・認知症から作る物）は次の保存で作り直されるので外さない */
  | { what: "clock"; id: string };

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
    c.kana,
    c.relation,
    c.kind && CONTACT_KIND_LABELS[c.kind],
    c.reach ? CONTACT_REACH_LABELS[c.reach] : undefined,
    c.address,
    c.phone,
    c.mobile,
    c.nightOk === true ? "夜間可" : c.nightOk === false ? "夜間不可" : undefined,
    c.emergencyOrder != null ? `緊急 ${c.emergencyOrder}` : undefined,
    c.supporterOrder != null ? `支援 ${c.supporterOrder}` : undefined,
    flagText(CONTACT_FLAG_LABELS.hasSmartphone, c.hasSmartphone),
    flagText(CONTACT_FLAG_LABELS.hasCar, c.hasCar),
    c.note,
  ]);
}

/** スマホ・車の有無の言葉（「スマホ あり」「車 なし」）。未確認に戻すのは「スマホ 未確認」、触れていなければ出さない */
function flagText(label: string, v: boolean | null | undefined): string | undefined {
  if (v === undefined) return undefined;
  return `${label} ${v === true ? PLACE_LABELS.yes : v === false ? PLACE_LABELS.no : PLACE_LABELS.unknown}`;
}

/** 住所の言葉（「松山市 架空町」）。外すは「外す」 */
export function addressText(a: AddressValue | null): string {
  return a ? join([a.city, a.town]) : "外す";
}

/** 位置の言葉（緯度・経度を 5 桁）。外すは「外す」 */
export function locationText(p: GeoPoint | null): string {
  return p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : "外す";
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
      return join([HAZARD_LABELS[c.value.kind], c.value.depthM != null ? `${c.value.depthM} m` : undefined, c.value.note]);
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
    case "clockAdd":
      // 行の詳細・本人のページと同じ時計の言葉（T132、lib/ledger-words.ts）: 「ワーファリン 手元の量 未確認（発災から数える）」
      return clockText({ ...c.value, starts_on: c.value.startsOn, source_note: c.value.sourceNote ?? null }).line;
    case "clockStart":
      return CLOCK_START_LABELS[c.to];
    case "address":
      return addressText(c.value);
    case "location":
      return locationText(c.value);
    case "evacMap":
      return evacMapText(c.value);
  }
}

/** 伏せ字（仮名化の置き換えの印。氏名・町名・電話・住所・郵便番号・メール・生年月日。T118 で全部に） */
export const MASK_MARKS: readonly string[] = PSEUDONYM_MARKS;

/** 伏せ字が残っているか（Claude の分け方では、残る値は出さず保存しない。T118） */
export function hasMask(text: string): boolean {
  return hasMaskMark(text);
}

/** 変更の中の文字の値のどれかに伏せ字が残っているか（保存の検査。lib/intake/save.ts） */
export function changeHasMask(change: unknown): boolean {
  if (typeof change === "string") return hasMaskMark(change);
  if (Array.isArray(change)) return change.some(changeHasMask);
  if (change && typeof change === "object") return Object.values(change).some(changeHasMask);
  return false;
}
