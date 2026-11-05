// 紙の手入れの受け口（POST /api/forms/entries、T135。サーバーだけ）。中身はここに置き、偽の D1 でテストする。
//
// 壁: ケアマネの役で事業所があり（formsScope）、本人が範囲の中で自分の事業所の人（personInScope と office_id）。ほかは 403・404。
// 様式は計画書・医療要約か、自分の事業所の確認済の対応表だけ。
// op:
// - put: 様式だけの欄の値（台帳に項目の無い欄だけ。値は欄の形に合う物）・文字の枠（字と頁の上の矩形）・画像（事業所の画像の id と矩形）
// - remove: 取り消す（行は消さない）
// - ledger: 台帳に入れる（lib/intake/save.ts の saveIntake。面の編集と同じ edit か、問いの答え）。入ったら欄の印（誰がいつ）を残す
// Claude は呼ばない。紙に置く画像・手入れの値はどこにも送らない。

import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import type { Principal } from "../auth/principal.ts";
import { personInScope } from "../auth/scope.ts";
import { saveIntake, SaveRequestSchema } from "../intake/save.ts";
import { ENTRY_ID, ENTRY_LIMITS, fieldValueEmpty, formOnlyField, markLedgerEntry, parseFormId, putFormEntry, removeFormEntry, type FieldValue, type FormId } from "./form-entries.ts";
import { KIROKU_FRAME } from "./frame-kiroku.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { clampBox, type FieldBox, type FormMapping } from "./mapping.ts";
import { formsScope, loadCheckedMapping } from "./mapping-db.ts";
import { MATSUYAMA_FIELDS } from "./matsuyama.ts";
import { MATSUYAMA_FORM_ONLY } from "./paper-slots.ts";

const HEADERS = { "Cache-Control": "no-store" } as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type EntriesError = "login_required" | "forbidden" | "not_found" | "invalid" | "conflict" | "too_many" | "order_clash" | "self_twice";

const LABELS: Record<EntriesError, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  not_found: "該当なし",
  invalid: "形式不正",
  conflict: "競合",
  too_many: "上限超過",
  order_clash: "順の重複",
  self_twice: "本人重複",
};
const STATUS: Record<EntriesError, number> = {
  login_required: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  too_many: 409,
  order_clash: 409,
  self_twice: 409,
};

export const entriesError = (e: EntriesError) => Response.json({ ok: false, error: e, label: LABELS[e] }, { status: STATUS[e], headers: HEADERS });

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const EntriesRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("put"),
    personId: z.string().regex(ID),
    formId: z.string().max(80),
    entry: z.object({
      id: z.string().regex(ENTRY_ID),
      kind: z.enum(["field", "text", "image"]),
      fieldKey: z.string().min(1).max(80).nullable(),
      page: z.number().int().min(1).max(20).nullable(),
      box: Box.nullable(),
      value: z.string().max(2000),
    }),
  }),
  z.object({ op: z.literal("remove"), personId: z.string().regex(ID), formId: z.string().max(80), id: z.string().regex(ENTRY_ID) }),
  z.object({
    op: z.literal("ledger"),
    personId: z.string().regex(ID),
    formId: z.string().max(80),
    /** 印を付ける欄の鍵（入れた欄。問いの答えは当たる欄） */
    fieldKeys: z.array(z.string().min(1).max(80)).max(8),
    version: z.number().int().min(1),
    /** 面の編集と同じ手入力（経過に「ケアマネが直した」）か、問いの答え（経過に「入力」） */
    edit: z.boolean(),
    changes: z.array(z.unknown()).min(1).max(40),
  }),
]);
export type EntriesRequest = z.output<typeof EntriesRequestSchema>;

/** 様式の頁の数と、様式だけの欄の形（添付の様式は対応表から） */
type FormShape = { pages: number; fieldShape: (key: string) => { shape: "text" | "check" | "choice"; options: readonly string[] } | null };

async function formShape(db: D1Database, officeId: string, formId: FormId): Promise<FormShape | null> {
  if (formId === "matsuyama") {
    return {
      pages: MATSUYAMA_FRAME.pages.length,
      fieldShape: (key) => {
        const def = MATSUYAMA_FIELDS.find((f) => f.key === key);
        if (!def || !MATSUYAMA_FORM_ONLY.has(def.key)) return null;
        return { shape: "choice", options: "options" in def ? (def.options as readonly string[]) : [] };
      },
    };
  }
  if (formId === "kiroku") return { pages: KIROKU_FRAME.pages.length, fieldShape: () => null };
  const stored = await loadCheckedMapping(db, officeId, formId.slice("mapped:".length));
  if (!stored) return null;
  const m: FormMapping = stored.mapping;
  return {
    pages: stored.pageImages?.length ?? 0,
    fieldShape: (key) => {
      const f = m.fields.find((x) => x.id === key);
      if (!f || !formOnlyField(f)) return null;
      return { shape: f.shape === "check" ? "check" : f.shape === "choice" && f.options.length > 0 ? "choice" : "text", options: f.options };
    },
  };
}

