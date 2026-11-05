// 様式 9 の紙の上でその場で書く（T147）。様式 9 は 1 行に 1 人の一覧なので、行の欄に書いた字はその行の人の手入れ
// （form_entries、form_id "form9"、field_key は列の id）として残し、その人の行の欄に効かせる（紙・画面の表・CSV が同じ値）。
// 台帳の本体は変えない（様式 9 の欄は台帳の何か所かの値と表の計算から組む欄で、1 つの欄の字から台帳の形に戻せない）。
// 字の大きさは紙と同じ決まり（欄の矩形に fitText。上限は様式の欄の字 6.57pt、下限 6pt、入らなければ欄に「別紙」）。
// Claude は呼ばない。ここはブラウザでも読む形（D1 を読む物は下の loadForm9Entries だけで、型だけ import する）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Form9Row, Form9Sheet } from "./form9.ts";
import { form9Cell, FORM9_FONT_PT, FORM9_MARGIN_MM, FORM9_ROWS_PER_PAGE, FORM9_VALUE_COLS, type Form9ValueColumn } from "./frame-form9.ts";

export const FORM9_FORM_ID = "form9" as const;

/** 書ける列（ひな形の値の列。No は刷ってある番号なので書かない） */
export const FORM9_FILL_COLS: readonly Form9ValueColumn[] = FORM9_VALUE_COLS.map((c) => c.id);

export function isForm9FillCol(v: unknown): v is Form9ValueColumn {
  return typeof v === "string" && (FORM9_FILL_COLS as readonly string[]).includes(v);
}

/** 1 人の 1 つの欄の手入れ */
export type Form9Entry = { id: string; personId: string; col: Form9ValueColumn; value: string; by: string | null; at: string };

/** 人ごと・列ごとの手入れ */
export type Form9Entries = ReadonlyMap<string, ReadonlyMap<Form9ValueColumn, Form9Entry>>;

/** 事業所の様式 9 の手入れ（取り消していない物）を人ごと・列ごとに */
export async function loadForm9Entries(db: D1Database, officeId: string): Promise<Map<string, Map<Form9ValueColumn, Form9Entry>>> {
  const r = await db
    .prepare(
      `SELECT e.id, e.person_id, e.field_key, e.value, e.updated_at, a.display_name AS by_name
         FROM form_entries e LEFT JOIN accounts a ON a.id = e.updated_by
        WHERE e.office_id = ?1 AND e.form_id = ?2 AND e.kind = 'field' AND e.removed_at IS NULL
        ORDER BY e.created_at, e.id`,
    )
    .bind(officeId, FORM9_FORM_ID)
    .all<{ id: string; person_id: string; field_key: string | null; value: string; updated_at: string; by_name: string | null }>();
  const out = new Map<string, Map<Form9ValueColumn, Form9Entry>>();
  for (const row of r.results ?? []) {
    if (!isForm9FillCol(row.field_key)) continue;
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") continue;
    const m = out.get(row.person_id) ?? new Map<Form9ValueColumn, Form9Entry>();
    m.set(row.field_key, { id: row.id, personId: row.person_id, col: row.field_key, value, by: row.by_name, at: row.updated_at });
    out.set(row.person_id, m);
  }
  return out;
}

/** 手入れをその人の行の欄に効かせる（人が書いたまま。紙・画面の表・CSV が同じ値） */
export function withForm9Entries(sheet: Form9Sheet, entries: Form9Entries): Form9Sheet {
  if (entries.size === 0) return sheet;
  const rows = sheet.rows.map((r): Form9Row => {
    const mine = entries.get(r.id);
    if (!mine || mine.size === 0) return r;
    const cells = { ...r.cells };
    for (const [col, e] of mine) cells[col] = e.value;
    return { ...r, cells };
  });
  return { ...sheet, rows };
}

/** 紙の上の書ける欄 1 つ（画面に渡す。矩形はひな形の 1 枚の内容の箱〔261 × 172mm〕の上の mm） */
export type Form9Slot = {
  personId: string;
  name: string;
  col: Form9ValueColumn;
  /** 1 枚目からの枚の番号（0 から）と、その枚の 1 行目の No */
  sheet: number;
  first: number;
  box: { x: number; y: number; w: number; h: number };
  value: string;
  /** 手入れの id（あれば。消すとき） */
  entryId?: string;
  hand?: { by: string | null; at: string };
};

/** 紙の欄の字の上限（pt） */
export const FORM9_FILL_PT = FORM9_FONT_PT.cell;

/** 様式 9 の紙の書ける欄（行ごと・列ごと）。並びは紙と同じ（順位の順） */
export function form9Slots(sheet: Form9Sheet, entries: Form9Entries): Form9Slot[] {
  const out: Form9Slot[] = [];
  sheet.rows.forEach((r, i) => {
    const k = i % FORM9_ROWS_PER_PAGE;
    const n = Math.floor(i / FORM9_ROWS_PER_PAGE);
    for (const { id, col } of FORM9_VALUE_COLS) {
      const c = form9Cell(`${col}${7 + k}`);
      const e = entries.get(r.id)?.get(id);
      out.push({
        personId: r.id,
        name: r.name,
        col: id,
        sheet: n,
        first: n * FORM9_ROWS_PER_PAGE + 1,
        box: { x: round(c.x - FORM9_MARGIN_MM.left), y: round(c.y - FORM9_MARGIN_MM.top), w: c.w, h: c.h },
        value: r.cells[id] ?? "",
        ...(e ? { entryId: e.id, hand: { by: e.by, at: e.at } } : {}),
      });
    }
  });
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
