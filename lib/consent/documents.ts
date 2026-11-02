// 書類の範囲（docs/tasks/T24.md）。書類の頁（app/people/[id]/forms）が lib/consent/scope.ts の範囲を当てる所。
// 範囲の外の書類は開けない（頁は 404。壁の外と同じ返し方で、在ることも言わない）。
// 医療要約は医療班・行政の範囲（住所・本人の電話・支援者の名前と電話）に合わせて組む。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { MedicalBuildOptions, MedicalKey } from "../forms/medical-summary.ts";
import { loadPersonPage, type PersonPageRows } from "../person.ts";
import { canOpenDocument, peopleMode, scopeHas, scopeOfRows, type ScopeDocument, type ViewScope } from "./scope.ts";

/** 書類の頁の本人。壁（personInScope）の外か、範囲に無い書類なら null（頁は 404） */
export async function loadPersonDocument(
  db: D1Database,
  principal: Principal,
  personId: string,
  doc: ScopeDocument,
): Promise<{ rows: PersonPageRows; scope: ViewScope } | null> {
  const rows = await loadPersonPage(db, principal, personId);
  if (!rows) return null;
  const scope = scopeOfRows(principal.role, rows);
  return canOpenDocument(scope, doc) ? { rows, scope } : null;
}

/**
 * 医療要約の組み方。全部見える人（ケアマネ）は undefined（今までどおり）。
 * 本人の電話は基本の区分、住所は住所の範囲。人の一部なら連絡先の人は緊急連絡先だけ名前と電話で、支援者は役割名
 */
export function medicalSummaryView(scope: ViewScope): MedicalBuildOptions["view"] {
  const hide: MedicalKey[] = [];
  if (!scopeHas(scope, "basic")) hide.push("patient.phone");
  if (!scopeHas(scope, "address")) hide.push("patient.address");
  const partialPeople = peopleMode(scope) !== "all";
  if (hide.length === 0 && !partialPeople) return undefined;
  return { partialPeople, hide };
}
