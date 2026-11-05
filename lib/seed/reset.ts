// デモ事業所を種に戻す（docs/tasks/T26.md の「最初に戻す」と毎日 4 時）。Worker の中から D1 と R2 を引数で受けて戻す。
// 協力事業所など別の事業所の行には、審査員の受け持ちを閉じる（下の「閉じる物」）ほかは触らない。
//
// 1 つの batch（取引）: デモ事業所の行を消す → 事業所・ケアマネの行を種に → 10 人 → 災害モードと山田の赤（lib/seed/demo.ts）。
// そのあとに終わった訓練（lib/seed/drill.ts。本物の startDrill・advanceDrill を回すので 12 回に分かれる）。
// 訓練の途中で止まっても、もう一度戻せば消してから作り直す（何度流しても同じ）。最後に R2 の録音を種の物だけにする。
//
// 消す範囲（DEMO_CLEAR。手元の npm run db:reset の CLEAR_ORDER と同じ表を全部並べ、テストが抜けを見る）:
// - デモ事業所の人と、その人に付いた行（連絡先・同意・時計・信号・経過・受け持ち・第三者提供・様式 9 の手直し）
// - 医療班・行政の役の審査員などデモ事業所のアカウントがその場で登録した所属なしの人（T23。先にデモ事業所へ移してから一緒に消す）
// - デモ事業所の訓練・事業所の経過・災害モード・様式の対応表、種に無いデモ事業所のアカウント（T30 で足したケアマネ）
// - 審査員が作ったアンケートのリンクと、その答え（T42・T65。試しの答えを本物の答えに混ぜない）。審査員が足したアカウント（judge_made、T81）が
//   作った物も（T81 の前は care_manager の印で作られていた）。審査員が足したアカウントはデモ事業所の物なので、上のアカウントと一緒に消える
// 閉じる物（T81、朝の見直し 11/4 の安全 高 1）:
// - 審査員（acct-judge）と審査員が足したアカウントの開いた受け持ちのうち、上で消えずに残る物（T81 の前に審査員が医療班の役で受け入れた
//   ほかの事業所の人）。退所として閉じ（書き手は受け持った審査員、本文「退所」）、第三者提供の記録も閉じる。人と、ほかの人の受け持ちは残す
// 消さない物:
// - 審査員でない人（山本など）が作ったアンケートのリンクと答え（協力してくれるケアマネの本物の答え。毎朝消えては困る）。
//   送信の試みの数え（survey_attempts）も、戻すたびに 0 になると回数の上限が効かないので残す
// - AI の呼び出しの記録（ai_calls）。1 日の上限の数え。ボタンで戻すたびに数えが 0 に戻ると上限が効かないので残す
//   （日は JST で数えるので 0 時に変わる。docs/progress/t26.md）
// - ログインの失敗の数え（login_attempts、T41）。戻すたびに数えが消えると回数の制限が効かないので残す（1 日で消える）
// - 事業所の行（デモ事業所の名前などは種に上書き）。種のアカウントの行（山本のパスワードのハッシュは残し、ほかを種に上書き）
// - 別の事業所の人に付いた行（審査員が医療班の役で協力事業所の人を受け入れた受け持ちも、その人の行として残す。閉じるだけ）

import type { D1Database } from "@cloudflare/workers-types";
import { DEMO_JUDGE_ACCOUNT_ID, DEMO_OFFICE_ID, FIXED_ACCOUNT_IDS } from "../auth/demo.ts";
import { demoRegisteredSql } from "../auth/wall.ts";
import { UNAFFILIATED_OFFICE_ID } from "../custody/actor.ts";
import { RELEASE_LABELS } from "../custody/labels.ts";
import { CUSTODY_SOURCE } from "../custody/timeline.ts";
import { SEED_ACCOUNTS, SEED_OFFICES, SEED_PEOPLE, SEED_AT } from "../../seed/people.ts";
import { CLEAR_ORDER, insert, lit, personStatements } from "../../seed/sql.ts";
import {
  DEMO_RECORDING_PREFIX,
  demoExtraStatements,
  SEED_RECORDING_KEYS,
  type SeedRecording,
} from "./demo.ts";
import { seedDrill } from "./drill.ts";
import { pageImagePrefix } from "../forms/page-images.ts";

