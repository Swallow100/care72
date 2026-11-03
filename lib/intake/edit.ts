// 本人のページの面の「編集」（T45）。面ごとに今の値を入力欄の下書きにし、直した所だけを保存の変更にする。ブラウザで使う。
// 保存は /api/intake/save の edit（手の入力）: 埋まった欄・薬・機器・ハザード・連絡先・時計も上書きし（overwrite）、
// 同意と時計の頼り先の確認も変えられる。経過に「ケアマネが直した」。版の確かめは入れる欄の保存と同じ。
//
// 外す（設計の側の頼み「消す」）: 埋まった欄を空にする（選ぶ欄は「未確認」に戻す）と欄を外す。薬・機器・ハザード・特記・連絡先の行は
// 行の「外す」で印を付け、保存の前に確認の窓（components/person/SectionEdit.tsx）。外す行のほかの直しは送らない。
// 薬の回数・用量・保管・機器の中身・連絡先の文字は空にすると消える（行は残る）。
// 時計の「値確認」（設計の側の頼み「確かめた」）: 値を変えずに今日確かめたと残す（clockSeen）。値か単位を直したときは直しの方で確認の日付が今になる。

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
  DependsOn,
  DeviceKind,
  HazardKind,
  Ledger,
  MedicationCategory,
} from "../db/types.ts";
import { CLOCK_CATEGORIES, CONSENT_KINDS } from "../db/types.ts";
import { sameMedication } from "../db/ledger.ts";
import { CONTACT_KIND_LABELS, DEVICE_LABELS, HAZARD_LABELS } from "../labels.ts";
import { DEVICE_CLOCKS } from "./marks.ts";
import type { ContactValue, IntakeChange, RemoveTarget } from "./changes.ts";
import { INTAKE_FIELDS, isFilled, ledgerValue, normalizeValue, type IntakeSection } from "./fields.ts";

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
    /** 緊急連絡先の順・避難支援等実施者の順（T57）。人が決める */
    emergency_order: number | null;
    supporter_order: number | null;
    /** どこにいる人か（同居・近所・市内・県外・遠方）。T57 */
    reach: ContactReach | null;
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
    /** 値を最後に確かめた時刻（ISO）。無ければ null */
    confirmed_at: string | null;
    /** 走り出すきっかけ（停電・発災・走らない）。T57 */
    starts_on: ClockStart;
    source: ClockSource | null;
    source_note: string | null;
  }>;
  consents: Array<{ kind: ConsentKind; status: ConsentStatus }>;
};

/** 連絡先の夜間の欄（空は未確認） */
export type NightDraft = "" | "yes" | "no";

/** 緊急・支援の順の欄（空は順なし。数字の文字） */
export type OrderDraft = string;

/** 画面で選べる順（今の値がこれより大きければ、その値も選べるように出す） */
export const CONTACT_ORDERS = [1, 2, 3] as const;

export type ContactDraft = {
  id: string | null;
  kind: Exclude<ContactKind, "self">;
  relation: string;
  name: string;
  phone: string;
  night: NightDraft;
  note: string;
  /** 緊急連絡先の順・支援者の順（T57） */
  emergency: OrderDraft;
  supporter: OrderDraft;
  /** 距離（空は未確認） */
  reach: ContactReach | "";
};
/** 走る時計の起点（停電・発災）。走らない状態の時計（condition）は足せず、起点も none のまま */
export type RunningStart = Exclude<ClockStart, "none">;
/** 手で足す時計の区分（状態 condition は足せない） */
export type AddableClockKind = Exclude<ClockKind, "condition">;
/** 手で足す時計の「何で決まるか」（認知症は台帳の印から作るので足せない） */
export const ADDABLE_CLOCK_CATEGORIES = CLOCK_CATEGORIES.filter((c) => c !== "dementia");

/** 手で足す時計の下書き（T57）。値が空なら未確認（単位も持たない） */
export type ClockDraft = {
  label: string;
  kind: AddableClockKind;
  category: Exclude<ClockCategory, "dementia">;
  value: string;
  unit: ClockUnit;
  start: RunningStart;
  /** 出典（空は無し）と書き足し */
  source: ClockSource | "";
  sourceNote: string;
};

