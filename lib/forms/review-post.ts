// 見直しの受け口（app/api/forms/review、T136）の中身。テストから直に呼べるように、D1・R2・AI の文脈を受け取る形。
// 操作（op）:
//   plan    紙の版・描く物（塗る所を除いた字と印、塗る四角）・決まりの見直し
//   run     AI の見直しを 1 回（ブラウザが描いて塗った頁の JPEG と、頁ごとの塗った数）。紙の版が今と違えば 409、塗った数が足りなければ 415
//   redo    再考（直せそうな欄だけを読み直す。対応表の紙だけ）。直しを form_reviews の fix に足す
//   confirm 確認済（紙の版に付く）
//   undo    再考の直しを戻す
// AI の見直しと再考は、本人の AI 提供（ai_overseas）が「不同意」なら断る（入れる欄の AI と同じ。T74）。
// 応答に氏名・住所・電話を入れない（描く物は、仮名化の門で変わらない字と印だけ）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { isAiConsentRefused } from "../intake/http.ts";
import { pseudonymInputOf } from "../intake/extract.ts";
import { checkRedactedImage } from "../intake/read-check.ts";
import { pseudonymize, type PseudonymKey } from "../pseudonym/index.ts";
import { mappingError, mappingErrorOf, NO_STORE } from "./mapping-http.ts";
import { pageImageKey } from "./page-images.ts";
import { composePlan, paintCounts, paintedFields, redoTargets, reviewList, rereadFields, REDO_ROUNDS_MAX, runAiReview } from "./review-ai.ts";
import { insertReview, type FieldFix, type RunBody } from "./review-db.ts";
import { loadReviewPaper, parseFormKey, type ReviewLoadDeps, type ReviewPaper } from "./review-load.ts";
import { REDO_KINDS, ruleReview, type ReviewFinding, type ReviewKind } from "./review.ts";

export type ReviewDeps = ReviewLoadDeps & {
  aiContext: (officeId: string) => Promise<AskJsonContext>;
  now?: () => string;
};

/** 1 回の見直しで受ける頁の数の上限（紙の頁。様式は 3 頁まで、原本の枠の紙は 2 頁） */
export const REVIEW_PAGES_MAX = 4;

const nowOf = (deps: ReviewDeps) => deps.now?.() ?? new Date().toISOString();

function keyOf(paper: ReviewPaper, today: string): PseudonymKey {
  return pseudonymize([pseudonymInputOf(paper.rows)], { on: today }).key;
}

/** 紙の今の描く物と決まりの見直し（plan の応答と、run の確かめに使う） */
export function planOf(paper: ReviewPaper, today: string) {
  const key = keyOf(paper, today);
  const painted = paintedFields(paper.subject, key);
  const plan = composePlan(paper.subject, painted, key, paper.hash, paper.href);
  return { key, painted, plan, rule: ruleReview(paper.subject) };
}

const brief = (f: ReviewFinding) => ({ id: f.id, kind: f.kind, field: f.field, by: f.by });

/** 再考の候補（対応表の紙で、上限の回の前だけ） */
function nextRedo(paper: ReviewPaper, found: readonly ReviewFinding[], round: number): Array<{ id: string; kinds: ReviewKind[] }> {
  if (!paper.mapped || round >= REDO_ROUNDS_MAX + 1) return [];
  return redoTargets(found, paper.mapped.mapping.fields).map((t) => ({ id: t.field.id, kinds: t.kinds }));
}

type Json = Record<string, unknown>;

async function readRun(db: D1Database, id: string, personId: string, formKey: string): Promise<RunBody | null> {
  const row = await db
    .prepare("SELECT body FROM form_reviews WHERE id = ?1 AND person_id = ?2 AND form_key = ?3 AND kind = 'run'")
    .bind(id, personId, formKey)
    .first<{ body: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.body) as RunBody;
  } catch {
    return null;
  }
}

