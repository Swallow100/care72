// アンケートのリンクを作る受け口（事業所の画面 /office から）。ケアマネの役（山本・審査員のケアマネの役・協力事業所のケアマネ）だけ。
// 断り方は lib/office/http.ts と同じ: ログインしていなければ 401、ケアマネの役でなければ 403、形の違いは 400。
// 審査員が作ったリンクは「審査員」の印が付き（created_role = judge）、毎朝 4 時のデモの戻しで答えと一緒に消える。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { officeActor } from "../office/scope.ts";
import { surveyUrl } from "./paths.ts";
import { createSurveyLink, MEMO_MAX } from "./store.ts";
import { SURVEY_OFFICE_LABELS } from "./text.ts";

export type LinkOutcome = { status: number; body: Record<string, unknown> };

/** 宛先の控え。空でもよい。制御文字を外し、前後の空白を落とす。長すぎる・文字でないは null */
export function parseMemo(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const memo = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return memo.length <= MEMO_MAX ? memo : null;
}

export async function createLinkRequest(
  db: D1Database,
  p: Principal | null,
  raw: unknown,
  now: Date,
  origin: string,
): Promise<LinkOutcome> {
  if (!p) return { status: 401, body: { ok: false, error: "login_required", label: "ログイン要" } };
  const actor = officeActor(p);
  if (!actor) return { status: 403, body: { ok: false, error: "forbidden", label: "権限なし" } };
  const memo = parseMemo(typeof raw === "object" && raw !== null ? (raw as { memo?: unknown }).memo : undefined);
  if (memo === null) return { status: 400, body: { ok: false, error: "invalid", label: SURVEY_OFFICE_LABELS.failed } };
  const { token, expiresAt } = await createSurveyLink(
    db,
    { officeId: actor.officeId, memo, createdBy: p.accountId, createdRole: p.judge ? "judge" : "care_manager" },
    now,
  );
  return { status: 200, body: { ok: true, url: surveyUrl(origin, token), expiresAt } };
}
