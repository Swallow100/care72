// 分類を人が直す API（app/api/signals/[id]/classes）の中身。route は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1・Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// 直せるのはケアマネの役だけ（審査員のケアマネの役を含む）。本人・家族は save を持つが、分類の直しは断る（403）。
// 行政・医療班も 403（受け持ちは T23）。事業所の外の信号・訓練の信号は 404。ログインなしは 401。

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import type { Principal } from "../auth/principal.ts";
import { denied } from "../auth/guard.ts";
import { RECORDING_CLASSES } from "../db/types.ts";
import { saveClassEdit } from "./store.ts";

const NO_STORE = { "Cache-Control": "no-store" };

export const SIGNAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const ClassEditBody = z.object({
  classes: z.array(z.enum(RECORDING_CLASSES)).min(1).max(RECORDING_CLASSES.length),
});

export type ClassEditError = "forbidden" | "invalid" | "not_found";

const STATUS: Record<ClassEditError, number> = { forbidden: 403, invalid: 400, not_found: 404 };
const LABELS: Record<ClassEditError, string> = { forbidden: "権限なし", invalid: "入力不正", not_found: "対象なし" };

export function classEditError(error: ClassEditError): Response {
  return Response.json({ ok: false, error, label: LABELS[error] }, { status: STATUS[error], headers: NO_STORE });
}

/** 分類の直しの POST（JSON { classes: [...] }）。返すのは直したあとの分類の形（components/list/Classification.tsx の view） */
export async function classEditPost(
  db: D1Database,
  p: Principal | null,
  signalId: string,
  json: unknown,
  now: string,
): Promise<Response> {
  const no = denied(p, "save");
  if (no) return no;
  if (!p || p.role !== "care_manager" || !p.office) return classEditError("forbidden");
  if (!SIGNAL_ID.test(signalId)) return classEditError("not_found");
  const body = ClassEditBody.safeParse(json);
  if (!body.success) return classEditError("invalid");
  const r = await saveClassEdit(db, { officeId: p.office.id, accountId: p.accountId, role: "care_manager" }, signalId, body.data.classes, now);
  if (!r.ok) return classEditError(r.error);
  return Response.json({ ok: true, changed: r.changed, view: r.view }, { headers: NO_STORE });
}
