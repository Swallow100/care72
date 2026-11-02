// 利用者の追加・担当の割当・ケアマネの追加（docs/tasks/T30.md）の言葉。2〜4 字の漢語、ボタンは操作名だけ。

export const OFFICE_LABELS = {
  addPerson: "利用者追加",
  addCareManager: "ケアマネ追加",
  careManagers: "ケアマネ",
  assignments: "担当",
  assign: "変更",
  unlist: "外す",
  /** 担当の表の行を開く・畳む（外すは開いた行の中） */
  detail: "詳細",
  createdAt: "登録",
  updatedAt: "更新",
  relist: "戻す",
  unlisted: "外した人",
  unlistedAt: "除外",
  create: "作成",
  add: "追加",
  cancel: "取消",
  name: "氏名",
  kana: "カナ",
  birth: "生年月日",
  sex: "性別",
  age: "年齢",
  plan: "避難計画",
  careManager: "担当",
  /** 利用者追加の担当の既定（自分） */
  defaultCm: "既定",
  displayName: "名前",
  loginId: "ID",
  initialPassword: "初期パスワード",
  shownOnce: "表示は今回だけ",
  copy: "コピー",
  copied: "コピー済",
  close: "閉じる",
  admin: "管理者",
  unassigned: "未割当",
  people: "人",
  open: "開く",
  none: "なし",
  sending: "送信中",
} as const;

/** 利用者追加の欄の誤り */
export const PERSON_FORM_ERRORS = ["name", "kana", "birth", "sex", "care_manager"] as const;
export type PersonFormError = (typeof PERSON_FORM_ERRORS)[number];

/** ケアマネ追加の欄の誤り */
export const STAFF_FORM_ERRORS = ["display_name", "login_id", "login_taken"] as const;
export type StaffFormError = (typeof STAFF_FORM_ERRORS)[number];

/** 担当の割当・外す・戻すの誤り（画面へ戻す URL の people_error） */
export const PEOPLE_ACTION_ERRORS = ["bad", "not_found", "care_manager", "conflict"] as const;
export type PeopleActionError = (typeof PEOPLE_ACTION_ERRORS)[number];

/** API の断り（権限・形） */
export type OfficeApiError = PersonFormError | StaffFormError | "invalid" | "forbidden" | "login_required";

export const OFFICE_ERROR_LABELS: Record<OfficeApiError | PeopleActionError, string> = {
  name: "氏名 不正",
  kana: "カナ 不正",
  birth: "生年月日 不正",
  sex: "性別 未選択",
  care_manager: "担当 不正",
  display_name: "名前 不正",
  login_id: "ID 不正",
  login_taken: "ID 使用中",
  invalid: "入力不正",
  forbidden: "権限なし",
  login_required: "ログイン要",
  bad: "入力不正",
  not_found: "該当なし",
  conflict: "競合 再読込",
};
