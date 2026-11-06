// 頁の読み（docs/tasks/T156.md）。puppeteer の page.evaluate で頁の中で動かす関数と、その結果から指紋を作る所。
// 押せる物（a[href]・button・input・select・textarea・summary・role の付いた物）に data-persona-ref の番号を振り、役・名前・値を返す。
// 名前は aria-label → aria-labelledby → label → 見える字 → title → placeholder の順。パスワードの欄の値は返さない。
// 頁の中で動くので、外の変数・import を使わない（この関数だけで閉じる）。

import { createHash } from "node:crypto";
import type { Item, Snapshot } from "./types.ts";

export const REF_ATTR = "data-persona-ref";

export type ReadLimits = { items: number; text: number; name: number; body: number };
export const READ_LIMITS: ReadLimits = { items: 200, text: 1800, name: 60, body: 30_000 };

export type RawRead = Omit<Snapshot, "hash" | "look" | "errors" | "printed"> & { printed: boolean };

/** 頁の中で動く。番号を振り直し、読みを返す */
export function readPageInBrowser(limits: ReadLimits): RawRead {
  const attr = "data-persona-ref";
  const squeeze = (s: string | null | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (el: Element): boolean => {
    if (el.closest("[aria-hidden='true'],[inert],[hidden]")) return false;
    const he = el as HTMLElement;
    if (he.getClientRects().length === 0) return false;
    const st = getComputedStyle(he);
    return st.visibility !== "hidden" && st.display !== "none";
  };
  /** 見える字。ふりがな（ruby の rt・rp）は外す（「無事ぶじじゃない」を「無事じゃない」に） */
  const plain = (el: HTMLElement): string => {
    if (!el.querySelector("rt,rp")) return el.innerText;
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll("rt,rp").forEach((n) => n.remove());
    return c.textContent ?? "";
  };
  const labelOf = (el: Element): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (t.trim()) return t;
    }
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent;
    }
    const wrap = el.closest("label");
    if (wrap && wrap !== el && wrap.textContent?.trim()) return wrap.textContent;
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "select" && tag !== "textarea") {
      const t = plain(el as HTMLElement);
      if (t?.trim()) return t;
      const img = el.querySelector("img[alt]");
      if (img?.getAttribute("alt")) return img.getAttribute("alt") ?? "";
    }
    return el.getAttribute("title") ?? el.getAttribute("placeholder") ?? el.getAttribute("name") ?? "";
  };
  const roleOf = (el: Element): string => {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") ?? "text").toLowerCase();
      if (t === "checkbox" || t === "radio") return t;
      if (t === "submit" || t === "button" || t === "reset") return "button";
      if (t === "file") return "file";
      return t === "password" ? "password" : "textbox";
    }
    return tag;
  };
  const zoneOf = (el: Element): string | undefined => {
    const z = el.closest("[role=dialog],dialog,nav,header,aside,[role=tablist]");
    if (!z) return undefined;
    const name = z.getAttribute("aria-label") ?? (z.querySelector("h1,h2,h3")?.textContent ?? "");
    const kind = z.tagName.toLowerCase() === "dialog" || z.getAttribute("role") === "dialog" ? "窓" : z.tagName.toLowerCase() === "nav" ? "切替" : z.tagName.toLowerCase() === "header" ? "上" : z.getAttribute("role") === "tablist" ? "面" : "横";
    return squeeze(name ? `${kind}:${name}` : kind, 30);
  };

  document.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
  const sel = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=menuitem],[role=option],[role=switch]";
  // 開いた窓（aria-modal・showModal の dialog）があれば、押せるのはその中だけ（人も窓の外を押せない）。無ければ窓の物を先に
  const modal = Array.from(document.querySelectorAll("[aria-modal='true'],dialog[open]")).find((m) => visible(m) && (m.getAttribute("aria-modal") === "true" || (m as HTMLDialogElement).matches(":modal")));
  const scope: ParentNode = modal ?? document;
  const all = Array.from(scope.querySelectorAll(sel));
  const inWindow = (el: Element) => el.closest("[role=dialog],dialog") !== null;
  const ordered = modal ? all : [...all.filter(inWindow), ...all.filter((el) => !inWindow(el))];
  const items: Item[] = [];
  let ref = 0;
  for (const el of ordered) {
    if (items.length >= limits.items) break;
    if (!visible(el)) continue;
    const role = roleOf(el);
    const name = squeeze(labelOf(el), limits.name);
    if (!name && role !== "textbox" && role !== "password") continue;
    ref += 1;
    el.setAttribute(attr, String(ref));
    const item: Item = { ref, role, name };
    const href = el.getAttribute("href");
    if (href && role === "link") item.href = href;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) item.checked = el.checked;
      else if (role !== "password" && el.value) item.value = squeeze(el.value, 80);
    }
    if (el instanceof HTMLSelectElement) {
      item.options = Array.from(el.options)
        .slice(0, 12)
        .map((o) => squeeze(o.textContent, 30));
      item.value = squeeze(el.selectedOptions[0]?.textContent, 30);
    }
    const ariaChecked = el.getAttribute("aria-checked") ?? el.getAttribute("aria-selected") ?? el.getAttribute("aria-pressed");
    if (ariaChecked === "true") item.checked = true;
    if (el.getAttribute("aria-current")) item.checked = true;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    const zone = zoneOf(el);
    if (zone) item.zone = zone;
    items.push(item);
  }
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role=heading]"))
    .filter(visible)
    .slice(0, 20)
    .map((h) => squeeze(h.textContent, 50))
    .filter(Boolean);
  const alerts = Array.from(document.querySelectorAll("[role=alert],[role=status],[aria-live=assertive]"))
    .filter(visible)
    .map((a) => squeeze(a.textContent, 120))
    .filter(Boolean)
    .slice(0, 8);
  const main = document.querySelector("main") ?? document.body;
  const w = window as unknown as { __personaPrinted?: boolean };
  const whole = squeeze(plain(main as HTMLElement), limits.body);
  return {
    url: location.href,
    path: location.pathname + location.search,
    title: squeeze(document.title, 60),
    headings,
    items,
    alerts,
    header: squeeze(plain((document.querySelector("header") as HTMLElement | null) ?? document.createElement("i")), 200),
    text: whole.slice(0, limits.text),
    body: whole,
    printed: w.__personaPrinted === true,
  };
}

/** 見た目の指紋（道・見出し・押せる物の名前と値・知らせ）。番号は入れない */
export function hashOf(s: Pick<Snapshot, "path" | "headings" | "items" | "alerts">): string {
  const body = JSON.stringify([s.path, s.headings, s.items.map((i) => [i.role, i.name, i.value ?? "", i.checked ?? false, i.disabled ?? false]), s.alerts]);
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/** 本文と上の帯の字の指紋 */
export function lookOf(s: Pick<Snapshot, "header" | "text">): string {
  return createHash("sha256").update(JSON.stringify([s.header, s.text])).digest("hex").slice(0, 16);
}

/** 頁を開く前に入れる: 印刷の画面を開かずに旗を立てる（headless で止まらない・「印刷の手前まで」の印） */
export function stubPrintInBrowser(): void {
  const w = window as unknown as { __personaPrinted?: boolean; print: () => void };
  w.print = () => {
    w.__personaPrinted = true;
  };
}
