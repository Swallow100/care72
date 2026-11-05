// 手の時刻の書き方（docs/tasks/T128.md の 5）。時刻の範囲と所要を分けて書く: 訓練の中の時刻「13:44〜14:44」と「所要 60 分」、
// 所要の理由（浸水・夜間）は別の小さな文字で。前は発災からの経過で「1 時間〜2 時間」と書き、同じ時間の中なら終わりを分だけにして
// （「2 時間〜2 分」）、うしろに所要と理由を詰めて並べたので「2 時間 60 分」「2 分2 分」と読み違えた。
// 対応の結果・経過の対応・訓練記録の紙面・採点・職員の空き（次空）は全部ここで書く。
//
// 訓練の中の時刻は開始の時刻（drills.started_at、発災）から数える日本の時刻。夜間発災（T59）の訓練は発災を深夜 2 時として数える
// （lib/drill/night.ts の nightTimeLabel と同じ時刻。上の大きな経過の下の時刻と食い違わない）。日をまたぐ範囲は終わりに日付
// （夜間発災は「翌」）。元が無いとき（開始の時刻を渡せない所）は発災からの経過で、両端を略さずに書く。
// D1 を読まない。Claude を呼ばない。ブラウザの束にも入る。

import { NIGHT_START_HOUR } from "./night.ts";
import { minuteText, TIME_WORDS } from "./time-text.ts";

/** 訓練の中の時刻の元。startedAt は開始（発災）の時刻、night は夜間発災（T59） */
export type TimeBase = { startedAt: string; night: boolean };

export const ACT_TIME_LABELS = {
  /** 手に使う時間 */
  need: "所要",
  /** 夜間発災の訓練で日をまたいだ時刻の前 */
  nextDay: "翌",
} as const;

const MINUTE_MS = 60_000;
const JST_MS = 9 * 3_600_000;

/** 訓練の画面の状態から元を作る（開始の時刻と夜間発災か） */
export function timeBaseOf(startedAt: string, night: boolean | undefined): TimeBase {
  return { startedAt, night: night === true };
}

type Clock = { day: string; text: string };

/** 発災から minute 分の訓練の中の時刻（日の鍵と「14:05」）。開始の時刻が読めなければ null */
function clockOf(base: TimeBase, minute: number): Clock | null {
  const m = Math.max(0, Math.round(minute));
  if (base.night) {
    const all = NIGHT_START_HOUR * 60 + m;
    const day = Math.floor(all / 1440);
    const h = Math.floor(all / 60) % 24;
    return { day: String(day), text: `${h}:${String(all % 60).padStart(2, "0")}` };
  }
  const t = Date.parse(base.startedAt);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + m * MINUTE_MS + JST_MS);
  return {
    day: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    text: `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  };
}

/** 訓練の中の時刻「14:05」（夜間発災は深夜 2 時から「5:30」）。元が無ければ発災からの経過「3 時間 5 分」 */
export function clockText(base: TimeBase | null, minute: number): string {
  const c = base ? clockOf(base, minute) : null;
  return c ? c.text : minuteText(minute);
}

/**
 * 手の時刻の範囲「14:05〜15:05」。始まりと終わりが同じ分なら「14:05」。日をまたげば終わりに日付「23:40〜11/6 0:40」
 * （夜間発災は「翌 0:40」）。元が無ければ発災からの経過で両端を略さず「1 時間 5 分〜1 時間 10 分」
 */
export function actSpanText(base: TimeBase | null, at: number, end: number): string {
  const a = Math.max(0, Math.round(at));
  const b = Math.max(a, Math.round(end));
  const ca = base ? clockOf(base, a) : null;
  const cb = base ? clockOf(base, b) : null;
  if (!ca || !cb) return a === b ? minuteText(a) : `${minuteText(a)}〜${minuteText(b)}`;
  if (a === b) return ca.text;
  if (ca.day === cb.day) return `${ca.text}〜${cb.text}`;
  return `${ca.text}〜${base?.night ? ACT_TIME_LABELS.nextDay : cb.day} ${cb.text}`;
}

/** 所要「所要 60 分」（数字と単位の間は空ける。時刻の範囲とは別の言葉にして並べる） */
export function needText(minutes: number): string {
  return `${ACT_TIME_LABELS.need} ${Math.max(0, Math.round(minutes))} ${TIME_WORDS.minutes}`;
}

/** 所要の理由（「浸水・夜間」）。無ければ null。画面は所要とは別の小さな文字で、括弧に入れて並べる */
export function needWhyText(adds: ReadonlyArray<string> | undefined): string | null {
  return adds && adds.length > 0 ? adds.join("・") : null;
}
