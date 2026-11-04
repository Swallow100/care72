// アンケートの表を読む・書く。D1 を引数で受ける（テストは node:sqlite）。
// T65 から: 共有のリンク（survey_shares）と答え（survey_responses、migrations/0016_survey_share.sql）。
// T42 の 1 人 1 本のリンク（survey_links・survey_answers）は作らず、行はそのまま残す（開くと受付終了）。
// 時刻は UTC の ISO 8601（toISOString の形）。同じ形なので文字のまま比べられる。

import type { D1Database } from "@cloudflare/workers-types";
import type { SurveyCreatorRole, SurveyResponseRow, SurveyShareRow } from "../db/types.ts";
import { answerId, answersOfRow, type SurveyAnswers } from "./answer.ts";
import { jstDayStartIso, shareExpiresAt, shareState, SURVEY_MAX_ANSWERS, SURVEY_SHARES_PER_DAY, type ShareState } from "./share.ts";
import { isSurveyTokenShape, newSurveyToken } from "./token.ts";

export type NewShare = {
  officeId: string;
  memo: string;
  createdBy: string | null;
  createdRole: SurveyCreatorRole;
};

/**
 * 審査員の物（試し）か。審査員が作った（created_role judge）か、審査員が足したアカウント（accounts.judge_made、T81）が作った物。
 * 後者は T81 の前に作られた物（そのときは care_manager で入っていた）。s は survey_shares の別名
 */
export function judgeShareSql(alias = "s"): string {
  return `(${alias}.created_role = 'judge' OR ${alias}.created_by IN (SELECT ja.id FROM accounts ja WHERE ja.judge_made = 1))`;
}

export type CreateShareResult = { ok: true; token: string; expiresAt: string; maxAnswers: number } | { ok: false; error: "limited" };

/**
 * 共有のリンクを 1 つ作る。受付は締切まで（審査員は lib/survey/share.ts）、答えは 30 件まで。
 * 1 つの事業所で 1 日（JST）SURVEY_SHARES_PER_DAY 本まで（T81）。審査員の物と本物は別に数える。数えと入れるのは 1 文（同時に押しても超えない）
 */
export async function createSurveyShare(
  db: D1Database,
  share: NewShare,
  now: Date,
  token: string = newSurveyToken(),
): Promise<CreateShareResult> {
  const judge = share.createdRole === "judge";
  const expiresAt = shareExpiresAt(now, judge);
  const pool = judge ? judgeShareSql("c") : `NOT ${judgeShareSql("c")}`;
  const r = await db
    .prepare(
      `INSERT INTO survey_shares (token, office_id, memo, created_by, created_role, created_at, expires_at, max_answers)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        WHERE (SELECT count(*) FROM survey_shares c WHERE c.office_id = ?2 AND c.created_at >= ?9 AND ${pool}) < ?10`,
    )
    .bind(
      token,
      share.officeId,
      share.memo,
      share.createdBy,
      share.createdRole,
      now.toISOString(),
      expiresAt,
      SURVEY_MAX_ANSWERS,
      jstDayStartIso(now),
      SURVEY_SHARES_PER_DAY,
    )
    .run();
  if ((r.meta?.changes ?? 0) !== 1) return { ok: false, error: "limited" };
  return { ok: true, token, expiresAt, maxAnswers: SURVEY_MAX_ANSWERS };
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

/** 見る人（T81）。walled は審査員と審査員が足したアカウント（lib/auth/wall.ts）。admin は事業所の管理者、accountId は自分 */
export type SurveyViewer = { walled: boolean; admin: boolean; accountId: string | null };

/**
 * 事業所の画面の「アンケート」。リンクは新しい順、答えは送った順。
 * 審査員の壁の中（審査員・審査員が足したアカウント）は審査員の物（試し）だけを見る（協力してくれる人の本物の答えを、審査員の鍵で読めないように）。
 * 本物（審査員でない人が作ったリンクと答え）は、作った本人と、壁の外の管理者だけが見る（T81）。壁の外の管理者は事業所の全部（試しには印）、
 * 管理者でないケアマネは自分が作った本物だけ。
 * 番号は本物（W）と試し（T）で別に、事業所の全部で数える（見る人で番号が変わらない）。毎朝の戻しで試しが消えても、本物の番号は変わらない
 */
export async function loadSurveyOverview(
  db: D1Database,
  officeId: string,
  viewer: SurveyViewer,
  nowIso: string,
): Promise<SurveyOverview> {
  const judge = judgeShareSql("s");
  // リンクの絞り（答えの番号は全部で数えてから、同じ条件で絞る）
  const visible = viewer.walled ? ` AND ${judge}` : viewer.admin ? "" : ` AND NOT ${judge} AND s.created_by = ?2`;
  const shares = await db
    .prepare(
      `SELECT s.*, ${judge} AS judge_share, (SELECT count(*) FROM survey_responses r WHERE r.token = s.token) AS answers
         FROM survey_shares s WHERE s.office_id = ?1${visible} AND (?2 IS NULL OR ?2 IS NOT NULL) ORDER BY s.created_at DESC, s.token`,
    )
    .bind(officeId, viewer.accountId)
    .all<SurveyShareRow & { answers: number; judge_share: number }>();
  // 壁の中の人は試しだけ読む（本物の答えを読まない。試しの番号 T は試しだけで数えるので変わらない）
  const answers = await db
    .prepare(
      `SELECT r.*, s.memo AS memo, s.created_by AS share_created_by, ${judge} AS judge_share
         FROM survey_responses r JOIN survey_shares s ON s.token = r.token
        WHERE s.office_id = ?1${viewer.walled ? ` AND ${judge}` : ""} ORDER BY r.submitted_at, r.id`,
    )
    .bind(officeId)
    .all<SurveyResponseRow & { memo: string; share_created_by: string | null; judge_share: number }>();

  const sees = (judgeShare: boolean, createdBy: string | null): boolean =>
    viewer.walled ? judgeShare : viewer.admin || (!judgeShare && viewer.accountId !== null && createdBy === viewer.accountId);
  const seq = { real: 0, judge: 0 };
  const numbered = answers.results.map((r) => {
    const judgeShare = Number(r.judge_share) === 1;
    const n = judgeShare ? ++seq.judge : ++seq.real;
    return { r, judgeShare, n };
  });
  return {
    shares: shares.results.map((r) => ({
      token: r.token,
      memo: r.memo,
      judge: Number(r.judge_share) === 1,
      state: shareState(r, r.answers, nowIso),
      answers: r.answers,
      maxAnswers: r.max_answers,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
    answers: numbered
      .filter((x) => sees(x.judgeShare, x.r.share_created_by))
      .map(({ r, judgeShare, n }) => ({
        id: answerId(n, judgeShare),
        memo: r.memo,
        judge: judgeShare,
        submittedAt: r.submitted_at,
        answers: answersOfRow(r),
      })),
  };
}
