// ケアマネの手（T20）の型。lib/drill/engine.ts から分けた（T90 の準備）。engine.ts は同じ名前を再び出す。
// 手の打ち方は lib/drill/actions.ts、世界の返事は lib/drill/world-reply.ts。

import type { ContactKind, DrillAction, SignalColor, WhereNow } from "../db/types.ts";
import type { TalkLine, VisitReport } from "./dialogue.ts";
import type { PersonState } from "./persona-types.ts";
import type { PersonMarks, PhoneState } from "./scenarios.ts";

/**
 * ケアマネが通話・訪問で聞いた安否（T21）。本人・家族・支援者が電話に出て答えた・訪問で着いたときだけ。
 * 色と 4 問は本人役の今の様子（PersonState）から決める（Claude は決めない）。保存の所が signals に出どころ care_manager で足し、
 * 左の表の色・順位を動かす。AI の分類ではなく人が聞いた結果なので AI の印は付けない（言う事は文字起こしに入れない）
 */
export type HeardSignal = {
  /** 通話（本人電話・連絡先電話）か訪問（着いた。「確認済」） */
  via: "call" | "visit";
  color: SignalColor;
  whereNow: WhereNow | null;
  injured: boolean | null;
  atHome: boolean | null;
  canMove: boolean | null;
  hasMedicine: boolean | null;
  /** 聞いた時刻（発災からの時間。手の終わり） */
  at: number;
};

/**
 * ケアマネの手 1 つ（T20、lib/drill/actions.ts）。誰に・何を・何時と、手の前の状態、世界の返事。
 * drills.world の actions と drill_events（kind action と result）に残し、採点（T22）が読む
 */
export type ActionRecord = {
  /** 訓練の中の番号（a1・a2…。打った順） */
  id: string;
  kind: DrillAction;
  /** 相手の本人（台帳の id）。全体への報告・自分の避難は null */
  person: string | null;
  /** 相手の連絡先の id（電話の相手・出向いてもらう人）。事業所の職員・相手の無い手は null */
  target: string | null;
  /** 相手の区分（本人・家族・訪問看護・透析施設…）。事業所の職員・相手の無い手は null */
  callee: ContactKind | null;
  /** 相手の言い方（「家族 娘」「訪問看護」）。名前と番号は書かない */
  calleeLabel: string | null;
  /** 打った時刻（発災からの時間。小数） */
  at: number;
  /** 打った時刻と終わる時刻（発災からの分） */
  atMinute: number;
  endMinute: number;
  /** 所要時間（分。表で固定） */
  minutes: number;
  /** 打ったときの刻み */
  step: number;
  /** 手の前の状態（採点 T22 が読む） */
  before: ActionBefore;
  /** 世界の返事。手の途中で刻みを越えている間だけ null */
  result: ActionResult | null;
  /**
   * ケアマネのメモ（T59、100 字まで、任意）。なぜその手を打ったか。訓練記録と履歴に出すだけで、
   * 講評・監督・世界・本人役（Claude）の入力には渡さない（withoutMemo で落とす）
   */
  memo?: string;
  /**
   * 自由に書く手の文（T91）。ケアマネが打った文で、サーバーの中だけに置く。
   * Claude の入力には渡さない（withoutMemo で落とす。Claude に渡るのは読み替えた手の id だけ）
   */
  text?: string;
  /** 自由に書く手の読み替えの理由（T91）。text と同じく Claude の入力には渡さない（withoutMemo で落とす） */
  reason?: string;
  /**
   * 自由に書く手（kind free）の読み替えた手（T91。lib/drill/action-catalog.ts の id）。時間・結果・効き目はこの手の行で決まり、
   * 採点（T94）と本人役（T93）はこの手として数え・言う。Claude に渡るのはこの id と表の言い方だけ（文は渡さない）
   */
  as?: DrillAction;
};

/** 手の前の状態。本人の今の様子・印、職員の空き、電話の線、家の前の道。左の表の色と順位は保存の所が足す */
export type ActionBefore = {
  person: PersonState | null;
  marks: PersonMarks;
  staff: number;
  phone: PhoneState;
  /** 家の前の道が通行止 */
  roadClosed: boolean;
  /** 左の表のこの本人の色・順位・理由（lib/triage。保存の所が画面と同じ道で作って足す） */
  triage?: { color: string; rank: number | null; reason: string } | null;
  /** 左の表の優先の並び（台帳の id、1 番から） */
  ranking?: string[];
};

/** 世界の返事の状態。T19 の WORLD_REPLY_LABELS の 13 と記録（T91）と、電話に出ない・声がない・番号が無い */
export type ActionStatus =
  | "ringing"
  | "connected"
  | "noLine"
  | "closed"
  | "arrived"
  | "blocked"
  | "turnedBack"
  | "dispatched"
  | "noDispatch"
  | "accepted"
  | "refused"
  | "reported"
  | "evacuated"
  | "noted"
  | "noAnswer"
  | "silent"
  | "noNumber";

export type ActionResult = {
  ok: boolean;
  status: ActionStatus;
  /** そうなった世界の事実（「家の前の道 通行止」）。確率で外れたときは null */
  because: string | null;
  /** 画面の 1 文（固定の文か、監督の言い換え） */
  text: string;
  /** 文が監督（Opus）の言い換え */
  ai: boolean;
  /** 電話に出た人の言う事（吹き出し）。出ない・声がない・本人でも家族でもない相手は null */
  speech: string | null;
  /** 言う事が本人役（Haiku）の物 */
  speechAi: boolean;
  /** 本人・家族・支援者への電話で、出たか（出る・出ない・背景の音だけ） */
  pickup: "answers" | "no_answer" | "background_only" | null;
  /** この手で消えた本人の印（出向いてもらった人の分は着いた時刻に世界が消す） */
  cleared: Array<keyof PersonMarks>;
  /** 職員の空きの増減（事業所の職員に出向いてもらうと -1） */
  staff: number;
  /** 手の途中で進んだ刻み（その間の安否は着信） */
  crossed: number[];
  /** 返事の時刻（終わる時刻。発災からの分） */
  atMinute: number;
  /** 通話・訪問で聞いた安否（T21）。保存の所が signals に足す（id は `<訓練>-<手の番号>-h`）。無ければ null */
  heard?: HeardSignal | null;
  /**
   * 向かってもらった人が本人の所に着く時刻（発災からの分。T91）。手の表の効き目 arrival の分（幅のある物は確率で決めた分）。
   * 保存した物からの作り直しでも同じ時刻にするため返事に残す。採点（T94）の「届いた」の時刻
   */
  arriveAt?: number;
  /**
   * 電話に出た人との往復（T93、lib/drill/talk.ts が足す。3 往復まで）。ケアマネの問いと本人役の言葉。
   * 頼み事は world.asks にも積む（applyResult が作り直しでも積む）。無ければ往復なし
   */
  talk?: TalkLine[];
  /** 往復を切った時刻（発災からの分、T93）。切っていなければ無し */
  talkEnd?: number;
  /** 訪問で着いたときの様子と頼み事（T93、本人役 Haiku × 1 回）。色・聞いた安否は変えない */
  visit?: VisitReport;
};
