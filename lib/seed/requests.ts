// 種の事業所（デモ・確認用）の「発災開始」で入れる医療班への受入依頼（docs/tasks/T163.md）。
// 審査員が医療班の役で受入一覧を開いたときに、ケアマネから届いた依頼が並んでいる形にする（訓練の外の受け入れの道を試せるように）。
//
// 選び方はルールの表の連絡順（様式 9 の自動の順位、lib/forms/form9-db.ts の loadForm9。手直しは当てない）の上から、
// 色が赤か黄で、医療班への提供に同意（granted）のある人を SEED_REQUEST_MAX 人まで。依頼の時刻は押した時刻の少し前で、連絡順の上の人ほど古い。
// 依頼した人は本人の担当のケアマネ、行き先は台帳の避難先 1（無ければ「指定避難所」）。行には seed の印（1）。
// もう一度押したとき（平時に戻したあと）は前の種の依頼を消して入れ直す。審査員が送った依頼中の人には足さない（同じ人の依頼中は 1 つ）。
// 毎朝 4 時の戻しと「最初に戻す」は事業所の依頼を全部消す（lib/seed/reset.ts の seedClear）。

import type { D1Database } from "@cloudflare/workers-types";
import { todayJst } from "../age.ts";
import { seedTargets } from "../auth/demo.ts";
import { parseLedger } from "../db/ledger.ts";
import { loadForm9, loadSituation } from "../forms/form9-db.ts";

export const SEED_REQUEST_MAX = 3;
/** 台帳に避難先 1 が無い人の行き先 */
export const SEED_REQUEST_FALLBACK_SHELTER = "指定避難所";

export function seedRequestId(personId: string): string {
  return `rq-seed-${personId}`;
}

/** 依頼に入れる人の id（連絡順の上から）。平時・種の事業所でなければ空 */
export async function seedRequestTargets(db: D1Database, officeId: string, at: string): Promise<string[]> {
  if (!seedTargets(officeId)) return [];
  const situation = await loadSituation(db, officeId, at);
  if (!situation) return [];
  const data = await loadForm9(db, { officeId }, { today: todayJst(new Date(at)), situation });
  if (!data) return [];
  const granted = await db
    .prepare(
      `SELECT person_id FROM consents WHERE kind = 'medical' AND status = 'granted'
          AND person_id IN (SELECT id FROM people WHERE office_id = ?1)`,
    )
    .bind(officeId)
    .all<{ person_id: string }>();
  const ok = new Set(granted.results.map((r) => r.person_id));
  return [...data.sheet.rows]
    .sort((a, b) => a.autoRank - b.autoRank)
    .filter((r) => (r.color === "red" || r.color === "yellow") && ok.has(r.id))
    .slice(0, SEED_REQUEST_MAX)
    .map((r) => r.id);
}

/** 種の依頼を入れ直す。入れた人の id を返す */
export async function seedStartRequests(db: D1Database, officeId: string, at: string): Promise<string[]> {
  const ids = await seedRequestTargets(db, officeId, at);
  const people = ids.length
    ? await db
        .prepare(`SELECT id, care_manager_id, ledger FROM people WHERE office_id = ?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(", ")})`)
        .bind(officeId, ...ids)
        .all<{ id: string; care_manager_id: string | null; ledger: string }>()
    : { results: [] };
  const byId = new Map(people.results.map((p) => [p.id, p]));
  const t = Date.parse(at);
  const statements = [db.prepare("DELETE FROM custody_requests WHERE office_id = ?1 AND seed = 1").bind(officeId)];
  ids.forEach((id, i) => {
    const p = byId.get(id);
    if (!p) return;
    const shelter = parseLedger(p.ledger).evacuation.destination1?.trim() || SEED_REQUEST_FALLBACK_SHELTER;
    // 連絡順の上の人ほど古い（医療班の一覧は古い順）。押した時刻より前（10 分 → 8 分 → 6 分前）
    const requestedAt = new Date(t - (10 - i * 2) * 60_000).toISOString();
    statements.push(
      db
        .prepare(
          `INSERT INTO custody_requests (id, person_id, office_id, requested_by, shelter, state, requested_at, seed)
           SELECT ?1, ?2, ?3, ?4, ?5, 'open', ?6, 1
            WHERE NOT EXISTS (SELECT 1 FROM custody_requests WHERE person_id = ?2 AND state = 'open')`,
        )
        .bind(seedRequestId(id), id, officeId, p.care_manager_id, shelter, requestedAt),
    );
  });
  await db.batch(statements);
  return ids;
}
