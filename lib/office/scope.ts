// 利用者を足す・担当を変える・一覧から外す人と、ケアマネを足す人（docs/tasks/T30.md、docs/SPEC.md「画面 7 事業所の設定」）。
//
// - 利用者追加・担当の割当・外す・戻す: ケアマネの役（管理者・管理者でないケアマネ・審査員のケアマネの役）。事業所の中だけ
// - ケアマネ追加・変更（改名・管理者・停止・再発行。T61）: 事業所の管理者と、審査員のケアマネの役（デモ事業所の管理者として扱う。T79、
//   11/4 の点検の中 12）。固定のアカウント（山本・西村・審査員。lib/auth/demo.ts）はサーバーが断る。審査員が足したケアマネは
//   毎朝 4 時の戻し（lib/seed/reset.ts）で消える。審査員が足した・再発行したアカウントには印（accounts.judge_made、T81）を付け、
//   そのアカウントで入っても審査員と同じ壁（lib/auth/wall.ts）。壁の中の人が変えられるのは印の付いたアカウントだけ
//   （審査員でない人が足した本物のアカウントの再発行で、その人として入れないように）
// - 事業所の地域（市と地図の中心）: 管理者だけ。審査員は見るだけ（変えるとほかの審査員の地図の真ん中が翌朝まで動くので）。
//   審査員の試用事業所（T115、lib/office/sandbox.ts）では審査員が管理者として置く（その審査員だけの事業所）
// 行政・医療班（save は持つ）・本人・家族・役を選ぶ前の審査員は、どれもできない。

import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { isWalled } from "../auth/wall.ts";
import type { AuthorRole } from "../db/types.ts";

export type OfficeActor = {
  officeId: string;
  /** 経過の書き手。審査員は審査員のアカウント */
  authorId: string | null;
  authorRole: AuthorRole;
  /** ケアマネを足す・変えられるか（事業所の管理者と、審査員のケアマネの役。審査員はデモ事業所の管理者として扱う） */
  admin: boolean;
  /** 事業所の地域（市と中心）を書けるか（事業所の管理者だけ。審査員は見るだけ） */
  placeEdit: boolean;
  /** 利用者追加の担当の既定（自分の担当一覧の持ち主。審査員は山本） */
  defaultCareManagerId: string | null;
  /**
   * 審査員の壁の中（審査員と、審査員が足したアカウント。T81）。足すケアマネに印を付け、変えられるのは印の付いた人だけ、
   * 所属なしの引受はデモのアカウントが登録した人だけ。officeActor は必ず入れる（無いのは壁の外）
   */
  walled?: boolean;
};

export function officeActor(p: Principal | null): OfficeActor | null {
  if (!p || p.role !== "care_manager" || !p.office || !roleAllows(p.role, "save")) return null;
  const walled = isWalled(p);
  return {
    officeId: p.office.id,
    authorId: p.accountId,
    authorRole: "care_manager",
    admin: p.admin || p.judge,
    // 審査員が足して管理者にしたアカウントも、事業所の地域は書けない（審査員と同じ）。
    // 例外は審査員の試用事業所の管理者の役（T115）: その審査員のセッションだけの事業所で、変えてもほかの審査員の地図は動かない
    placeEdit: p.admin && (!walled || p.sandbox === true),
    defaultCareManagerId: p.caseloadOf,
    walled,
  };
}
