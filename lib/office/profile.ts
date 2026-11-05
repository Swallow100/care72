// 事業所の情報（docs/tasks/T148.md の 1）: 事業所名・所在地・電話・FAX・事業所番号。事業所の画面（/office）の「事業所」の区分で直す
// （components/office/OfficeProfile.tsx、保存は app/office/profile のフォームの POST）。
// - 事業所名（offices.name）は計画書・様式 9・本人の 1 枚・医療要約・様式の対応表の事業所名の欄が前から読む（officeName）。
//   ヘッダーの事業所名・役の Principal も次の要求から新しい名前（lib/auth/principal.ts が offices を毎回読む）
// - 所在地・電話・FAX・事業所番号（migration 0036）は区分に出す。紙のどの欄に置くかは問い（docs/progress/t148.md）
// 書けるのは地域と同じ人（lib/office/scope.ts の officeActor.placeEdit: 事業所の管理者と、試用事業所の審査員）。
// デモ事業所の審査員は見るだけ（皆で 1 つの事業所なので、1 人が名前を変えると次の審査員の画面が変わる）。
// 事業所の経過には残さない（office_timeline_entries の kind の CHECK を広げるには表の建て直しが要る。地域〔T68〕と同じ）。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { tidySpaces } from "./forms.ts";
import { officeActor } from "./scope.ts";

export const OFFICE_PROFILE_PATH = "/office/profile";
export const OFFICE_PROFILE_ANCHOR = "office-profile";

export const OFFICE_NAME_MAX = 40;
export const ADDRESS_MAX = 80;
export const PHONE_MAX = 20;
export const OFFICE_NUMBER_LENGTH = 10;

export type OfficeProfile = {
  name: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
  /** 介護保険の事業所番号（数字 10 桁） */
  number: string | null;
};

/** 入れた値の誤り（どの欄か。画面は欄の名前と「不正」） */
export const PROFILE_ERRORS = ["name", "address", "phone", "fax", "number"] as const;
export type ProfileError = (typeof PROFILE_ERRORS)[number];

/** 画面の言葉（2〜4 字の漢語） */
export const PROFILE_LABELS = {
  title: "事業所",
  name: "名称",
  address: "所在地",
  phone: "電話",
  fax: "FAX",
  number: "事業所番号",
  save: "保存",
  none: "未入力",
  saved: "保存済",
  bad: "不正",
} as const;

/** 断ったときに戻す印（/office?profile_error=phone） */
export const PROFILE_ERROR_PARAM = "profile_error";

// 制御文字（改行・タブを含む）は入れない
const CONTROL = /[\u0000-\u001f\u007f]/;
/** 電話・FAX: 数字・ハイフン・括弧・空白（NFKC で全角を半角に、いろいろな横棒をハイフンに）。数字は 6〜15 字 */
const PHONE_CHARS = /^[0-9()\- ]+$/;
const DASHES = /[‐‑‒–—―−ーｰ]/g;

export async function loadOfficeProfile(db: D1Database, officeId: string): Promise<OfficeProfile | null> {
  const r = await db
    .prepare("SELECT name, address, phone, fax, office_number FROM offices WHERE id = ?1")
    .bind(officeId)
    .first<{ name: string; address: string | null; phone: string | null; fax: string | null; office_number: string | null }>();
  return r ? { name: r.name, address: r.address, phone: r.phone, fax: r.fax, number: r.office_number } : null;
}

type FormLike = { get(name: string): unknown } | null;

const text = (form: NonNullable<FormLike>, k: string): string => {
  const v = form.get(k);
  return typeof v === "string" ? v : "";
};

/** 電話・FAX の形にそろえる。空なら null、形が違えば undefined */
export function normalizePhone(raw: string): string | null | undefined {
  const v = tidySpaces(raw.normalize("NFKC").replace(DASHES, "-"));
  if (v === "") return null;
  if (v.length > PHONE_MAX || !PHONE_CHARS.test(v)) return undefined;
  const digits = v.replace(/[^0-9]/g, "").length;
  return digits >= 6 && digits <= 15 ? v : undefined;
}

