// Excel・Word の部品の XML を木にする（T119）。ブラウザと Node の両方で動く（DOMParser は Workers・Node に無いので、既にある fast-xml-parser）。
// 名前空間の頭（w: a: xdr: v: x: など）は外して、要素と属性を局所の名前で引く（Office が書く頭は決まっているが、別の頭でも読める）。
// 順を保つ（Word の段落と表、走りの順が崩れないように preserveOrder）。外の実体・DOCTYPE は受けない（Office の部品に無い）。

import { XMLParser } from "fast-xml-parser";

export type XNode = { n: string; a: Record<string, string>; c: XNode[]; t?: string };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

type Raw = Record<string, unknown>;

function convert(list: unknown[]): XNode[] {
  const out: XNode[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Raw;
    const attrs = (o[":@"] as Record<string, unknown> | undefined) ?? {};
    for (const key of Object.keys(o)) {
      if (key === ":@") continue;
      const v = o[key];
      if (key === "#text") {
        out.push({ n: "#text", a: {}, c: [], t: String(v ?? "") });
        continue;
      }
      const a: Record<string, string> = {};
      for (const [k, val] of Object.entries(attrs)) a[k] = String(val);
      out.push({ n: key, a, c: Array.isArray(v) ? convert(v) : [] });
    }
  }
  return out;
}

export class XmlError extends Error {
  constructor() {
    super("xml");
    this.name = "XmlError";
  }
}

/** XML の文字を木に。根の要素を返す（無ければ XmlError） */
export function parseXml(text: string): XNode {
  if (/<!DOCTYPE/i.test(text.slice(0, 2048))) throw new XmlError();
  let raw: unknown;
  try {
    raw = parser.parse(text);
  } catch {
    throw new XmlError();
  }
  const nodes = convert(Array.isArray(raw) ? raw : []);
  const root = nodes.find((x) => x.n !== "#text");
  if (!root) throw new XmlError();
  return root;
}

/** 子の要素（名前を渡せばその名前だけ） */
export const kids = (x: XNode | null | undefined, name?: string): XNode[] => (x ? x.c.filter((k) => k.n !== "#text" && (name === undefined || k.n === name)) : []);
/** 最初の子の要素 */
export const kid = (x: XNode | null | undefined, name: string): XNode | null => (x ? (x.c.find((k) => k.n === name) ?? null) : null);
/** 道（"spPr/xfrm/off"）の先の要素 */
export function path(x: XNode | null | undefined, p: string): XNode | null {
  let cur: XNode | null = x ?? null;
  for (const name of p.split("/")) {
    cur = kid(cur, name);
    if (!cur) return null;
  }
  return cur;
}
/** 子孫の要素を全部（深さ優先、文書の順） */
export function descendants(x: XNode | null | undefined, name: string, out: XNode[] = []): XNode[] {
  if (!x) return out;
  for (const k of x.c) {
    if (k.n === "#text") continue;
    if (k.n === name) out.push(k);
    descendants(k, name, out);
  }
  return out;
}
/** 子孫の字を全部つなげる */
export function textOf(x: XNode | null | undefined): string {
  if (!x) return "";
  if (x.n === "#text") return x.t ?? "";
  let s = "";
  for (const k of x.c) s += textOf(k);
  return s;
}
/** 属性（無ければ undefined） */
export const attr = (x: XNode | null | undefined, name: string): string | undefined => x?.a[name];
/** 数の属性（無い・数でなければ fallback） */
export function num(x: XNode | null | undefined, name: string, fallback: number): number;
export function num(x: XNode | null | undefined, name: string): number | undefined;
export function num(x: XNode | null | undefined, name: string, fallback?: number): number | undefined {
  const v = x?.a[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
/** 真偽の属性（"1"・"true"・"on" は真、"0"・"false"・"off" は偽、無ければ fallback） */
export function bool(x: XNode | null | undefined, name: string, fallback: boolean): boolean {
  const v = x?.a[name];
  if (v === undefined) return fallback;
  return !(v === "0" || v === "false" || v === "off");
}

/**
 * mc:AlternateContent を開く。Choice の Requires が読める物（wps・a14・x14 など、ここで描ける物）なら Choice、
 * そうでなければ Fallback の子を返す
 */
export function alternate(x: XNode, readable: ReadonlySet<string> = new Set(["wps", "wpg", "wpc", "a14", "x14", "v"])): XNode[] {
  for (const k of kids(x)) {
    if (k.n === "Choice") {
      const req = (k.a.Requires ?? "").split(/\s+/).filter(Boolean);
      if (req.every((r) => readable.has(r))) return kids(k);
    }
  }
  const fb = kid(x, "Fallback");
  return fb ? kids(fb) : [];
}
