// 所属なしの人をケアマネが自分の事業所に引き受ける（docs/tasks/T23.md）。入口は事業所の画面（/office）の「所属なし」の区分。
//
// - 一覧に出すのは、医療班・行政がその場で登録した（origin on_site）所属なしの人の カナ・年齢・避難所・登録の時刻だけ
//   （引き受ける前は本人のページを開けない。事業所の壁は lib/auth/scope.ts のまま）
// - 引き受けると事業所は自分の事業所、担当は自分（審査員のケアマネの役は山本。lib/office/scope.ts の defaultCareManagerId）。
//   本人の経過（kind note・source office・action taken、「引受 山本」）と事業所の経過（person_taken）に 1 行ずつ、1 つの batch で
// - 引き受けても医療班・行政の受け持ちは閉じない（受け持ちは避難所にいる間の物、引受は台帳の持ち主が決まること）
// - 審査員の壁（T81、lib/auth/wall.ts）: 審査員と審査員が足したアカウント（どれもデモ事業所）は、デモのアカウント（審査員など）が登録した人だけを
//   一覧・引受できる。デモ事業所の審査員でない人（山本）も同じ（デモ事業所に入った人は毎朝 4 時に消えるので、本物の登録を引き受けると消してしまう）。
//   ほかの事業所はその逆で、デモのアカウントが登録した人を出さない・引き受けない（毎朝消える見本の人を本物の事業所へ入れない）
// - 確認用の事業所（T144）も種の事業所で、自分の事業所のアカウントが登録した人だけ（審査員の登録と混ぜない）

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "../age.ts";
import { careManagerName } from "../office/people.ts";
import type { OfficeActor } from "../office/scope.ts";
import { officePayload } from "../office/timeline.ts";
import { shortJst } from "../disaster/state.ts";
import { DEMO_OFFICE_ID, isSeedOfficeId, SEED_OFFICE_IDS } from "../auth/demo.ts";
import { demoRegisteredSql, sandboxRegisteredSql } from "../auth/wall.ts";
import { isSandboxOfficeId } from "../office/sandbox-id.ts";
import { UNAFFILIATED_OFFICE_ID } from "./actor.ts";

export type UnaffiliatedItem = {
  id: string;
  kana: string;
  age: number | null;
  ageReported: boolean;
  /** 開いている受け持ちの避難所（いくつかあれば名前の順） */
  shelters: string[];
  /** 登録の時刻（ISO）と画面の言い方 */
  createdAt: string;
  createdWhen: string;
};

/**
 * 引き受ける人から見える所属なしの人（壁）。種の事業所（デモ事業所・確認用の事業所、T144）は自分の事業所のアカウントの登録だけ、
 * 審査員の試用事業所（T115）はその試用事業所のアカウントの登録だけ（T180。前はデモ事業所の登録）、
 * ほかに審査員の壁の中でほかの事業所にいる人はデモ事業所の登録だけ、ほかの事業所はどの種の事業所の登録も出さない
 */
export type UnaffiliatedViewer = Pick<OfficeActor, "officeId" | "walled">;

/** SQL の条件（alias は people の別名） */
function registeredBy(viewer: UnaffiliatedViewer, alias = "p"): string {
  if (isSeedOfficeId(viewer.officeId)) return demoRegisteredSql(alias, viewer.officeId);
  // 審査員の試用事業所（T180）: その試用事業所のアカウント（新規事業所の医療班の役）が登録した人だけ。デモの登録と混ぜない
  if (viewer.walled === true && isSandboxOfficeId(viewer.officeId)) return demoRegisteredSql(alias, viewer.officeId);
  if (viewer.walled === true) return demoRegisteredSql(alias, DEMO_OFFICE_ID);
  return `NOT ${demoRegisteredSql(alias, SEED_OFFICE_IDS)} AND NOT ${sandboxRegisteredSql(alias)}`;
}