export const blankClock = (): ClockDraft => ({
  label: "",
  kind: "supply",
  category: "other",
  value: "",
  unit: "day",
  start: "disaster",
  source: "",
  sourceNote: "",
});

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
  /** 足すその他の機器の名前（T57。その他を選んだときだけ使う） */
  newDeviceDetail: string;
  /** 今のハザードの浸水の深さ（m、文字）と、足すハザード */
  hazards: Array<{ kind: HazardKind; depth: string; note: string }>;
  newHazards: HazardKind[];
  /** 足すその他のハザードの書き足し（T57。その他を選んだときだけ使う） */
  newHazardNote: string;
  /** 今の連絡先（本人の行を除く）と、足す連絡先 */
  contacts: ContactDraft[];
  newContacts: ContactDraft[];
  /** 時計の値（文字）と単位と起点。走らない状態の時計（condition）は除く */
  clocks: Array<{ id: string; label: string; value: string; unit: ClockUnit; start: RunningStart }>;
  /** 手で足す時計（T57） */
  newClocks: ClockDraft[];
  /** 時計の頼り先の確認（頼り先のある時計だけ） */
  checks: Record<string, CheckStatus>;
  consents: Record<ConsentKind, ConsentStatus>;
  /** 足す特記 */
  note: string;
  /** 外す印を付けた行（dropKey の形: med:0・device:oxygen・hazard:flood・contact:c-01-2・note:0） */
  drops: string[];
  /** 値を今日確かめた時計の id（値・単位は変えない） */
  seen: string[];
};

/** 外す印の鍵 */
export const dropKey = {
  med: (index: number) => `med:${index}`,
  device: (kind: DeviceKind) => `device:${kind}`,
  hazard: (kind: HazardKind) => `hazard:${kind}`,
  contact: (id: string) => `contact:${id}`,
  clock: (id: string) => `clock:${id}`,
  note: (index: number) => `note:${index}`,
} as const;

/** 印を付ける・外す（外す印と値確認の両方） */
export function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

