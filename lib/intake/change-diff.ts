// 台帳の保存で変えた欄の前と後の言葉（T143）。本人のページの変更履歴で、行を押すと「既往: 高血圧 → 高血圧・心不全」と出す元。
//
// 保存（lib/intake/save.ts）の前の台帳・連絡先・時計・同意と、保存のあとの同じ物（save.ts が書く文と同じ当て方で手元で作った写し）を
// 欄ごとの画面の言葉にして並べ、違う欄だけを残す。台帳の版が同じときだけ保存が効く（save.ts の guard）ので、手元の写しは書いた結果と同じ。
// 言葉は入れる欄の差分（lib/intake/diff.ts・changes.ts）と時計の言葉（lib/ledger-words.ts、T132）のまま。
// 位置・経路地図は数を見せない（T113）ので、前と後を null にして欄の名前だけ。
// 経過の payload に入るだけで、Claude を呼ぶ所は経過の表を読まない（lib/timeline/t63.test.ts・lib/list/call-heard.test.ts）。

import type { ClockRow, ConsentRow, ContactRow, IntakeDiff, IntakeDiffSection, Ledger } from "../db/types.ts";
import { clockText } from "../ledger-words.ts";
import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, CONTACT_KIND_LABELS, DEVICE_LABELS, HAZARD_LABELS } from "../labels.ts";
import { EVAC_MAP_FIELDS } from "../map/route-edit.ts";
import { changeText, contactText, medicationText } from "./changes.ts";
import { displayValue, INTAKE_FIELDS, isFilled, ledgerValue } from "./fields.ts";

/** 1 つの保存で残す欄の数と、1 つの値の字数の上限（経過の行を大きくしすぎない） */
export const DIFF_MAX = 40;
export const DIFF_TEXT_MAX = 120;

/** 中身の言葉の無い薬・機器・ハザード（名前だけ入った物）の値 */
const THERE = "あり";

export type DiffContactRow = Pick<
  ContactRow,
  | "id"
  | "kind"
  | "relation"
  | "name"
  | "phone"
  | "reach"
  | "emergency_order"
  | "supporter_order"
  | "night_ok"
  | "has_car"
  | "has_smartphone"
  | "note"
> &
  Partial<Pick<ContactRow, "kana" | "address" | "mobile">>;
export type DiffClockRow = Pick<
  ClockRow,
  "id" | "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check"
>;
export type DiffConsentRow = Pick<ConsentRow, "kind" | "status">;

/** 保存の前か後の、本人の記録の写し */
export type RecordState = {
  ledger: Ledger;
  contacts: ReadonlyArray<DiffContactRow>;
  clocks: ReadonlyArray<DiffClockRow>;
  consents: ReadonlyArray<DiffConsentRow>;
};

type Entry = {
  section: IntakeDiffSection;
  label: string;
  text: string | null;
  hidden?: true;
};

const cut = (s: string | null): string | null => {
  if (s === null) return null;
  const t = s.trim();
  if (t === "") return null;
  return t.length > DIFF_TEXT_MAX ? `${t.slice(0, DIFF_TEXT_MAX)}…` : t;
};

/** 連絡先の行を差分の言葉に（入れる欄の差分と同じ contactText） */
function contactLine(c: DiffContactRow): string {
  return contactText({
    kind: c.kind,
    relation: c.relation ?? undefined,
    name: c.name ?? undefined,
    kana: c.kana ?? undefined,
    phone: c.phone ?? undefined,
    mobile: c.mobile ?? undefined,
    address: c.address ?? undefined,
    reach: c.reach ?? undefined,
    note: c.note ?? undefined,
    nightOk: c.night_ok === null ? undefined : c.night_ok === 1,
    emergencyOrder: c.emergency_order,
    supporterOrder: c.supporter_order,
    hasSmartphone: c.has_smartphone === null ? undefined : c.has_smartphone === 1,
    hasCar: c.has_car === null ? undefined : c.has_car === 1,
  });
}

/** 連絡先の欄の名前（「連絡先 長女」「連絡先 かかりつけ」） */
function contactLabel(c: DiffContactRow): string {
  return ["連絡先", c.relation?.trim() || CONTACT_KIND_LABELS[c.kind]].join(" ");
}

/** 連絡先の区分（本人の電話は基本、かかりつけ・薬局・透析は医療、ほかは人） */
function contactSection(c: DiffContactRow): IntakeDiffSection {
  if (c.kind === "self") return "basic";
  if (c.kind === "home_doctor" || c.kind === "pharmacy" || c.kind === "dialysis_center") return "medical";
  return "people";
}

