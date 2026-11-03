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
  // 担当の一括変更（T60）
  /** 見出しのチェック（表の全員） */
  selectAll: "全選択",
  /** 行のチェックの読み上げ（「山田 ハナ 選択」）と帯の「選択 N 人」 */
  pick: "選択",
  /** 帯の担当ごとの選択の読み上げ（「山本 担当全員」） */
  pickCm: "担当全員",
  moveTo: "移動先",
  assignMany: "一括変更",
  /** 確認の窓の決めるボタン */
  assignManyOk: "変更",
  assigned: "変更済",
  skipped: "飛ばし",
} as const;

/** 確認の窓の名前の箇条書きは 6 行まで。超えたら 5 人と「ほか N 件」（窓の中を送れる箱にしない。DECISIONS 11/3 17:0x の T51-2） */
export const CONFIRM_DETAIL_ROWS = 6;

export function assignManyDetails(names: readonly string[]): string[] {
  if (names.length <= CONFIRM_DETAIL_ROWS) return [...names];
  const shown = names.slice(0, CONFIRM_DETAIL_ROWS - 1);
  return [...shown, `ほか ${names.length - shown.length} 件`];
}

/** 一括変更のあとの 1 行（「変更済 3 人」「変更済 2 人・飛ばし 1 人」） */
export function assignManyText(r: { moved: number; skipped: number }): string {
  const moved = `${OFFICE_LABELS.assigned} ${r.moved} ${OFFICE_LABELS.people}`;
  return r.skipped > 0 ? `${moved}・${OFFICE_LABELS.skipped} ${r.skipped} ${OFFICE_LABELS.people}` : moved;
}

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
