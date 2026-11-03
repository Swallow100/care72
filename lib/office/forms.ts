// 利用者追加とケアマネ追加の入力の読み方（D1 を使わない所）。画面（JSON）から来た値をそろえて確かめる。
//
// 利用者: 氏名・カナ・生年月日・性別・担当ケアマネの 5 つだけ（最小の項目）。続きは本人のページの入れる欄（T03）。
// - 氏名は空白をそろえるだけ（全角の空白も半角 1 つに）。40 字まで
// - カナはひらがな・半角カナもカタカナにそろえる（seed と同じ「ヤマダ ハナ」の形）。40 字まで
// - 生年月日は暦にある日で、1900 年から今日（JST）まで
// ケアマネ: 名前（20 字まで）と ID（英小文字・数字・「._-」の 3〜32 字。大文字・全角は小文字の半角にそろえる）。
// 初期パスワードは入力にしない（サーバーが作り、画面に 1 回だけ出す。lib/office/staff.ts）

import { isReservedLoginId } from "../auth/demo.ts";
import { SEXES, type Sex } from "../db/types.ts";
import type { PersonFormError, StaffFormError } from "./labels.ts";

export const NAME_MAX = 40;
export const KANA_MAX = 40;
export const DISPLAY_NAME_MAX = 20;
export const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// 制御文字（改行・タブを含む）は名前に入れない
const CONTROL = /[\u0000-\u001f\u007f]/;

export type PersonInput = { name: string; kana: string; birthDate: string; sex: Sex; careManagerId: string };
export type StaffInput = { displayName: string; loginId: string };

type Parsed<T, E> = { ok: true; value: T } | { ok: false; error: E };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** 空白をそろえる（全角の空白・続く空白を半角 1 つに、前後を落とす） */
export function tidySpaces(s: string): string {
  return s.replace(/[\s　]+/gu, " ").trim();
}

/** カナにそろえる: 半角カナ → 全角（NFKC）、ひらがな → カタカナ、空白をそろえる */
export function normalizeKana(s: string): string {
  const wide = s.normalize("NFKC");
  const kata = [...wide]
    .map((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
    })
    .join("");
  return tidySpaces(kata);
}

const KANA_ONLY = /^[ァ-ヶ・ー ]+$/u;

/** 暦にある日か（2026-02-30 は無い） */
export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 利用者追加の入力。today は JST の YYYY-MM-DD（先の生年月日を断る） */
export function parsePersonInput(raw: unknown, today: string): Parsed<PersonInput, PersonFormError | "invalid"> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid" };
  const o = raw as Record<string, unknown>;

  const name = tidySpaces(str(o.name).normalize("NFC"));
  if (!name || name.length > NAME_MAX || CONTROL.test(name)) return { ok: false, error: "name" };

  const kana = normalizeKana(str(o.kana));
  if (!kana || kana.length > KANA_MAX || !KANA_ONLY.test(kana)) return { ok: false, error: "kana" };

  const birthDate = str(o.birthDate).trim();
  if (!isCalendarDate(birthDate) || birthDate < "1900-01-01" || birthDate > today) return { ok: false, error: "birth" };

  const sex = str(o.sex);
  if (!(SEXES as readonly string[]).includes(sex)) return { ok: false, error: "sex" };

  const careManagerId = str(o.careManagerId);
  if (!ID.test(careManagerId)) return { ok: false, error: "care_manager" };

  return { ok: true, value: { name, kana, birthDate, sex: sex as Sex, careManagerId } };
}

/** ログインの ID にそろえる（全角 → 半角、大文字 → 小文字、前後の空白を落とす） */
export function normalizeLoginId(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

/** ケアマネの名前（追加と改名〔T61〕で同じ決まり）: NFC・空白をそろえる・20 字まで・制御文字なし。違えば null */
export function parseDisplayName(raw: unknown): string | null {
  const displayName = tidySpaces(str(raw).normalize("NFC"));
  if (!displayName || displayName.length > DISPLAY_NAME_MAX || CONTROL.test(displayName)) return null;
  return displayName;
}

/** ケアマネ追加の入力 */
export function parseStaffInput(raw: unknown): Parsed<StaffInput, StaffFormError | "invalid"> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid" };
  const o = raw as Record<string, unknown>;

  const displayName = parseDisplayName(o.displayName);
  if (displayName === null) return { ok: false, error: "display_name" };

  const loginId = normalizeLoginId(str(o.loginId));
  if (!LOGIN_ID_PATTERN.test(loginId) || isReservedLoginId(loginId)) return { ok: false, error: "login_id" };

  return { ok: true, value: { displayName, loginId } };
}
