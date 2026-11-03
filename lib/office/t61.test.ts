// アカウントの幅（docs/tasks/T61.md）: 名前の変更・管理者の付け外し・停止と再開・パスワードの再発行・自分のパスワードの変更。
// 種のデモ事業所のアカウント（山本・審査員）は固定で、どの操作もサーバーが断る。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。

import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS } from "../../seed/people.ts";
import { DEMO_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID, DEMO_OFFICE_ID, FIXED_ACCOUNT_IDS, isFixedAccount } from "../auth/demo.ts";

describe("固定のアカウント", () => {
  it("種のデモ事業所のアカウント（山本・審査員）と同じ集合", () => {
    const seed = SEED_ACCOUNTS.filter((a) => a.office_id === DEMO_OFFICE_ID).map((a) => a.id);
    expect([...FIXED_ACCOUNT_IDS].sort()).toEqual([...seed].sort());
    expect([...FIXED_ACCOUNT_IDS].sort()).toEqual([DEMO_CARE_MANAGER_ID, DEMO_JUDGE_ACCOUNT_ID].sort());
  });

  it("固定は山本と審査員だけ。協力事業所・足したケアマネ・空は固定でない", () => {
    expect(isFixedAccount(DEMO_CARE_MANAGER_ID)).toBe(true);
    expect(isFixedAccount(DEMO_JUDGE_ACCOUNT_ID)).toBe(true);
    expect(isFixedAccount("acct-partner-cm")).toBe(false);
    expect(isFixedAccount("acct-new")).toBe(false);
    expect(isFixedAccount(null)).toBe(false);
    expect(isFixedAccount(undefined)).toBe(false);
  });
});