type Table = (typeof CLEAR_ORDER)[number];

const OFFICE = lit(DEMO_OFFICE_ID);
const UNAFFILIATED = lit(UNAFFILIATED_OFFICE_ID);
/** デモ事業所の人（所属なしの人は先にデモ事業所へ移す） */
const PEOPLE = `SELECT id FROM people WHERE office_id = ${OFFICE}`;
const DRILLS = `SELECT id FROM drills WHERE office_id = ${OFFICE}`;
/** 審査員が足した・再発行したアカウント（T81） */
const JUDGE_MADE = `SELECT id FROM accounts WHERE judge_made = 1`;
/** 審査員がデモ事業所で作った共有のリンク（T65）。審査員が足したアカウントが作った物も（T81） */
const JUDGE_SHARE_WHERE = `office_id = ${OFFICE} AND (created_role = 'judge' OR created_by IN (${JUDGE_MADE}))`;
const JUDGE_SURVEY_SHARES = `SELECT token FROM survey_shares WHERE ${JUDGE_SHARE_WHERE}`;
/** 審査員がデモ事業所で作ったアンケートのリンク（T42） */
const JUDGE_SURVEY_LINKS = `SELECT token FROM survey_links WHERE office_id = ${OFFICE} AND created_role = 'judge'`;
/** 消さないアカウント（種のデモ事業所の物）。変えられないアカウント（T61）と同じ 1 つの元から読む */
const SEED_ACCOUNT_IDS = FIXED_ACCOUNT_IDS.map((id) => lit(id));

/** 表ごとに消す範囲（WHERE の中身）。null は消さない。CLEAR_ORDER と同じ順に流す */
export const DEMO_CLEAR: Readonly<Record<Table, string | null>> = {
  // 気象庁の写し（T72）。事業所ごとでなく、5 分ごとの cron が入れ直す本物の情報なので消さない
  jma_quake_points: null,
  jma_quakes: null,
  jma_warnings: null,
  jma_entries: null,
  jma_fetch_state: null,
  survey_responses: `token IN (${JUDGE_SURVEY_SHARES})`,
  survey_shares: JUDGE_SHARE_WHERE,
  survey_answers: `token IN (${JUDGE_SURVEY_LINKS})`,
  survey_links: `office_id = ${OFFICE} AND created_role = 'judge'`,
  survey_attempts: null,
  timeline_entries: `person_id IN (${PEOPLE})`,
  office_timeline_entries: `office_id = ${OFFICE}`,
  third_party_provisions: `person_id IN (${PEOPLE})`,
  custody: `person_id IN (${PEOPLE})`,
  form9_rank_edits: `office_id = ${OFFICE} OR person_id IN (${PEOPLE})`,
  form_mappings: `office_id = ${OFFICE}`,
  // 様式の対応表の共有（T134）。事業所のデータでない（人の値も入らない）ので消さない
  form_shared_mappings: null,
  disaster_state: `office_id = ${OFFICE}`,
  ai_calls: null,
  // 世界の部屋（T50）の ID。事業所ごとでない
  ai_agents: null,
  login_attempts: null,
  signals: `person_id IN (${PEOPLE}) OR drill_id IN (${DRILLS})`,
  drill_events: `drill_id IN (${DRILLS}) OR person_id IN (${PEOPLE})`,
  drills: `office_id = ${OFFICE}`,
  clocks: `person_id IN (${PEOPLE})`,
  consents: `person_id IN (${PEOPLE})`,
  contacts: `person_id IN (${PEOPLE})`,
  people: `office_id = ${OFFICE}`,
  accounts: `office_id = ${OFFICE} AND id NOT IN (${SEED_ACCOUNT_IDS.join(", ")})`,
  offices: null,
};

