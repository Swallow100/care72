// スマホ入口の発行・再発行（app/api/people/[id]/phone/route.ts の中身。T69a）。D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
// ケアマネ（審査員のケアマネの役を含む）だけ。壁は本人のページと同じ（personInScope、範囲の外は 404）。医療班・行政・本人・家族は 403。
// 一覧から外した人には出さない（開く口も通さないので、出しても開けない。戻してから発行する）。
// 同意の無い人には出さない（T147。本人・家族の頁は同意が前提。見る同意は PHONE_LINK_CONSENT〔計画共有〕で、同意ありのときだけ。
// 未確認・同意なしは 409「同意なし」。新しく足した人は同意が全部「未確認」なので、本人のページで同意を記録してから発行する）。
// 版を 1 つ上げ、前の版のリンクと、そのリンクで開いたセッションを全部無効にする。経過に「スマホ入口 発行／再発行」。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import type { ConsentKind } from "../db/types.ts";
import { issuePhoneLink, loadPhoneLinkRow } from "./phone-link-store.ts";

/** スマホ入口を作る前に見る同意（T147。docs/DECISIONS.md「仮名化・同意・個人情報」の案） */
export const PHONE_LINK_CONSENT: ConsentKind = "plan_share";

/** スマホ入口を作れるか（その同意が「同意あり」か。行が無ければ未確認） */
export async function phoneLinkConsented(db: D1Database, personId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT status FROM consents WHERE person_id = ?1 AND kind = ?2")
    .bind(personId, PHONE_LINK_CONSENT)
    .first<{ status: string }>();
  return row?.status === "granted";
}

export type PhoneLinkIssueResult =
  | { ok: true; personId: string; generation: number }
  | { ok: false; error: "login_required" | "forbidden" | "not_found" | "unlisted" | "no_consent" };

export const PHONE_LINK_ISSUE_STATUS = { login_required: 401, forbidden: 403, not_found: 404, unlisted: 409, no_consent: 409 } as const;

export async function issuePhoneLinkFor(
  db: D1Database,
  p: Principal | null,
  personId: string,
  nowIso: string,
): Promise<PhoneLinkIssueResult> {
  if (!p) return { ok: false, error: "login_required" };
  if (p.role !== "care_manager" || !p.office || !roleAllows(p.role, "save")) return { ok: false, error: "forbidden" };
  const brief = await personInScope(db, p, personId);
  if (!brief) return { ok: false, error: "not_found" };
  const row = await loadPhoneLinkRow(db, brief.id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.unlisted_at !== null) return { ok: false, error: "unlisted" };
  if (!(await phoneLinkConsented(db, brief.id))) return { ok: false, error: "no_consent" };
  const issued = await issuePhoneLink(db, { officeId: p.office.id, authorId: p.accountId }, brief.id, nowIso);
  if (!issued) return { ok: false, error: "not_found" };
  return { ok: true, personId: brief.id, generation: issued.phone_link_generation };
}