/** 様式だけの欄の値を欄の形で確かめる。合わなければ null */
export function checkFieldValue(shape: { shape: "text" | "check" | "choice"; options: readonly string[] }, raw: string): FieldValue | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (shape.shape === "check") return v === true ? true : null;
  if (shape.shape === "choice" && Array.isArray(v)) {
    if (v.length === 0 || v.length > ENTRY_LIMITS.options || !v.every((x) => typeof x === "string" && shape.options.includes(x))) return null;
    return [...new Set(v as string[])];
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" || [...s].length > ENTRY_LIMITS.field ? null : s;
}

/** 頁の上の矩形（比）。頁の中に収め、小さすぎる物は断る */
function checkBox(b: FieldBox | null): FieldBox | null {
  const c = clampBox(b);
  return c && c.w >= 0.01 && c.h >= 0.005 ? c : null;
}

export async function handleEntries(db: D1Database, p: Principal | null, body: unknown, now = new Date()): Promise<Response> {
  if (!p) return entriesError("login_required");
  const scope = formsScope(p);
  if (!scope || p.role !== "care_manager") return entriesError("forbidden");
  const parsed = EntriesRequestSchema.safeParse(body);
  if (!parsed.success) return entriesError("invalid");
  const req = parsed.data;
  const formId = parseFormId(req.formId);
  if (!formId) return entriesError("invalid");
  const person = await personInScope(db, p, req.personId);
  if (!person || person.office_id !== scope.officeId) return entriesError("not_found");
  const form = await formShape(db, scope.officeId, formId);
  if (!form) return entriesError("not_found");
  const at = { officeId: scope.officeId, personId: req.personId, formId, accountId: scope.accountId, now: now.toISOString() };

  if (req.op === "remove") {
    const n = await removeFormEntry(db, at, req.id);
    return Response.json({ ok: true, removed: n }, { headers: HEADERS });
  }

  if (req.op === "ledger") {
    const save = SaveRequestSchema.safeParse({ personId: req.personId, version: req.version, ai: null, edit: req.edit, changes: req.changes });
    if (!save.success) return entriesError("invalid");
    const r = await saveIntake(db, p, save.data, now);
    if (!r.ok) return entriesError(r.error);
    if (r.changed > 0) for (const key of new Set(req.fieldKeys)) await markLedgerEntry(db, at, key);
    return Response.json({ ok: true, changed: r.changed, version: r.version }, { headers: HEADERS });
  }

  const e = req.entry;
  if (e.kind === "field") {
    const shape = e.fieldKey ? form.fieldShape(e.fieldKey) : null;
    if (!shape) return entriesError("invalid");
    const v = checkFieldValue(shape, e.value);
    if (v === null || fieldValueEmpty(v)) return entriesError("invalid");
    const ok = await putFormEntry(db, at, { id: e.id, kind: "field", fieldKey: e.fieldKey, page: null, box: null, value: JSON.stringify(v) });
    return ok ? Response.json({ ok: true }, { headers: HEADERS }) : entriesError("conflict");
  }
  // 文字の枠と画像
  const box = checkBox(e.box);
  if (!box || e.page === null || e.page > form.pages) return entriesError("invalid");
  if (e.kind === "text") {
    const s = e.value.replace(/\r\n/g, "\n");
    if (s.trim() === "" || [...s].length > ENTRY_LIMITS.text) return entriesError("invalid");
    e.value = s;
  } else {
    const asset = await db
      .prepare("SELECT id FROM form_assets WHERE id = ?1 AND office_id = ?2 AND removed_at IS NULL")
      .bind(e.value, scope.officeId)
      .first<{ id: string }>();
    if (!asset) return entriesError("invalid");
  }
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM form_entries WHERE person_id = ?1 AND form_id = ?2 AND kind IN ('text', 'image') AND removed_at IS NULL AND id <> ?3",
    )
    .bind(req.personId, formId, e.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= ENTRY_LIMITS.free) return entriesError("too_many");
  const ok = await putFormEntry(db, at, { id: e.id, kind: e.kind, fieldKey: null, page: e.page, box, value: e.value });
  return ok ? Response.json({ ok: true }, { headers: HEADERS }) : entriesError("conflict");
}
