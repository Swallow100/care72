// 時間を使う手の見え方（docs/tasks/T110.md の 1）。ケアマネの時計のうち手に使った時間（埋まった時間）と、職員の空き・次に空く時刻。
// 画面（components/drill/ActionPanel の上の 1 行、DrillControls の「手の分」）に渡す。D1・Claude を読まない純な計算。色と順位は決めない。
//
// - 埋まった時間: AI も動かして進めた最後の区切り（aiAt）から今のケアマネの時計まで。手を打つたびに所要の分だけ伸び、
//   「手の分」・30 分・1 時間・3 時間・次まで のどれかで AI を動かすと 0 に戻る。刻みの道（10 分版・前からある訓練）は手の分の進めが無いので出さない
// - 職員: 空き（world.staff）と、出ている職員（訪問依頼で出向いた事業所の職員〔dispatched の back〕、arrivals の role staff で戻っていない物）、
//   次に空く時刻（出ている職員の戻る時刻と、ほかの事業所の応援が着く時刻のいちばん早い物）

import type { ActionRecord } from "./action-types.ts";
import type { Arrival, Dispatched } from "./scenarios.ts";

export type BusyView = {
  /** ケアマネの時計（発災からの分） */
  minute: number;
  /** AI も動かして進めた最後の区切り（発災からの分）。刻みの道は null */
  aiAt: number | null;
  /** 手に使った時間（分）。aiAt からケアマネの時計まで。刻みの道は null */
  used: number | null;
  /** その間に打った手の数 */
  acts: number;
  /** 職員の空き */
  staffFree: number;
  /** 出ている職員の数 */
  staffOut: number;
  /** 職員が次に空く時刻（発災からの分）。出ている職員も来る応援も無ければ null */
  nextFree: number | null;
};

/** 職員の出入り（出ている数と次に空く時刻） */
export function staffOf(world: { staff: number; dispatched?: ReadonlyArray<Dispatched>; arrivals?: ReadonlyArray<Arrival> }): Pick<
  BusyView,
  "staffFree" | "staffOut" | "nextFree"
> {
  const backs: number[] = [];
  let out = 0;
  for (const d of world.dispatched ?? []) {
    if (d.back === null) continue;
    out += 1;
    backs.push(d.back);
  }
  for (const a of world.arrivals ?? []) {
    if (a.role !== "staff" || a.back === null) continue;
    // 応援（本人の所へ向かわない。person 空）は出ている職員でなく、着いたら空きが 1 増える
    if (a.person) out += 1;
    backs.push(a.back);
  }
  return { staffFree: Math.max(0, world.staff), staffOut: out, nextFree: backs.length > 0 ? Math.min(...backs) : null };
}

/**
 * 時間を使う手の見え方。clock は連続の時計の訓練か（手の分の進めがある）、aiAt は AI を動かした最後の区切り（lib/drill/engine.ts の aiAtOf）
 */
export function busyOf(
  state: { minute: number; world: Parameters<typeof staffOf>[0]; actions: ReadonlyArray<Pick<ActionRecord, "atMinute">> },
  clock: { on: boolean; aiAt: number | null },
): BusyView {
  const aiAt = clock.on ? clock.aiAt : null;
  const from = aiAt ?? -1;
  return {
    minute: state.minute,
    aiAt,
    used: aiAt === null ? null : Math.max(0, Math.round(state.minute) - aiAt),
    acts: aiAt === null ? 0 : state.actions.filter((a) => a.atMinute >= from && a.atMinute < state.minute).length,
    ...staffOf(state.world),
  };
}

// ---------- 言葉 ----------

/** 画面の言葉（2〜4 字。lib/drill/labels.ts は触らない） */
export const BUSY_LABELS = {
  /** 手に使った時間（AI を動かした最後の区切りから） */
  used: "使用",
  /** その間の手の数 */
  acts: "手",
  staff: "職員",
  free: "空き",
  out: "外出",
  /** 職員が次に空く時刻 */
  next: "次空",
} as const;

/**
 * 手の打った時刻と終わる時刻（発災からの分）。同じ時間の中なら終わりは分だけ（「1 時間 5 分〜10 分」）、
 * 時間をまたげば両方（「0 時間 50 分〜1 時間 30 分」）
 */
export function spanLabel(at: number, end: number, minuteText: (m: number) => string): string {
  const a = Math.max(0, Math.round(at));
  const b = Math.max(a, Math.round(end));
  if (Math.floor(a / 60) === Math.floor(b / 60) && b % 60 !== 0 && a !== b) return `${minuteText(a)}〜${b % 60} 分`;
  return a === b ? minuteText(a) : `${minuteText(a)}〜${minuteText(b)}`;
}
