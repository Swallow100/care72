// 本人のページの面の「編集」（T45）。面ごとに今の値を入力欄の下書きにし、直した所だけを保存の変更にする。ブラウザで使う。
// 保存は /api/intake/save の edit（手の入力）: 埋まった欄・薬・機器・ハザード・連絡先・時計も上書きし（overwrite）、
// 同意と時計の頼り先の確認も変えられる。経過に「ケアマネが直した」。版の確かめは入れる欄の保存と同じ。
//
// 消すこと（欄を空にする・薬や連絡先の行を外す）はしない。空にした欄は送らない（今の値のまま）。
// 薬の回数・用量・保管・機器の中身・連絡先の文字は空にすると消える（行は残る）。

import type {
  CheckStatus,
  ClockCategory,
  ClockKind,
  ClockUnit,
  ConsentKind,
  ConsentStatus,
  ContactKind,
  DependsOn,
  DeviceKind,
  HazardKind,
  Ledger,
  MedicationCategory,
} from "../db/types.ts";
import { CONSENT_KINDS } from "../db/types.ts";
import type { ContactValue, IntakeChange } from "./changes.ts";
import { INTAKE_FIELDS, ledgerValue, normalizeValue, type IntakeSection } from "./fields.ts";

/** 編集できる面（本人のページの区分のうち、書類と経過を除く） */
export const EDIT_SECTIONS = ["medical", "evacuation", "people", "basic", "consent"] as const;
export type EditSection = (typeof EDIT_SECTIONS)[number];

export function isEditSection(id: string): id is EditSection {
  return (EDIT_SECTIONS as readonly string[]).includes(id);
}

/** 編集に要る今の値（サーバーで作り、画面に渡す。名前・電話は本人のページにもう出ている物だけ） */
export type EditData = {
  personId: string;
  version: number;
  ledger: Ledger;
  contacts: Array<{
    id: string;
    kind: ContactKind;
    relation: string | null;
    name: string | null;
    phone: string | null;
    night_ok: 0 | 1 | null;
    note: string | null;
  }>;
  clocks: Array<{
    id: string;
    kind: ClockKind;
    category: ClockCategory;
    label: string;
    value: number | null;
    unit: ClockUnit | null;
    depends_on: DependsOn | null;
    depends_check: CheckStatus | null;
  }>;
  consents: Array<{ kind: ConsentKind; status: ConsentStatus }>;
};

/** 連絡先の夜間の欄（空は未確認） */
export type NightDraft = "" | "yes" | "no";

export type ContactDraft = { id: string | null; kind: Exclude<ContactKind, "self">; relation: string; name: string; phone: string; night: NightDraft; note: string };
export type MedDraft = { name: string; category: MedicationCategory; schedule: string; amount: string; storage: string };

export type EditDraft = {
  /** 欄の表の欄（面の欄だけを使う） */
  values: Record<string, unknown>;
  /** 今の薬（並びは台帳と同じ）と、足す薬 */
  meds: MedDraft[];
  newMeds: MedDraft[];
  /** 今の機器の中身・回数（並びは台帳と同じ）と、足す機器 */
  devices: Array<{ kind: DeviceKind; detail: string; schedule: string }>;
  newDevices: DeviceKind[];
  /** 今のハザードの浸水の深さ（m、文字）と、足すハザード */
  hazards: Array<{ kind: HazardKind; depth: string }>;
  newHazards: HazardKind[];
  /** 今の連絡先（本人の行を除く）と、足す連絡先 */
  contacts: ContactDraft[];
  newContacts: ContactDraft[];
  /** 時計の値（文字）と単位。走らない状態の時計（condition）は除く */
  clocks: Array<{ id: string; label: string; value: string; unit: ClockUnit }>;
  /** 時計の頼り先の確認（頼り先のある時計だけ） */
  checks: Record<string, CheckStatus>;
  consents: Record<ConsentKind, ConsentStatus>;
  /** 足す特記 */
  note: string;
};

const s = (v: string | null | undefined) => v ?? "";

export const blankMed = (): MedDraft => ({ name: "", category: "other", schedule: "", amount: "", storage: "" });
export const blankContact = (): ContactDraft => ({ id: null, kind: "family", relation: "", name: "", phone: "", night: "", note: "" });

