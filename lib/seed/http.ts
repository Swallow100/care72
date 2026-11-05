// 事業所の画面（/office）の「最初に戻す」（docs/tasks/T26.md）。route（app/office/reset）は同じ所からの POST かを見て、
// ここの結果を応答にするだけ。D1・R2・Principal は引数で受け取る（テストで node:sqlite と偽の R2 を渡す）。
//
// 押せる人: 種の事業所の審査員（ケアマネの役）と、種の事業所の管理者（確認用の事業所の山本、T144）。協力事業所の管理者・管理者でないケアマネ・
// 行政・医療班・本人・家族は 403、ログインしていなければ 401。戻すのは押した人の種の事業所だけ（lib/seed/reset.ts の resetSeedOffice）:
// 審査員はデモ事業所、山本は確認用の事業所（審査員の戻しが山本の確かめを消さない、山本の戻しが審査員の見る中身を消さない）。
// 確認の欄（URL の reset=confirm）を通った POST（confirm=1）だけ戻す。経過には残さない（戻すと消えるので）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { isSeedOfficeId } from "../auth/demo.ts";
import { OFFICE_PATH, type PostOutcome } from "../disaster/http.ts";
import type { FormLike } from "../disaster/state.ts";
import { resetSeedOffice, type SeedBucket } from "./reset.ts";

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
  if (p.office.kind !== "demo" || !isSeedOfficeId(p.office.id)) return false;
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
    await resetSeedOffice(db, bucket, now, p.office!.id);
  } catch (e) {
    console.error("最初に戻せない", e instanceof Error ? e.name : typeof e);
    return { status: 303, location: officeResetHref("failed") };
  }
  return { status: 303, location: officeResetHref("done") };
}
