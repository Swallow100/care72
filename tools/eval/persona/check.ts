// 目標の達成の印を読みで確かめる（docs/tasks/T156.md）。台が決め、AI は決めない。

import type { Check, Done, RouteMove } from "./personas.ts";
import type { Item, Snapshot } from "./types.ts";

/** 見出し・本文（全部）・知らせ・上の帯を 1 つにした字 */
export function corpusOf(s: Pick<Snapshot, "header" | "headings" | "alerts" | "text"> & { body?: string }): string {
  return [s.header, ...s.headings, ...s.alerts, s.body || s.text].join("\n");
}

function matches(source: string, value: string): boolean {
  return new RegExp(source).test(value);
}

export function checkHolds(c: Check, s: Snapshot): boolean {
  if (c.path !== undefined && !matches(c.path, s.path)) return false;
  if (c.text !== undefined && !matches(c.text, corpusOf(s))) return false;
  if (c.header !== undefined && !matches(c.header, s.header)) return false;
  if (c.notHeader !== undefined && matches(c.notHeader, s.header)) return false;
  if (c.printed !== undefined && s.printed !== c.printed) return false;
  if (c.checked !== undefined && !s.items.some((i) => i.checked === true && (i.name === c.checked || i.name.startsWith(c.checked!)))) return false;
  return true;
}

export function isDone(d: Done, s: Snapshot): boolean {
  return "any" in d ? d.any.some((c) => checkHolds(c, s)) : checkHolds(d, s);
}

/** 押せる物を名前で（同じ名前 → で始まる名前の順。nth は同じ名前の何番目か） */
export function itemByName(items: readonly Item[], name: string, nth = 0): Item | null {
  const exact = items.filter((i) => i.name === name && !i.disabled);
  if (exact[nth]) return exact[nth];
  const starts = items.filter((i) => i.name.startsWith(name) && !i.disabled);
  return starts[nth] ?? exact[0] ?? starts[0] ?? null;
}

/** 手の短い言い方（記録・報告・再現の手順） */
export function routeText(m: RouteMove): string {
  if ("click" in m) return `「${m.click}」を押す`;
  if ("type" in m) return `「${m.type}」に書く`;
  if ("select" in m) return `「${m.select}」で「${m.option}」を選ぶ`;
  return "戻る";
}
