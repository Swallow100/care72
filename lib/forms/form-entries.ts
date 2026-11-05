// 紙の手入れ（T135、migrations/0033_form_entries.sql）。元の様式の上に値を置いた紙の上で人が入れた物のうち、台帳に入らない物:
// - field: 台帳に項目の無い欄（様式だけの欄）の値。その人のその様式だけに効く
// - text・image: 紙の上に置いた文字の枠と画像（大きさと位置は頁の画像の上の比）
// - ledger: 紙から台帳に入れた欄の印（値は台帳が正。画面の「手で入れた所」の印と誰がいつのためだけ）
// 紙を描くとき（サーバー）に、field は欄の値に、text・image は頁の上の物にする（印刷の PDF に同じ位置で出る）。
// 字の大きさは欄の値と同じ決まり（lib/forms/overlay-sheet.ts の fitText）。
// Claude は呼ばない。画像は紙に置くだけで、Claude に送る道（様式の読み取り・入れる欄の読み取り）を通らない。

import type { D1Database } from "@cloudflare/workers-types";
import { clampBox, type FieldBox, type MappingField } from "./mapping.ts";
import type { MappedSheet } from "./mapped-sheet.ts";
import type { Cell, Choice, MatsuyamaKey, MatsuyamaSheet } from "./matsuyama.ts";
import { FONT_MIN_PT, fitText, wrapLine, type OverlayItem, type OverlaySheet } from "./overlay-sheet.ts";
import { isUnconfirmedCell } from "./unconfirmed.ts";

export const FORM_ENTRY_KINDS = ["field", "ledger", "text", "image"] as const;
export type FormEntryKind = (typeof FORM_ENTRY_KINDS)[number];

/** 手入れ 1 つ（画面とサーバーで同じ形）。by は入れた人の名前、at は最後に変えた時刻（UTC の ISO） */
export type FormEntry = {
  id: string;
  kind: FormEntryKind;
  fieldKey: string | null;
  page: number | null;
  box: FieldBox | null;
  value: string;
  by: string | null;
  at: string;
};

/** 様式だけの欄の値。文字・選んだ選択肢・□ の真偽 */
export type FieldValue = string | string[] | boolean;

export const ENTRY_LIMITS = {
  /** 様式だけの欄の字 */
  field: 200,
  /** 文字の枠の字 */
  text: 400,
  /** 1 人 1 様式の文字の枠と画像の数 */
  free: 40,
  /** 選択肢の数 */
  options: 40,
} as const;

/** 手入れの id（画面が作る。英数と - _） */
export const ENTRY_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** 様式の id: 計画書（松山市の原本の枠の紙）・医療要約（災害診療記録2018）・添付の様式（対応表の id） */
export type FormId = "matsuyama" | "kiroku" | `mapped:${string}`;

export function parseFormId(v: unknown): FormId | null {
  if (v === "matsuyama" || v === "kiroku") return v;
  if (typeof v === "string" && /^mapped:[A-Za-z0-9_-]{1,64}$/.test(v)) return v as FormId;
  return null;
}

export const mappedFormId = (mappingId: string): FormId => `mapped:${mappingId}`;

/** 保存した値の字（JSON）を値に。形が違えば null */
export function parseFieldValue(raw: string): FieldValue | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "string" || typeof v === "boolean") return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  } catch {
    return null;
  }
  return null;
}

/** 空の値（保存せずに外す） */
export const fieldValueEmpty = (v: FieldValue | null): boolean =>
  v === null || v === false || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

// ---------- 紙に効かせる ----------

/** 様式だけの欄の形（添付の様式の欄の形と選択肢） */
export type FormOnlyShape = Pick<MappingField, "shape" | "options">;

