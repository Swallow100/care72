// ルールの表（docs/SPEC.md「医療の芯」）。安否の色と連絡の順位はこの表で出し、Claude は決めない。
// 先にテスト（triage.test.ts）を書いた。中身はこのあとの commit で入れる。

import type { ClockRow, RecordingClass } from "../db/types.ts";

/** 赤 危険・黄 要確認・灰 未知・緑 無事 */
export type Color = "red" | "yellow" | "gray" | "green";

/** 緊急度の骨格 1〜8（何で時間が決まるか） */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 表のどの行で決まったか（表の上から） */
export type RuleId =
  | "red_injury" // 赤 ＋ けが・動けない → 赤、最上位
  | "red" // 赤だけ → 赤
  | "unknown_device_over" // 未知 ＋ 停電が機器の時計を超えた → 赤
  | "unknown_half" // 未知 ＋ 時計の半分を過ぎた → 黄
  | "unknown" // 未知（時計の半分まで） → 灰
  | "green_device_low" // 緑だが機器の時計が切れる → 黄
  | "green"; // 緑 → 緑、一番下

export type TriageClock = Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on">;

export type TriagePerson = {
  id: string;
  clocks: TriageClock[];
  livesAlone: boolean;
  /** 寝たきり・歩行不可 */
  bedridden: boolean;
  /** 避難支援等実施者がいる */
  hasSupporter: boolean;
  dementia: boolean;
};

/** 本人・家族からの信号。赤は 4 問の答えと録音の分類を持てる */
export type TriageSignal =
  | { color: "green" }
  | { color: "red"; injured?: boolean | null; canMove?: boolean | null; classes?: RecordingClass[] }
  | { color: "unknown" };

/** 災害の情報 */
export type Situation = {
  /** 発災からの時間 */
  hoursSinceDisaster: number;
  /** 停電が始まってからの時間。停電していなければ null */
  hoursSinceOutage: number | null;
};

/** ケアマネの上書き。理由が要る */
export type Override = {
  to: Color;
  /** 上書きしたときの表の色。表の色がこれより悪くなったら上書きは切れる */
  baseAtOverride: Color;
  reason: string;
  by: string;
  at: string;
};

export type TriageResult = {
  personId: string;
  /** 上書きを当てたあとの色 */
  color: Color;
  /** 表の色 */
  baseColor: Color;
  rule: RuleId;
  /** 並びの組: 0 赤（けが・動けない）・1 赤・2 黄・3 灰・4 緑 */
  group: 0 | 1 | 2 | 3 | 4;
  /** 時計の残りの短い物（時間）。時計が無ければ Infinity */
  remainingHours: number;
  tier: Tier;
  /** 理由 1 行 */
  reason: string;
  override?: Override & { expired: boolean };
};

export type TriageEntry = { person: TriagePerson; signal: TriageSignal; override?: Override };

const NOT_YET = "lib/triage はまだ中身が無い";

export function clockHours(_clock: TriageClock): number | null {
  throw new Error(NOT_YET);
}

export function tierOf(_person: TriagePerson): Tier {
  throw new Error(NOT_YET);
}

export function triage(_entry: TriageEntry, _situation: Situation): TriageResult {
  throw new Error(NOT_YET);
}

export function rank(_entries: ReadonlyArray<TriageEntry>, _situation: Situation): TriageResult[] {
  throw new Error(NOT_YET);
}
