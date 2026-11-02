// 事業所の画面（/office）の「最初に戻す」（docs/tasks/T26.md）。route（app/office/reset）は同じ所からの POST かを見て、
// ここの結果を応答にするだけ。D1・R2・Principal は引数で受け取る（テストで node:sqlite と偽の R2 を渡す）。
//
// 押せる人: デモ事業所の審査員（ケアマネの役）と、デモ事業所の管理者（山本）。協力事業所の管理者・管理者でないケアマネ・
// 行政・医療班・本人・家族は 403、ログインしていなければ 401。戻すのはいつもデモ事業所だけ（lib/seed/reset.ts）。
// 確認の欄（URL の reset=confirm）を通った POST（confirm=1）だけ戻す。経過には残さない（戻すと消えるので）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { OFFICE_PATH, type PostOutcome } from "../disaster/http.ts";
import type { FormLike } from "../disaster/state.ts";
import { resetDemoOffice, type SeedBucket } from "./reset.ts";

export const OFFICE_RESET_PATH = "/office/reset";

/** 事業所の画面の reset の欄: confirm は確認の欄、done は戻した、failed は戻せなかった */
export const RESET_STATES = ["confirm", "done", "failed"] as const;
export type ResetState = (typeof RESET_STATES)[number];

export function officeResetHref(state: ResetState): string {
  return `${OFFICE_PATH}?reset=${state}`;
}

export function parseResetState(v: unknown): ResetState | null {
  return typeof v === "string" && (RESET_STATES as readonly string[]).includes(v) ? (v as ResetState) : null;
}

/** 「最初に戻す」を出す・押せるか */
export function canResetDemo(p: Principal | null): boolean {
  if (!p || p.role !== "care_manager" || !p.office) return false;
  if (p.office.kind !== "demo" || p.office.id !== DEMO_OFFICE_ID) return false;
  return p.judge || p.admin;
}

export async function resetPost(
  db: D1Database,
  bucket: SeedBucket,
  p: Principal | null,
  form: FormLike | null,
  now: string,
): Promise<PostOutcome> {
  if (!p) return { status: 401 };
  if (!canResetDemo(p)) return { status: 403 };
  if (form?.get("confirm") !== "1") return { status: 303, location: officeResetHref("confirm") };
  try {
    await resetDemoOffice(db, bucket, now);
  } catch (e) {
    console.error("最初に戻せない", e instanceof Error ? e.name : typeof e);
    return { status: 303, location: officeResetHref("failed") };
  }
  return { status: 303, location: officeResetHref("done") };
}