async function saveRun(db: D1Database, id: string, body: RunBody): Promise<void> {
  await db.prepare("UPDATE form_reviews SET body = ?2 WHERE id = ?1 AND kind = 'run'").bind(id, JSON.stringify(body)).run();
}

export async function reviewPost(deps: ReviewDeps, principal: Principal | null, request: Request): Promise<Response> {
  const multipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
  let op: string;
  let body: Json;
  let form: FormData | null = null;
  if (multipart) {
    form = await request.formData().catch(() => null);
    const meta = form?.get("meta");
    if (!form || typeof meta !== "string") return mappingError("invalid");
    try {
      body = JSON.parse(meta) as Json;
    } catch {
      return mappingError("invalid");
    }
    op = "run";
  } else {
    body = ((await request.json().catch(() => null)) as Json | null) ?? {};
    op = typeof body.op === "string" ? body.op : "";
  }
  const formKey = parseFormKey(body.form);
  const personId = typeof body.person === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.person) ? body.person : null;
  if (!formKey || !personId) return mappingError("invalid");
  const paper = await loadReviewPaper(deps, principal, personId, formKey);
  if (!paper) return mappingError("not_found");
  const at = nowOf(deps);
  const by = principal?.accountId ?? null;

  if (op === "plan") {
    const { plan, rule, painted } = planOf(paper, deps.today);
    return Response.json({ ok: true, hash: paper.hash, plan, rule, painted: painted.size, redoable: paper.subject.redoable }, { headers: NO_STORE });
  }

  if (op === "confirm") {
    if (body.hash !== paper.hash) return mappingError("conflict");
    const seen = Array.isArray(body.seen) ? body.seen.filter((x): x is string => typeof x === "string").slice(0, 400) : [];
    await insertReview(deps.db, { kind: "confirm", officeId: paper.officeId, personId, formKey, sheetHash: paper.hash, body: { seen }, by, at });
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  if (op === "undo") {
    if (!paper.mapped || typeof body.field !== "string" || !paper.mapped.fixes.has(body.field)) return mappingError("not_found");
    await insertReview(deps.db, { kind: "fix", officeId: paper.officeId, personId, formKey, mappingVersion: paper.mapped.stored.version, body: { undo: [body.field] }, by, at });
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  // ここから先は Claude を呼ぶ（AI の見直し・再考）
  if (principal?.role !== "care_manager") return mappingError("forbidden");
  if (isAiConsentRefused(paper.rows.consents)) return Response.json({ ok: false, error: "consent_refused", label: "同意 拒否" }, { status: 403, headers: NO_STORE });

  if (op === "run" && form) {
    if (body.hash !== paper.hash) return mappingError("conflict");
    // 回の番号はブラウザの言う数でなく、記録に残した回の数から（前と後の記録を回の番号で並べる）
    const runId = typeof body.run === "string" ? body.run : null;
    const prev = runId ? await readRun(deps.db, runId, personId, formKey) : null;
    if (runId && !prev) return mappingError("not_found");
    const round = (prev?.rounds.length ?? 0) + 1;
    if (round > REDO_ROUNDS_MAX + 1) return mappingError("conflict");
    const { key, painted, plan, rule } = planOf(paper, deps.today);
    const need = paintCounts(plan);
    const paints = Array.isArray(body.paints) ? body.paints : [];
    const images = form.getAll("image");
    if (images.length !== plan.pages.length || images.length > REVIEW_PAGES_MAX) return mappingError("invalid");
    // 塗った数が描く物の塗る四角より少なければ断る（塗れていない頁を送らない）
    if (need.some((n, i) => typeof paints[i] !== "number" || (paints[i] as number) < n)) return mappingError("not_redacted");
    const bytes: Uint8Array[] = [];
    for (const img of images) {
      if (typeof img === "string") return mappingError("invalid");
      const b = new Uint8Array(await img.arrayBuffer());
      const checked = checkRedactedImage(b);
      if (!checked.ok) return mappingError(checked.error === "file_large" ? "file_large" : "not_redacted");
      bytes.push(b);
    }
    let ai: ReviewFinding[];
    try {
      const ctx = await deps.aiContext(paper.officeId);
      ai = (await runAiReview(ctx, { subject: paper.subject, rows: reviewList(paper.subject, painted), images: bytes, key })).findings;
    } catch (e) {
      const res = mappingErrorOf(e);
      if (res) return res;
      console.error("紙の見直しに失敗", e instanceof Error ? e.name : typeof e);
      return mappingError("ai_failed");
    }
    const found = [...rule, ...ai];
    const roundRec = { round, found: found.filter((f) => f.level !== "note").map(brief), redo: [], fixed: [] };
    const runBody: RunBody = {
      rounds: [...(prev?.rounds ?? []), roundRec],
      findings: ai,
      calls: (prev?.calls ?? 0) + 1,
      finalHash: paper.hash,
    };
    let id = runId;
    if (prev && runId) await saveRun(deps.db, runId, runBody);
    else id = await insertReview(deps.db, { kind: "run", officeId: paper.officeId, personId, formKey, sheetHash: paper.hash, body: runBody, by, at });
    return Response.json({ ok: true, run: id, hash: paper.hash, ai, rule, redo: nextRedo(paper, found, round) }, { headers: NO_STORE });
  }

  if (op === "redo") {
    if (!paper.mapped) return mappingError("not_found");
    const runId = typeof body.run === "string" ? body.run : "";
    const prev = await readRun(deps.db, runId, personId, formKey);
    if (!prev) return mappingError("not_found");
    const round = prev.rounds.length;
    if (round > REDO_ROUNDS_MAX) return mappingError("conflict");
    const want = Array.isArray(body.fields) ? (body.fields as Array<{ id?: unknown; kinds?: unknown }>) : [];
    const last = prev.rounds.at(-1)!;
    // 再考するのは、前の回で見つけた欄のうち、再考で直せそうな物だけ（ブラウザの言う欄をそのまま信じない）
    const found = last.found.filter((f) => REDO_KINDS.has(f.kind)).map((f) => ({ ...f, redo: true, level: "fix" as const, label: "", page: null, box: null, items: [], why: "" }));
    const targets = redoTargets(
      found.filter((f) => want.some((w) => w.id === f.field)),
      paper.mapped.mapping.fields,
    );
    if (targets.length === 0) return Response.json({ ok: true, fixed: [] }, { headers: NO_STORE });
    const pages = [...new Set(targets.map((t) => t.field.page))];
    const fixes: FieldFix[] = [];
    let calls = 0;
    try {
      const ctx = await deps.aiContext(paper.officeId);
      for (const page of pages) {
        const obj = await deps.get(pageImageKey(paper.officeId, paper.mapped.stored.id, page));
        if (!obj) continue;
        const b = new Uint8Array(await new Response(obj.body as BodyInit).arrayBuffer());
        const checked = checkRedactedImage(b);
        if (!checked.ok) continue;
        calls += 1;
        fixes.push(...(await rereadFields(ctx, { page, pages: paper.mapped.mapping.pages, image: checked.file.attachment, targets: targets.filter((t) => t.field.page === page), round })));
      }
    } catch (e) {
      const res = mappingErrorOf(e);
      if (res) return res;
      console.error("再考の読み直しに失敗", e instanceof Error ? e.name : typeof e);
      return mappingError("ai_failed");
    }
    if (fixes.length > 0) {
      await insertReview(deps.db, { kind: "fix", officeId: paper.officeId, personId, formKey, mappingVersion: paper.mapped.stored.version, body: { fixes }, by, at });
    }
    const rounds = prev.rounds.map((r, i) => (i === prev.rounds.length - 1 ? { ...r, redo: targets.map((t) => t.field.id), fixed: fixes.map((f) => f.field) } : r));
    await saveRun(deps.db, runId, { ...prev, rounds, calls: prev.calls + calls });
    return Response.json({ ok: true, fixed: fixes.map((f) => f.field) }, { headers: NO_STORE });
  }

  return mappingError("invalid");
}
