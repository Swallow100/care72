// スマホ入口の発行・再発行（app/api/people/[id]/phone/route.ts の中身。T69a）。D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
// ケアマネ（審査員のケアマネの役を含む）だけ。壁は本人のページと同じ（personInScope、範囲の外は 404）。医療班・行政・本人・家族は 403。
// 一覧から外した人には出さない（開く口も通さないので、出しても開けない。戻してから発行する）。
// 版を 1 つ上げ、前の版のリンクと、そのリンクで開いたセッションを全部無効にする。経過に「スマホ入口 発行／再発行」。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import { issuePhoneLink, loadPhoneLinkRow } from "./phone-link-store.ts";

export type PhoneLinkIssueResult =
  | { ok: true; personId: string; generation: number }
  | { ok: false; error: "login_required" | "forbidden" | "not_found" | "unlisted" };

export const PHONE_LINK_ISSUE_STATUS = { login_required: 401, forbidden: 403, not_found: 404, unlisted: 409 } as const;

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
  const issued = await issuePhoneLink(db, { officeId: p.office.id, authorId: p.accountId }, brief.id, nowIso);
  if (!issued) return { ok: false, error: "not_found" };
  return { ok: true, personId: brief.id, generation: issued.phone_link_generation };
}