/**
 * 所属なしの人のうち、デモ事業所のアカウント（審査員など）がその場で登録した人をデモ事業所へ移す（このあと一緒に消える）。
 * 範囲は審査員が探し・受け入れ・引き受けられる「デモの人」と同じ所から（lib/auth/wall.ts）
 */
const ADOPT_UNAFFILIATED = `UPDATE people SET office_id = ${OFFICE}
 WHERE office_id = ${UNAFFILIATED} AND ${demoRegisteredSql("people")};`;

/** 審査員と審査員が足したアカウント（受け持ちを閉じる相手。T81） */
const JUDGE_HOLDERS = `SELECT id FROM accounts WHERE id = ${lit(DEMO_JUDGE_ACCOUNT_ID)} OR judge_made = 1`;
const OPEN_JUDGE_CUSTODY = `holder_id IN (${JUDGE_HOLDERS}) AND released_at IS NULL`;

/**
 * 審査員の開いた受け持ちを閉じる（T81）。デモの人の受け持ちは消したあとなので、残るのはほかの事業所の人の物だけ。
 * 第三者提供の記録を閉じ、本人の経過に「退所」（書き手は受け持った審査員。lib/custody/store.ts の release と同じ形）、受け持ちを退所で閉じる。
 * 3 つとも「まだ開いている」を条件にするので、何度流しても 1 回だけ書く
 */
export function closeJudgeCustodyStatements(now: string): string[] {
  const at = lit(now);
  return [
    `UPDATE third_party_provisions SET closed_at = ${at}
      WHERE closed_at IS NULL AND custody_id IN (SELECT id FROM custody WHERE ${OPEN_JUDGE_CUSTODY});`,
    `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at, created_at)
      SELECT 'tl-cu-reset-' || c.id, c.person_id, c.holder_id, c.holder_role, 'released', ${lit(RELEASE_LABELS.discharged)},
             json_object('source', ${lit(CUSTODY_SOURCE)}, 'custodyId', c.id, 'shelter', c.shelter, 'release', 'discharged'), NULL, ${at}, ${at}
        FROM custody c WHERE c.holder_id IN (${JUDGE_HOLDERS}) AND c.released_at IS NULL;`,
    `UPDATE custody SET released_at = ${at}, release_kind = 'discharged', release_note = NULL, released_by = holder_id
      WHERE ${OPEN_JUDGE_CUSTODY};`,
  ];
}

/**
 * 事業所とアカウントは消さずに種へ上書き（山本のパスワードのハッシュは Worker が知らないので残す）。
 * 停止の印は戻す（固定のアカウントはサーバーが停止を断るので二重の守り。T61）
 */
function upsertStatements(): string[] {
  const out: string[] = [];
  for (const o of SEED_OFFICES) {
    if (o.id === DEMO_OFFICE_ID) {
      out.push(
        // 様式と地図の中心（T68）も種に戻す（審査員が様式を変えても毎朝松山市に戻る）
        `${insert("offices", { ...o, created_at: SEED_AT }).replace(/;$/, "")} ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, city = excluded.city, plan_form = excluded.plan_form, center_lat = excluded.center_lat, center_lng = excluded.center_lng;`,
      );
    } else if (o.id === UNAFFILIATED_OFFICE_ID) {
      // 所属なしの事業所は無ければ作る（ほかの事業所の行には触らない）
      out.push(`${insert("offices", { ...o, created_at: SEED_AT }).replace(/;$/, "")} ON CONFLICT (id) DO NOTHING;`);
    }
  }
  for (const a of SEED_ACCOUNTS) {
    if (a.office_id !== DEMO_OFFICE_ID) continue;
    out.push(
      `${insert("accounts", { ...a, created_at: SEED_AT }).replace(/;$/, "")} ON CONFLICT (id) DO UPDATE SET office_id = excluded.office_id, role = excluded.role, is_office_admin = excluded.is_office_admin, display_name = excluded.display_name, login_id = excluded.login_id, disabled_at = NULL;`,
    );
  }
  return out;
}

