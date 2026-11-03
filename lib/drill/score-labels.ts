// 採点と講評（T22）の画面と紙面の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。D1 も Claude も読まない（ブラウザの束にも入る）。
// 「死亡」「関連死」と書かない。時計が切れるまで手が届かなかった人は「条件到達」（文では「条件に達した」）。

import { AI_FAILURE_LABELS, AI_STATUS_LABELS } from "../claude/status.ts";
import { DEPENDS_ON_LABELS } from "../labels.ts";
import { formatHours } from "../triage/index.ts";
import { clockLabel } from "./labels.ts";
import type { Form9PlanColumn, OrderMissKind, Reached } from "./score.ts";

/** 見出し・数字の名前・操作 */
export const SCORE_LABELS = {
  score: "採点",
  order: "順番一致",
  report: "報告遅延",
  form9: "空欄",
  /** 空欄の数の出どころ（「空欄 様式 9」と添える） */
  form9Doc: "様式 9",
  reached: "条件到達",
  /** 条件到達の出どころ（仮想モードで結末と並べるとき「条件到達 時計計算」） */
  reachedBy: "時計計算",
  /** 仮想モードの結末（世界が決めた。T53）。「結末 筋書」と AI の印 */
  ended: "結末",
  endedBy: "筋書",
  endedAt: "結末時刻",
  endedText: "経過",
  unreported: "未報告",
  previous: "前回",
  noPrevious: "前回なし",
  thisTime: "今回",
  paper: "訓練記録",
  print: "印刷",
  detail: "内訳",
  misses: "順番相違",
  calls: "着信",
  answered: "出た",
  declined: "出なかった",
  open: "未応答",
  person: "氏名",
  clock: "時計",
  outAt: "超過時刻",
  /** 時計が切れるまでに打ったが届かなかった手の数 */
  tries: "未達",
  column: "記入欄",
  none: "なし",
  at: "時刻",
  action: "対応",
  target: "対象",
  callee: "相手",
  result: "結果",
  reason: "理由",
  /** その時の左の表で、手のまだ無い人の一番上 */
  expected: "先頭",
  scenario: "想定",
  history: "対応履歴",
  situation: "状況",
  summary: "概要",
  item: "項目",
  office: "事業所",
  startedBy: "実施者",
  date: "実施日",
  startedAt: "開始",
  status: "状態",
  elapsed: "経過",
  participants: "参加者",
  confirm: "確認欄",
  manager: "管理者",
  checkedOn: "確認日",
  stamp: "押印",
  made: "作成",
  kind: "種類",
  noAction: "対応なし",
} as const;

/** 一致しなかった理由 */
export const MISS_LABELS: Readonly<Record<OrderMissKind, string>> = {
  late: "後手",
  missing: "未対応",
  declined: "至急拒否",
  unknown: "記録なし",
};

/** 様式 9 の数える欄（lib/drill/score.ts の FORM9_PLAN_COLUMNS） */
export const FORM9_PLAN_LABELS: Readonly<Record<Form9PlanColumn, string>> = {
  area: "地域・区分",
  address: "住所",
  place: "避難場所",
  careManager: "担当",
  emergency1: "連絡先1",
  means: "確認方法",
};

/** 講評の指摘の種類（lib/drill/review.ts の REVIEW_KINDS） */
export const REVIEW_KIND_LABELS = {
  order: "順番",
  report: "報告",
  blank: "空欄",
  reached: "条件",
  call: "着信",
  other: "その他",
} as const;

/** 講評の欄 */
export const REVIEW_UI = {
  review: "講評",
  creating: "作成中",
  retry: "再作成",
  edit: "編集",
  save: "保存",
  cancel: "取消",
  edited: "修正済",
  whole: "全体",
  summary: "総評",
  findings: "指摘",
  failed: "作成失敗",
  network: "通信失敗",
  none: "講評なし",
  /** 講評を AI が作れなかった（未設定・上限到達・接続失敗・出力不良。T76）。「講評」の見出しの下に「AI 停止 上限到達」 */
  stopped: `${AI_STATUS_LABELS.ai} ${AI_STATUS_LABELS.stop}`,
} as const;

/** 講評が作れなかった理由（lib/drill/review.ts の ReviewError）。AI の状態の言葉（lib/claude/status.ts）と同じ。T76 */
export const REVIEW_ERROR_LABELS = AI_FAILURE_LABELS;

/** 発災からの分の言い方（「5 時間 10 分」） */
export const minuteText = clockLabel;

/** 報告の遅れの言い方。未報告は「未報告」 */
export function reportText(minute: number | null): string {
  return minute === null ? SCORE_LABELS.unreported : clockLabel(minute);
}

/** 順番の一致の言い方（「7/10」） */
export function orderText(o: { matched: number; total: number }): string {
  return `${o.matched}/${o.total}`;
}

/** 条件に達した時計の言い方（「透析 次の回まで 2 日を超過、透析先 未確認」）。ルールの表の理由と同じ書き方 */
export function reachedText(r: Pick<Reached, "label" | "hours" | "unchecked">): string {
  const unchecked = r.unchecked.map((d) => `${DEPENDS_ON_LABELS[d]} 未確認`);
  return [`${r.label} ${formatHours(r.hours)}を超過`, ...unchecked].join("、");
}
