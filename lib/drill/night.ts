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

/**
 * 夜間発災でない訓練の発災の時刻（時、0〜23。T165）。drills.started_at（発災）の日本の時刻。読めなければ null。
 * 前は夜間発災の訓練だけ時刻の 1 行を渡していて、昼の訓練の監督・世界・本人役が「夜になっても」「明け方」「二日目の昼」を
 * 経過と食い違う所に書いた（評価の 7 回目）。画面の時刻（lib/drill/time-text.ts の simTimeText）と同じ元
 */
export function startHourOf(startedAt: string): number | null {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return null;
  return (new Date(t).getUTCHours() + 9) % 24;
}

/** Claude に渡す 1 行（昼の訓練。T165）。「発災は 10 時ごろ。今は 2 日目の 22 時ごろ」 */
export function dayLine(hour: number, startHour: number): string {
  const total = startHour + Math.floor(Math.max(0, hour));
  const day = Math.floor(total / 24) + 1;
  return `発災は ${startHour} 時ごろ。今は ${day > 1 ? `${day} 日目の ` : ""}${total % 24} 時ごろ（朝・昼・夜の言い方はこの時刻に合わせる）`;
}

/** 時刻の 1 行（夜間発災は nightLine、ほかは発災の時刻があれば dayLine。T165）。無ければ空の配列 */
export function timeLines(hour: number, x: { night?: boolean; startHour?: number | null }): string[] {
  if (x.night) return [nightLine(hour)];
  return typeof x.startHour === "number" ? [dayLine(hour, x.startHour)] : [];
}
