// 審査員の試用事業所（T115、lib/office/sandbox.ts）の毎朝 4 時の掃除。デモ事業所の戻し（lib/seed/reset.ts）の隣で、同じ cron
// （lib/seed/cron.ts）から呼ぶ。試用事業所（offices.judge_sandbox = 1、migration 0027）を、人・台帳・訓練・アンケート・事業所の経過・
// アカウント（審査員の管理者と、そこで足したケアマネ）と R2（録音・様式の頁の画像と取り込んだ原本・訓練の声）ごと消す。
//
// 消す範囲（SANDBOX_CLEAR。手元の npm run db:reset の CLEAR_ORDER と同じ表を全部並べ、テストが抜けを見る）:
// - 試用事業所の人と、その人に付いた行（連絡先・同意・時計・信号・経過・受け持ち・第三者提供・様式 9 の手直し）
// - 試用事業所の訓練・事業所の経過・災害モード・様式の対応表・アンケートのリンクと答え・アカウント、事業所の行
// - ai_calls: 試用事業所の呼び出しはデモ事業所の数え（lib/claude/usage.ts の quotaOffice）で入るので、試用事業所の id の行は無いはず。
//   外部キー（ai_calls.office_id → offices）で事業所が消せなくならないよう、あれば消す
// 消さない物: ほかの事業所の行（デモ・本物・所属なし）、気象庁の写し、世界の部屋の ID、ログインと送信の数え（事業所ごとでない）
//
// 順: R2 を先に消してから D1（訓練の声 drill/<訓練>/ は訓練の id でしか引けないので、D1 を先に消すと翌朝に拾えない）。
// R2 の途中で落ちたら D1 は消さず、次の朝にもう一度（何度流しても同じ）。D1 は 1 つの batch（取引）で、外部キーで落ちれば何も消えない。

import type { D1Database } from "@cloudflare/workers-types";
import { CLEAR_ORDER } from "../../seed/sql.ts";
import { pageImagePrefix } from "../forms/page-images.ts";
import { SANDBOX_OFFICES } from "../office/sandbox.ts";
import { isSandboxOfficeId } from "../office/sandbox-id.ts";
import { clearPrefix, type SeedBucket } from "./reset.ts";

type Table = (typeof CLEAR_ORDER)[number];

const SB = SANDBOX_OFFICES;
const PEOPLE = `SELECT id FROM people WHERE office_id IN (${SB})`;
const DRILLS = `SELECT id FROM drills WHERE office_id IN (${SB})`;

/** 表ごとに消す範囲（WHERE の中身）。null は消さない。CLEAR_ORDER と同じ順に流す */
export const SANDBOX_CLEAR: Readonly<Record<Table, string | null>> = {
  jma_quake_points: null,
  jma_quakes: null,
  jma_warnings: null,
  jma_entries: null,
  jma_fetch_state: null,
  // アンケートの 4 表は 0021 で offices への外部キーが無いので、消さないと孤児が残る（デモの戻しはデモ事業所の物しか拾わない）
  survey_responses: `token IN (SELECT token FROM survey_shares WHERE office_id IN (${SB}))`,
  survey_shares: `office_id IN (${SB})`,
  survey_answers: `token IN (SELECT token FROM survey_links WHERE office_id IN (${SB}))`,
  survey_links: `office_id IN (${SB})`,
  survey_attempts: null,
  timeline_entries: `person_id IN (${PEOPLE})`,
  office_timeline_entries: `office_id IN (${SB})`,
  third_party_provisions: `person_id IN (${PEOPLE})`,
  custody: `person_id IN (${PEOPLE})`,
  form9_rank_edits: `office_id IN (${SB}) OR person_id IN (${PEOPLE})`,
  form_reviews: `office_id IN (${SB}) OR person_id IN (${PEOPLE})`,
  form_entries: `office_id IN (${SB}) OR person_id IN (${PEOPLE})`,
  form_assets: `office_id IN (${SB})`,
  form_mappings: `office_id IN (${SB})`,
  // 様式の対応表の共有（T134）。事業所のデータでないので試用事業所の掃除でも消さない
  form_shared_mappings: null,
  disaster_state: `office_id IN (${SB})`,
  ai_calls: `office_id IN (${SB})`,
  ai_agents: null,
  login_attempts: null,
  phone_accounts: `person_id IN (${PEOPLE})`,
  push_subscriptions: `person_id IN (${PEOPLE})`,
  signals: `person_id IN (${PEOPLE}) OR drill_id IN (${DRILLS})`,
  drill_events: `drill_id IN (${DRILLS}) OR person_id IN (${PEOPLE})`,
  drills: `office_id IN (${SB})`,
  clocks: `person_id IN (${PEOPLE})`,
  consents: `person_id IN (${PEOPLE})`,
  contacts: `person_id IN (${PEOPLE})`,
  people: `office_id IN (${SB})`,
  accounts: `office_id IN (${SB})`,
  offices: `judge_sandbox = 1`,
};

/** 試用事業所を消す文（R2 のほか）。1 つの batch で流す */
export function sandboxClearStatements(): string[] {
  return CLEAR_ORDER.flatMap((t) => {
    const where = SANDBOX_CLEAR[t];
    return where === null ? [] : [`DELETE FROM ${t} WHERE ${where};`];
  });
}

/** 消す試用事業所と、その訓練の id（R2 の頭を作るため） */
export async function sandboxTargets(db: D1Database): Promise<{ offices: string[]; drills: string[] }> {
  const [offices, drills] = await Promise.all([
    db.prepare(`${SB} ORDER BY id`).all<{ id: string }>(),
    db.prepare(`${DRILLS} ORDER BY id`).all<{ id: string }>(),
  ]);
  return { offices: offices.results.map((r) => r.id), drills: drills.results.map((r) => r.id) };
}

/**
 * 試用事業所の R2 の頭: 録音 recordings/<事業所>/（lib/signals/save.ts の recordingKey）、様式の頁の画像と取り込んだ原本
 * forms/<事業所>/（lib/forms/page-images.ts・originals.ts）、訓練の声 drill/<訓練>/（lib/drill/voice.ts の voiceKey）。
 * 声の共有の置き場（voice/…）とデモ事業所の頭は入らない
 */
export function sandboxR2Prefixes(t: { offices: readonly string[]; drills: readonly string[] }): string[] {
  // 念のため: 事業所の R2 は試用事業所の id の頭（office-sbx-）を持つ物だけ（印の付いた本物の事業所があっても録音と原本は消さない）。
  // 空の id（頭が recordings/ だけになり全部に当たる）も作らない
  const offices = t.offices.filter((id) => isSandboxOfficeId(id) && !id.includes("/"));
  const drills = t.drills.filter((id) => id.length > 0 && !id.includes("/"));
  return [...offices.flatMap((id) => [`recordings/${id}/`, pageImagePrefix(id)]), ...drills.map((id) => `drill/${id}/`)];
}

export type SandboxCleanResult = { offices: number; drills: number; removedObjects: number };

/** 試用事業所を全部消す（R2 → D1）。無ければ何もしない */
export async function clearSandboxes(db: D1Database, bucket: SeedBucket): Promise<SandboxCleanResult> {
  const targets = await sandboxTargets(db);
  if (targets.offices.length === 0) return { offices: 0, drills: 0, removedObjects: 0 };
  let removedObjects = 0;
  for (const prefix of sandboxR2Prefixes(targets)) removedObjects += await clearPrefix(bucket, prefix);
  await db.batch(sandboxClearStatements().map((s) => db.prepare(s)));
  return { offices: targets.offices.length, drills: targets.drills.length, removedObjects };
}
