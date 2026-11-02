// Claude の分け方（lib/intake/schema.ts の形）を、今の台帳と並べた差分（項目ごとに 今の値 → 新しい値）にする。
// 画面はこの差分を見せ、ケアマネが外す・直す・既入力を選んでから保存する（保存は save.ts が今の台帳に当て直す）。
//
// - 状態: 追加（空いた所に入る・配列に足す）、一致（今と同じ。保存しない）、既入力（今と違う。既定では保存しない）
// - 欄の形に合わない値（選択肢に無い値など）は捨てて数える（dropped）
// - 文字の値は仮名（A さん）を氏名に戻す。伏せ字（（氏名）（町名）（電話））が残る物は印を付けて人が直す
// - 特記は入力の 1 文をそのまま写させ、仮名化の前の同じ文に戻す（本人の言葉を言い換えない）

import { sameMedication } from "../db/ledger.ts";
import type { ContactRow, Ledger } from "../db/types.ts";
import { CONTACT_KIND_LABELS, PENDING_STATUS_LABELS } from "../labels.ts";
import {
  changeText as changeLabel,
  contactText,
  hasMask,
  medicationText,
  type ContactValue,
  type IntakeChange,
  type MedicationValue,
} from "./changes.ts";
import {
  displayValue,
  EXTRA_PENDING_LABELS,
  intakeField,
  isFilled,
  ledgerValue,
  normalizeValue,
  type IntakeSection,
} from "./fields.ts";
import type { ExtractOutput } from "./schema.ts";

export type DiffState = "add" | "same" | "filled";

export type DiffItem = {
  id: string;
  section: IntakeSection;
  /** 欄の名前（世帯・薬・民生委員） */
  label: string;
  /** 今の値の言葉。空なら null */
  current: string | null;
  /** 新しい値の言葉 */
  next: string;
  state: DiffState;
  /** 伏せ字が残っている（人が直す） */
  masked: boolean;
  /** 保存に渡す変更。一致は null */
  change: IntakeChange | null;
};

export type DiffContact = Pick<ContactRow, "id" | "kind" | "relation" | "name" | "phone" | "night_ok" | "note">;

export type DiffInput = {
  ledger: Ledger;
  contacts: ReadonlyArray<DiffContact>;
};

export type Restorers = {
  /** 文字の値の仮名を氏名に戻す */
  text: (s: string) => string;
  /** 特記を仮名化の前の文に戻す */
  note: (s: string) => string;
};

const SECTION_BY_PREFIX: Record<string, IntakeSection> = {
  medical: "medical",
  clocks: "medical",
  evacuation: "evacuation",
  people: "people",
  local: "people",
  basic: "basic",
  care: "basic",
  notes: "basic",
};

export function sectionOfKey(key: string): IntakeSection {
  return intakeField(key)?.section ?? SECTION_BY_PREFIX[key.split(".")[0]] ?? "basic";
}

export function labelOfKey(key: string): string {
  return intakeField(key)?.label ?? EXTRA_PENDING_LABELS[key as keyof typeof EXTRA_PENDING_LABELS] ?? key;
}

const blank = (s: string) => s.trim() === "";
const opt = (s: string) => (blank(s) ? undefined : s.trim());

function contactValue(c: DiffContact): ContactValue {
  return {
    kind: c.kind === "self" ? "family" : c.kind,
    ...(c.relation ? { relation: c.relation } : {}),
    ...(c.name ? { name: c.name } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.night_ok != null ? { nightOk: c.night_ok === 1 } : {}),
    ...(c.note ? { note: c.note } : {}),
  };
}

/** 連絡先の言及を今の行に当てる: 同じ種類（家族は続柄も）が 1 つなら、その行 */
function matchContact(contacts: ReadonlyArray<DiffContact>, kind: string, relation: string): DiffContact | undefined {
  const same = contacts.filter((c) => c.kind === kind);
  if (kind === "family" && relation) {
    const byRelation = same.filter((c) => c.relation === relation);
    return byRelation.length === 1 ? byRelation[0] : undefined;
  }
  return same.length === 1 ? same[0] : undefined;
}

