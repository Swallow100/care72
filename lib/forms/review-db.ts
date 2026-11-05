// 書類の紙の見直しの記録（T136、migrations/0032_form_reviews.sql）。1 回 1 行で足すだけで、今の状態はいちばん新しい行から読む。
// - run: AI の見直しを回した記録（回ごとの前と後）。紙の版（sheet_hash）が今の紙と同じときだけ、見つけた所を一覧に出す
// - fix: 再考で読み直した欄（対応表と版に付く。同じ対応表の紙の全部に効く）。戻した欄は undo
// - confirm: 確認済の印（紙の版に付く。紙が変われば外れる）
// 中身に氏名・住所・電話は入れない（欄の id・種類・場所の数・AI の短い理由だけ。理由は仮名のまま）。

import type { D1Database } from "@cloudflare/workers-types";
import type { FieldBox, FormMapping, LedgerItemKey, MappingField } from "./mapping.ts";
import type { ReviewFinding } from "./review.ts";

/** 欄の場所と項目（再考の前と後） */
export type FieldShapeFix = {
  item: LedgerItemKey | null;
  box: FieldBox | null;
  options: string[];
  optionBoxes?: Array<FieldBox | null>;
};

export type FieldFix = { field: string; before: FieldShapeFix; after: FieldShapeFix; reason: string; round: number };

export type FixBody = { fixes?: FieldFix[]; undo?: string[] };

/** 回 1 つの前と後 */
export type RunRound = {
  round: number;
  /** 見つけた所（決まりと AI） */
  found: Array<Pick<ReviewFinding, "id" | "kind" | "field" | "by">>;
  /** 再考した欄 */
  redo: string[];
  /** 再考で直した欄 */
  fixed: string[];
};

export type RunBody = {
  rounds: RunRound[];
  /** 最後の回で AI が挙げた所（一覧に出す） */
  findings: ReviewFinding[];
  /** 呼んだ回数（AI の見直し・再考の読み直し） */
  calls: number;
  /** 最後の回の紙の版（再考で紙が変われば、見直しを始めた紙と違う） */
  finalHash: string;
};

export type ConfirmBody = { seen: string[] };

type Row = { id: string; kind: string; sheet_hash: string | null; mapping_version: number | null; body: string; created_by: string | null; created_at: string; by_name?: string | null };

export type NewReview =
  | { kind: "run"; officeId: string; personId: string; formKey: string; sheetHash: string; body: RunBody; by: string | null; at: string }
  | { kind: "confirm"; officeId: string; personId: string; formKey: string; sheetHash: string; body: ConfirmBody; by: string | null; at: string }
  | { kind: "fix"; officeId: string; personId: string | null; formKey: string; mappingVersion: number; body: FixBody; by: string | null; at: string };

export async function insertReview(db: D1Database, r: NewReview): Promise<string> {
  const id = `rv-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO form_reviews (id, office_id, person_id, form_key, kind, sheet_hash, mapping_version, body, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      id,
      r.officeId,
      r.personId,
      r.formKey,
      r.kind,
      r.kind === "fix" ? null : r.sheetHash,
      r.kind === "fix" ? r.mappingVersion : null,
      JSON.stringify(r.body),
      r.by,
      r.at,
    )
    .run();
  return id;
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export type ReviewState = {
  /** 今の紙の版の AI の見直し（無ければ null）。stale は前の紙の版の見直しがある（紙が変わった） */
  run: { body: RunBody; at: string; by: string | null } | null;
  stale: boolean;
  /** 今の紙の版の確認済（誰がいつ） */
  confirmed: { at: string; by: string | null } | null;
};

/** 人と紙の今の見直しの状態 */
export async function loadReviewState(db: D1Database, personId: string, formKey: string, sheetHash: string): Promise<ReviewState> {
  const rows =
    (
      await db
        .prepare(
          `SELECT r.id, r.kind, r.sheet_hash, r.mapping_version, r.body, r.created_by, r.created_at, a.display_name AS by_name
             FROM form_reviews r LEFT JOIN accounts a ON a.id = r.created_by
            WHERE r.person_id = ?1 AND r.form_key = ?2 AND r.kind IN ('run', 'confirm')
            ORDER BY r.created_at DESC, r.rowid DESC LIMIT 40`,
        )
        .bind(personId, formKey)
        .all<Row>()
    ).results ?? [];
  const run = rows.find((r) => r.kind === "run" && (r.sheet_hash === sheetHash || parse<RunBody>(r.body)?.finalHash === sheetHash)) ?? null;
  const anyRun = rows.find((r) => r.kind === "run") ?? null;
  const confirm = rows.find((r) => r.kind === "confirm" && r.sheet_hash === sheetHash) ?? null;
  const body = run ? parse<RunBody>(run.body) : null;
  return {
    run: run && body ? { body, at: run.created_at, by: run.by_name ?? null } : null,
    stale: !run && anyRun !== null,
    confirmed: confirm ? { at: confirm.created_at, by: confirm.by_name ?? null } : null,
  };
}

/** 対応表と版の再考の直し（古い順に重ね、戻した欄は外す）。欄の id → 直し */
export async function loadFixes(db: D1Database, officeId: string, formKey: string, mappingVersion: number): Promise<Map<string, FieldFix>> {
  const rows =
    (
      await db
        .prepare(
          `SELECT id, kind, sheet_hash, mapping_version, body, created_by, created_at FROM form_reviews
            WHERE office_id = ?1 AND form_key = ?2 AND kind = 'fix' AND mapping_version = ?3
            ORDER BY created_at, rowid`,
        )
        .bind(officeId, formKey, mappingVersion)
        .all<Row>()
    ).results ?? [];
  return foldFixes(rows.map((r) => parse<FixBody>(r.body)).filter((b): b is FixBody => b !== null));
}

/** 直しの行を古い順に重ねる（後の直しが前を上書き、undo は外す） */
export function foldFixes(bodies: readonly FixBody[]): Map<string, FieldFix> {
  const out = new Map<string, FieldFix>();
  for (const b of bodies) {
    for (const f of b.fixes ?? []) out.set(f.field, f);
    for (const id of b.undo ?? []) out.delete(id);
  }
  return out;
}

/** 対応表に再考の直しを当てる（欄の場所・項目・区切り。ほかは変えない）。直した欄の id も返す */
export function applyFixes(mapping: FormMapping, fixes: ReadonlyMap<string, FieldFix>): { mapping: FormMapping; fixed: string[] } {
  if (fixes.size === 0) return { mapping, fixed: [] };
  const fixed: string[] = [];
  const fields: MappingField[] = mapping.fields.map((f) => {
    const fix = fixes.get(f.id);
    if (!fix || f.removed) return f;
    fixed.push(f.id);
    const a = fix.after;
    return {
      ...f,
      item: a.item,
      box: a.box,
      options: a.options,
      ...(a.optionBoxes ? { optionBoxes: a.optionBoxes } : {}),
    };
  });
  return { mapping: { ...mapping, fields }, fixed };
}

/** 欄の今の場所と項目（再考の前） */
export const shapeOfField = (f: MappingField): FieldShapeFix => ({
  item: f.item,
  box: f.box ?? null,
  options: [...f.options],
  ...(f.optionBoxes ? { optionBoxes: [...f.optionBoxes] } : {}),
});
