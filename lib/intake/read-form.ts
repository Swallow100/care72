// 入れる欄の「写真・PDF を読む」の送る形（T52）。ブラウザ（components/person/Intake.tsx）とサーバー（app/api/intake/read）の両方が使う。
//
// 写真・PDF は黒塗りの画面（components/person/RedactSheet.tsx）を必ず通り、送るのは塗った後の画像（canvas の JPEG、付け足しを外した物）だけ。
// サーバーはこの形の物だけを受ける: 欄の名前が image（前の file＝生の写真・PDF は断る）、中身が JPEG、EXIF・XMP・コメントが無い、
// 黒塗りの画面の印（source・page・redacted）がある。PDF の生のファイル・PNG・付け足しのある JPEG は「未加工」で断る。
// 隠した所 0 の頁は、人が確かめの窓（RedactSheet の「塗り無し」）で「送信」を選んだ印（bare=1）が無ければ断る（T83、見直しの安全 中 5。
// 0 のまま送るのは人が選んだときだけ）。様式の読み取り（lib/forms/read-upload.ts）も同じ印を使う。
// 1 要求 1 枚（PDF は頁ごとに 1 要求）。大きさの上限は様式の読み取りと同じ（FORM_FILE_MAX_BYTES）。
// ブラウザも読むので、サーバーだけの物（中身の確かめ、node:buffer）は lib/intake/read-check.ts に置く。


/** 元の形。excel・word は T119（ブラウザで頁の画像に描いた物。送るのは PDF と同じく頁の画像） */
export const READ_SOURCES = ["photo", "pdf", "excel", "word"] as const;
export type ReadSource = (typeof READ_SOURCES)[number];

/**
 * 1 回に送れる頁の上限（T146 で 3 から 10 に）。PDF は頭からこの頁までを画像にし、11 頁目からは描かない（画面に「10/N 頁」）。
 * Excel・Word は人が選んだこの頁まで。受け口はこれより多い頁・この番号より後の頁を断る。
 * 入れる欄の読み取りは 1 頁 1 要求 1 回、様式の読み取りは 1 要求で頁ごとに並べて 1 回ずつ（lib/forms/form-read.ts）。
 * 10 頁で ai_calls の 1 日の上限（200 回）を 10 回ほど使う。費用と待ちの見込みは docs/DECISIONS.md「書類」の案（T146）
 */
export const PDF_PAGES_MAX = 10;

/**
 * 送る頁を選ぶ画面（黒塗りの画面の頁の印）を出す頁の数（T146）。上限を 10 にしたので、4 頁からは送る前に外せるようにする
 * （前は上限の 3 を超えたときだけ出ていた。頁ごとに Opus を 1 回呼ぶので、要らない頁を外せば費用と待ちが減る）
 */
export const READ_CHOOSE_FROM = 4;

/** 頁の並ぶ元（PDF・Excel・Word）か。写真は 1 枚 1 頁 */
export const isPagedSource = (s: ReadSource) => s !== "photo";
/** 1 回に選べる写真・PDF の数 */
export const READ_FILES_MAX = 5;
/** 1 頁に塗れる四角の数の上限（送る印の検査） */
export const REDACTED_MAX = 500;

/** 黒塗りの画面を通った印。経過に「写真を読んだ（隠した所 N か所）」と残す元 */
export type ReadMeta = { source: ReadSource; page: number; redacted: number };

/** 送る形の欄の名前。bare は隠した所 0 の頁を人が「送信」と選んだ印（値は BARE_MARK） */
export const READ_FORM = { personId: "personId", image: "image", source: "source", page: "page", redacted: "redacted", bare: "bare" } as const;
export const BARE_MARK = "1";
/** 前の形（T45）の欄。生の写真・PDF なので、来たら断る */
export const RAW_FILE_FIELD = "file";

const int = (v: FormDataEntryValue | null, min: number, max: number): number | null => {
  if (typeof v !== "string" || !/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

type MetaValues = { source: FormDataEntryValue | null; page: FormDataEntryValue | null; redacted: FormDataEntryValue | null; bare: FormDataEntryValue | null };

/** 1 頁分の印を読む。無い・形が違う・隠した所 0 なのに人が選んだ印（bare）が無ければ null */
export function parseReadMeta(v: MetaValues): ReadMeta | null {
  const source = v.source;
  if (typeof source !== "string" || !(READ_SOURCES as readonly string[]).includes(source)) return null;
  const page = int(v.page, 1, source === "photo" ? 1 : PDF_PAGES_MAX);
  const redacted = int(v.redacted, 0, REDACTED_MAX);
  if (page === null || redacted === null) return null;
  if (redacted === 0 && v.bare !== BARE_MARK) return null;
  return { source: source as ReadSource, page, redacted };
}

/** 黒塗りの画面の印を読む。無い・形が違う・隠した所 0 で人が選んだ印が無ければ null */
export function readMetaOf(form: FormData): ReadMeta | null {
  return parseReadMeta({
    source: form.get(READ_FORM.source),
    page: form.get(READ_FORM.page),
    redacted: form.get(READ_FORM.redacted),
    bare: form.get(READ_FORM.bare),
  });
}

/** ブラウザで送る形を作る。bare は隠した所 0 の頁を人が確かめの窓で「送信」と選んだとき（ほかの頁には付けない） */
export function buildReadForm(personId: string, image: Blob, meta: ReadMeta, opts: { bare?: boolean } = {}): FormData {
  const form = new FormData();
  form.set(READ_FORM.personId, personId);
  form.set(READ_FORM.source, meta.source);
  form.set(READ_FORM.page, String(meta.page));
  form.set(READ_FORM.redacted, String(meta.redacted));
  if (opts.bare === true && meta.redacted === 0) form.set(READ_FORM.bare, BARE_MARK);
  form.set(READ_FORM.image, image, "redacted.jpg");
  return form;
}

const SOURCE_NAMES: Record<ReadSource, string> = { photo: "写真", pdf: "PDF", excel: "Excel", word: "Word" };

/** 経過の本文の頭（「写真を読んだ（隠した所 3 か所）」「PDF を読んだ（2 頁目・隠した所 1 か所）」「Excel を読んだ（1 頁目・…）」） */
export function readTimelineHead(meta: ReadMeta): string {
  const what = meta.source === "photo" ? "写真を読んだ（" : `${SOURCE_NAMES[meta.source]} を読んだ（${meta.page} 頁目・`;
  return `${what}隠した所 ${meta.redacted} か所）`;
}
