// 受け持ちの入力の読み方（D1 を使わない所）。画面（JSON・フォーム）から来た値をそろえて確かめる。
//
// - 避難所: 空白をそろえて 1〜40 字（必須）
// - 検索: 氏名・カナ（ひらがな・半角カナはカタカナに、空白を除く）と生年月日。生年月日か、氏名・カナ 2 字以上のどちらかが要る
//   （全件を返さない）
// - その場で登録: 氏名・カナ（必須）・年齢か生年月日（どちらか）・薬（1 行 1 つ、20 まで）・機器（選ぶ。その他は名前が要る。T64）・
//   連絡先（続柄・氏名・電話、任意）

import { DEVICE_KINDS, RELEASE_KINDS, type DeviceKind, type ReleaseKind } from "../db/types.ts";
import { isCalendarDate, KANA_MAX, NAME_MAX, normalizeKana, tidySpaces } from "../office/forms.ts";
import type { CustodyError } from "./labels.ts";

export const SHELTER_MAX = 40;
export const NOTE_MAX = 40;
export const MED_MAX = 40;
export const MEDS_MAX = 20;
export const QUERY_MIN = 2;
/** 機器の「その他」の名前（1 行。T64） */
export const DEVICE_NAME_MAX = 40;

const CONTROL = /[\u0000-\u001f\u007f]/;
const KANA_ONLY = /^[ァ-ヶ・ー ]+$/u;
const PHONE = /^[0-9+][0-9-]{5,19}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: CustodyError };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** 1 行の文字（空白をそろえ、制御文字を断る）。max を超えたら null */
function line(v: unknown, max: number): string | null {
  const s = tidySpaces(str(v).normalize("NFC"));
  if (s.length > max || CONTROL.test(s)) return null;
  return s;
}

export function parseShelter(v: unknown): Parsed<string> {
  const s = line(v, SHELTER_MAX);
  return s ? { ok: true, value: s } : { ok: false, error: "shelter" };
}

export function isId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}

/** 検索の文字: NFKC → カタカナ → 空白を除く */
export function searchKey(s: string): string {
  return normalizeKana(s).replace(/\s/g, "");
}

export type SearchInput = { text: string; birth: string | null };

export function parseSearch(raw: unknown, today: string): Parsed<SearchInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid" };
  const o = raw as Record<string, unknown>;
  const text = searchKey(str(o.text).slice(0, NAME_MAX * 2));
  if (CONTROL.test(text) || text.length > NAME_MAX) return { ok: false, error: "query" };
  const b = str(o.birth).trim();
  let birth: string | null = null;
  if (b) {
    if (!isCalendarDate(b) || b < "1900-01-01" || b > today) return { ok: false, error: "birth" };
    birth = b;
  }
  if (!birth && text.length < QUERY_MIN) return { ok: false, error: "query" };
  return { ok: true, value: { text, birth } };
}

export type OnSiteDevice = { kind: DeviceKind; detail?: string };

/**
 * 機器の並びを読む。1 つは種類の文字（前の形）か { kind, detail }。並びは DEVICE_KINDS の順で重ねない。
 * その他は名前（1 行 40 字）が要り、空なら device（名前が無いと何か分からない。T57 の編集と同じ）。ほかの種類の名前は落とす
 */
export function parseDevices(raw: unknown): Parsed<OnSiteDevice[]> {
  const items = Array.isArray(raw) ? raw : [];
  const picked = new Map<DeviceKind, string>();
  for (const it of items) {
    const o = typeof it === "string" ? { kind: it } : typeof it === "object" && it !== null ? (it as Record<string, unknown>) : null;
    if (!o || !(DEVICE_KINDS as readonly unknown[]).includes(o.kind)) return { ok: false, error: "invalid" };
    const kind = o.kind as DeviceKind;
    const detail = o.detail === undefined || o.detail === null ? "" : line(o.detail, DEVICE_NAME_MAX);
    if (detail === null) return { ok: false, error: "invalid" };
    // 同じ種類が 2 回来たら、名前のある方を残す
    if (!picked.has(kind) || (!picked.get(kind) && detail)) picked.set(kind, detail);
  }
  const devices: OnSiteDevice[] = [];
  for (const kind of DEVICE_KINDS) {
    if (!picked.has(kind)) continue;
    if (kind !== "other") {
      devices.push({ kind });
      continue;
    }
    const detail = picked.get(kind)!;
    if (!detail) return { ok: false, error: "device" };
    devices.push({ kind, detail });
  }
  return { ok: true, value: devices };
}