/** 様式だけの欄の値を、欄の値（Cell）に。字は人が打ったまま（書き方を直さない） */
export function formValueCell(shape: FormOnlyShape, v: FieldValue): Cell | null {
  if (fieldValueEmpty(v)) return null;
  if (shape.shape === "check") return v === true ? { kind: "choice", options: [{ label: "", on: true }] } : null;
  if (shape.shape === "choice" && shape.options.length > 0) {
    const picked = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    const options: Choice[] = shape.options.map((label) => ({ label, on: picked.includes(label) }));
    return options.some((o) => o.on) ? { kind: "choice", options } : null;
  }
  if (typeof v !== "string") return null;
  const lines = v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.length > 0 ? { kind: "value", lines: lines.map((l) => [{ text: l, raw: true }]) } : null;
}

/** 欄の名前（帯と同じ） */
const nameOf = (f: MappingField) => (f.section ? `${f.section} ${f.label}` : f.label);

/** 添付の様式の欄のうち、紙から様式だけの値を入れてよい欄（台帳の項目が無く、手書きの欄〔署名・受付印・医師が書く所〕でない） */
export const formOnlyField = (f: MappingField): boolean => !f.removed && f.item === null && f.shape !== "handwrite";

/**
 * 差し込みの紙面（lib/forms/mapped-sheet.ts の buildMappedSheet）に、様式だけの欄の手入れと、台帳の欄のこの様式だけの手入れ
 * （T133 の置けなかった欄。台帳の値は変えない）を効かせる。
 * 入れた欄は値になり、帯の未確認・対応なしと未記入の色付けから外れる（紙の数え方と同じ元）
 */
export function withMappedEntries(sheet: MappedSheet, entries: readonly FormEntry[]): MappedSheet {
  const values = new Map<string, FieldValue>();
  for (const e of entries) {
    if (e.kind !== "field" || !e.fieldKey) continue;
    const v = parseFieldValue(e.value);
    if (v !== null) values.set(e.fieldKey, v);
  }
  if (values.size === 0) return sheet;
  const filled = new Set<string>();
  const pages = sheet.pages.map((p) => ({
    ...p,
    sections: p.sections.map((s) => ({
      ...s,
      rows: s.rows.map((r) => {
        const v = values.get(r.field.id);
        // 様式だけの欄と、台帳の欄のこの様式だけの手入れ（T133 の置けなかった欄を、この様式に合う形で書いた物）。同意の無い欄・手書きの欄は効かせない
        if (v === undefined || r.field.removed || r.field.shape === "handwrite" || r.cell.kind === "withheld") return r;
        const cell = formValueCell(r.field, v);
        if (!cell) return r;
        if (isUnconfirmedCell(r.cell)) filled.add(nameOf(r.field));
        return { ...r, cell };
      }),
    })),
  }));
  return {
    ...sheet,
    pages,
    unconfirmed: sheet.unconfirmed.filter((n) => !filled.has(n)),
    unmapped: sheet.unmapped.filter((n) => !filled.has(n)),
  };
}

/** 計画書の様式だけの欄（台帳に置き場が無く、手で印を付ける欄。T117 の棚卸しの C のうち、押して印を付けられる物） */
export const MATSUYAMA_FORM_ONLY: ReadonlySet<MatsuyamaKey> = new Set<MatsuyamaKey>(["route.map"]);

/** 計画書の紙面に、様式だけの欄の手入れを効かせる（選んだ □ に印。帯の「手書き」から外れる） */
export function withMatsuyamaEntries<S extends Pick<MatsuyamaSheet, "cells">>(sheet: S, entries: readonly FormEntry[]): S {
  let cells = sheet.cells;
  for (const e of entries) {
    if (e.kind !== "field" || !e.fieldKey || !MATSUYAMA_FORM_ONLY.has(e.fieldKey as MatsuyamaKey)) continue;
    const key = e.fieldKey as MatsuyamaKey;
    const cur = cells[key];
    const v = parseFieldValue(e.value);
    if (!cur || cur.kind !== "choice" || v === null) continue;
    const picked = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    if (picked.length === 0) continue;
    cells = { ...cells, [key]: { ...cur, options: cur.options.map((o) => ({ ...o, on: picked.includes(o.label) })) } };
  }
  return cells === sheet.cells ? sheet : { ...sheet, cells };
}

