// 夜の発災（T59）。開始の前に「夜間発災」を選ぶと、発災は深夜 2 時ごろとして本人役・監督・世界に時刻の 1 行を渡す。
// drills.started_at はずらさない（simAt の時刻が全部ずれる）。ここは発災からの時間から「何時ごろ」を出すだけ。
// ルールの表（lib/triage）は時刻を読まないので、色・順は変わらない。

/** 夜の発災の時刻（時。深夜 2 時ごろ） */
export const NIGHT_START_HOUR = 2;

/** 発災から hour 時間の「何時ごろ」（0〜23。小数の時間は切り捨て） */
export function nightClock(hour: number): number {
  const h = Math.floor(NIGHT_START_HOUR + Math.max(0, hour));
  return ((h % 24) + 24) % 24;
}

/** Claude に渡す 1 行（画面の言葉ではない）。「発災は深夜 2 時ごろ。今は 5 時ごろ」 */
export function nightLine(hour: number): string {
  return `発災は深夜 ${NIGHT_START_HOUR} 時ごろ。今は ${nightClock(hour)} 時ごろ`;
}

/**
 * 訓練の画面の大きな経過の下に出す訓練の中の時刻（夜間発災のとき。「5:30」）。発災からの分 minute から、
 * 発災を深夜 2 時として出す。時は nightClock と同じ（棒の下の「今 N 時」と食い違わない）。started_at はずらさず表示だけ
 */
export function nightTimeLabel(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  return `${nightClock(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
