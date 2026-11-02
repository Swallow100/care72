// 災害モードを切り替え、災害の情報を入れられる人。ケアマネの役（管理者・審査員のケアマネの役を含む）で、事業所があること。
// 夜に管理者がいないことがあるので、管理者でないケアマネも押せる（docs/SPEC.md「画面 7 事業所の設定」）。誰が押したかは経過に残る。
// 行政・医療班は save を持つ（本人の経過を書き足す）が、事業所の状態は変えられない。本人・家族・役を選ぶ前の審査員も同じ。

import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import type { AuthorRole } from "../db/types.ts";

export type DisasterScope = {
  officeId: string;
  /** 経過の書き手。審査員は審査員のアカウント */
  authorId: string | null;
  authorRole: AuthorRole;
};

export function disasterScope(p: Principal | null): DisasterScope | null {
  if (!p || p.role !== "care_manager" || !p.office || !roleAllows(p.role, "save")) return null;
  return { officeId: p.office.id, authorId: p.accountId, authorRole: "care_manager" };
}