/** 今の値から下書きを作る */
export function editDraft(d: EditData): EditDraft {
  const l = d.ledger;
  const consents = Object.fromEntries(CONSENT_KINDS.map((k) => [k, d.consents.find((c) => c.kind === k)?.status ?? "unconfirmed"])) as Record<
    ConsentKind,
    ConsentStatus
  >;
  return {
    values: Object.fromEntries(INTAKE_FIELDS.map((f) => [f.key, ledgerValue(l, f.key)])),
    meds: l.medical.medications.map((m) => ({ name: m.name, category: m.category, schedule: s(m.schedule), amount: s(m.amount), storage: s(m.storage) })),
    newMeds: [],
    devices: l.medical.devices.map((x) => ({ kind: x.kind, detail: s(x.detail), schedule: s(x.schedule) })),
    newDevices: [],
    hazards: l.evacuation.hazards.map((h) => ({ kind: h.kind, depth: h.depthM != null ? String(h.depthM) : "" })),
    newHazards: [],
    contacts: d.contacts.flatMap((c): ContactDraft[] =>
      c.kind === "self"
        ? []
        : [{ id: c.id, kind: c.kind, relation: s(c.relation), name: s(c.name), phone: s(c.phone), night: c.night_ok === 1 ? "yes" : c.night_ok === 0 ? "no" : "", note: s(c.note) }],
    ),
    newContacts: [],
    clocks: d.clocks
      .filter((k) => k.kind !== "condition")
      .map((k) => ({ id: k.id, label: k.label, value: k.value != null ? String(k.value) : "", unit: k.unit ?? (k.kind === "device" ? "hour" : "day") })),
    checks: Object.fromEntries(d.clocks.filter((k) => k.depends_on && k.depends_check).map((k) => [k.id, k.depends_check as CheckStatus])),
    consents,
    note: "",
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 全角の数字と小数点を半角に。数でなければ null */
export function numberOf(v: string): number | null {
  const t = v.trim().replace(/[０-９．]/g, (c) => (c === "．" ? "." : String(c.charCodeAt(0) - 0xff10)));
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const nightOf = (n: NightDraft): boolean | null => (n === "yes" ? true : n === "no" ? false : null);

/** 面の下書きから、直した所だけの変更を作る */
export function editChanges(section: EditSection, d: EditData, draft: EditDraft): IntakeChange[] {
  const out: IntakeChange[] = [];
  const l = d.ledger;

  // 欄の表の欄（この面の物）。空にした欄・形の合わない値は送らない
  if (section !== "consent") {
    for (const f of INTAKE_FIELDS) {
      if (f.section !== (section as IntakeSection)) continue;
      const cur = ledgerValue(l, f.key);
      const raw = draft.values[f.key];
      if (same(raw, cur)) continue;
      const value = normalizeValue(f, raw);
      if (value === null || same(value, cur)) continue;
      out.push({ t: "field", key: f.key, value, overwrite: true });
    }
  }

  if (section === "medical") {
    draft.meds.forEach((m, index) => {
      const cur = l.medical.medications[index];
      if (!cur) return;
      const before = { name: cur.name, category: cur.category, schedule: s(cur.schedule), amount: s(cur.amount), storage: s(cur.storage) };
      const next = { ...m, name: m.name.trim() || cur.name, schedule: m.schedule.trim(), amount: m.amount.trim(), storage: m.storage.trim() };
      if (same(next, before)) return;
      out.push({ t: "medication", index, value: next, overwrite: true });
    });
    for (const m of draft.newMeds) {
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
    draft.devices.forEach((x) => {
      const cur = l.medical.devices.find((c) => c.kind === x.kind);
      if (!cur || (s(cur.detail) === x.detail.trim() && s(cur.schedule) === x.schedule.trim())) return;
      out.push({ t: "device", value: { kind: x.kind, detail: x.detail.trim(), schedule: x.schedule.trim() }, overwrite: true });
    });
    for (const kind of draft.newDevices) if (!l.medical.devices.some((c) => c.kind === kind)) out.push({ t: "device", value: { kind } });
    for (const k of draft.clocks) {
      const cur = d.clocks.find((c) => c.id === k.id);
      const n = numberOf(k.value);
      if (!cur || n === null || (cur.value === n && cur.unit === k.unit)) continue;
      out.push({ t: "clock", clockId: k.id, medIndex: null, label: cur.label, value: n, unit: k.unit, overwrite: true });
    }
    for (const [clockId, to] of Object.entries(draft.checks)) {
      const cur = d.clocks.find((c) => c.id === clockId);
      if (cur?.depends_on && cur.depends_check !== to) out.push({ t: "clockCheck", clockId, to });
    }
  }

  if (section === "evacuation") {
    for (const h of draft.hazards) {
      const cur = l.evacuation.hazards.find((c) => c.kind === h.kind);
      const n = h.depth.trim() === "" ? undefined : (numberOf(h.depth) ?? undefined);
      if (!cur || cur.depthM === n || (h.depth.trim() !== "" && n === undefined)) continue;
      out.push({ t: "hazard", value: n === undefined ? { kind: h.kind } : { kind: h.kind, depthM: n }, overwrite: true });
    }
    for (const kind of draft.newHazards) if (!l.evacuation.hazards.some((c) => c.kind === kind)) out.push({ t: "hazard", value: { kind } });
  }

  if (section === "people") {
    for (const c of draft.contacts) {
      const cur = d.contacts.find((x) => x.id === c.id);
      if (!cur || cur.kind === "self") continue;
      const value: ContactValue = { kind: c.kind };
      let changed = false;
      for (const col of ["relation", "name", "phone", "note"] as const) {
        if (c[col].trim() === s(cur[col])) continue;
        value[col] = c[col].trim();
        changed = true;
      }
      const night = nightOf(c.night);
      const curNight = cur.night_ok === 1 ? true : cur.night_ok === 0 ? false : null;
      if (night !== curNight) {
        value.nightOk = night;
        changed = true;
      }
      if (changed) out.push({ t: "contact", id: cur.id, value, overwrite: true });
    }
    for (const c of draft.newContacts) {
      if (![c.relation, c.name, c.phone, c.note].some((x) => x.trim())) continue;
      const night = nightOf(c.night);
      out.push({
        t: "contact",
        id: null,
        value: {
          kind: c.kind,
          ...(c.relation.trim() ? { relation: c.relation.trim() } : {}),
          ...(c.name.trim() ? { name: c.name.trim() } : {}),
          ...(c.phone.trim() ? { phone: c.phone.trim() } : {}),
          ...(night !== null ? { nightOk: night } : {}),
          ...(c.note.trim() ? { note: c.note.trim() } : {}),
        },
      });
    }
  }

  if (section === "basic" && draft.note.trim()) out.push({ t: "note", value: draft.note.trim() });

  if (section === "consent") {
    for (const kind of CONSENT_KINDS) {
      const cur = d.consents.find((c) => c.kind === kind)?.status ?? "unconfirmed";
      if (draft.consents[kind] !== cur) out.push({ t: "consent", kind, status: draft.consents[kind] });
    }
  }
  return out;
}
