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
import { allows } from "../auth/guard.ts";
import { OFFICE_PATH, officeHref, type PostOutcome } from "../disaster/http.ts";
import { disasterScope } from "../disaster/scope.ts";
import { parseVersion, type FormLike } from "../disaster/state.ts";
import { resetSeedOffice, type SeedBucket } from "./reset.ts";
import { startSeedDisaster } from "./start.ts";

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

// ---------- 発災開始（T153） ----------

/** 種の事業所の「発災開始」（lib/seed/start.ts）。事業所の画面の災害モードの区分のボタンが送る */
export const OFFICE_START_PATH = "/office/start";

/**
 * 「発災開始」を出す・押せるか: 種の事業所（デモ・確認用）で、災害モードを切り替えられる人（ケアマネの役。審査員 3 つと確認用の山本）。
 * 協力事業所・試用事業所・行政・医療班・本人・家族は押せない
 */
export function canStartSeed(p: Principal | null): boolean {
  if (!allows(p, "save")) return false;
  const scope = disasterScope(p);
  return scope !== null && isSeedOfficeId(scope.officeId) && p?.office?.kind === "demo";
}

/**
 * 「発災開始」の POST。入ったら entered に事業所の id（route が応答のあとに T149 の通知を送る）。
 * 断り方は切替と同じ: ログインなし 401、押せない人 403、版の違い・災害モードの間は事業所の画面へ「競合」で戻す
 */
export async function startPost(
  db: D1Database,
  bucket: SeedBucket,
  p: Principal | null,
  form: FormLike | null,
  at: string,
): Promise<{ outcome: PostOutcome; entered: string | null }> {
  if (!p) return { outcome: { status: 401 }, entered: null };
  const scope = canStartSeed(p) ? disasterScope(p) : null;
  if (!scope) return { outcome: { status: 403 }, entered: null };
  const version = parseVersion(form?.get("version"));
  if (version === null) return { outcome: { status: 303, location: officeHref({ error: "bad" }) }, entered: null };
  const r = await startSeedDisaster(db, bucket, scope, { version, at });
  if (!r.ok) return { outcome: { status: 303, location: officeHref({ error: "conflict" }) }, entered: null };
  return { outcome: { status: 303, location: `${OFFICE_PATH}?started=1` }, entered: scope.officeId };
}
