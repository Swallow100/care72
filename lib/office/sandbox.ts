// 審査員の試用事業所（docs/tasks/T115.md）。審査員が役の一覧の「新規事業所」を押すと、そのセッションだけの空の事業所を作り、
// 審査員がその管理者（ケアマネの役）になる。デモ事業所（種の 10 人と山本）はそのまま残し、本物の事業所が最初にする流れ
// （地域の中心を置く → ケアマネ追加 → 利用者追加と台帳 → 経路と紙 → 訓練）を審査員が自分で試せるようにする。
//
// - 作る物: 事業所 1 行（kind regular・judge_sandbox 1・市は松山市・様式は松山市・中心は無し）と管理者 1 行（ケアマネ・管理者・judge_made 1・
//   ログインの ID とパスワードは無し）。行の形は作者の道具 tools/office/new-office.ts と同じ所（lib/office/create.ts）
// - 入れる道: 作った審査員のセッション（lib/auth/session.ts の judge の b に管理者の id。署名の中）だけ。管理者の行にログインの ID が無いので
//   ID とパスワードでは入れない。ほかの審査員のセッションは自分の b しか持たない
// - 壁: 中の人は審査員の壁の中（lib/auth/wall.ts）。ケアマネの役の範囲は自分の事業所だけ（lib/auth/scope.ts）。足したケアマネには印（judge_made）が付き、
//   そのケアマネで入っても同じ壁。医療班・本人・家族の役はデモ事業所のまま（試用事業所の人には届かない）
// - 上限: 生きている試用事業所が SANDBOX_LIMIT 件まで（毎朝 4 時に全部消えるので 1 日の数と同じ）。1 セッション 1 件（b が生きていれば作らない）
// - AI の 1 日の上限: デモ事業所と同じ数え（lib/claude/usage.ts の quotaOffice。審査員の呼び出しの合計は前と変わらない）
// - 毎朝 4 時の掃除: lib/seed/sandbox.ts。作り直しの守り（tools/deploy/guard.ts）は本物のデータに数えない

import type { D1Database } from "@cloudflare/workers-types";
import { JUDGE_LABEL, SANDBOX_LABELS } from "../auth/roles.ts";
import type { OfficeKind } from "../db/types.ts";
import { newOfficeRows, type Row } from "./create.ts";
import { newSandboxIds } from "./sandbox-id.ts";

/** 生きている試用事業所の上限（全部の審査員で） */
export const SANDBOX_LIMIT = 20;
/** 初めの市（松山市の様式が出るように）。審査員が /office の「地域」で直せる */
export const SANDBOX_CITY = "松山市";
/** 初めの様式（lib/forms/plan-form.ts の defaultPlanForm(SANDBOX_CITY) と同じ。テストが確かめる。plan-form.ts は重いので読まない） */
export const SANDBOX_PLAN_FORM = "matsuyama";

/** 作ったあと・選び直したあとの送り先。事業所の画面（lib/disaster/http.ts の OFFICE_PATH と同じ。テストが確かめる。準備の欄 T98 が一番上） */
export const SANDBOX_START_PATH = "/office";

/** SQL の条件: 事業所（alias の表の行）が試用事業所 */
export function sandboxOfficeSql(alias: string): string {
  return `${alias}.judge_sandbox = 1`;
}

/** 試用事業所の id の一覧（SQL） */
export const SANDBOX_OFFICES = `SELECT id FROM offices WHERE judge_sandbox = 1`;

export type SandboxAdmin = {
  accountId: string;
  displayName: string;
  /** 管理者のままか（試用事業所で足した管理者が外すと false） */
  admin: boolean;
  office: { id: string; name: string; kind: OfficeKind };
};

/**
 * セッションの b から、試用事業所の管理者。試用事業所でない・審査員が作った管理者の形でない（ログインの ID がある・印が無い・
 * ケアマネでない・停止）・消えた（毎朝 4 時の掃除）なら null
 */
export async function loadSandboxAdmin(db: D1Database, accountId: string): Promise<SandboxAdmin | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.display_name, a.is_office_admin, o.id AS office_id, o.name AS office_name, o.kind AS office_kind
         FROM accounts a JOIN offices o ON o.id = a.office_id
        WHERE a.id = ?1 AND a.role = 'care_manager' AND a.judge_made = 1 AND a.login_id IS NULL AND a.disabled_at IS NULL
          AND ${sandboxOfficeSql("o")}`,
    )
    .bind(accountId)
    .first<{ id: string; display_name: string; is_office_admin: 0 | 1; office_id: string; office_name: string; office_kind: OfficeKind }>();
  if (!row) return null;
  return {
    accountId: row.id,
    displayName: row.display_name,
    admin: Number(row.is_office_admin) === 1,
    office: { id: row.office_id, name: row.office_name, kind: row.office_kind },
  };
}

export type CreateSandboxResult = { ok: true; accountId: string; officeId: string } | { ok: false; error: "limit" };

/** 行の INSERT … SELECT（値は全部 bind。where は SELECT の後ろの条件） */
function insertSelect(db: D1Database, table: string, row: Row, where: string, extra: unknown[]) {
  const cols = Object.keys(row);
  const marks = cols.map((_, i) => `?${i + 1}`);
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(", ")}) SELECT ${marks.join(", ")} WHERE ${where.replaceAll("?N", `?${cols.length + 1}`)}`)
    .bind(...cols.map((c) => row[c] ?? null), ...extra);
}

/**
 * 試用事業所を 1 つ作る。上限に達していれば limit（何も入れない）。数えると入れるを 1 つの文で（同時に押しても上限を越えない）。
 * 管理者の行は事業所の行が入ったときだけ入る（1 つの batch）
 */
export async function createSandbox(
  db: D1Database,
  at: string,
  ids: { officeId: string; accountId: string } = newSandboxIds(),
  limit: number = SANDBOX_LIMIT,
): Promise<CreateSandboxResult> {
  const rows = newOfficeRows({
    officeId: ids.officeId,
    name: SANDBOX_LABELS.officeName,
    city: SANDBOX_CITY,
    planForm: SANDBOX_PLAN_FORM,
    accountId: ids.accountId,
    displayName: JUDGE_LABEL,
    loginId: null,
    passwordHash: null,
    at,
    sandbox: true,
  });
  const [office] = await db.batch([
    insertSelect(db, "offices", rows.office, `(SELECT count(*) FROM offices WHERE judge_sandbox = 1) < ?N`, [limit]),
    insertSelect(db, "accounts", rows.admin, `EXISTS (SELECT 1 FROM offices WHERE id = ?N AND judge_sandbox = 1)`, [ids.officeId]),
  ]);
  if ((office.meta.changes ?? 0) === 0) return { ok: false, error: "limit" };
  return { ok: true, accountId: ids.accountId, officeId: ids.officeId };
}
