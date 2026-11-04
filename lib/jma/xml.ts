// 気象庁の XML（Atom のフィードと防災情報 XML の電文）を読む（T72）。Workers には DOMParser が無いので fast-xml-parser（MIT）で読む。
// - 名前空間の接頭辞（jmx・jmx_eb・jmx_ib など）は落として、要素の名前だけで読む（電文の版で接頭辞が変わっても同じに読める）
// - 値は文字のまま（コード「03」や震度「5-」を数にしない）
// - 1 つでも複数でも同じに読めるよう、繰り返しうる要素はいつも配列にする（1 つだけのときに配列でなくなる罠）
// 壊れた XML は XMLValidator で先に見て投げる（読む側で捨てて次へ）。

import { XMLParser, XMLValidator } from "fast-xml-parser";

/** 繰り返しうる要素（Atom の entry・link、警報の Warning・Item・Kind・Area、地震の Pref・Area・City・IntensityStation） */
const ARRAY_TAGS: ReadonlySet<string> = new Set(["entry", "link", "Warning", "Item", "Kind", "Area", "Pref", "City", "IntensityStation"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export type XmlNode = { readonly [key: string]: unknown };

/** XML を読む。壊れていれば投げる */
export function parseXml(xml: string): XmlNode {
  const src = xml.replace(/^﻿/, "");
  const ok = XMLValidator.validate(src);
  if (ok !== true) throw new Error(`XML が壊れている（${ok.err.line} 行: ${ok.err.code}）`);
  const doc = parser.parse(src) as unknown;
  if (!isNode(doc)) throw new Error("XML が読めない");
  return doc;
}

function isNode(v: unknown): v is XmlNode {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 子の要素（1 つ目）。無ければ undefined */
export function child(node: unknown, name: string): XmlNode | undefined {
  if (!isNode(node)) return undefined;
  const v = node[name];
  const first = Array.isArray(v) ? v[0] : v;
  if (isNode(first)) return first;
  // 中身が文字だけの要素（<Name>松山市</Name>）は { "#text": … } の形にそろえる
  if (typeof first === "string") return { "#text": first };
  return undefined;
}

/** 子の要素を全部（無ければ空） */
export function children(node: unknown, name: string): XmlNode[] {
  if (!isNode(node)) return [];
  const v = node[name];
  const all = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return all.flatMap((x) => (isNode(x) ? [x] : typeof x === "string" ? [{ "#text": x }] : []));
}

/** 要素の文字（属性つきの要素も文字だけ）。無ければ "" */
export function text(node: unknown): string {
  if (typeof node === "string") return node.trim();
  if (isNode(node)) {
    const t = node["#text"];
    return typeof t === "string" ? t.trim() : typeof t === "number" ? String(t) : "";
  }
  return "";
}

/** 子の要素の文字（childText(item, "Name")）。無ければ "" */
export function childText(node: unknown, name: string): string {
  if (!isNode(node)) return "";
  const v = node[name];
  return text(Array.isArray(v) ? v[0] : v);
}

/** 属性の値。無ければ undefined */
export function attr(node: unknown, name: string): string | undefined {
  if (!isNode(node)) return undefined;
  const v = node[`@_${name}`];
  return typeof v === "string" ? v : undefined;
}

/** 道をたどる（path(doc, "Report", "Head", "Title")）。途中で無ければ undefined */
export function path(node: unknown, ...names: string[]): XmlNode | undefined {
  let cur: unknown = node;
  for (const n of names) {
    cur = child(cur, n);
    if (cur === undefined) return undefined;
  }
  return cur as XmlNode;
}

/** 日時の文字を UTC の ISO に（「2026-11-04T10:00:00+09:00」→「2026-11-04T01:00:00.000Z」）。読めなければ null */
export function isoOf(s: string): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
