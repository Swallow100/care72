// 利用者を足す・担当を変える・一覧から外す人と、ケアマネを足す人（docs/tasks/T30.md、docs/SPEC.md「画面 7 事業所の設定」）。
//
// - 利用者追加・担当の割当・外す・戻す: ケアマネの役（管理者・管理者でないケアマネ・審査員のケアマネの役）。事業所の中だけ
// - ケアマネ追加: 事業所の管理者だけ。審査員のケアマネの役は管理者でない（lib/auth/principal.ts の judgePrincipal）ので足せない
// 行政・医療班（save は持つ）・本人・家族・役を選ぶ前の審査員は、どれもできない。

import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import type { AuthorRole } from "../db/types.ts";

export type OfficeActor = {
  officeId: string;
  /** 経過の書き手。審査員は審査員のアカウント */
  authorId: string | null;
  authorRole: AuthorRole;
  /** ケアマネを足せるか（事業所の管理者） */
  admin: boolean;
  /** 利用者追加の担当の既定（自分の担当一覧の持ち主。審査員は山本） */
  defaultCareManagerId: string | null;
};

export function officeActor(p: Principal | null): OfficeActor | null {
  if (!p || p.role !== "care_manager" || !p.office || !roleAllows(p.role, "save")) return null;
  return {
    officeId: p.office.id,
    authorId: p.accountId,
    authorRole: "care_manager",
    admin: p.admin && !p.judge,
    defaultCareManagerId: p.caseloadOf,
  };
}
