// 事業所と最初の管理者の 2 行（docs/tasks/T73.md の 3、T115）。作る所は 2 つあり、同じ行の形をここから取る:
// - 作者の端末の道具 tools/office/new-office.ts: 本物の事業所。行を SQL の文字にしてファイルに書き、作者が D1 に入れる
// - 審査員の試用事業所 lib/office/sandbox.ts: 審査員が役の一覧の「新規事業所」を押したときにサーバーが作る（印 judge_sandbox・judge_made が 1、
//   管理者にログインの ID とパスワードは無い。入れるのは作った審査員のセッションだけ）
// 事業所は kind regular（本物の事業所が最初にする流れと同じ）。中心（T68 の center_lat・center_lng）は入れない（NULL。管理者が /office の「地域」で置く）。

import type { SqlValue } from "../../seed/sql.ts";

export type NewOfficeRowsInput = {
  officeId: string;
  name: string;
  city: string;
  /** 計画書の様式（lib/forms/plan-form.ts の defaultPlanForm など） */
  planForm: string;
  accountId: string;
  displayName: string;
  /** 本物の事業所はログインの ID とハッシュ。試用事業所は null（ログインできない管理者） */
  loginId: string | null;
  passwordHash: string | null;
  at: string;
  /** 審査員の試用事業所（T115）。事業所に judge_sandbox、管理者に judge_made を付ける */
  sandbox?: boolean;
};

/** 表の列の名前 → 値（seed/sql.ts の insert にそのまま渡せる形） */
export type Row = Record<string, SqlValue>;

/** 事業所の 1 行と管理者（ケアマネ・管理者）の 1 行 */
export function newOfficeRows(o: NewOfficeRowsInput): { office: Row; admin: Row } {
  const office: Row = { id: o.officeId, name: o.name, kind: "regular", city: o.city, plan_form: o.planForm, created_at: o.at };
  const admin: Row = {
    id: o.accountId,
    office_id: o.officeId,
    role: "care_manager",
    is_office_admin: 1,
    display_name: o.displayName,
    login_id: o.loginId,
    password_hash: o.passwordHash,
    created_at: o.at,
  };
  if (o.sandbox) {
    office.judge_sandbox = 1;
    admin.judge_made = 1;
  }
  return { office, admin };
}
