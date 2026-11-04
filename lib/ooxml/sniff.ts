// Excel・Word の形を頭のバイトで見分ける小さな所（T119）。画面の束に入れても重くならないよう、ほかを読み込まない。

/** 頭の 4 バイトが zip（PK\x03\x04。.xlsx・.docx はこの形） */
export const isZip = (head: Uint8Array) => head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

/** 頭の 8 バイトが OLE の複合文書（古い .xls・.doc。パスワード付きの .xlsx・.docx もこの形） */
export const isLegacyOffice = (head: Uint8Array) => head.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => head[i] === b);

/** 受け取る Excel・Word の大きさの上限（様式の .xlsx・.docx は数百 KB。画像の多い物でも数 MB） */
export const OFFICE_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** 様式の読取で選べる形（ファイルの選択の accept） */
export const OFFICE_ACCEPT = [
  ".xlsx",
  ".xlsm",
  ".docx",
  ".docm",
  ".xls",
  ".doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/msword",
].join(",");
