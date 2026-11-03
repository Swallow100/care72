// 録音のまとめ（T69b）の、録音を添えたあとの走らせ方と、ケアマネの直し・「生成」の API の中身。
// Claude を呼ぶ本体（askJson）は lib/classify/summary.ts。ここは本人の記録の行（経過）に「まとめ修正」を書くので、Claude を呼ぶ所と分ける
// （Claude を呼ぶ所は経過の表を読まない決まり。lib/list/call-heard.test.ts・lib/timeline/t63.test.ts）。
// まとめは色と連絡の順に使わない（ルールの表に渡さない）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { denied } from "../auth/guard.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { SUMMARY_EDIT_MAX, summaryEditLogBody } from "./labels.ts";
import { classifySignal, type ClassifyDeps, type ClassifySignalOutcome, type ClassifyTarget } from "./store.ts";
import { summarizeSignal, type SummarizeOutcome } from "./summary.ts";
import { summaryOf, type SignalSummary } from "./view.ts";

/** 経過の payload の出どころ（ケアマネがまとめを直した） */
export const SUMMARY_EDIT_LOG_SOURCE = "summary_edit";

type SignalForSummaryEdit = { id: string; person_id: string; ai_summary: string | null; ai_summary_error: SignalSummary["error"]; summary: string | null };

/**
 * 録音を添えたあと（app/api/recordings の afterAttach）: 分類とまとめを並べて走らせる（Promise.allSettled。順に呼ぶと waitUntil の 30 秒に
 * 収まらない）。どちらかが失敗しても、もう片方は書く
 */
export async function afterRecording(
  db: D1Database,
  t: ClassifyTarget,
  deps: ClassifyDeps,
): Promise<{ classify: ClassifySignalOutcome | null; summary: SummarizeOutcome | null }> {
  const [c, s] = await Promise.allSettled([classifySignal(db, t, deps), summarizeSignal(db, t, deps)]);
  return { classify: c.status === "fulfilled" ? c.value : null, summary: s.status === "fulfilled" ? s.value : null };
}

// ---------- ケアマネの直しと「生成」 ----------

/** 直す人（ケアマネの役だけ。事業所の壁を通したあと） */
export type SummaryEditor = { officeId: string; accountId: string | null };

export type SummaryEditResult = { ok: true; changed: boolean; view: SignalSummary } | { ok: false; error: "not_found" | "invalid" };

/**
 * ケアマネがまとめを直す。summary に書き（以後は人の文。AI の印が外れる）、経過に「まとめ修正「…」」。Claude の文（ai_summary）は残す。
 * 色と順は変わらない（まとめはルールの表に渡さない）
 */
export async function saveSummaryEdit(
  db: D1Database,
  editor: SummaryEditor,
  signalId: string,
  text: string,
  now: string,
): Promise<SummaryEditResult> {
  const value = Array.from(text.replace(/\s+/g, " ").trim()).slice(0, SUMMARY_EDIT_MAX).join("");
  if (!value) return { ok: false, error: "invalid" };
  const row = await db
    .prepare(
      `SELECT s.id, s.person_id, s.ai_summary, s.ai_summary_error, s.summary
         FROM signals s JOIN people p ON p.id = s.person_id
        WHERE s.id = ?1 AND p.office_id = ?2 AND s.drill_id IS NULL`,
    )
    .bind(signalId, editor.officeId)
    .first<SignalForSummaryEdit>();
  if (!row) return { ok: false, error: "not_found" };
  if (row.summary === value) return { ok: true, changed: false, view: summaryOf(row) };
  await db.batch([
    db.prepare(`UPDATE signals SET summary = ?2 WHERE id = ?1`).bind(row.id, value),
    db
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
         VALUES (?1, ?2, ?3, 'care_manager', 'note', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        crypto.randomUUID(),
        row.person_id,
        editor.accountId,
        summaryEditLogBody(value),
        JSON.stringify({ source: SUMMARY_EDIT_LOG_SOURCE }),
        row.id,
        now,
      ),
  ]);
  return { ok: true, changed: true, view: summaryOf({ ...row, summary: value }) };
}

const NO_STORE = { "Cache-Control": "no-store" };
const SIGNAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

type SummaryApiError = "forbidden" | "invalid" | "not_found";
const STATUS: Record<SummaryApiError, number> = { forbidden: 403, invalid: 400, not_found: 404 };
const LABELS: Record<SummaryApiError, string> = { forbidden: "権限なし", invalid: "入力不正", not_found: "対象なし" };

function summaryError(error: SummaryApiError): Response {
  return Response.json({ ok: false, error, label: LABELS[error] }, { status: STATUS[error], headers: NO_STORE });
}

/** 「生成」で Claude を呼ぶ文脈（事業所の 1 日の上限を数える）。テストは偽の client */
export type SummaryApiDeps = { ai: (officeId: string) => Promise<AskJsonContext> };

/**
 * まとめの POST（app/api/signals/[id]/summary）。ケアマネの役だけ（本人・家族・医療班・行政は 403、ログインなしは 401）。
 * JSON { text } なら直す。text が無ければ「生成」: まとめがまだ無いときだけ Claude をもう一度呼ぶ（待ちは同じ 20 秒）。
 * 事業所の外の信号・訓練の信号は 404。返すのは画面の形（SignalSummary）
 */
export async function summaryPost(
  db: D1Database,
  p: Principal | null,
  signalId: string,
  json: unknown,
  now: string,
  deps: SummaryApiDeps,
): Promise<Response> {
  const no = denied(p, "save");
  if (no) return no;
  if (!p || p.role !== "care_manager" || !p.office) return summaryError("forbidden");
  if (!SIGNAL_ID.test(signalId)) return summaryError("not_found");
  const body = json && typeof json === "object" ? (json as { text?: unknown }) : {};
  if (body.text !== undefined && body.text !== null) {
    if (typeof body.text !== "string" || body.text.length > SUMMARY_EDIT_MAX * 2) return summaryError("invalid");
    const r = await saveSummaryEdit(db, { officeId: p.office.id, accountId: p.accountId }, signalId, body.text, now);
    if (!r.ok) return summaryError(r.error);
    return Response.json({ ok: true, changed: r.changed, view: r.view }, { headers: NO_STORE });
  }
  const owner = await db
    .prepare(`SELECT s.person_id FROM signals s JOIN people p ON p.id = s.person_id WHERE s.id = ?1 AND p.office_id = ?2 AND s.drill_id IS NULL`)
    .bind(signalId, p.office.id)
    .first<{ person_id: string }>();
  if (!owner) return summaryError("not_found");
  const officeId = p.office.id;
  const out = await summarizeSignal(
    db,
    { officeId, personId: owner.person_id, signalId },
    { ai: () => deps.ai(officeId), now: () => now },
    { force: true },
  );
  if (out.status === "not_found") return summaryError("not_found");
  return Response.json(
    { ok: true, changed: out.status === "summarized" && out.result.ok, view: out.view },
    { headers: NO_STORE },
  );
}
