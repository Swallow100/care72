// アンケートの共有のリンクを作る受け口（事業所の画面 /office から。T65 から共有の 1 本だけ。1 人 1 本のリンクは作らない）。ケアマネの役（山本・審査員のケアマネの役・協力事業所のケアマネ）だけ。
// 断り方は lib/office/http.ts と同じ: ログインしていなければ 401、ケアマネの役でなければ 403、形の違いは 400。
// 審査員が作ったリンクは「審査員」の印が付き（created_role = judge）、毎朝 4 時のデモの戻しで答えと一緒に消える。
// 審査員が足したアカウント（T81、lib/auth/wall.ts）が作ったリンクも審査員の物。
// 1 つの事業所で 1 日 SURVEY_SHARES_PER_DAY 本まで（審査員の物と本物は別に数える。超えたら 429「本日上限」。T81）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { isWalled } from "../auth/wall.ts";
import { officeActor } from "../office/scope.ts";
import { MEMO_MAX } from "./form.ts";
import { surveyUrl } from "./paths.ts";
import { createSurveyShare } from "./store.ts";
import { SURVEY_OFFICE_LABELS } from "./text.ts";

export type LinkOutcome = { status: number; body: Record<string, unknown> };

/** 控え（配った先など）。空でもよい。制御文字を外し、前後の空白を落とす。長すぎる・文字でないは null */
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
  const made = await createSurveyShare(
    db,
    { officeId: actor.officeId, memo, createdBy: p.accountId, createdRole: isWalled(p) ? "judge" : "care_manager" },
    now,
  );
  if (!made.ok) return { status: 429, body: { ok: false, error: "limited", label: SURVEY_OFFICE_LABELS.limited } };
  return { status: 200, body: { ok: true, url: surveyUrl(origin, made.token), expiresAt: made.expiresAt, maxAnswers: made.maxAnswers } };
}
