// 受け持ちの表（/staff）の絞込と並び（T62）。前は表の部品（components/staff/StaffTable.tsx）の中だけで持っていた状態を URL に載せ、
// 画面と CSV（/staff/csv）が同じ関数で行を決める（DECISIONS 11/4 00:0x「画面と同じ行の決まり」）。D1 を使わない（ブラウザも読む）。
// URL: /staff?shelter=みどり小学校&color=red&q=やまだ&sort=age（既定は書かない）。
// 色と連絡順の番号はルールの表の結果のまま（lib/custody/board.ts）。ここでは絞って並べるだけで、番号を数え直さない。

import { COLOR_LABELS } from "../labels.ts";
import type { Color } from "../triage/index.ts";
import type { StaffRow } from "./board.ts";
import { CUSTODY_LABELS } from "./labels.ts";

export const STAFF_SORTS = ["rank", "kana", "age", "remain", "shelter", "received", "office"] as const;
export type StaffSort = (typeof STAFF_SORTS)[number];

export const STAFF_SORT_LABELS: Record<StaffSort, string> = {
  rank: "連絡順",
  kana: CUSTODY_LABELS.name,
  age: CUSTODY_LABELS.age,
  remain: CUSTODY_LABELS.remain,
  shelter: CUSTODY_LABELS.shelter,
  received: CUSTODY_LABELS.receivedAt,
  office: CUSTODY_LABELS.office,
};

/** 降順で並べる列（年齢は上の人から、受入は新しい順） */
export const STAFF_DESCENDING: ReadonlySet<StaffSort> = new Set<StaffSort>(["age", "received"]);

export const STAFF_COLORS: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

/** 避難所・検索の文の長さの上限（字） */
export const MAX_STAFF_TEXT = 40;

export type StaffView = {
  /** 避難所（空は全部） */
  shelter: string;
  /** 状態の色（空は全部） */
  color: Color | "";
  /** 氏名・カナの部分一致 */
  q: string;
  sort: StaffSort;
};

export const NO_STAFF_VIEW: StaffView = { shelter: "", color: "", q: "", sort: "rank" };

const one = (v: unknown): string => (typeof v === "string" ? v : "");

/** URL の query を読む（Next の searchParams の形。同じ名前が 2 つ以上・形が違う物は無かったことに） */
export function parseStaffView(q: { shelter?: unknown; color?: unknown; q?: unknown; sort?: unknown }): StaffView {
  const color = one(q.color);
  const sort = one(q.sort);
  return {
    shelter: one(q.shelter).trim().slice(0, MAX_STAFF_TEXT),
    color: (STAFF_COLORS as readonly string[]).includes(color) ? (color as Color) : "",
    q: one(q.q).trim().slice(0, MAX_STAFF_TEXT),
    sort: (STAFF_SORTS as readonly string[]).includes(sort) ? (sort as StaffSort) : "rank",
  };
}

/** route の URLSearchParams を Next の searchParams と同じ形に（同じ名前が 2 つ以上なら配列で、効かない） */
export function staffQueryOf(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of ["shelter", "color", "q", "sort"]) {
    const all = params.getAll(k);
    if (all.length === 1) out[k] = all[0];
    else if (all.length > 1) out[k] = all;
  }
  return out;
}

/** 絞込と並びを URL の query に（既定は書かない）。先頭の ? は付けない */
export function staffViewQuery(v: StaffView): string {
  const p = new URLSearchParams();
  if (v.shelter) p.set("shelter", v.shelter);
  if (v.color) p.set("color", v.color);
  if (v.q) p.set("q", v.q);
  if (v.sort !== "rank") p.set("sort", v.sort);
  return p.toString();
}

/** 絞り込みの文字: カタカナ・空白なし（漢字の氏名にも当てる） */
export function squash(s: string): string {
  return [...s.normalize("NFKC")]
    .map((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
    })
    .join("")
    .replace(/\s/g, "");
}

function compare(a: StaffRow, b: StaffRow, sort: StaffSort): number {
  const num = (x: number | null) => (x === null ? Infinity : x);
  switch (sort) {
    case "rank":
      return a.rank - b.rank;
    case "kana":
      return a.kana.localeCompare(b.kana, "ja") || a.rank - b.rank;
    case "age":
      // 上の人から。年齢の無い人は後ろ
      return (b.age ?? -1) - (a.age ?? -1) || a.rank - b.rank;
    case "remain":
      return num(a.remain?.hours ?? null) - num(b.remain?.hours ?? null) || a.rank - b.rank;
    case "shelter":
      return a.shelter.localeCompare(b.shelter, "ja") || a.rank - b.rank;
    case "received":
      return Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || a.rank - b.rank;
    case "office":
      return a.office.localeCompare(b.office, "ja") || a.rank - b.rank;
  }
}

/**
 * 効いている絞込: 選んだ避難所の人が搬送・退所で全員いなくなったら（読み直しで一覧から消えたら）避難所は全部に戻す
 */
export function effectiveStaffView(v: StaffView, shelters: ReadonlyArray<string>): StaffView {
  return shelters.includes(v.shelter) ? v : { ...v, shelter: "" };
}

/** 画面に出す行（絞って並べたあと）。画面の表と CSV が呼ぶ */
export function staffViewRows(rows: ReadonlyArray<StaffRow>, shelters: ReadonlyArray<string>, view: StaffView): StaffRow[] {
  const v = effectiveStaffView(view, shelters);
  const q = squash(v.q);
  return rows
    .filter((r) => (v.shelter ? r.shelter === v.shelter : true))
    .filter((r) => (v.color ? r.color === v.color : true))
    .filter((r) => (q ? squash(r.kana).includes(q) || squash(r.name).includes(q) : true))
    .sort((a, b) => compare(a, b, v.sort));
}

/** 並びと絞込の言葉（CSV の 2 行目）。「並び：年齢」「絞込：みどり小学校・至急・検索 ヤマ」「絞込：なし」 */
export function staffViewWords(view: StaffView, shelters: ReadonlyArray<string>): { sort: string; filter: string } {
  const v = effectiveStaffView(view, shelters);
  const parts = [v.shelter || null, v.color ? COLOR_LABELS[v.color] : null, v.q ? `検索 ${v.q}` : null].filter(
    (x): x is string => Boolean(x),
  );
  return { sort: `並び：${STAFF_SORT_LABELS[v.sort]}`, filter: `絞込：${parts.length ? parts.join("・") : "なし"}` };
}
