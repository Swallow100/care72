// 選ぶ部品（components/ui/Select.tsx）の中の計算（T51）。DOM に触らない純な関数にして、テストは node で回す。
// 中身の読み方（option・optgroup・Fragment・配列）、キーで移る先（選べない物は飛ばす）、文字で飛ぶ先、検索の絞り、
// 一覧を上に開くかの判定、複数のときのボタンの字。

import { Fragment, isValidElement, type ReactNode } from "react";
import { SELECT_LABELS } from "./labels";

export type SelectItem = {
  value: string;
  label: string;
  disabled: boolean;
  /** 項目の下の小さな薄い字の 1 行（<option data-sub="…">） */
  sub?: string;
  /** 入っているグループ（groups の番号）。無ければ null */
  group: number | null;
};

export type SelectModel = { items: SelectItem[]; groups: { label: string }[] };

/** 中の文字だけを取り出す（option の中身は文字のはずだが、数や入れ子も読む） */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

type OptionProps = { value?: string | number; disabled?: boolean; label?: string; children?: ReactNode; "data-sub"?: string };
type GroupProps = { label?: string; disabled?: boolean; children?: ReactNode };

/** <option>・<optgroup>（Fragment・配列の中も）を項目の並びにする。value の無い option は文字が値 */
export function readOptions(children: ReactNode): SelectModel {
  const items: SelectItem[] = [];
  const groups: { label: string }[] = [];
  const walk = (node: ReactNode, group: number | null, off: boolean) => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, group, off);
      return;
    }
    if (!isValidElement(node)) return;
    if (node.type === Fragment) {
      walk((node.props as { children?: ReactNode }).children, group, off);
      return;
    }
    if (node.type === "optgroup") {
      const p = node.props as GroupProps;
      groups.push({ label: p.label ?? "" });
      walk(p.children, groups.length - 1, off || p.disabled === true);
      return;
    }
    if (node.type === "option") {
      const p = node.props as OptionProps;
      const text = p.label ?? textOf(p.children);
      items.push({
        value: p.value != null ? String(p.value) : text,
        label: text,
        disabled: off || p.disabled === true,
        sub: p["data-sub"] || undefined,
        group,
      });
    }
  };
  walk(children, null, false);
  return { items, groups };
}

/** 次に焦点を置く項目（shown の中の位置）。選べない物は飛ばし、端で止まる（OS の select と同じく回らない） */
export function moveIndex(items: SelectItem[], shown: number[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < shown.length; i += step) {
    if (!items[shown[i]].disabled) return i;
  }
  return from;
}

/** 端の選べる項目（Home・End）。無ければ -1 */
export function edgeIndex(items: SelectItem[], shown: number[], edge: "first" | "last"): number {
  if (edge === "first") return shown.findIndex((i) => !items[i].disabled);
  for (let i = shown.length - 1; i >= 0; i--) if (!items[shown[i]].disabled) return i;
  return -1;
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/**
 * 文字で飛ぶ先（shown の中の位置）。打った文字で始まる選べる項目を、今の次から探して回る。
 * 同じ 1 字を続けて打つ（「ああ」）と、その字で始まる項目を順に回る。無ければ -1
 */
export function typeaheadIndex(items: SelectItem[], shown: number[], from: number, typed: string): number {
  const q = norm(typed);
  if (q === "") return -1;
  const same = [...q].every((c) => c === q[0]);
  const key = same ? q[0] : q;
  // 打ち始め（1 字）と同じ字の繰り返しは次から、続けて打った語は今の項目から（打ち足しても今の項目に留まる）
  const start = same ? from + 1 : Math.max(from, 0);
  const n = shown.length;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    const it = items[shown[i]];
    if (!it.disabled && norm(it.label).startsWith(key)) return i;
  }
  return -1;
}

/** 検索で比べる形（全角半角・大文字小文字を揃え、空白を除く。画面の言葉は「1 日 1 回」のように数の前後を空けるため） */
const squash = (s: string) => norm(s).replace(/\s+/g, "");

/** 検索で残す項目（items の番号）。文字か説明の行に含む物。空なら全部 */
export function filterItems(items: SelectItem[], query: string): number[] {
  const q = squash(query);
  const all = items.map((_, i) => i);
  if (q === "") return all;
  return all.filter((i) => squash(items[i].label).includes(q) || (items[i].sub != null && squash(items[i].sub).includes(q)));
}

/** 検索の欄を出すか（12 を超える項目か、呼ぶ側が searchable） */
export const SEARCH_OVER = 12;
export function wantsSearch(count: number, searchable: boolean | undefined): boolean {
  return searchable === true || count > SEARCH_OVER;
}

export type Rect = { top: number; bottom: number; left: number; right: number; width: number };

/**
 * 一覧の置き場所（文書の中の位置）。ボタンの下 4px に置き、右にはみ出すなら右を揃える。
 * 下に入りきらず上の方が広く、文書の上に一覧の高さの余地があれば上に開く（画面の中にスクロールの箱は作らない）
 */
export function placeList(p: {
  anchor: Rect;
  list: { width: number; height: number };
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  gap?: number;
}): { top: number; left: number; up: boolean } {
  const gap = p.gap ?? 4;
  const { anchor: a, list, viewport: v, scroll: s } = p;
  const below = v.height - a.bottom - gap;
  const above = a.top - gap;
  const roomInDoc = a.top + s.y - gap;
  const up = list.height > below && above > below && roomInDoc >= list.height;
  const width = Math.max(list.width, a.width);
  let left = a.left;
  if (left + width > v.width) left = a.right - width;
  if (left < 0) left = 0;
  const top = up ? a.top - gap - list.height : a.bottom + gap;
  return { top: top + s.y, left: left + s.x, up };
}

/** 複数のときのボタンの字。2 つまでは「a・b」、3 つ以上は「N 件」。無ければ null */
export function summaryLabel(labels: string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length <= 2) return labels.join("・");
  return `${labels.length} ${SELECT_LABELS.count}`;
}

/** 複数のときの onChange の value（「,」区切り） */
export function joinValues(values: string[]): string {
  return values.join(",");
}

/** 複数で 1 つ押したときの次の値（並びは項目の順） */
export function toggleValue(items: SelectItem[], values: string[], value: string): string[] {
  const on = new Set(values);
  if (on.has(value)) on.delete(value);
  else on.add(value);
  const order = items.map((i) => i.value);
  return [...on].sort((x, y) => order.indexOf(x) - order.indexOf(y));
}
