// 同意の範囲と経過の書き足し（docs/tasks/T24.md）の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。
// 経過の種類の言葉（安否確認・診察・配薬・搬送・到着・記録）は lib/labels.ts の TIMELINE_KIND_LABELS を読む（ここでは持たない）。
// lib/labels.ts は言葉の分岐が直しているので触らず、新しい言葉はここに置く。画面に出す言葉は docs/progress/t24.md に一覧で書く。
// ここはブラウザの部品（components/person/TimelineComposer.tsx）からも読むので、サーバーの物を import しない。

import type { ProvisionBasis } from "../db/types.ts";
import type { ProvisionSection } from "./scope.ts";

/** 第三者提供の記録の区分 */
export const PROVISION_SECTION_LABELS: Record<ProvisionSection, string> = {
  identity: "本人確認",
  medical: "医療",
  evacuation: "避難",
  people_partial: "人の一部",
  address: "住所",
};

export const PROVISION_BASIS_LABELS: Record<ProvisionBasis, string> = {
  consent: "同意",
  vital: "生命保護",
};

/** 本人の経過の提供の行（「提供 医療班 医療・避難・人の一部」） */
export const PROVISION_TIMELINE_LABEL = "提供";

/** 経過の書き足しの欄 */
export const COMPOSER_LABELS = {
  /** 欄の見出し（aria） */
  title: "書き足し",
  /** 自由文の欄の placeholder */
  placeholder: "自由文",
  send: "記録",
  sending: "送信中",
  /** 定型を選ばずに自由文だけ */
  note: "記録",
} as const;

/** 書き足しの断り（API の error と、画面に出す言葉） */
export const TIMELINE_ERRORS = ["login_required", "forbidden", "invalid", "empty", "too_long", "not_found"] as const;
export type TimelineError = (typeof TIMELINE_ERRORS)[number];

export const TIMELINE_ERROR_LABELS: Record<TimelineError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  invalid: "入力不正",
  empty: "本文 未入力",
  too_long: "本文 超過",
  not_found: "該当なし",
};

export const TIMELINE_ERROR_STATUS: Record<TimelineError, number> = {
  login_required: 401,
  forbidden: 403,
  invalid: 400,
  empty: 400,
  too_long: 400,
  not_found: 404,
};

/** 送信の失敗（通信） */
export const COMPOSER_FAILED = "送信失敗";