/** 空にした（未確認に戻した）か。文字は空白だけ、配列は空 */
function emptyDraft(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const s = (v: string | null | undefined) => v ?? "";

export const blankMed = (): MedDraft => ({ name: "", category: "other", schedule: "", amount: "", storage: "" });
export const blankContact = (): ContactDraft => ({
  id: null,
  kind: "family",
  relation: "",
  name: "",
  phone: "",
  night: "",
  note: "",
  emergency: "",
  supporter: "",
  reach: "",
});

const orderDraft = (n: number | null): OrderDraft => (n == null ? "" : String(n));
const orderOf = (v: OrderDraft): number | null => (v.trim() === "" ? null : Number(v));

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
    newDeviceDetail: "",
    hazards: l.evacuation.hazards.map((h) => ({ kind: h.kind, depth: h.depthM != null ? String(h.depthM) : "", note: s(h.note) })),
    newHazards: [],
    newHazardNote: "",
    contacts: d.contacts.flatMap((c): ContactDraft[] =>
      c.kind === "self"
        ? []
        : [
            {
              id: c.id,
              kind: c.kind,
              relation: s(c.relation),
              name: s(c.name),
              phone: s(c.phone),
              night: c.night_ok === 1 ? "yes" : c.night_ok === 0 ? "no" : "",
              note: s(c.note),
              emergency: orderDraft(c.emergency_order),
              supporter: orderDraft(c.supporter_order),
              reach: c.reach ?? "",
            },
          ],
    ),
    newContacts: [],
    clocks: d.clocks
      .filter((k) => k.kind !== "condition")
      .map((k) => ({
        id: k.id,
        label: k.label,
        value: k.value != null ? String(k.value) : "",
        unit: k.unit ?? (k.kind === "device" ? "hour" : "day"),
        start: k.starts_on === "outage" ? "outage" : "disaster",
      })),
    newClocks: [],
    checks: Object.fromEntries(d.clocks.filter((k) => k.depends_on && k.depends_check).map((k) => [k.id, k.depends_check as CheckStatus])),
    consents,
    note: "",
    drops: [],
    seen: [],
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

/** 外す薬・機器に付いた時計か（サーバーの lib/intake/save.ts の planRemovals と同じ当て方） */
function clockGone(k: EditData["clocks"][number], l: Ledger, drops: readonly string[]): boolean {
  return drops.some((key) => {
    const [what, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (what === "device") {
      const spec = DEVICE_CLOCKS[rest as DeviceKind];
      return !!spec && (k.kind === "device" || k.kind === "supply") && k.category === spec.category;
    }
    if (what === "med") {
      const med = l.medical.medications[Number(rest)];
      return !!med && k.kind !== "device" && k.kind !== "condition" && sameMedication(k.label, med.name);
    }
    return false;
  });
}

/** 外す物の名前（確認の窓の文）。欄は欄の名前、行は薬・連絡先などの名前 */
export function removalNames(changes: ReadonlyArray<IntakeChange>, d: EditData): string[] {
  const names: string[] = [];
  for (const c of changes) {
    if (c.t !== "remove") continue;
    const r = c.target;
    switch (r.what) {
      case "field":
        names.push(INTAKE_FIELDS.find((f) => f.key === r.key)?.label ?? r.key);
        break;
      case "medication":
        names.push(r.name);
        break;
      case "device":
        names.push(DEVICE_LABELS[r.kind]);
        break;
      case "hazard":
        names.push(HAZARD_LABELS[r.kind]);
        break;
      case "note":
        names.push(r.value.length > 12 ? `${r.value.slice(0, 12)}…` : r.value);
        break;
      case "contact": {
        const cur = d.contacts.find((x) => x.id === r.id);
        names.push(cur?.relation || cur?.name || "連絡先");
        break;
      }
      case "clock":
        names.push(d.clocks.find((x) => x.id === r.id)?.label ?? "時計");
        break;
    }
  }
  return names;
}

/** 足す連絡先を送るか（何か書いたか） */
function newContactFilled(c: ContactDraft): boolean {
  return [c.relation, c.name, c.phone, c.note].some((x) => x.trim() !== "");
}

/** 順の重なり（同じ緊急・支援の順を 2 人に付けた）。外す行と送らない空の行は数えない。保存（lib/intake/save.ts）も同じ物を断る */
export type OrderClash = { emergency: number[]; supporter: number[] };

export function orderClash(draft: Pick<EditDraft, "contacts" | "newContacts" | "drops">): OrderClash {
  const live = [
    ...draft.contacts.filter((c) => !(c.id && draft.drops.includes(dropKey.contact(c.id)))),
    ...draft.newContacts.filter(newContactFilled),
  ];
  const twice = (pick: (c: ContactDraft) => number | null) => {
    const seen = new Set<number>();
    const out = new Set<number>();
    for (const c of live) {
      const n = pick(c);
      if (n === null) continue;
      if (seen.has(n)) out.add(n);
      seen.add(n);
    }
    return [...out].sort((a, b) => a - b);
  };
  return { emergency: twice((c) => orderOf(c.emergency)), supporter: twice((c) => orderOf(c.supporter)) };
}

/**
 * 保存の前に止める空欄（T57）。「その他」の種類だけでは何か分からないので、連絡先のその他は続柄（間柄）、
 * 機器のその他は中身（名前）を書くまで保存しない。保存の batch は丸ごと通るか落ちるかなので、サーバーで断らず画面で止める。
 * 返すのは欄の名前（「その他 続柄」）。外す行と送らない空の行は見ない
 */
export function editBlockers(section: EditSection, draft: EditDraft): string[] {
  const out: string[] = [];
  if (section === "people") {
    const live = [
      ...draft.contacts.filter((c) => !(c.id && draft.drops.includes(dropKey.contact(c.id)))),
      ...draft.newContacts.filter(newContactFilled),
    ];
    if (live.some((c) => c.kind === "other" && c.relation.trim() === "")) out.push(`${CONTACT_KIND_LABELS.other} 続柄`);
  }
  if (section === "medical") {
    const other = [...draft.devices.filter((x) => !draft.drops.includes(dropKey.device(x.kind))), ...draft.newDevices.map((kind) => ({ kind, detail: "" }))].find(
      (x) => x.kind === "other",
    );
    const fresh = draft.newDevices.includes("other") ? draft.newDeviceDetail : other?.detail;
    if (other && (fresh ?? "").trim() === "") out.push(`${DEVICE_LABELS.other} 名前`);
    // 足す時計で値や出典を書いたのに名前が空（名前の無い時計は送らない）
    if (draft.newClocks.some((k) => !k.label.trim() && (k.value.trim() !== "" || k.sourceNote.trim() !== ""))) out.push("時計 名前");
    // 足す時計の値が数でない
    if (draft.newClocks.some((k) => k.label.trim() && k.value.trim() !== "" && numberOf(k.value) === null)) out.push("時計 値");
  }
  return out;
}

const nightOf =(n: NightDraft): boolean | null => (n === "yes" ? true : n === "no" ? false : null);

/** 面の下書きから、直した所だけの変更を作る */
export function editChanges(section: EditSection, d: EditData, draft: EditDraft): IntakeChange[] {
  const out: IntakeChange[] = [];
  const l = d.ledger;

  const dropped = (key: string) => draft.drops.includes(key);
  const remove = (target: RemoveTarget) => out.push({ t: "remove", target });

  // 欄の表の欄（この面の物）。埋まった欄を空にしたら外す。形の合わない値は送らない
  if (section !== "consent") {
    for (const f of INTAKE_FIELDS) {
      if (f.section !== (section as IntakeSection)) continue;
      const cur = ledgerValue(l, f.key);
      const raw = draft.values[f.key];
      if (same(raw, cur)) continue;
      if (emptyDraft(raw)) {
        if (isFilled(cur) && !emptyDraft(cur)) remove({ what: "field", key: f.key });
        continue;
      }
      const value = normalizeValue(f, raw);
      if (value === null || same(value, cur)) continue;
      out.push({ t: "field", key: f.key, value, overwrite: true });
    }
  }

  if (section === "medical") {
    draft.meds.forEach((m, index) => {
      const cur = l.medical.medications[index];
      if (!cur) return;
      if (dropped(dropKey.med(index))) return remove({ what: "medication", index, name: cur.name });
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
      if (cur && dropped(dropKey.device(x.kind))) return remove({ what: "device", kind: x.kind });
      if (!cur || (s(cur.detail) === x.detail.trim() && s(cur.schedule) === x.schedule.trim())) return;
      out.push({ t: "device", value: { kind: x.kind, detail: x.detail.trim(), schedule: x.schedule.trim() }, overwrite: true });
    });
    for (const kind of draft.newDevices) {
      if (l.medical.devices.some((c) => c.kind === kind)) continue;
      // その他の機器は名前（中身）を付けて足す。名前が空なら editBlockers が保存を止める
      if (kind === "other") {
        const detail = draft.newDeviceDetail.trim();
        if (detail) out.push({ t: "device", value: { kind, detail } });
        continue;
      }
      out.push({ t: "device", value: { kind } });
    }
    for (const k of draft.clocks) {
      const cur = d.clocks.find((c) => c.id === k.id);
      // 外す薬・機器の時計はサーバーが消すので、その時計の直し・値確認は送らない
      if (!cur || clockGone(cur, l, draft.drops)) continue;
      // 時計だけを外す（手で足した時計など。印の時計は外せない: lib/intake/marks.ts の markClockIds）
      if (dropped(dropKey.clock(cur.id))) {
        remove({ what: "clock", id: cur.id });
        continue;
      }
      // 起点（停電・発災）。走らない状態の時計は draft.clocks に無い
      if (cur.starts_on !== "none" && cur.starts_on !== k.start) out.push({ t: "clockStart", clockId: cur.id, to: k.start });
      const n = numberOf(k.value);
      if (n !== null && !(cur.value === n && cur.unit === k.unit)) {
        out.push({ t: "clock", clockId: k.id, medIndex: null, label: cur.label, value: n, unit: k.unit, overwrite: true });
        continue;
      }
      // 値を変えずに今日確かめた（値の無い時計は確かめる物が無い）
      if (draft.seen.includes(k.id) && cur.value != null) out.push({ t: "clockSeen", clockId: k.id });
    }
    for (const k of draft.newClocks) {
      const label = k.label.trim();
      if (!label) continue;
      const n = numberOf(k.value);
      out.push({
        t: "clockAdd",
        value: {
          label,
          kind: k.kind,
          category: k.category,
          value: n,
          unit: n === null ? null : k.unit,
          startsOn: k.start,
          source: k.source === "" ? null : k.source,
          ...(k.sourceNote.trim() ? { sourceNote: k.sourceNote.trim() } : {}),
        },
      });
    }
    for (const [clockId, to] of Object.entries(draft.checks)) {
      const cur = d.clocks.find((c) => c.id === clockId);
      if (cur?.depends_on && cur.depends_check !== to) out.push({ t: "clockCheck", clockId, to });
    }
  }

  if (section === "evacuation") {
    for (const h of draft.hazards) {
      const cur = l.evacuation.hazards.find((c) => c.kind === h.kind);
      if (cur && dropped(dropKey.hazard(h.kind))) {
        remove({ what: "hazard", kind: h.kind });
        continue;
      }
      const n =h.depth.trim() === "" ? undefined : (numberOf(h.depth) ?? undefined);
      const note = h.note.trim();
      if (!cur || (h.depth.trim() !== "" && n === undefined)) continue;
      if (cur.depthM === n && s(cur.note) === note) continue;
      out.push({
        t: "hazard",
        value: { kind: h.kind, ...(n !== undefined ? { depthM: n } : {}), ...(note ? { note } : {}) },
        overwrite: true,
      });
    }
    for (const kind of draft.newHazards) {
      if (l.evacuation.hazards.some((c) => c.kind === kind)) continue;
      const note = kind === "other" ? draft.newHazardNote.trim() : "";
      out.push({ t: "hazard", value: note ? { kind, note } : { kind } });
    }
  }

  if (section === "people") {
    for (const c of draft.contacts) {
      const cur = d.contacts.find((x) => x.id === c.id);
      if (!cur || cur.kind === "self") continue;
      if (dropped(dropKey.contact(cur.id))) {
        remove({ what: "contact", id: cur.id });
        continue;
      }
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
      const emergency = orderOf(c.emergency);
      if (emergency !== cur.emergency_order) {
        value.emergencyOrder = emergency;
        changed = true;
      }
      const supporter = orderOf(c.supporter);
      if (supporter !== cur.supporter_order) {
        value.supporterOrder = supporter;
        changed = true;
      }
      const reach = c.reach === "" ? null : c.reach;
      if (reach !== cur.reach) {
        value.reach = reach;
        changed = true;
      }
      if (changed) out.push({ t: "contact", id: cur.id, value, overwrite: true });
    }
    for (const c of draft.newContacts) {
      if (!newContactFilled(c)) continue;
      const night = nightOf(c.night);
      const emergency = orderOf(c.emergency);
      const supporter = orderOf(c.supporter);
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
          ...(emergency !== null ? { emergencyOrder: emergency } : {}),
          ...(supporter !== null ? { supporterOrder: supporter } : {}),
          ...(c.reach !== "" ? { reach: c.reach } : {}),
        },
      });
    }
  }

  if (section === "basic") {
    l.notes.forEach((value, index) => {
      if (dropped(dropKey.note(index))) remove({ what: "note", value });
    });
    if (draft.note.trim()) out.push({ t: "note", value: draft.note.trim() });
  }

  if (section === "consent") {
    for (const kind of CONSENT_KINDS) {
      const cur = d.consents.find((c) => c.kind === kind)?.status ?? "unconfirmed";
      if (draft.consents[kind] !== cur) out.push({ t: "consent", kind, status: draft.consents[kind] });
    }
  }
  return out;
}
