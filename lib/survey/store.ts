// アンケートの表（migrations/0004_survey.sql）を読む・書く。D1 を引数で受ける（テストは node:sqlite）。
// 時刻は UTC の ISO 8601（toISOString の形）。同じ形なので文字のまま比べられる。

import type { D1Database } from "@cloudflare/workers-types";
import type { SurveyAnswerRow, SurveyCreatorRole, SurveyLinkRow } from "../db/types.ts";
import { answerId, answersOfRow, type SurveyAnswers } from "./answer.ts";
import type { SurveyLinkState } from "./text.ts";
import { isSurveyTokenShape, newSurveyToken, SURVEY_TTL_DAYS } from "./token.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 宛先の控えの上限（字） */
export const MEMO_MAX = 40;

export type NewLink = {
  officeId: string;
  memo: string;
  createdBy: string | null;
  createdRole: SurveyCreatorRole;
};

/** リンクを 1 つ作る。期限は作ってから 14 日 */
export async function createSurveyLink(
  db: D1Database,
  link: NewLink,
  now: Date,
  token: string = newSurveyToken(),
): Promise<{ token: string; expiresAt: string }> {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SURVEY_TTL_DAYS * DAY_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO survey_links (token, office_id, memo, created_by, created_role, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(token, link.officeId, link.memo, link.createdBy, link.createdRole, createdAt, expiresAt)
    .run();
  return { token, expiresAt };
}

/** 答えられるリンクか（有る・使っていない・期限の前）。形の違う token は D1 を読まない */
export async function liveSurveyLink(db: D1Database, token: unknown, nowIso: string): Promise<SurveyLinkRow | null> {
  if (!isSurveyTokenShape(token)) return null;
  const row = await db.prepare("SELECT * FROM survey_links WHERE token = ?1").bind(token).first<SurveyLinkRow>();
  if (!row || row.used_at !== null || row.expires_at <= nowIso) return null;
  return row;
}

/**
 * 答えの頁を開いた。答えられるリンクなら、最初に開いた時刻を残して返す（2 度目からは変えない）。
 * 答えられないリンク（無い・使用済み・期限切れ）は null（頁は 404）
 */
export async function openSurveyLink(db: D1Database, token: unknown, nowIso: string): Promise<SurveyLinkRow | null> {
  const row = await liveSurveyLink(db, token, nowIso);
  if (!row) return null;
  if (row.opened_at === null) {
    await db.prepare("UPDATE survey_links SET opened_at = ?2 WHERE token = ?1 AND opened_at IS NULL").bind(row.token, nowIso).run();
    return { ...row, opened_at: nowIso };
  }
  return row;
}

export function linkState(row: Pick<SurveyLinkRow, "opened_at" | "used_at" | "expires_at">, nowIso: string): SurveyLinkState {
  if (row.used_at !== null) return "answered";
  if (row.expires_at <= nowIso) return "expired";
  return row.opened_at === null ? "unopened" : "opened";
}

export type SurveyLinkItem = {
  token: string;
  memo: string;
  judge: boolean;
  state: SurveyLinkState;
  createdAt: string;
  expiresAt: string;
};

export type SurveyAnswerItem = {
  /** W001…（審査員の試しは T001…）。送った順の通し番号 */
  id: string;
  memo: string;
  judge: boolean;
  submittedAt: string;
  answers: SurveyAnswers;
};

export type SurveyOverview = { links: SurveyLinkItem[]; answers: SurveyAnswerItem[] };

/**
 * 事業所の画面の「アンケート」。リンクは新しい順、答えは送った順。
 * 審査員（judge）は審査員が作った物だけを見る（協力してくれるケアマネの本物の答えを、審査員の鍵で読めないように）。
 * 審査員でない人は事業所の全部を見る（審査員の試しには印を付ける）。
 * 番号は本物（W）と試し（T）で別に数える。毎朝の戻しで試しが消えても、本物の番号は変わらない
 */
export async function loadSurveyOverview(
  db: D1Database,
  officeId: string,
  viewer: { judge: boolean },
  nowIso: string,
): Promise<SurveyOverview> {
  const only = viewer.judge ? " AND l.created_role = 'judge'" : "";
  const links = await db
    .prepare(
      `SELECT l.token, l.memo, l.created_role, l.created_at, l.opened_at, l.used_at, l.expires_at
         FROM survey_links l WHERE l.office_id = ?1${only} ORDER BY l.created_at DESC, l.token`,
    )
    .bind(officeId)
    .all<Pick<SurveyLinkRow, "token" | "memo" | "created_role" | "created_at" | "opened_at" | "used_at" | "expires_at">>();
  const answers = await db
    .prepare(
      `SELECT a.*, l.memo AS memo, l.created_role AS created_role
         FROM survey_answers a JOIN survey_links l ON l.token = a.token
        WHERE l.office_id = ?1${only} ORDER BY a.submitted_at, a.token`,
    )
    .bind(officeId)
    .all<SurveyAnswerRow & { memo: string; created_role: SurveyCreatorRole }>();

  const seq = { real: 0, judge: 0 };
  return {
    links: links.results.map((r) => ({
      token: r.token,
      memo: r.memo,
      judge: r.created_role === "judge",
      state: linkState(r, nowIso),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
    answers: answers.results.map((r) => {
      const judge = r.created_role === "judge";
      const n = judge ? ++seq.judge : ++seq.real;
      return { id: answerId(n, judge), memo: r.memo, judge, submittedAt: r.submitted_at, answers: answersOfRow(r) };
    }),
  };
}
