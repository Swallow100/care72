// 画面を移る途中の印の決め方（lib/ui/nav-pending.ts）
import { describe, expect, it } from "vitest";
import { startsNavigation, type NavAnchor, type NavClick } from "./nav-pending";

const HERE = "http://localhost:3073/?sort=order";
const CLICK: NavClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const a = (href: string, more: Partial<NavAnchor> = {}): NavAnchor => ({ href, target: "", download: false, ...more });

describe("startsNavigation", () => {
  it("別の画面・同じ画面の別の絞込は移る", () => {
    expect(startsNavigation(CLICK, a("/drill"), HERE)).toBe(true);
    expect(startsNavigation(CLICK, a("/people/p01"), HERE)).toBe(true);
    expect(startsNavigation(CLICK, a("/?sort=name"), HERE)).toBe(true);
    expect(startsNavigation(CLICK, a("/"), HERE)).toBe(true);
    expect(startsNavigation(CLICK, a("http://localhost:3073/office"), HERE)).toBe(true);
  });

  it("同じ画面・# だけ違うのは移らない", () => {
    expect(startsNavigation(CLICK, a("/?sort=order"), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("/?sort=order#map"), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("#map"), HERE)).toBe(false);
  });

  it("新しい窓・修飾キー・中の押しは数えない", () => {
    expect(startsNavigation(CLICK, a("/drill", { target: "_blank" }), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("/drill", { target: "_self" }), HERE)).toBe(true);
    for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(startsNavigation({ ...CLICK, [k]: true }, a("/drill"), HERE)).toBe(false);
    }
    expect(startsNavigation({ ...CLICK, button: 1 }, a("/drill"), HERE)).toBe(false);
  });

  it("書き出し・受け口・別のサイト・電話とメールは数えない", () => {
    expect(startsNavigation(CLICK, a("/caseload/csv", { download: true }), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("/api/forms/mappings/x/pages/1"), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("/apiary"), HERE)).toBe(true);
    expect(startsNavigation(CLICK, a("https://maps.gsi.go.jp/"), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("tel:119"), HERE)).toBe(false);
    expect(startsNavigation(CLICK, a("mailto:x@example.com"), HERE)).toBe(false);
  });
});
