// 訓練の経過と時刻の言い方（T100）。経過は「6 時間 10 分」（分が 0 なら「6 時間」）、時刻は「11/4 22:10」。
// 連続の時計（T90）で刻みの時刻が 30 分・1 時間・手の終わりの分になり、時間が小数（6.1666…）になる。画面・訓練記録の紙・
// 講評・監督・世界に渡す文の経過と時刻は、ここの関数だけで作る（小数の時間をそのまま書かない）。整数の時間は前と同じ文字。
// lib/drill のどこからでも読めるよう、lib/drill のほかのファイルを値で読まない（読み込みの輪に入らない）。

import { shortJst } from "../disaster/state.ts";

/** 時間と分の言葉（lib/drill/labels.ts の DRILL_LABELS.hours・ACTION_UI.minutes もここから） */
export const TIME_WORDS = { hours: "時間", minutes: "分" } as const;

const MINUTE_MS = 60_000;

/** 分に丸めた分（負は 0） */
function wholeMinutes(minute: number): number {
  return Math.max(0, Math.round(minute));
}

/** 発災からの分 → 経過「6 時間 10 分」（分が 0 なら「6 時間」、1 時間未満は「0 時間 30 分」）。分に丸める */
export function minuteText(minute: number): string {
  const m = wholeMinutes(minute);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} ${TIME_WORDS.hours}` : `${h} ${TIME_WORDS.hours} ${r} ${TIME_WORDS.minutes}`;
}

/** 発災からの時間（小数のこともある）→ 経過「6 時間 10 分」。分に丸める（小数の誤差 5.9999… は「6 時間」） */
export function hourText(hour: number): string {
  return minuteText(hour * 60);
}

/**
 * 発災からの時間の範囲。両端が整数の時間なら前からの形「6〜9 時間」、どちらかに分があれば「6 時間 10 分〜9 時間」。
 * 分に丸めてから比べる
 */
export function hourSpanText(from: number, to: number): string {
  const a = wholeMinutes(from * 60);
  const b = wholeMinutes(to * 60);
  if (a % 60 === 0 && b % 60 === 0) return `${a / 60}〜${b / 60} ${TIME_WORDS.hours}`;
  return `${minuteText(a)}〜${minuteText(b)}`;
}

/** 訓練の中の時刻「11/4 22:10」（日本の時刻）。開始の時刻（発災）から minute 分（分に丸める）。開始の時刻が読めなければそのまま */
export function simTimeText(startedAt: string, minute: number): string {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return startedAt;
  return shortJst(new Date(t + wholeMinutes(minute) * MINUTE_MS).toISOString());
}
