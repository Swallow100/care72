// デモ事業所を種に戻す（docs/tasks/T26.md の「最初に戻す」と毎日 4 時）。Worker の中から D1 と R2 を引数で受けて戻す。
// 協力事業所など別の事業所の行には触らない。
//
// 1 つの batch（取引）: デモ事業所の行を消す → 事業所・ケアマネの行を種に → 10 人 → 災害モードと山田の赤（lib/seed/demo.ts）。
// そのあとに終わった訓練（lib/seed/drill.ts。本物の startDrill・advanceDrill を回すので 12 回に分かれる）。
// 訓練の途中で止まっても、もう一度戻せば消してから作り直す（何度流しても同じ）。最後に R2 の録音を種の物だけにする。
//
// 消す範囲（DEMO_CLEAR。手元の npm run db:reset の CLEAR_ORDER と同じ表を全部並べ、テストが抜けを見る）:
// - デモ事業所の人と、その人に付いた行（連絡先・同意・時計・信号・経過・受け持ち・第三者提供・様式 9 の手直し）
// - 医療班・行政の役の審査員などデモ事業所のアカウントがその場で登録した所属なしの人（T23。先にデモ事業所へ移してから一緒に消す）
// - デモ事業所の訓練・事業所の経過・災害モード・様式の対応表、種に無いデモ事業所のアカウント（T30 で足したケアマネ）
// - 審査員が作ったアンケートのリンクと、その答え（T42。試しの答えを本物のケアマネの答えに混ぜない）
// 消さない物:
// - 審査員でない人（山本など）が作ったアンケートのリンクと答え（協力してくれるケアマネの本物の答え。毎朝消えては困る）。
//   送信の試みの数え（survey_attempts）も、戻すたびに 0 になると回数の上限が効かないので残す
// - AI の呼び出しの記録（ai_calls）。1 日の上限の数え。ボタンで戻すたびに数えが 0 に戻ると上限が効かないので残す
//   （日は JST で数えるので 0 時に変わる。docs/DECISIONS.md の (f) と違う所。docs/progress/t26.md）
// - ログインの失敗の数え（login_attempts、T41）。戻すたびに数えが消えると回数の制限が効かないので残す（1 日で消える）
// - 事業所の行（デモ事業所の名前などは種に上書き）。種のアカウントの行（山本のパスワードのハッシュは残し、ほかを種に上書き）
// - 別の事業所の人に付いた行（審査員が医療班の役で協力事業所の人を受け入れた受け持ちも、その人の行として残す）

import type { D1Database } from "@cloudflare/workers-types";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { UNAFFILIATED_OFFICE_ID } from "../custody/actor.ts";
import { SEED_ACCOUNTS, SEED_OFFICES, SEED_PEOPLE, SEED_AT } from "../../seed/people.ts";
import { CLEAR_ORDER, insert, lit, personStatements } from "../../seed/sql.ts";
import {
  DEMO_RECORDING_PREFIX,
  demoExtraStatements,
  SEED_RECORDING_KEYS,
  type SeedRecording,
} from "./demo.ts";
import { seedDrill } from "./drill.ts";

type Table = (typeof CLEAR_ORDER)[number];

const OFFICE = lit(DEMO_OFFICE_ID);
const UNAFFILIATED = lit(UNAFFILIATED_OFFICE_ID);
/** デモ事業所の人（所属なしの人は先にデモ事業所へ移す） */
const PEOPLE = `SELECT id FROM people WHERE office_id = ${OFFICE}`;
const DRILLS = `SELECT id FROM drills WHERE office_id = ${OFFICE}`;
/** 審査員がデモ事業所で作ったアンケートのリンク（T42） */
const JUDGE_SURVEY_LINKS = `SELECT token FROM survey_links WHERE office_id = ${OFFICE} AND created_role = 'judge'`;
const SEED_ACCOUNT_IDS =SEED_ACCOUNTS.filter((a) => a.office_id === DEMO_OFFICE_ID).map((a) => lit(a.id));

/** 表ごとに消す範囲（WHERE の中身）。null は消さない。CLEAR_ORDER と同じ順に流す */
export const DEMO_CLEAR: Readonly<Record<Table, string | null>> = {
  survey_answers: `token IN (${JUDGE_SURVEY_LINKS})`,
  survey_links: `office_id = ${OFFICE} AND created_role = 'judge'`,
  survey_attempts: null,
  timeline_entries: `person_id IN (${PEOPLE})`,
  office_timeline_entries: `office_id = ${OFFICE}`,
  third_party_provisions: `person_id IN (${PEOPLE})`,
  custody: `person_id IN (${PEOPLE})`,
  form9_rank_edits: `office_id = ${OFFICE} OR person_id IN (${PEOPLE})`,
  form_mappings: `office_id = ${OFFICE}`,
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

/** 所属なしの人のうち、デモ事業所のアカウント（審査員など）がその場で登録した人をデモ事業所へ移す（このあと一緒に消える） */
const ADOPT_UNAFFILIATED = `UPDATE people SET office_id = ${OFFICE}
 WHERE office_id = ${UNAFFILIATED} AND id IN (
   SELECT c.person_id FROM custody c JOIN accounts a ON a.id = c.holder_id
    WHERE c.via = 'on_site' AND a.office_id = ${OFFICE});`;

/** 事業所とアカウントは消さずに種へ上書き（山本のパスワードのハッシュは Worker が知らないので残す） */
function upsertStatements(): string[] {
  const out: string[] = [];
  for (const o of SEED_OFFICES) {
    if (o.id === DEMO_OFFICE_ID) {
      out.push(
        `${insert("offices", { ...o, created_at: SEED_AT }).replace(/;$/, "")} ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, city = excluded.city;`,
      );
    } else if (o.id === UNAFFILIATED_OFFICE_ID) {
      // 所属なしの事業所は無ければ作る（ほかの事業所の行には触らない）
      out.push(`${insert("offices", { ...o, created_at: SEED_AT }).replace(/;$/, "")} ON CONFLICT (id) DO NOTHING;`);
    }
  }
  for (const a of SEED_ACCOUNTS) {
    if (a.office_id !== DEMO_OFFICE_ID) continue;
    out.push(
      `${insert("accounts", { ...a, created_at: SEED_AT }).replace(/;$/, "")} ON CONFLICT (id) DO UPDATE SET office_id = excluded.office_id, role = excluded.role, is_office_admin = excluded.is_office_admin, display_name = excluded.display_name, login_id = excluded.login_id;`,
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
  return [ADOPT_UNAFFILIATED, ...clear, ...upsertStatements(), ...people, ...demoExtraStatements(now, recording)];
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
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix: DEMO_RECORDING_PREFIX, ...(cursor ? { cursor } : {}) });
    const keys = page.objects.map((o) => o.key).filter((k) => k.startsWith(DEMO_RECORDING_PREFIX) && !SEED_KEYS.has(k));
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

export type ResetResult = { recording: boolean; removedRecordings: number };

/** デモ事業所を種に戻す。now は種の時刻の元（ボタンは押した時刻、毎日 4 時は予定の時刻） */
export async function resetDemoOffice(db: D1Database, bucket: SeedBucket, now: string): Promise<ResetResult> {
  const recording = await findSeedRecording(bucket);
  await db.batch(demoResetStatements(now, recording).map((s) => db.prepare(s)));
  await seedDrill(db, now);
  const removedRecordings = await clearDemoRecordings(bucket);
  return { recording: recording !== null, removedRecordings };
}