export type OnSiteInput = {
  name: string;
  kana: string;
  /** 申告の年齢（生年月日が無いとき） */
  age: number | null;
  birthDate: string | null;
  medications: string[];
  /** 機器。名前（detail）は その他 だけが持ち、ほかの種類は落とす */
  devices: OnSiteDevice[];
  contact: { relation: string | null; name: string | null; phone: string | null } | null;
  shelter: string;
};

export function parseOnSite(raw: unknown, today: string): Parsed<OnSiteInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid" };
  const o = raw as Record<string, unknown>;

  const name = line(o.name, NAME_MAX);
  if (!name) return { ok: false, error: "name" };
  const kana = normalizeKana(str(o.kana));
  if (!kana || kana.length > KANA_MAX || !KANA_ONLY.test(kana)) return { ok: false, error: "kana" };

  const b = str(o.birthDate).trim();
  let birthDate: string | null = null;
  if (b) {
    if (!isCalendarDate(b) || b < "1900-01-01" || b > today) return { ok: false, error: "birth" };
    birthDate = b;
  }
  const a = str(typeof o.age === "number" ? String(o.age) : o.age).normalize("NFKC").trim();
  let age: number | null = null;
  if (a) {
    if (!/^\d{1,3}$/.test(a) || Number(a) > 130) return { ok: false, error: "age" };
    age = Number(a);
  }
  if (birthDate === null && age === null) return { ok: false, error: "age" };

  const medsRaw = Array.isArray(o.medications) ? o.medications : str(o.medications).split(/\r?\n/);
  const medications: string[] = [];
  for (const m of medsRaw) {
    const s = line(m, MED_MAX);
    if (s === null) return { ok: false, error: "invalid" };
    if (s && !medications.includes(s)) medications.push(s);
  }
  if (medications.length > MEDS_MAX) return { ok: false, error: "invalid" };

  const parsedDevices = parseDevices(o.devices);
  if (!parsedDevices.ok) return parsedDevices;
  const devices = parsedDevices.value;

  let contact: OnSiteInput["contact"] = null;
  if (typeof o.contact === "object" && o.contact !== null) {
    const c = o.contact as Record<string, unknown>;
    const relation = line(c.relation, 20);
    const cname = line(c.name, NAME_MAX);
    const phoneRaw = str(c.phone).normalize("NFKC").replace(/\s/g, "");
    if (relation === null || cname === null) return { ok: false, error: "invalid" };
    if (phoneRaw && !PHONE.test(phoneRaw)) return { ok: false, error: "phone" };
    if (relation || cname || phoneRaw) contact = { relation: relation || null, name: cname || null, phone: phoneRaw || null };
  }

  const shelter = parseShelter(o.shelter);
  if (!shelter.ok) return shelter;

  return { ok: true, value: { name, kana, age, birthDate, medications, devices, contact, shelter: shelter.value } };
}

export type ReleaseInput = { custodyId: string; kind: ReleaseKind; note: string | null };

export function parseRelease(raw: unknown): Parsed<ReleaseInput> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid" };
  const o = raw as Record<string, unknown>;
  if (!isId(o.custodyId)) return { ok: false, error: "invalid" };
  const kind = str(o.kind);
  if (!(RELEASE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "invalid" };
  const note = line(o.note, NOTE_MAX);
  if (note === null) return { ok: false, error: "invalid" };
  return { ok: true, value: { custodyId: o.custodyId, kind: kind as ReleaseKind, note: note || null } };
}