/** 置いた画像の元（事業所の画像の名前と、紙に読む URL） */
export type AssetRef = { id: string; name: string; src: string };

/**
 * 紙の上に置いた文字の枠と画像を、頁の上の物にする（印刷に同じ位置で出る）。
 * 文字は欄の値と同じ決まり（fitText。上限 maxPt から 6pt まで縮める）。6pt でも入らなければ 6pt で枠に入る行まで（枠の外へ出さない）
 */
export function withFreeItems(sheet: OverlaySheet, entries: readonly FormEntry[], assets: ReadonlyMap<string, AssetRef>, maxPt: number): OverlaySheet {
  const free = entries.filter((e) => (e.kind === "text" || e.kind === "image") && e.page !== null && e.box !== null);
  if (free.length === 0) return sheet;
  const pages = sheet.pages.map((p) => {
    const items: OverlayItem[] = [...p.items];
    for (const e of free) {
      if (e.page !== p.page || !e.box) continue;
      if (e.kind === "text") {
        const placed = freeText(e.value, e.box.w * p.image.w, e.box.h * p.image.h, maxPt);
        if (placed) items.push({ kind: "text", fieldId: `free:${e.id}`, box: e.box, ...placed, free: e.id });
        continue;
      }
      const a = assets.get(e.value);
      if (a) items.push({ kind: "picture", fieldId: `free:${e.id}`, box: e.box, src: a.src, alt: a.name, free: e.id });
    }
    return { ...p, items };
  });
  return { ...sheet, pages };
}

/** 文字の枠の字の大きさと行。入らなければ下限の大きさで、入る行まで（clipped） */
export function freeText(text: string, wMm: number, hMm: number, maxPt: number): { lines: string[]; fontPt: number; top: boolean; clipped?: true } | null {
  const logical = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/u, ""))
    .filter((l, i, all) => l !== "" || (i > 0 && i < all.length - 1));
  if (logical.length === 0) return null;
  const fitted = fitText(logical, wMm, hMm, maxPt);
  if (fitted) return { ...fitted, top: true };
  const fontMm = (FONT_MIN_PT * 25.4) / 72;
  const innerW = wMm - 1.6;
  const innerH = hMm - 1;
  if (innerW <= 0 || innerH < fontMm * 1.15) return null;
  const lines = logical.flatMap((l) => wrapLine(l, innerW / fontMm));
  const rows = Math.max(1, Math.floor(innerH / (fontMm * 1.15) + 1e-9));
  return { lines: lines.slice(0, rows), fontPt: FONT_MIN_PT, top: true, clipped: true };
}

// ---------- D1 ----------

type EntryRow = {
  id: string;
  kind: FormEntryKind;
  field_key: string | null;
  page: number | null;
  box: string | null;
  value: string;
  updated_at: string;
  by_name: string | null;
};

