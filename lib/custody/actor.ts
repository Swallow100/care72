// 受け持つ人（行政・医療班。docs/tasks/T23.md）。受け持ちはアカウントごと（審査員は acct-judge）。
// ケアマネ・本人・家族・役を選ぶ前の審査員・アカウントの無い人は受け持てない（null）。
// 審査員（壁の中、lib/auth/wall.ts）は、検索・避難所・受入・QR 受入・受け持ちの一覧・本人のページがデモの人だけ（T81）。
// 役を替えた山本（確認用の事業所、T144）は確認用の事業所の人だけ（wallOffice）。

import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { isWalled, wallOfficeOf } from "../auth/wall.ts";
import type { StaffRole } from "../db/types.ts";

/** 所属なしの事業所の行（seed/people.ts の SEED_OFFICES と同じ id。定義は lib/auth/demo.ts） */
export { UNAFFILIATED_OFFICE_ID } from "../auth/demo.ts";

export type StaffActor = {
  /** 受け持つアカウント（経過の書き手） */
  accountId: string;
  role: StaffRole;
  /** 相手の名前の写し（第三者提供の記録）。審査員は「審査員」 */
  name: string | null;
  judge: boolean;
  /** 審査員の壁の中（T81）。デモの人だけを探し・受け入れ・開ける */
  walled: boolean;
  /** 壁の中の人が見る種の事業所（T144、lib/auth/wall.ts の wallOfficeOf）。無いのはデモ事業所 */
  wallOffice?: string;
};

export function staffActor(p: Principal | null): StaffActor | null {
  if (!p || (p.role !== "medical" && p.role !== "government") || !p.accountId || !roleAllows(p.role, "save")) return null;
  return { accountId: p.accountId, role: p.role, name: p.displayName, judge: p.judge, walled: isWalled(p), wallOffice: wallOfficeOf(p) };
}
