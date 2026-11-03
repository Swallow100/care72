// 入れる欄の「写真・PDF を読む」の送る形（T52）。ブラウザ（components/person/Intake.tsx）とサーバー（app/api/intake/read）の両方が使う。
//
// 写真・PDF は黒塗りの画面（components/person/RedactSheet.tsx）を必ず通り、送るのは塗った後の画像（canvas の JPEG、付け足しを外した物）だけ。
// サーバーはこの形の物だけを受ける: 欄の名前が image（前の file＝生の写真・PDF は断る）、中身が JPEG、EXIF・XMP・コメントが無い、
// 黒塗りの画面の印（source・page・redacted）がある。PDF の生のファイル・PNG・付け足しのある JPEG は「未加工」で断る。
// 1 要求 1 枚（PDF は頁ごとに 1 要求）。大きさの上限は様式の読み取りと同じ（FORM_FILE_MAX_BYTES）。
// ブラウザも読むので、サーバーだけの物（中身の確かめ、node:buffer）は lib/intake/read-check.ts に置く。


export const READ_SOURCES = ["photo", "pdf"] as const;
export type ReadSource = (typeof READ_SOURCES)[number];

/** PDF から画像にする頁の上限（1 頁 1 要求 1 回。ai_calls の 1 日の上限を食いすぎない） */
export const PDF_PAGES_MAX = 3;
/** 1 回に選べる写真・PDF の数 */
export const READ_FILES_MAX = 5;
/** 1 頁に塗れる四角の数の上限（送る印の検査） */
export const REDACTED_MAX = 500;

/** 黒塗りの画面を通った印。経過に「写真を読んだ（隠した所 N か所）」と残す元 */
export type ReadMeta = { source: ReadSource; page: number; redacted: number };

/** 送る形の欄の名前 */
export const READ_FORM = { personId: "personId", image: "image", source: "source", page: "page", redacted: "redacted" } as const;
/** 前の形（T45）の欄。生の写真・PDF なので、来たら断る */
export const RAW_FILE_FIELD = "file";

const int = (v: FormDataEntryValue | null, min: number, max: number): number | null => {
  if (typeof v !== "string" || !/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

/** 黒塗りの画面の印を読む。無い・形が違えば null */
export function readMetaOf(form: FormData): ReadMeta | null {
  const source = form.get(READ_FORM.source);
  if (typeof source !== "string" || !(READ_SOURCES as readonly string[]).includes(source)) return null;
  const page = int(form.get(READ_FORM.page), 1, source === "pdf" ? PDF_PAGES_MAX : 1);
  const redacted = int(form.get(READ_FORM.redacted), 0, REDACTED_MAX);
  if (page === null || redacted === null) return null;
  return { source: source as ReadSource, page, redacted };
}

/** ブラウザで送る形を作る */
export function buildReadForm(personId: string, image: Blob, meta: ReadMeta): FormData {
  const form = new FormData();
  form.set(READ_FORM.personId, personId);
  form.set(READ_FORM.source, meta.source);
  form.set(READ_FORM.page, String(meta.page));
  form.set(READ_FORM.redacted, String(meta.redacted));
  form.set(READ_FORM.image, image, "redacted.jpg");
  return form;
}

/** 経過の本文の頭（「写真を読んだ（隠した所 3 か所）」「PDF を読んだ（2 頁目・隠した所 1 か所）」） */
export function readTimelineHead(meta: ReadMeta): string {
  const what = meta.source === "pdf" ? `PDF を読んだ（${meta.page} 頁目・` : "写真を読んだ（";
  return `${what}隠した所 ${meta.redacted} か所）`;
}
