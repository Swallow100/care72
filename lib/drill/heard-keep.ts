// 訓練の通話で聞いた安否の至急維持（T84、docs/DECISIONS.md 11/4 12:4x「訓練の通話で聞いた「無事」も、本番の電話と同じく
// 本人の「けが」「動けない」を置き換えない（至急維持）。訓練が本番の練習になるように」）。D1 を使わない所。
//
// 本番の電話（lib/list/calls.ts の saveCall）は保存のときに、今の表の行が red_injury（本人・家族が答えた けが・動けない、
// ケアマネが直した分類）なら、「無事」と、けが・動けないのどちらも付けない「無事でない」を断る（どちらも連絡順の組を下げるため。
// 11/3 21:2x・T58 の答え）。訓練は本人役の様子から聞いた安否を決め（lib/drill/actions.ts の heardOf）、保存の所が signals に書く。
// 同じ線を、訓練の左の表に渡す所（lib/drill/view.ts の loadDrillScreen）で当てる: 人ごとに時刻の順に安否を読み、通話で聞いた
// 安否の前に表に渡した安否だけで表（lib/triage、変えない）を当て、その行が red_injury なら表に渡さない。画面には本番と同じ言葉
// （injuryRefusal「無事 不可（本人が「けが」）」）を出す。保存の時でなく読む時に当てるのは、手の途中で刻みを越えたときの
// 本人役の安否（同じ取引で書く）まで含めて、通話の時点の表で決めるため。再生も同じ道を通る。
// 訪問で着いた「確認済」は当てない（作者の決めは通話。docs/progress/t84.md の問い）。

import { injuryRefusal } from "../list/calls.ts";
import type { SignalForDetail } from "../list/detail.ts";
import type { RuleId, TriageSignal } from "../triage/index.ts";
import type { HeardSignal } from "./engine.ts";

type HeardRow = Pick<SignalForDetail, "id" | "person_id" | "color" | "injured" | "can_move" | "occurred_at">;

/** 聞いた安否が けが・動けない を保つ（赤で、けが か 動けない のどちらかを聞いた）。本番の saveCall の keepsInjury と同じ */
export function keepsInjury(s: Pick<HeardRow, "color" | "injured" | "can_move">): boolean {
  return s.color === "red" && (s.injured === 1 || s.can_move === 0);
}

/** 表の行を当てる（その人の、渡した安否だけで）。lib/drill/view.ts が担当一覧と同じ道（toCaseloadRows）で作る */
export type TriageAt = (personId: string, signals: ReadonlyArray<TriageSignal>) => { rule: RuleId; reason: string } | null;

export type HeardPass<S> = {
  /** 表に渡す安否（人ごと、読んだ順） */
  byPerson: Map<string, TriageSignal[]>;
  /** 表に渡す安否の行（行の詳細に出す物） */
  kept: S[];
  /** 表に渡さなかった安否の id → 画面の言葉（「無事 不可（本人が「けが」）」） */
  refused: Map<string, string>;
};

/**
 * 訓練の安否を表に渡すかを決める。rows は occurred_at・created_at・id の順（表と同じ読み順）。
 * 通話で聞いた安否（heard が call）のうち、「無事」と けが・動けない の無い「無事でない」で、now（見ている刻みの時刻）までの物だけを見る。
 * その安否の前に渡した安否で表を当て、行が red_injury なら渡さない。ほかは全部そのまま渡す（今までと同じ）
 */
export function passHeard<S extends HeardRow>(
  rows: ReadonlyArray<S>,
  heard: Readonly<Record<string, HeardSignal["via"]>>,
  toSignal: (s: S) => TriageSignal,
  now: string,
  triageAt: TriageAt,
): HeardPass<S> {
  const byPerson = new Map<string, TriageSignal[]>();
  const kept: S[] = [];
  const refused = new Map<string, string>();
  const until = Date.parse(now);
  for (const s of rows) {
    const mine = byPerson.get(s.person_id) ?? [];
    const lowers = heard[s.id] === "call" && (s.color === "green" || s.color === "red") && !keepsInjury(s);
    if (lowers && Date.parse(s.occurred_at) <= until) {
      const before = triageAt(s.person_id, mine);
      if (before?.rule === "red_injury") {
        refused.set(s.id, injuryRefusal({ color: s.color === "green" ? "green" : "red" }, before.reason));
        continue;
      }
    }
    byPerson.set(s.person_id, [...mine, toSignal(s)]);
    kept.push(s);
  }
  return { byPerson, kept, refused };
}
