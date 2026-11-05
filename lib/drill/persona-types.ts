// 本人役（ペルソナ、T18）の型。lib/drill/engine.ts から分けた（T90 の準備）。engine.ts は同じ名前を再び出す。
// 本人役の呼び方・言葉は lib/drill/persona.ts。ここは engine と persona が共有する形だけ。

import type { SignalColor, WhereNow } from "../db/types.ts";
import type { ActionRecord } from "./action-types.ts";
import type { DrillIncident } from "./incident-types.ts";
import type { DrillKind, FixedTurn, WorldState } from "./scenarios.ts";

/** 本人ごとの 1 刻みの結果（安否 1 つ）。表の固定の物も、ペルソナ（T18）の物も同じ形 */
export type DrillTurn = {
  person: string;
  color: SignalColor;
  source: FixedTurn["source"];
  whereNow: WhereNow | null;
  injured: boolean | null;
  atHome: boolean | null;
  canMove: boolean | null;
  hasMedicine: boolean | null;
  /** 言う事（安否の文字起こしの欄に入る） */
  saying: string | null;
  /** する事 */
  doing: string | null;
  /** Claude（ペルソナ）が作った物。表の固定の物は false。画面で AI の印を付ける */
  ai: boolean;
  /** 起きた時刻（発災からの時間） */
  at: number;
  /** 保存した安否の signals の id（保存した刻みから読み直したときだけ。着信の声と録音の再生に使う、T21） */
  signal?: string;
};

/** 本人ごとの今の様子（いちばん新しい 1 刻みの安否） */
export type PersonState = {
  color: SignalColor;
  source: FixedTurn["source"];
  whereNow: WhereNow | null;
  at: number;
  saying: string | null;
  doing: string | null;
  /**
   * 赤の 4 問の答え（T21。通話・訪問で聞いた安否に写す）。T20 までに保存した状態には無い（無ければ答えていない）
   */
  injured?: boolean | null;
  atHome?: boolean | null;
  canMove?: boolean | null;
  hasMedicine?: boolean | null;
};

/**
 * 本人役を呼ぶ理由（T90）。table 想定の表の行・incident その人を指す状況・action その人への手の返事・
 * clock 時計が半分か切れを越えた・round しばらく何も無い人の巡回
 */
export type PersonaReason = "table" | "incident" | "action" | "clock" | "round";

/** ペルソナ（T18）に渡す物。本人 1 人の 1 刻み。Claude に渡す前に仮名化する（ここは id だけ） */
export type PersonaInput = {
  step: number;
  hour: number;
  person: string;
  /** 刻みのあとの世界（この刻みの状況を当てたあと） */
  world: WorldState;
  /** この刻みの状況 */
  incidents: ReadonlyArray<DrillIncident>;
  /** 前の刻みまでの様子。まだ安否が無ければ null */
  state: PersonState | null;
  /** 直前のケアマネの手（この本人に向けた物。T20） */
  lastAction: ActionRecord | null;
  /**
   * この本人に向けたケアマネの手（T93。メモと自由の文を落とした物、打った順）。本人役の文は since 以後（無ければ前の刻みから）の物を
   * 結果の言葉つきで書く。無ければ lastAction だけ
   */
  actions?: ReadonlyArray<ActionRecord>;
  /** 想定の表のこの本人の行（起きること）。ペルソナはこれを骨にする */
  fixed: ReadonlyArray<FixedTurn>;
  /** 仮想モード（T50）。本人役は表の行が無く、自分の町の状況から自由に動く */
  virtual?: boolean;
  /** 夜間発災（T59）。本人役に「発災は深夜 2 時ごろ。今は N 時ごろ」の 1 行を足す */
  night?: boolean;
  /** この人を前に呼んだ時刻（発災からの分、T90）。無ければ刻みの道（今までと同じ） */
  since?: number;
  /** この区切りで呼んだ理由（T90）。無ければ刻みの道 */
  reasons?: ReadonlyArray<PersonaReason>;
  /** この区切りの終わりの時刻（発災からの分、T90）。無ければ hour の刻み */
  toMinute?: number;
  /** 訓練の災害の種類（T125、lib/drill/fit.ts）。本人役の説明のハザードを想定に効く物に絞る。未決・無ければ絞らない */
  fit?: DrillKind | null;
};

/** 本人 1 人の 1 刻み。空の配列は「連絡なし」。投げたら連絡なしとして進む */
export type PersonaHook = (input: PersonaInput) => Promise<DrillTurn[]>;

/**
 * 本人役をまとめて呼ぶ口（T121）。入力の並びと同じ並びで、1 人ずつの安否（空の配列は連絡なし）を返す。投げたら全員連絡なし
 */
export type PersonaBatchHook = (inputs: ReadonlyArray<PersonaInput>) => Promise<DrillTurn[][]>;
