// 事業所の画面（/office）の URL と、切替・情報のフォームの POST の中身。route（app/office/mode・app/office/info）は
// 同じ所からの POST かを見て、ここの結果を応答にするだけ。ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// 断り方: ログインしていなければ 401、役で持たない（行政・医療班・本人・家族・役を選ぶ前の審査員）は 403。
// 行政・医療班は save を持つが、事業所の状態は変えられない（lib/disaster/scope.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { seeOther } from "../auth/cookie.ts";
import { allows } from "../auth/guard.ts";
import { saveDisasterInfo, switchDisasterMode } from "./db.ts";
import { disasterScope } from "./scope.ts";
import { DISASTER_FORM_ERRORS, parseInfoForm, parseModeForm, type DisasterFormError, type FormLike } from "./state.ts";

export const OFFICE_PATH = "/office";
export const OFFICE_MODE_PATH = "/office/mode";
export const OFFICE_INFO_PATH = "/office/info";

/** 事業所の画面の URL。confirm は平時に戻す確認の欄、error は保存できなかった理由 */
export function officeHref(q: { confirm?: boolean; error?: DisasterFormError | null } = {}): string {
  const params = new URLSearchParams();
  if (q.confirm) params.set("confirm", "normal");
  if (q.error) params.set("error", q.error);
  const s = params.toString();
  return s ? `${OFFICE_PATH}?${s}` : OFFICE_PATH;
}

export function parseConfirm(v: unknown): boolean {
  return v === "normal";
}

export function parseFormError(v: unknown): DisasterFormError | null {
  return typeof v === "string" && (DISASTER_FORM_ERRORS as readonly string[]).includes(v) ? (v as DisasterFormError) : null;
}

export type PostOutcome = { status: 401 } | { status: 403 } | { status: 303; location: string };

/** 結果を応答に。303 は画面へ戻し、401・403 は lib/auth/guard.ts の denied と同じ形 */
export function outcomeResponse(request: Request, r: PostOutcome): Response {
  if (r.status === 303) return seeOther(request, r.location);
  if (r.status === 401) return Response.json({ error: "login_required", label: "ログイン要" }, { status: 401 });
  return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
}

function refuse(p: Principal | null): PostOutcome | null {
  if (!allows(p, "save")) return { status: p === null ? 401 : 403 };
  return null;
}

/** 災害モードの切替（災害の種類・平時に戻す）。平時に戻すは確認の欄を通ったときだけ */
export async function modePost(db: D1Database, p: Principal | null, form: FormLike | null, at: string): Promise<PostOutcome> {
  const no = refuse(p);
  if (no) return no;
  const scope = disasterScope(p);
  if (!scope) return { status: 403 };
  const parsed = parseModeForm(form);
  if (!parsed.ok) {
    return { status: 303, location: parsed.error === "confirm" ? officeHref({ confirm: true }) : officeHref({ error: "bad" }) };
  }
  const r = await switchDisasterMode(db, scope, { ...parsed.value, at });
  return { status: 303, location: r.ok ? OFFICE_PATH : officeHref({ error: r.error }) };
}

/** 災害の情報（発災・停電・警戒レベル・断水・道路）の保存 */
export async function infoPost(db: D1Database, p: Principal | null, form: FormLike | null, at: string): Promise<PostOutcome> {
  const no = refuse(p);
  if (no) return no;
  const scope = disasterScope(p);
  if (!scope) return { status: 403 };
  const parsed = parseInfoForm(form, at);
  if (!parsed.ok) return { status: 303, location: officeHref({ error: parsed.error }) };
  const r = await saveDisasterInfo(db, scope, { info: parsed.value, version: parsed.version, at });
  return { status: 303, location: r.ok ? OFFICE_PATH : officeHref({ error: r.error }) };
}