/** 所属なしの人（その場で登録した人）。登録の新しい順。viewer は引き受ける人（officeActor。壁と事業所で出す人が変わる） */
export async function listUnaffiliated(db: D1Database, viewer: UnaffiliatedViewer, today: string): Promise<UnaffiliatedItem[]> {
  const res = await db
    .prepare(
      `SELECT p.id, p.kana, p.birth_date, p.reported_age, p.created_at,
              (SELECT json_group_array(DISTINCT c.shelter) FROM custody c WHERE c.person_id = p.id AND c.released_at IS NULL) AS shelters
         FROM people p
        WHERE p.office_id = ?1 AND p.origin = 'on_site' AND ${registeredBy(viewer)}
        ORDER BY p.created_at DESC, p.id`,
    )
    .bind(UNAFFILIATED_OFFICE_ID)
    .all<{ id: string; kana: string; birth_date: string | null; reported_age: number | null; created_at: string; shelters: string | null }>();
  return res.results.map((r) => {
    let shelters: string[] = [];
    try {
      const v = JSON.parse(r.shelters ?? "[]") as unknown;
      shelters = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").sort((a, b) => a.localeCompare(b, "ja")) : [];
    } catch {
      shelters = [];
    }
    return {
      id: r.id,
      kana: r.kana,
      age: r.birth_date ? ageOn(r.birth_date, today) : r.reported_age,
      ageReported: !r.birth_date && r.reported_age !== null,
      shelters,
      createdAt: r.created_at,
      createdWhen: shortJst(r.created_at),
    };
  });
}

export type TakeResult = { ok: true; personId: string } | { ok: false; error: "not_found" | "care_manager" };

/** 引き受ける。担当は actor の担当一覧の持ち主（審査員は山本）。所属なしの on_site の人で、一覧に出る人だけ（壁。ほかは not_found） */
export async function takeOver(db: D1Database, actor: OfficeActor, personId: string, at: string): Promise<TakeResult> {
  const cmId = actor.defaultCareManagerId;
  if (!cmId) return { ok: false, error: "care_manager" };
  const cm = await db
    .prepare("SELECT display_name FROM accounts WHERE id = ?1 AND office_id = ?2 AND role = 'care_manager'")
    .bind(cmId, actor.officeId)
    .first<{ display_name: string }>();
  if (!cm) return { ok: false, error: "care_manager" };
  const name = careManagerName(cm.display_name);

  const [moved] = await db.batch([
    db
      .prepare(
        `UPDATE people SET office_id = ?2, care_manager_id = ?3, version = version + 1, updated_at = ?4
          WHERE id = ?1 AND office_id = ?5 AND origin = 'on_site' AND ${registeredBy(actor, "people")}`,
      )
      .bind(personId, actor.officeId, cmId, at, UNAFFILIATED_OFFICE_ID),
    // 動いたときだけ（今この事業所にいて、この時刻に更新された）経過を書く
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at, created_at)
         SELECT ?1, p.id, ?2, ?3, 'note', ?4, ?5, NULL, ?6, ?6 FROM people p
          WHERE p.id = ?7 AND p.office_id = ?8 AND p.updated_at = ?6 AND p.care_manager_id = ?9`,
      )
      .bind(
        `tl-take-${crypto.randomUUID()}`,
        actor.authorId,
        actor.authorRole,
        name,
        officePayload("taken", { to: cmId }),
        at,
        personId,
        actor.officeId,
        cmId,
      ),
    db
      .prepare(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at, created_at)
         SELECT ?1, ?2, ?3, ?4, 'person_taken', ?5, ?6, ?7, ?7 FROM people p
          WHERE p.id = ?8 AND p.office_id = ?2 AND p.updated_at = ?7 AND p.care_manager_id = ?9`,
      )
      .bind(
        `ot-take-${crypto.randomUUID()}`,
        actor.officeId,
        actor.authorId,
        actor.authorRole,
        name,
        JSON.stringify({ personId, to: cmId }),
        at,
        personId,
        cmId,
      ),
  ]);
  return (moved.meta.changes ?? 0) > 0 ? { ok: true, personId } : { ok: false, error: "not_found" };
}