export function buildDiff(input: DiffInput, out: ExtractOutput, restore: Restorers): { items: DiffItem[]; dropped: number } {
  const items: DiffItem[] = [];
  let dropped = 0;
  const { ledger } = input;
  const push = (item: Omit<DiffItem, "id" | "masked">, id: string) =>
    items.push({ ...item, id, masked: hasMask(item.next) || (item.change?.t === "contact" && hasMask(item.change.value.note ?? "")) });

  // 欄（配列の欄は同じ欄の行をまとめる）
  const grouped = new Map<string, string[]>();
  for (const it of out.items) {
    const v = restore.text(it.value);
    if (blank(v)) continue;
    grouped.set(it.field, [...(grouped.get(it.field) ?? []), v]);
  }
  for (const [key, values] of grouped) {
    const f = intakeField(key);
    if (!f) {
      dropped += values.length;
      continue;
    }
    const isList = f.shape.type === "list" || f.shape.type === "enumList";
    const value = normalizeValue(f, isList ? values : values[0]);
    if (value === null) {
      dropped += values.length;
      continue;
    }
    const cur = ledgerValue(ledger, key);
    const current = isFilled(cur) ? displayValue(f, cur) : null;
    if (isList) {
      const list = Array.isArray(cur) ? (cur as string[]) : [];
      const add = (value as string[]).filter((x) => !list.includes(x));
      if (add.length === 0) {
        push({ section: f.section, label: f.label, current, next: displayValue(f, value), state: "same", change: null }, `field-${key}`);
      } else {
        push(
          { section: f.section, label: f.label, current, next: displayValue(f, [...list, ...add]), state: "add", change: { t: "field", key, value: add } },
          `field-${key}`,
        );
      }
      continue;
    }
    const state: DiffState = !isFilled(cur) ? "add" : cur === value ? "same" : "filled";
    push(
      {
        section: f.section,
        label: f.label,
        current,
        next: displayValue(f, value),
        state,
        change: state === "same" ? null : { t: "field", key, value, ...(state === "filled" ? { overwrite: true } : {}) },
      },
      `field-${key}`,
    );
  }

  // 薬: 同じ名前の薬があれば空いた所だけ
  out.medications.forEach((m, i) => {
    const name = restore.text(m.name).trim();
    if (!name) {
      dropped++;
      return;
    }
    const value: MedicationValue = {
      name,
      category: m.category,
      ...(opt(m.schedule) ? { schedule: restore.text(m.schedule.trim()) } : {}),
      ...(opt(m.amount) ? { amount: restore.text(m.amount.trim()) } : {}),
      ...(opt(m.storage) ? { storage: restore.text(m.storage.trim()) } : {}),
    };
    const index = ledger.medical.medications.findIndex((x) => sameMedication(x.name, name));
    if (index < 0) {
      push({ section: "medical", label: "薬", current: null, next: medicationText(value), state: "add", change: { t: "medication", value } }, `med-${i}`);
      return;
    }
    const cur = ledger.medical.medications[index];
    const filled = { ...cur };
    let adds = false;
    for (const part of ["schedule", "amount", "storage"] as const) {
      if (value[part] && !isFilled(cur[part])) {
        filled[part] = value[part];
        adds = true;
      }
    }
    push(
      {
        section: "medical",
        label: "薬",
        current: medicationText(cur),
        next: medicationText(filled),
        state: adds ? "add" : "same",
        change: adds ? { t: "medication", index, value: { ...value, name: cur.name, category: cur.category } } : null,
      },
      `med-${i}`,
    );
  });

  // 機器・ハザード: 種類で当てる
  out.devices.forEach((d, i) => {
    const cur = ledger.medical.devices.find((x) => x.kind === d.kind);
    const value = { kind: d.kind, ...(opt(d.detail) ? { detail: restore.text(d.detail.trim()) } : {}), ...(opt(d.schedule) ? { schedule: restore.text(d.schedule.trim()) } : {}) };
    const fills = cur ? (["detail", "schedule"] as const).some((p) => value[p] && !isFilled(cur[p])) : true;
    const change: IntakeChange | null = fills ? { t: "device", value } : null;
    const next = change ? changeLabel(change) : changeLabel({ t: "device", value: cur! });
    push(
      { section: "medical", label: "機器", current: cur ? changeLabel({ t: "device", value: cur }) : null, next, state: fills ? "add" : "same", change },
      `device-${i}`,
    );
  });
  out.hazards.forEach((h, i) => {
    const depth = Number(h.depth_m.trim());
    const value = { kind: h.kind, ...(h.depth_m.trim() !== "" && Number.isFinite(depth) && depth >= 0 ? { depthM: depth } : {}) };
    const cur = ledger.evacuation.hazards.find((x) => x.kind === h.kind);
    const fills = !cur || (cur.depthM == null && value.depthM != null);
    push(
      {
        section: "evacuation",
        label: "ハザード",
        current: cur ? changeLabel({ t: "hazard", value: cur }) : null,
        next: changeLabel({ t: "hazard", value: cur && !fills ? cur : value }),
        state: fills ? "add" : "same",
        change: fills ? { t: "hazard", value } : null,
      },
      `hazard-${i}`,
    );
  });

  // 連絡先: 同じ種類の行があれば、空いた所（夜間・続柄・備考）だけ。無ければ足す（名前・電話は人が入れる）
  out.contacts.forEach((c, i) => {
    const relation = restore.text(c.relation).trim();
    const note = restore.text(c.note).trim();
    const nightOk = c.night === "yes" ? true : c.night === "no" ? false : undefined;
    const cur = matchContact(input.contacts, c.kind, relation);
    const label = CONTACT_KIND_LABELS[c.kind];
    if (!cur) {
      const value: ContactValue = { kind: c.kind, ...(relation ? { relation } : {}), ...(nightOk !== undefined ? { nightOk } : {}), ...(note ? { note } : {}) };
      push({ section: "people", label, current: null, next: contactText(value), state: "add", change: { t: "contact", id: null, value } }, `contact-${i}`);
      return;
    }
    const fill: ContactValue = { kind: contactValue(cur).kind };
    if (nightOk !== undefined && cur.night_ok == null) fill.nightOk = nightOk;
    if (relation && !cur.relation) fill.relation = relation;
    if (note && !cur.note) fill.note = note;
    const adds = fill.nightOk !== undefined || fill.relation !== undefined || fill.note !== undefined;
    const currentValue = contactValue(cur);
    push(
      {
        section: "people",
        label,
        current: contactText(currentValue),
        next: contactText({ ...currentValue, ...fill }),
        state: adds ? "add" : "same",
        change: adds ? { t: "contact", id: cur.id, value: fill } : null,
      },
      `contact-${i}`,
    );
  });

  // 特記: 入力の文のまま
  out.notes.forEach((n, i) => {
    const v = restore.note(n).trim();
    if (!v) return;
    const same = ledger.notes.includes(v);
    push({ section: "basic", label: "特記", current: null, next: v, state: same ? "same" : "add", change: same ? null : { t: "note", value: v } }, `note-${i}`);
  });

  // 分からない・答えない: 空いた欄だけ、値の出た欄は除く
  const valued = new Set(grouped.keys());
  out.unknowns.forEach((u, i) => {
    if (valued.has(u.field)) return;
    const f = intakeField(u.field);
    if (f && isFilled(ledgerValue(ledger, u.field))) return;
    push(
      {
        section: sectionOfKey(u.field),
        label: labelOfKey(u.field),
        current: null,
        next: PENDING_STATUS_LABELS[u.status],
        state: "add",
        change: { t: "pending", field: u.field, status: u.status },
      },
      `pending-${i}`,
    );
  });

  return { items, dropped };
}

// ---------- 特記を元の文に戻す ----------

/** 文の区切り（句点・感嘆・疑問・改行）。仮名化の置き換えはこの文字を作らず消さないので、元と置き換え後の文の数が同じ */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const stripEnd = (s: string) => s.trim().replace(/[。．.]$/, "");

/**
 * Claude が写した特記 1 つを、仮名化の前の文に戻す。置き換え後の文と同じなら元の文、
 * 同じ文が無ければそのまま（伏せ字が残れば人が直す）
 */
export function restoreNote(note: string, original: string, scrubbed: string): string {
  const o = sentencesOf(original);
  const s = sentencesOf(scrubbed);
  if (o.length !== s.length) return note;
  const i = s.findIndex((x) => stripEnd(x) === stripEnd(note));
  return i >= 0 ? o[i] : note;
}