/** デモ事業所を種に戻す文（訓練と R2 のほか）。1 つの batch で流す */
export function demoResetStatements(now: string, recording: SeedRecording = null): string[] {
  const clear = CLEAR_ORDER.flatMap((t) => {
    const where = DEMO_CLEAR[t];
    return where === null ? [] : [`DELETE FROM ${t} WHERE ${where};`];
  });
  const people = SEED_PEOPLE.filter((p) => p.person.office_id === DEMO_OFFICE_ID).flatMap(personStatements);
  return [ADOPT_UNAFFILIATED, ...clear, ...closeJudgeCustodyStatements(now), ...upsertStatements(), ...people, ...demoExtraStatements(now, recording)];
}

// ---------- R2 ----------

/** R2 のうち使う所（配信は env.RECORDINGS、テストは偽物） */
export type SeedBucket = {
  head(key: string): Promise<unknown>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
  delete(keys: string[]): Promise<unknown>;
};

const SEED_KEYS: ReadonlySet<string> = new Set(Object.values(SEED_RECORDING_KEYS));

/** 作者が R2 に置いた種の録音（webm を先に）。無ければ null */
export async function findSeedRecording(bucket: SeedBucket): Promise<SeedRecording> {
  for (const key of Object.values(SEED_RECORDING_KEYS)) {
    if (await bucket.head(key)) return { key, durationSec: null };
  }
  return null;
}

/** デモ事業所の録音のうち、種でない物（審査員が本人のスマホで録った物など）を消す。消した数 */
export async function clearDemoRecordings(bucket: SeedBucket): Promise<number> {
  return clearPrefix(bucket, DEMO_RECORDING_PREFIX, SEED_KEYS);
}

/**
 * デモ事業所の様式の頁の画像（T86。lib/forms/page-images.ts）を消す。対応表（form_mappings）は戻しで消えるので、
 * 画像だけ R2 に残らないように。取り込んだ公式の原本（T101、forms/<事業所>/originals/）はデモのデータでないので残す。消した数
 */
export async function clearDemoFormPages(bucket: SeedBucket): Promise<number> {
  const prefix = pageImagePrefix(DEMO_OFFICE_ID);
  return clearPrefix(bucket, prefix, new Set(), `${prefix}originals/`);
}

/** R2 の頭の同じ物を消す（keep にある物と、skipPrefix の下は残す）。消した数。試用事業所の掃除（lib/seed/sandbox.ts、T115）も使う */
export async function clearPrefix(bucket: SeedBucket, prefix: string, keep: ReadonlySet<string> = new Set(), skipPrefix?: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    const keys = page.objects
      .map((o) => o.key)
      .filter((k) => k.startsWith(prefix) && !keep.has(k) && !(skipPrefix && k.startsWith(skipPrefix)));
    if (keys.length > 0) {
      await bucket.delete(keys);
      removed += keys.length;
    }
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }
  return removed;
}

// ---------- 全部 ----------

export type ResetResult = { recording: boolean; removedRecordings: number; removedFormPages: number };

/** デモ事業所を種に戻す。now は種の時刻の元（ボタンは押した時刻、毎日 4 時は予定の時刻） */
export async function resetDemoOffice(db: D1Database, bucket: SeedBucket, now: string): Promise<ResetResult> {
  const recording = await findSeedRecording(bucket);
  await db.batch(demoResetStatements(now, recording).map((s) => db.prepare(s)));
  await seedDrill(db, now);
  const removedRecordings = await clearDemoRecordings(bucket);
  const removedFormPages = await clearDemoFormPages(bucket);
  return { recording: recording !== null, removedRecordings, removedFormPages };
}
