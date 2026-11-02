// 事業所の壁。本人を読むときはここを通す（画面も API も）。
// ケアマネ・審査員（ケアマネの役）は自分の事業所の中だけ。違う事業所の本人の id を渡されても見つからない（404）。
// 本人・家族のスマホは自分の本人だけ。行政・医療班は受け持ちの範囲だけ（T23）: 自分のアカウントの開いた受け持ち
// （custody の released_at が NULL）がある本人。事業所はまたぐ。受け入れの前と、搬送・退所で閉じたあとは開けない。

import type { D1Database } from "@cloudflare/workers-types";
import type { PersonRow } from "../db/types.ts";
import type { Principal } from "./principal.ts";
import { canViewPage } from "./roles.ts";

export type CaseloadScope = { officeId: string; careManagerId: string };

/** 担当一覧の範囲。ケアマネは自分の担当、審査員（ケアマネの役）はデモ事業所の山本の担当 */
export function caseloadScope(p: Principal): CaseloadScope | null {
  if (!canViewPage(p.role, "caseload") || !p.office || !p.caseloadOf) return null;
  return { officeId: p.office.id, careManagerId: p.caseloadOf };
}

export type PersonScope =
  | { kind: "office"; officeId: string }
  | { kind: "own"; officeId: string; personId: string }
  | { kind: "custody"; holderId: string }
  | { kind: "none" };

export function personScope(p: Principal): PersonScope {
  switch (p.role) {
    case "care_manager":
      return p.office ? { kind: "office", officeId: p.office.id } : { kind: "none" };
    case "self":
    case "family":
      return p.office && p.personId ? { kind: "own", officeId: p.office.id, personId: p.personId } : { kind: "none" };
    case "government":
    case "medical":
      return p.accountId ? { kind: "custody", holderId: p.accountId } : { kind: "none" };
    case "unselected":
      return { kind: "none" };
  }
}

export type PersonBrief = Pick<
  PersonRow,
  "id" | "office_id" | "care_manager_id" | "name" | "kana" | "birth_date" | "plan_status" | "ledger"
>;

/** 範囲の中の本人を 1 人。範囲の外なら null（画面は 404） */
export async function personInScope(db: D1Database, p: Principal, personId: string): Promise<PersonBrief | null> {
  const s = personScope(p);
  if (s.kind === "none") return null;
  if (s.kind === "custody") {
    // 受け持ち（T23）。自分のアカウントの開いた受け持ちがある本人だけ。事業所はまたぐ
    return db
      .prepare(
        `SELECT p.id, p.office_id, p.care_manager_id, p.name, p.kana, p.birth_date, p.plan_status, p.ledger
           FROM people p
          WHERE p.id = ?1
            AND EXISTS (SELECT 1 FROM custody c WHERE c.person_id = p.id AND c.holder_id = ?2 AND c.released_at IS NULL)`,
      )
      .bind(personId, s.holderId)
      .first<PersonBrief>();
  }
  if (s.kind === "own" && s.personId !== personId) return null;
  return db
    .prepare(
      `SELECT id, office_id, care_manager_id, name, kana, birth_date, plan_status, ledger
         FROM people WHERE id = ?1 AND office_id = ?2`,
    )
    .bind(personId, s.officeId)
    .first<PersonBrief>();
}