/** 時計の言葉（「酸素 内蔵電池 停電から 2 時間 透析先 確認済」） */
function clockLine(k: DiffClockRow): string {
  const t = clockText(k);
  return [t.line, t.depends?.text].filter((x) => x).join(" ");
}

/** 記録の写しを、欄ごとの言葉の表にする（key → 区分・名前・言葉） */
export function recordEntries(s: RecordState): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const { ledger } = s;
  for (const f of INTAKE_FIELDS) {
    const v = ledgerValue(ledger, f.key);
    out.set(f.key, {
      section: f.section,
      label: f.label,
      text: isFilled(v) ? displayValue(f, v) : null,
    });
  }
  // 薬・機器・ハザードは 1 つずつ（「薬 ワーファリン 1 日 1 回 → 1 日 1 回 用量 1 錠」）。名前・種類が欄の名前、中身が値
  for (const m of ledger.medical.medications) {
    out.set(`medical.medications.${m.name}`, {
      section: "medical",
      label: `薬 ${m.name}`,
      text: medicationText({ ...m, name: undefined }) || THERE,
    });
  }
  const seen = new Map<string, number>();
  for (const d of ledger.medical.devices) {
    const n = (seen.get(d.kind) ?? 0) + 1;
    seen.set(d.kind, n);
    const name = DEVICE_LABELS[d.kind];
    out.set(`medical.devices.${d.kind}.${n}`, {
      section: "medical",
      label: `機器 ${n > 1 ? `${name} ${n}` : name}`,
      text: changeText({ t: "device", value: d }).replace(new RegExp(`^${name}\\s*`), "") || THERE,
    });
  }
  for (const h of ledger.evacuation.hazards) {
    const name = HAZARD_LABELS[h.kind];
    out.set(`evacuation.hazards.${h.kind}`, {
      section: "evacuation",
      label: `ハザード ${name}`,
      text: changeText({ t: "hazard", value: h }).replace(new RegExp(`^${name}\\s*`), "") || THERE,
    });
  }
  out.set("notes", {
    section: "basic",
    label: "特記",
    text: ledger.notes.length > 0 ? ledger.notes.join(" ／ ") : null,
  });
  const addr = ledger.basic.address;
  out.set("basic.address", {
    section: "address",
    label: "住所",
    text: addr ? `${addr.city} ${addr.town}`.trim() : null,
  });
  // 位置・経路地図は数を見せない（T113）。違いだけを見て、前と後は空
  out.set("basic.location", {
    section: "address",
    label: "位置",
    text: ledger.basic.location ? JSON.stringify(ledger.basic.location) : null,
    hidden: true,
  });
  for (const [key, label] of Object.entries(EVAC_MAP_FIELDS)) {
    const v = ledgerValue(ledger, key);
    out.set(key, {
      section: "evacuation",
      label,
      text: v == null ? null : JSON.stringify(v),
      hidden: true,
    });
  }
  for (const c of s.contacts)
    out.set(`contacts.${c.id}`, {
      section: contactSection(c),
      label: contactLabel(c),
      text: contactLine(c),
    });
  for (const k of s.clocks)
    out.set(`clocks.${k.id}`, {
      section: "medical",
      label: `時計 ${k.label}`,
      text: clockLine(k),
    });
  for (const c of s.consents) {
    out.set(`consent.${c.kind}`, {
      section: "consent",
      label: CONSENT_KIND_LABELS[c.kind],
      text: CONSENT_STATUS_LABELS[c.status],
    });
  }
  return out;
}

/**
 * 前と後の写しから、変わった欄の前と後（DIFF_MAX まで）。並びは本人のページの欄の並び（台帳の欄 → 薬・機器… → 連絡先 → 時計 → 同意）。
 * 足した物は前が null、外した物は後が null。位置・経路地図は前も後も null
 */
export function changeDiff(before: RecordState, after: RecordState): IntakeDiff[] {
  const a = recordEntries(before);
  const b = recordEntries(after);
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  const out: IntakeDiff[] = [];
  for (const key of keys) {
    const x = a.get(key);
    const y = b.get(key);
    const was = x?.text ?? null;
    const now = y?.text ?? null;
    if (was === now) continue;
    const e = (y ?? x)!;
    out.push(
      e.hidden
        ? { key, section: e.section, label: e.label, before: null, after: null }
        : {
            key,
            section: e.section,
            label: e.label,
            before: cut(was),
            after: cut(now),
          },
    );
    if (out.length >= DIFF_MAX) break;
  }
  return out;
}
