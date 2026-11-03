// 様式 9 の CSV。Excel でそのまま開けるように、UTF-8 の BOM を先頭に付け、行の終わりは CRLF。
// 上の 2 行はひな形の上の段（題名・事業所名と作成日）、1 行空けて見出し、その下に優先順位の順の行。
// 「,」「"」・改行を含む欄は "" で囲み、= + - @ で始まる欄は先頭に ' を付けて式として読ませない。
// 事業所の自前の様式に合わせるときは対応表（Form9Mapping）で列を選んで並べ替える。

import { FORM9_COLUMNS, FORM9_TITLE, type Form9ColumnId, type Form9Sheet } from "./form9.ts";

export const CSV_BOM = "﻿";
const EOL = "\r\n";

/** 1 つの欄 */
export function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export function csvLine(cells: ReadonlyArray<string>): string {
  return cells.map(csvCell).join(",");
}

function csvText(lines: ReadonlyArray<ReadonlyArray<string>>): string {
  return CSV_BOM + lines.map(csvLine).join(EOL) + EOL;
}

/** 作成日（JST の 2026年11月2日） */
export function jstDateLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 9 * 3_600_000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export type CsvMeta = {
  officeName: string;
  /** 作った時刻（ISO） */
  madeAt: string;
};

function modeLabel(sheet: Form9Sheet): string {
  return sheet.mode === "disaster" ? "並び：発災時（色と順位）" : "並び：平時（順番の骨格）";
}

/** ひな形の列の順の CSV */
export function form9Csv(sheet: Form9Sheet, meta: CsvMeta): string {
  return csvText([
    [FORM9_TITLE],
    [`事業所名：${meta.officeName}`, `作成：${jstDateLabel(meta.madeAt)}`, modeLabel(sheet)],
    [],
    FORM9_COLUMNS.map((c) => c.csv),
    ...sheet.rows.map((r) => FORM9_COLUMNS.map((c) => r.cells[c.id])),
  ]);
}

/**
 * 事業所の自前の様式の対応表（docs/tasks/T08.md の様式の読み取りが作る形を想定した枠）。
 * 列ごとに見出しと、入れる様式 9 の列（無ければ空欄）。今は手で書く。T08 ができたら読み取った対応表をここに渡す
 */
export type Form9Mapping = {
  /** 様式の名前（1 行目に出す） */
  title: string;
  columns: ReadonlyArray<{ header: string; from: Form9ColumnId | null }>;
};

/** 対応表で並べた CSV */
export function mappedCsv(sheet: Form9Sheet, mapping: Form9Mapping, meta: CsvMeta): string {
  return csvText([
    [mapping.title],
    [`事業所名：${meta.officeName}`, `作成：${jstDateLabel(meta.madeAt)}`, modeLabel(sheet)],
    [],
    mapping.columns.map((c) => c.header),
    ...sheet.rows.map((r) => mapping.columns.map((c) => (c.from ? r.cells[c.from] : ""))),
  ]);
}

/** 落とすファイルの名前（ASCII の名前と、日本語の名前） */
export function csvFileNames(madeAt: string): { ascii: string; utf8: string } {
  const t = Date.parse(madeAt);
  const s = new Date((Number.isNaN(t) ? 0 : t) + 9 * 3_600_000).toISOString();
  const stamp = `${s.slice(0, 10).replaceAll("-", "")}-${s.slice(11, 16).replace(":", "")}`;
  return { ascii: `form9-${stamp}.csv`, utf8: `様式9_${stamp}.csv` };
}
