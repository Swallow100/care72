// 行政・医療班の受け持ち（docs/tasks/T23.md）の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。
// 設計の側の校正（11/3）: 受け入れは「受入」（受領は物を受け取る言葉）、ケアマネが自分の事業所に移すのは「引受」、
// その場で作るのは「新規登録」、事業所の無い人は「所属なし」。色の言葉（至急・要確認・不明・無事）は lib/labels.ts の COLOR_LABELS を読む。
// 新しく画面に出す言葉は docs/progress/t23.md に一覧で書く（設計の側が校正に通す）。

import type { CustodyVia, ReleaseKind } from "../db/types.ts";

export const CUSTODY_LABELS = {
  /** 画面の見出し（/staff） */
  page: "受け持ち",
  people: "人",
  at: "時点",
  /** 受け入れる操作と経過の種類 */
  receive: "受入",
  received: "受入済",
  /** 受け入れの入口 */
  search: "検索",
  shelterList: "避難所",
  register: "新規登録",
  /** 所属なしの一覧の列: 登録した時刻 */
  registeredAt: "登録",
  /** 欄 */
  shelter: "避難所",
  nameKana: "氏名・カナ",
  name: "氏名",
  kana: "カナ",
  birth: "生年月日",
  age: "年齢",
  reportedAge: "申告",
  medications: "薬",
  devices: "機器",
  contact: "連絡先",
  relation: "続柄",
  phone: "電話",
  state: "状態",
  medical: "医療",
  /** 上の人数: 医療依存の印・機器・薬のある人 */
  care: "要配慮",
  remain: "残り",
  office: "所属",
  receivedAt: "受入",
  by: "受入者",
  /** 所属なし（offices.kind unaffiliated の名前と同じ） */
  unaffiliated: "所属なし",
  /** 受け持ちを閉じる */
  release: "解除",
  destination: "行き先",
  confirm: "確定",
  cancel: "取消",
  open: "開く",
  filterAll: "全部",
  noHits: "該当なし",
  /** 検索のヒットが上限（30）を超えた */
  more: "件数超過",
  none: "なし",
  sending: "送信中",
  /** ケアマネの側（事業所の画面）: 所属なしの人を自分の事業所に */
  take: "引受",
  /** 第三者提供の記録 */
  provisions: "提供記録",
} as const;

export const CUSTODY_VIA_LABELS: Record<CustodyVia, string> = {
  qr: "QR",
  search: "検索",
  shelter: "避難所",
  on_site: "新規登録",
};

/** 受け持ちを閉じる理由（経過の種類にもなる） */
export const RELEASE_LABELS: Record<ReleaseKind, string> = {
  transported: "搬送",
  discharged: "退所",
};

/** 断り（API の error と、画面に出す言葉） */
export const CUSTODY_ERRORS = [
  "login_required",
  "forbidden",
  "invalid",
  "shelter",
  "query",
  "name",
  "kana",
  "age",
  "birth",
  "phone",
  "not_found",
  "already",
  "released",
  "conflict",
] as const;
export type CustodyError = (typeof CUSTODY_ERRORS)[number];

export const CUSTODY_ERROR_LABELS: Record<CustodyError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  invalid: "入力不正",
  shelter: "避難所 未入力",
  query: "条件不足",
  name: "氏名 不正",
  kana: "カナ 不正",
  age: "年齢 不正",
  birth: "生年月日 不正",
  phone: "電話 不正",
  not_found: "該当なし",
  already: "受入済",
  released: "解除済",
  conflict: "競合 再読込",
};

export const CUSTODY_ERROR_STATUS: Record<CustodyError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  shelter: 400,
  query: 400,
  name: 400,
  kana: 400,
  age: 400,
  birth: 400,
  phone: 400,
  not_found: 404,
  already: 409,
  released: 409,
  conflict: 409,
};
