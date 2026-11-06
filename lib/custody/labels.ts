// 行政・医療班の受け持ち（docs/tasks/T23.md）の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。
// 設計の側の校正（11/3）: 受け入れは「受入」（受領は物を受け取る言葉）、ケアマネが自分の事業所に移すのは「引受」、
// その場で作るのは「新規登録」、事業所の無い人は「所属なし」。色の言葉（至急・要確認・不明・無事）は lib/labels.ts の COLOR_LABELS を読む。
// 新しく画面に出す言葉は docs/progress/t23.md に一覧で書く（設計の側が校正に通す）。

import type { CustodyVia, ReleaseKind } from "../db/types.ts";

export const CUSTODY_LABELS = {
  /** 画面の見出し（/staff）。医療班・行政が受け入れた人の一覧。画面と紙の言葉は「受入一覧」（前は「受け持ち」。コードの名前 custody・staff はそのまま） */
  page: "受入一覧",
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
  /** 受入の前の最後の知らせが赤のとき、行の理由の下に出す頭（T78） */
  before: "受入前",
  /** 避難所の欄が空のまま受入・新規登録を押したとき、欄の名前の横に出す（T78） */
  missing: "未入力",
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

/** 画面の入り方（T163）。依頼から受け入れた受け持ちは表の via が search のまま（CHECK を変えない）なので、依頼の行と結んで「依頼」と出す */
export type ShownVia = CustodyVia | "request";
export const SHOWN_VIA_LABELS: Record<ShownVia, string> = { ...CUSTODY_VIA_LABELS, request: "依頼" };

/** SQL: 受け持ち（alias）の入り方。受け入れた依頼に結ばれていれば request */
export function shownViaSql(alias: string): string {
  return `CASE WHEN EXISTS (SELECT 1 FROM custody_requests via_r WHERE via_r.custody_id = ${alias}.id AND via_r.state = 'accepted') THEN 'request' ELSE ${alias}.via END`;
}

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
  /** 機器の その他 の名前が空（T64） */
  "device",
  "not_found",
  "already",
  "released",
  "conflict",
  /** 受入依頼（T163）: 医療班への提供の同意が無い */
  "consent",
  /** 受入依頼（T163）: 依頼中が既にある */
  "pending",
  /** 受入依頼（T163）: もう返事がある・下げた */
  "answered",
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
  device: "機器名 未入力",
  not_found: "該当なし",
  already: "受入済",
  released: "解除済",
  conflict: "競合 再読込",
  consent: "同意なし",
  pending: "依頼中",
  answered: "回答済",
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
  device: 400,
  not_found: 404,
  already: 409,
  released: 409,
  conflict: 409,
  consent: 403,
  pending: 409,
  answered: 409,
};

/**
 * 受入の入り方（T152）。受入一覧の最初に 3 つ並べる。sub は何の人かの 2〜5 字（説明の文にしない）。
 * 画面には「台帳」と書かない（本人のページの登録の有無で言う）
 */
export const ENTRY_LABELS = {
  qr: "QR読取",
  qrSub: "本人の1枚",
  search: "氏名検索",
  searchSub: "登録済",
  register: "新規登録",
  registerSub: "未登録",
  /** 既に誰かが受け入れた人を避難所で探す（前の「避難所」の切替。3 つの後ろに小さく） */
  shelterList: "避難所別",
  /** 審査員の壁の中だけ: デモの人の本人の 1 枚の QR */
  sample: "見本QR",
  showQr: "QR表示",
  hideQr: "閉じる",
  open: "開く",
  /** 読んだ QR の URL を貼る欄 */
  url: "URL入力",
  urlBad: "読取不可",
  /** 端末のカメラ（BarcodeDetector の使える端末だけ、アプリの中で読む） */
  camera: "端末カメラ",
  cameraStart: "カメラ起動",
  cameraStop: "停止",
  cameraFail: "カメラ不可",
  /** アプリの中で読めない端末: 端末のカメラで QR を写すと受入の頁が開く */
  cameraOs: "写すと受入頁",
  /** 受け入れたばかりの人の行の印（表の上に出す） */
  fresh: "新着",
} as const;

/** 受け入れた人の画面（T152。医療班・行政の役の本人のページ） */
export const RECEIVED_LABELS = {
  /** 戻る先 */
  back: "受入一覧",
  /** 医療班の要約（薬・機器・アレルギー・連絡先） */
  summary: "要約",
  timeline: "経過",
  /** 受け入れた避難所と時刻の行の見出し */
  received: "受入",
  /** 医療要約の書類（紙面）を開く・印刷 */
  full: "全文",
  print: "印刷",
} as const;

/**
 * 医療班への受入依頼（T163）。医療班の受入一覧の上の一覧と、ケアマネの本人のページの欄。2〜4 字の漢語。
 * 返事は 2 つの決まった言葉だけ（自由文の理由の欄は作らない）
 */
export const REQUEST_LABELS = {
  /** 本人のページの依頼の面から受入一覧へ（役を選べる人だけ。T166）。見える字と、読み上げと title の名前 */
  toStaff: "受入一覧",
  toStaffName: "医療班 受入一覧",
  /** 医療班の一覧の見出しと、本人のページの欄の見出し */
  list: "受入依頼",
  /** ケアマネの送る操作 */
  send: "依頼送信",
  /** 医療班の返事 */
  accept: "受入",
  decline: "受入不可",
  /** ケアマネが下げる */
  withdraw: "取消",
  /** 列 */
  from: "依頼元",
  shelter: "行き先",
  at: "依頼",
  replied: "返事",
  /** 一覧が空 */
  none: "依頼なし",
  /** 本人のページ: 医療班への提供の同意が無く送れない */
  noConsent: "同意なし",
  /** 送った後にもう一度送る */
  again: "再依頼",
} as const;

/** 依頼の状態の言葉（本人のページ） */
export const REQUEST_STATE_LABELS = {
  open: "依頼中",
  accepted: "受入済",
  declined: "受入不可",
  withdrawn: "取消済",
} as const;