/** 事業所番号の形にそろえる（NFKC・空白とハイフンを落とす）。空なら null、数字 10 桁でなければ undefined */
export function normalizeOfficeNumber(raw: string): string | null | undefined {
  const v = raw.normalize("NFKC").replace(DASHES, "-").replace(/[\s-]/g, "");
  if (v === "") return null;
  return new RegExp(`^[0-9]{${OFFICE_NUMBER_LENGTH}}$`).test(v) ? v : undefined;
}

/**
 * フォームの中身（name・address・phone・fax・number）を読む。名称は空を断る（40 字まで）。所在地は 80 字まで（空は未入力）。
 * 電話・FAX は数字 6〜15 字（数字・ハイフン・括弧・空白、20 字まで）、事業所番号は数字 10 桁。空は未入力
 */
export function parseProfileForm(form: FormLike): { ok: true; value: OfficeProfile } | { ok: false; error: ProfileError } {
  if (!form) return { ok: false, error: "name" };
  const name = tidySpaces(text(form, "name").normalize("NFC"));
  if (!name || [...name].length > OFFICE_NAME_MAX || CONTROL.test(name)) return { ok: false, error: "name" };
  const addr = tidySpaces(text(form, "address").normalize("NFC"));
  if ([...addr].length > ADDRESS_MAX || CONTROL.test(addr)) return { ok: false, error: "address" };
  const phone = normalizePhone(text(form, "phone"));
  if (phone === undefined) return { ok: false, error: "phone" };
  const fax = normalizePhone(text(form, "fax"));
  if (fax === undefined) return { ok: false, error: "fax" };
  const number = normalizeOfficeNumber(text(form, "number"));
  if (number === undefined) return { ok: false, error: "number" };
  return { ok: true, value: { name, address: addr || null, phone, fax, number } };
}

export type SaveProfileResult = { ok: true } | { ok: false; error: "forbidden" };

/** 事業所の情報を書く。地域と同じ人だけ（管理者・試用事業所の審査員。デモ事業所の審査員は断る） */
export async function saveProfile(db: D1Database, p: Principal | null, value: OfficeProfile): Promise<SaveProfileResult> {
  const actor = officeActor(p);
  if (!actor?.placeEdit) return { ok: false, error: "forbidden" };
  await db
    .prepare("UPDATE offices SET name = ?1, address = ?2, phone = ?3, fax = ?4, office_number = ?5 WHERE id = ?6")
    .bind(value.name, value.address, value.phone, value.fax, value.number, actor.officeId)
    .run();
  return { ok: true };
}

export type ProfilePostOutcome = { status: 401 } | { status: 403 } | { status: 303; location: string };

/** 「事業所」の保存（フォームの POST）。ログイン → 権限 → 形 の順に断る。戻り先は事業所の画面の区分 */
export async function profilePost(db: D1Database, p: Principal | null, form: FormLike): Promise<ProfilePostOutcome> {
  if (!p) return { status: 401 };
  if (!officeActor(p)?.placeEdit) return { status: 403 };
  const parsed = parseProfileForm(form);
  if (!parsed.ok) return { status: 303, location: `/office?${PROFILE_ERROR_PARAM}=${parsed.error}#${OFFICE_PROFILE_ANCHOR}` };
  const r = await saveProfile(db, p, parsed.value);
  if (!r.ok) return { status: 403 };
  return { status: 303, location: `/office#${OFFICE_PROFILE_ANCHOR}` };
}

/** 戻り先の profile_error を読む。形が違えば null */
export function parseProfileError(v: unknown): ProfileError | null {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && (PROFILE_ERRORS as readonly string[]).includes(x) ? (x as ProfileError) : null;
}
