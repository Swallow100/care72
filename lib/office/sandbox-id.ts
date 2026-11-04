// 審査員の試用事業所（T115）の id の形。事業所は office-sbx-<16 進 12 桁>、管理者は acct-sbx-<uuid>。
// 試用事業所かどうかの元は offices.judge_sandbox（migration 0027）で、id の頭は読みやすさと、作者の道具（tools/office/new-office.ts）が
// 本物の事業所にこの頭を使わないための物。D1 にも Next にも触らない（道具からも読む）。
// AI の 1 日の上限の数え（lib/claude/usage.ts の quotaOffice）は、AiContext を作る所がいくつもあるので、この頭で見る。

import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import type { OfficeKind } from "../db/types.ts";

export const SANDBOX_OFFICE_PREFIX = "office-sbx-";
export const SANDBOX_ACCOUNT_PREFIX = "acct-sbx-";

export function isSandboxOfficeId(id: string): boolean {
  return id.startsWith(SANDBOX_OFFICE_PREFIX);
}

/**
 * AI の 1 日の上限を数える事業所（lib/claude/usage.ts の quotaOffice）。試用事業所の呼び出しはデモ事業所の数えに入る
 * （ai_calls の行もデモ事業所の id で残る。毎朝の掃除は念のため試用事業所の id の行も消す）
 */
export const SANDBOX_AI_QUOTA: { id: string; kind: OfficeKind } = { id: DEMO_OFFICE_ID, kind: "demo" };

/** 新しい試用事業所の id と管理者の id */
export function newSandboxIds(uuid: () => string = () => crypto.randomUUID()): { officeId: string; accountId: string } {
  const u = uuid();
  return { officeId: `${SANDBOX_OFFICE_PREFIX}${u.replaceAll("-", "").slice(0, 12)}`, accountId: `${SANDBOX_ACCOUNT_PREFIX}${u}` };
}
