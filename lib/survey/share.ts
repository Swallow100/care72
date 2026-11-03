// 共有のリンク（紙に刷る QR 1 つ）の受付の決まり（docs/tasks/T65.md、DECISIONS 11/3 23:1x）。定数はここ 1 か所。
// 画面の部品からも読むので、サーバーの物を import しない。

/** 受付の終わり（この時刻から受付終了）。2026-11-05（木）23:59 JST まで受ける = 11/6 0:00 JST の手前まで */
export const SURVEY_DEADLINE_ISO = "2026-11-05T15:00:00.000Z";

/** 1 本の共有のリンクで受ける答えの上限（件） */
export const SURVEY_MAX_ANSWERS = 30;

/**
 * 審査員が作るリンクの最短の受付（時間）。審査は 11/5 の受付のあとなので、締切だけだと作った瞬間に受付終了になる。
 * 審査員の物は本物と分けてあり、毎朝 4 時に消える（lib/seed/reset.ts）。本物の締切は動かさない（DECISIONS の案）
 */
export const JUDGE_SHARE_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** 作るリンクの受付の終わり。本物は締切、審査員は締切か作ってから 24 時間の遅い方 */
export function shareExpiresAt(now: Date, judge: boolean): string {
  if (!judge) return SURVEY_DEADLINE_ISO;
  const grace = new Date(now.getTime() + JUDGE_SHARE_HOURS * HOUR_MS).toISOString();
  return grace > SURVEY_DEADLINE_ISO ? grace : SURVEY_DEADLINE_ISO;
}

/** 受付の最後の時刻（画面に「期限 11/5 23:59」と出す。終わりの時刻の 1 ミリ秒前） */
export const lastMoment = (expiresAt: string): string => new Date(Date.parse(expiresAt) - 1).toISOString();

export type ShareState = "open" | "full" | "closed";

/** 受付の状態。件数が上限に届いた（full）・期限を過ぎた（closed）・受付中（open） */
export function shareState(row: { expires_at: string; max_answers: number }, answers: number, nowIso: string): ShareState {
  if (row.expires_at <= nowIso) return "closed";
  if (answers >= row.max_answers) return "full";
  return "open";
}
