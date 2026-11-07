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
 * 夜間発災でない訓練の発災の時刻（時、0 以上 24 未満。T165）。drills.started_at（発災）の日本の時刻。分は時の小数で持つ（10:50 は 10.833…。T182）。読めなければ null。
 * 前は夜間発災の訓練だけ時刻の 1 行を渡していて、昼の訓練の監督・世界・本人役が「夜になっても」「明け方」「二日目の昼」を
 * 経過と食い違う所に書いた（評価の 7 回目）。画面の時刻（lib/drill/time-text.ts の simTimeText）と同じ元。
 * T182: 前は時で切り捨て、10:50 の発災で帳面の「16 時 50 分ごろ」が画面の「17:40」より 50 分早かった（最大 59 分）
 */
export function startHourOf(startedAt: string): number | null {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return (((d.getUTCHours() + 9) % 24) * 60 + d.getUTCMinutes()) / 60;
}

/** 発災の時刻（時の小数）を分に（T182。浮動小数の 649.999… を 650 に） */
const startMinuteOf = (startHour: number): number => Math.round(startHour * 60);

/** Claude に渡す 1 行（昼の訓練。T165）。「発災は 10 時ごろ。今は 2 日目の 22 時ごろ」。発災に分があれば「10 時 50 分ごろ」（T182。10 分に丸めて切り捨てる） */
export function dayLine(hour: number, startHour: number): string {
  const start = clockOfMinute(0, startHour);
  const now = clockOfMinute(Math.max(0, hour) * 60, startHour);
  const startMin = Math.floor(start.min / 10) * 10;
  return `発災は ${start.hour} 時${startMin > 0 ? ` ${startMin} 分` : ""}ごろ。今は ${now.day > 1 ? `${now.day} 日目の ` : ""}${now.hour} 時ごろ（朝・昼・夜の言い方はこの時刻に合わせる）`;
}

/** 時刻の 1 行（夜間発災は nightLine、ほかは発災の時刻があれば dayLine。T165）。無ければ空の配列 */
export function timeLines(hour: number, x: { night?: boolean; startHour?: number | null }): string[] {
  if (x.night) return [nightLine(hour)];
  return typeof x.startHour === "number" ? [dayLine(hour, x.startHour)] : [];
}

/** 発災の時刻（時）。夜間発災は NIGHT_START_HOUR、ほかは発災の時刻。分からなければ null（T177。帳面・門・台が同じに引く） */
export function clockStartOf(x: { night?: boolean | undefined; startHour?: number | null | undefined }): number | null {
  if (x.night) return NIGHT_START_HOUR;
  return typeof x.startHour === "number" ? x.startHour : null;
}

/** 発災から minute 分の時計（何日目の何時何分）。startHour は時の小数（分を持つ。T182） */
export function clockOfMinute(minute: number, startHour: number): { day: number; hour: number; min: number } {
  const total = startMinuteOf(startHour) + Math.max(0, Math.round(minute));
  return { day: Math.floor(total / 1440) + 1, hour: Math.floor(total / 60) % 24, min: total % 60 };
}

/**
 * 発災から minute 分の時計の言い方（T177）。「16 時ごろ」「16 時 50 分ごろ」。今と違う日は「2 日目の 3 時ごろ」。分は 10 分に丸めて切り捨てる
 * （dayLine の「今は N 時ごろ」と同じ向き）。評価の 10 回目で、帳面の経過の数（予備も 7 時間に切れた）を本人役が時計の 7 時と言った
 */
export function clockWhen(minute: number, startHour: number, now: number): string {
  const c = clockOfMinute(minute, startHour);
  const m = Math.floor(c.min / 10) * 10;
  const day = c.day !== clockOfMinute(now, startHour).day ? `${c.day} 日目の ` : "";
  return `${day}${c.hour} 時${m > 0 ? ` ${m} 分` : ""}ごろ`;
}
