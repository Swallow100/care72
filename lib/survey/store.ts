// アンケートの表を読む・書く。D1 を引数で受ける（テストは node:sqlite）。
// T65 から: 共有のリンク（survey_shares）と答え（survey_responses、migrations/0016_survey_share.sql）。
// T42 の 1 人 1 本のリンク（survey_links・survey_answers）は作らず、行はそのまま残す（開くと受付終了）。
// 時刻は UTC の ISO 8601（toISOString の形）。同じ形なので文字のまま比べられる。

import type { D1Database } from "@cloudflare/workers-types";
import type { SurveyCreatorRole, SurveyResponseRow, SurveyShareRow } from "../db/types.ts";
import { answerId, answersOfRow, type SurveyAnswers } from "./answer.ts";
import { shareExpiresAt, shareState, SURVEY_MAX_ANSWERS, type ShareState } from "./share.ts";
import { isSurveyTokenShape, newSurveyToken } from "./token.ts";

export type NewShare = {
  officeId: string;
  memo: string;
  createdBy: string | null;
  createdRole: SurveyCreatorRole;
};

/** 共有のリンクを 1 つ作る。受付は締切まで（審査員は lib/survey/share.ts）、答えは 30 件まで */
export async function createSurveyShare(
  db: D1Database,
  share: NewShare,
  now: Date,
  token: string = newSurveyToken(),
): Promise<{ token: string; expiresAt: string; maxAnswers: number }> {
  const expiresAt = shareExpiresAt(now, share.createdRole === "judge");
  await db
    .prepare(
      `INSERT INTO survey_shares (token, office_id, memo, created_by, created_role, created_at, expires_at, max_answers)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(token, share.officeId, share.memo, share.createdBy, share.createdRole, now.toISOString(), expiresAt, SURVEY_MAX_ANSWERS)
    .run();
  return { token, expiresAt, maxAnswers: SURVEY_MAX_ANSWERS };
}

export type ShareLookup =
  | { kind: "open"; share: SurveyShareRow; answers: number }
  /** 期限を過ぎた・件数が上限に届いた・T42 の 1 人 1 本のリンク（もう受けない） */
  | { kind: "closed" }
  /** 無い・形の違う token */
  | { kind: "missing" };

/** token のリンクを探し、受け付けるかを返す。形の違う token は D1 を読まない */
export async function lookupSurveyShare(db: D1Database, token: unknown, nowIso: string): Promise<ShareLookup> {
  if (!isSurveyTokenShape(token)) return { kind: "missing" };
  const share = await db
    .prepare(
      `SELECT s.*, (SELECT count(*) FROM survey_responses r WHERE r.token = s.token) AS answers
         FROM survey_shares s WHERE s.token = ?1`,
    )
    .bind(token)
    .first<SurveyShareRow & { answers: number }>();
  if (share) {
    const { answers, ...row } = share;
    return shareState(row, answers, nowIso) === "open" ? { kind: "open", share: row, answers } : { kind: "closed" };
  }
  const legacy = await db.prepare("SELECT 1 AS x FROM survey_links WHERE token = ?1").bind(token).first<number>("x");
  return legacy ? { kind: "closed" } : { kind: "missing" };
}

export type SurveyShareItem = {
  token: string;
  memo: string;
  judge: boolean;
  state: ShareState;
  answers: number;
  maxAnswers: number;
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

export type SurveyOverview = { shares: SurveyShareItem[]; answers: SurveyAnswerItem[] };

/**
 * 事業所の画面の「アンケート」。リンクは新しい順、答えは送った順。
 * 審査員（judge）は審査員が作った物だけを見る（協力してくれる人の本物の答えを、審査員の鍵で読めないように）。
 * 審査員でない人は事業所の全部を見る（審査員の試しには印を付ける）。
 * 番号は本物（W）と試し（T）で別に数える。毎朝の戻しで試しが消えても、本物の番号は変わらない
 */
export async function loadSurveyOverview(
  db: D1Database,
  officeId: string,
  viewer: { judge: boolean },
  nowIso: string,
): Promise<SurveyOverview> {
  const only = viewer.judge ? " AND s.created_role = 'judge'" : "";
  const shares = await db
    .prepare(
      `SELECT s.*, (SELECT count(*) FROM survey_responses r WHERE r.token = s.token) AS answers
         FROM survey_shares s WHERE s.office_id = ?1${only} ORDER BY s.created_at DESC, s.token`,
    )
    .bind(officeId)
    .all<SurveyShareRow & { answers: number }>();
  const answers = await db
    .prepare(
      `SELECT r.*, s.memo AS memo, s.created_role AS created_role
         FROM survey_responses r JOIN survey_shares s ON s.token = r.token
        WHERE s.office_id = ?1${only} ORDER BY r.submitted_at, r.id`,
    )
    .bind(officeId)
    .all<SurveyResponseRow & { memo: string; created_role: SurveyCreatorRole }>();

  const seq = { real: 0, judge: 0 };
  return {
    shares: shares.results.map((r) => ({
      token: r.token,
      memo: r.memo,
      judge: r.created_role === "judge",
      state: shareState(r, r.answers, nowIso),
      answers: r.answers,
      maxAnswers: r.max_answers,
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