const toEntry = (r: EntryRow): FormEntry => ({
  id: r.id,
  kind: r.kind,
  fieldKey: r.field_key,
  page: r.page,
  box: r.box ? clampBox(safeJson(r.box)) : null,
  value: r.value,
  by: r.by_name,
  at: r.updated_at,
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 本人のその様式の手入れ（取り消していない物、入れた順） */
export async function loadFormEntries(db: D1Database, officeId: string, personId: string, formId: FormId): Promise<FormEntry[]> {
  const r = await db
    .prepare(
      `SELECT e.id, e.kind, e.field_key, e.page, e.box, e.value, e.updated_at, a.display_name AS by_name
         FROM form_entries e LEFT JOIN accounts a ON a.id = e.updated_by
        WHERE e.office_id = ?1 AND e.person_id = ?2 AND e.form_id = ?3 AND e.removed_at IS NULL
        ORDER BY e.created_at, e.id`,
    )
    .bind(officeId, personId, formId)
    .all<EntryRow>();
  return (r.results ?? []).map(toEntry);
}

export type PutEntry = {
  id: string;
  kind: "field" | "text" | "image";
  fieldKey: string | null;
  page: number | null;
  box: FieldBox | null;
  value: string;
};

/**
 * 手入れを入れる・変える（同じ id は上書きし、取り消してあれば戻す）。様式だけの欄は 1 欄 1 行で、同じ欄のほかの行は取り消す。
 * 別の本人・様式の同じ id は書かない（false）
 */
export async function putFormEntry(
  db: D1Database,
  at: { officeId: string; personId: string; formId: FormId; accountId: string | null; now: string },
  e: PutEntry,
): Promise<boolean> {
  const box = e.box ? JSON.stringify(e.box) : null;
  const stmts = [
    db
      .prepare(
        `INSERT INTO form_entries (id, office_id, person_id, form_id, kind, field_key, page, box, value, author_id, created_at, updated_by, updated_at, removed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10, ?11, NULL)
         ON CONFLICT (id) DO UPDATE SET field_key = excluded.field_key, page = excluded.page, box = excluded.box, value = excluded.value,
                updated_by = excluded.updated_by, updated_at = excluded.updated_at, removed_at = NULL
          WHERE form_entries.office_id = excluded.office_id AND form_entries.person_id = excluded.person_id
            AND form_entries.form_id = excluded.form_id AND form_entries.kind = excluded.kind`,
      )
      .bind(e.id, at.officeId, at.personId, at.formId, e.kind, e.fieldKey, e.page, box, e.value, at.accountId, at.now),
  ];
  if (e.kind === "field" && e.fieldKey) {
    stmts.push(
      db
        .prepare(
          `UPDATE form_entries SET removed_at = ?5, updated_by = ?6, updated_at = ?5
            WHERE person_id = ?1 AND form_id = ?2 AND kind = 'field' AND field_key = ?3 AND id <> ?4 AND removed_at IS NULL`,
        )
        .bind(at.personId, at.formId, e.fieldKey, e.id, at.now, at.accountId),
    );
  }
  const r = await db.batch(stmts);
  return (r[0]?.meta?.changes ?? 0) === 1;
}

/** 手入れを取り消す（行は消さない）。取り消せた数 */
export async function removeFormEntry(
  db: D1Database,
  at: { officeId: string; personId: string; formId: FormId; accountId: string | null; now: string },
  id: string,
): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE form_entries SET removed_at = ?5, updated_by = ?6, updated_at = ?5
        WHERE id = ?1 AND office_id = ?2 AND person_id = ?3 AND form_id = ?4 AND kind <> 'ledger' AND removed_at IS NULL`,
    )
    .bind(id, at.officeId, at.personId, at.formId, at.now, at.accountId)
    .run();
  return r.meta?.changes ?? 0;
}

/** 紙から台帳に入れた欄の印（誰がいつ）。欄ごとに 1 行で、入れ直すたびに時刻と人を上書き。値は台帳が正なので持たない */
export async function markLedgerEntry(
  db: D1Database,
  at: { officeId: string; personId: string; formId: FormId; accountId: string | null; now: string },
  fieldKey: string,
): Promise<void> {
  const id = `fl-${await shortHash(`${at.personId}|${at.formId}|${fieldKey}`)}`;
  await db
    .prepare(
      `INSERT INTO form_entries (id, office_id, person_id, form_id, kind, field_key, page, box, value, author_id, created_at, updated_by, updated_at, removed_at)
       VALUES (?1, ?2, ?3, ?4, 'ledger', ?5, NULL, NULL, '', ?6, ?7, ?6, ?7, NULL)
       ON CONFLICT (id) DO UPDATE SET updated_by = excluded.updated_by, updated_at = excluded.updated_at, removed_at = NULL`,
    )
    .bind(id, at.officeId, at.personId, at.formId, fieldKey, at.accountId, at.now)
    .run();
}

async function shortHash(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
