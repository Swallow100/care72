// 受け持つ人（行政・医療班。docs/tasks/T23.md）。受け持ちはアカウントごと（審査員は acct-judge）。
// ケアマネ・本人・家族・役を選ぶ前の審査員・アカウントの無い人は受け持てない（null）。

import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import type { StaffRole } from "../db/types.ts";

/** 所属なしの事業所の行（seed/people.ts の SEED_OFFICES と同じ id） */
export const UNAFFILIATED_OFFICE_ID = "office-unaffiliated";

export type StaffActor = {
  /** 受け持つアカウント（経過の書き手） */
  accountId: string;
  role: StaffRole;
  /** 相手の名前の写し（第三者提供の記録）。審査員は「審査員」 */
  name: string | null;
  judge: boolean;
};

export function staffActor(p: Principal | null): StaffActor | null {
  if (!p || (p.role !== "medical" && p.role !== "government") || !p.accountId || !roleAllows(p.role, "save")) return null;
  return { accountId: p.accountId, role: p.role, name: p.displayName, judge: p.judge };
}
