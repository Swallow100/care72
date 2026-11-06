// 採点と講評（T22）の画面と紙面の言葉。2〜4 字の漢語（CLAUDE.md「画面の決まり」）。D1 も Claude も読まない（ブラウザの束にも入る）。
// 「死亡」「関連死」と書かない。時計が切れるまで手が届かなかった人は「条件到達」（文では「条件に達した」）。

import { AI_FAILURE_LABELS, AI_STATUS_LABELS } from "../claude/status.ts";
import type { DrillAction } from "../db/types.ts";
import { DEPENDS_ON_LABELS } from "../labels.ts";
import { formatHours } from "../triage/index.ts";
import { NO_CALL } from "./event-catalog.ts";
import { clockLabel } from "./labels.ts";
import type { AskKind } from "./scenarios.ts";
import type { Form9PlanColumn, Known, OrderMissKind, Reached, WasteWhy } from "./score.ts";

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
  // ---- T94 の内訳 ----
  /** 打った時に分かっていた事実で結果の決まっていた手 */
  wasted: "空振り",
  /** 同じ人に同じ手を、新しい事が無いまま 30 分以内に 2 回 */
  repeat: "重複",
  asks: "頼み事",
  asksOpen: "未対応",
  talk: "通話",
  talks: "往復",
  /** 声で入れた往復（T155） */
  voiced: "声",
  /** 手を打った時に分かっていた事実（紙面の対応履歴の列） */
  facts: "事実",
  /** 自由対応で何として扱ったか（「自由対応 扱い 薬手配」「自由対応 扱い 電話」。T129 で「読替」から） */
  reading: "扱い",
  /** 前の同じ手からの分 */
  gap: "間隔",
  /** 訪問の様子（T93、AI） */
  condition: "様子",
  /** 向かった人の着く時刻 */
  arrive: "到着",
} as const;

/** 空振りの理由（lib/drill/score.ts の WasteWhy） */
export const WASTE_LABELS: Readonly<Record<WasteWhy, string>> = {
  phone: NO_CALL,
  road: "通行止",
  staff: "職員なし",
  closed: "施設休止",
  nurse: "看護不在",
};

/**
 * 頼み事の種類（scenarios.ts の AskKind）。T93 の画面の言葉（dialogue.ts の ASK_LABELS）と同じ字にする。
 * T93 より前に作るので、ここに置く（入ったら片方を読む形に寄せる）
 */
export const ASK_WORDS: Readonly<Record<AskKind, string>> = {
  medicine: "薬",
  water: "水",
  food: "食事",
  power: "電源",
  transport: "移送",
  family_contact: "家族",
  battery: "電池",
  toilet: "便所",
  warmth: "保温",
};

/** 頼み事の並び（「薬・電源」） */
export const askWords = (kinds: ReadonlyArray<AskKind>): string => kinds.map((k) => ASK_WORDS[k]).join("・");

/**
 * 手を打った時に分かっていた世界の事実の言葉（「電話 通話不可」「道 通行止」「職員 0」「透析先 休止」）。講評の入力と紙面の対応履歴が読む。
 * 職員の空きと訪問看護の印は、それを見る手（訪問依頼・応援依頼）のときだけ
 */
export function factWords(k: Known, kind: DrillAction): string[] {
  const out: string[] = [];
  // 通信の段（T125）: 世界の電話の down は規制（全部は止まらない）。家の電話の印は家の電話の通話不可
  if (k.homeDown) out.push(`家の電話 ${NO_CALL}`);
  if (k.line === "down") out.push("電話 規制");
  else if (!k.homeDown && k.homeLine === "down") out.push("電話 規制");
  else if ((k.line ?? k.homeLine) === "busy") out.push("電話 不安定");
  if (k.roadClosed) out.push("道 通行止");
  if (kind === "dispatch" || kind === "request_backup") out.push(`職員 ${k.staff}`);
  if (kind === "dispatch" && k.nurseAway) out.push("訪問看護 来られない");
  for (const d of k.closed) out.push(`${DEPENDS_ON_LABELS[d]} 休止`);
  return out;
}

const SOURCE_WORDS = { agent: "本人", family: "家族", supporter: "支援者" } as const;

/** 本人の最後の連絡の言葉（「本人 赤 けが 動けない」「家族 緑」）。連絡が無ければ「連絡なし」 */
export function personWords(k: Pick<Known, "person">): string {
  const s = k.person;
  if (!s) return "連絡なし";
  const who = SOURCE_WORDS[s.source] ?? "本人";
  if (s.color !== "red") return `${who} ${s.color === "green" ? "緑" : "安否不明"}`;
  const answers = [
    s.injured === true ? "けが" : null,
    s.canMove === false ? "動けない" : null,
    s.atHome === false ? "家の外" : null,
    s.hasMedicine === false ? "薬なし" : null,
  ].filter(Boolean);
  return [who, "赤", ...answers].join(" ");
}

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
  /** 手の選び方（T94） */
  choice: "選択",
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
