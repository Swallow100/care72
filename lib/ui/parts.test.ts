// 共通の部品（T51 で書き直した選ぶ部品と、残した待ちの印・manifest）
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest, { MANIFEST_BACKGROUND } from "@/app/manifest";
import { Loader72, loaderMotion } from "@/components/ui/Loader72";
import { Select, SelectList } from "@/components/ui/Select";
import { SELECT_LABELS, WAIT_LABELS } from "./labels";
import {
  edgeIndex,
  filterItems,
  joinValues,
  moveIndex,
  placeList,
  readOptions,
  summaryLabel,
  toggleValue,
  typeaheadIndex,
  wantsSearch,
  type SelectItem,
} from "./select";

const h = createElement;
const opt = (value: string | undefined, label: string, more: Record<string, unknown> = {}) => h("option", { key: label, value, ...more }, label);
const all = (items: SelectItem[]) => items.map((_, i) => i);

describe("選ぶ部品: 中身の読み方", () => {
  it("option・optgroup・Fragment・配列を順に読む。value の無い option は文字が値", () => {
    const m = readOptions([
      opt("", "未確認"),
      h(Fragment, { key: "f" }, opt("a", "甲"), [opt(undefined, "乙")]),
      h("optgroup", { key: "g", label: "医療" }, opt("o2", "酸素"), opt("vent", "人工呼吸器", { disabled: true })),
      h("optgroup", { key: "g2", label: "止め", disabled: true }, opt("x", "使えない")),
      null,
      false,
    ]);
    expect(m.items.map((i) => [i.value, i.label, i.disabled, i.group])).toEqual([
      ["", "未確認", false, null],
      ["a", "甲", false, null],
      ["乙", "乙", false, null],
      ["o2", "酸素", false, 0],
      ["vent", "人工呼吸器", true, 0],
      ["x", "使えない", true, 1],
    ]);
    expect(m.groups).toEqual([{ label: "医療" }, { label: "止め" }]);
  });

  it("中身が数や入れ子でも文字にする。data-sub は説明の行", () => {
    const m = readOptions([h("option", { key: 1, value: 3 }, 3, " 日"), h("option", { key: 2, value: "b", "data-sub": "説明" }, h("span", null, "乙"))]);
    expect(m.items.map((i) => [i.value, i.label, i.sub])).toEqual([
      ["3", "3 日", undefined],
      ["b", "乙", "説明"],
    ]);
  });
});

describe("選ぶ部品: キー", () => {
  const { items } = readOptions([opt("a", "あ"), opt("b", "い", { disabled: true }), opt("c", "う"), opt("d", "え", { disabled: true })]);
  const s = all(items);

  it("↑↓ は選べない物を飛ばし、端で止まる", () => {
    expect(moveIndex(items, s, 0, 1)).toBe(2);
    expect(moveIndex(items, s, 2, 1)).toBe(2);
    expect(moveIndex(items, s, 2, -1)).toBe(0);
    expect(moveIndex(items, s, 0, -1)).toBe(0);
  });

  it("Home・End は端の選べる項目", () => {
    expect(edgeIndex(items, s, "first")).toBe(0);
    expect(edgeIndex(items, s, "last")).toBe(2);
    const off = readOptions([opt("a", "a", { disabled: true })]).items;
    expect(edgeIndex(off, all(off), "first")).toBe(-1);
  });

  it("文字で飛ぶ: 打った字で始まる項目へ、同じ字を続けると次へ回る、語は今の項目から", () => {
    const m = readOptions([opt("1", "Apple"), opt("2", "Banana"), opt("3", "Avocado"), opt("4", "Apricot", { disabled: true }), opt("5", "ぶどう")]).items;
    const sh = all(m);
    expect(typeaheadIndex(m, sh, 0, "a")).toBe(2);
    expect(typeaheadIndex(m, sh, 2, "a")).toBe(0);
    expect(typeaheadIndex(m, sh, 2, "aa")).toBe(0);
    expect(typeaheadIndex(m, sh, 0, "ap")).toBe(0);
    expect(typeaheadIndex(m, sh, 0, "av")).toBe(2);
    expect(typeaheadIndex(m, sh, 0, "B")).toBe(1);
    expect(typeaheadIndex(m, sh, 0, "ぶ")).toBe(4);
    expect(typeaheadIndex(m, sh, 0, "z")).toBe(-1);
    expect(typeaheadIndex(m, sh, -1, "a")).toBe(0);
  });
});

describe("選ぶ部品: 上に開く", () => {
  const anchor = (top: number, h = 32, left = 100, width = 200) => ({ top, bottom: top + h, left, right: left + width, width });
  const view = { width: 1280, height: 800 };

  it("下に入りきればボタンの下 4px（文書の中の位置）", () => {
    expect(placeList({ anchor: anchor(100), list: { width: 200, height: 300 }, viewport: view, scroll: { x: 0, y: 50 } })).toEqual({ top: 186, left: 100, up: false });
  });

  it("下に入りきらず上の方が広ければ上に開く", () => {
    const p = placeList({ anchor: anchor(600), list: { width: 200, height: 300 }, viewport: view, scroll: { x: 0, y: 1000 } });
    expect(p).toEqual({ top: 1000 + 600 - 4 - 300, left: 100, up: true });
  });

  it("上の方が狭い・文書の上に余地が無いときは下（画面全体を送って見る）", () => {
    expect(placeList({ anchor: anchor(300), list: { width: 200, height: 600 }, viewport: view, scroll: { x: 0, y: 0 } }).up).toBe(false);
    // 下は足りず上の方が広いが、文書の頭まで 500px しか無いのに一覧は 1200px
    expect(placeList({ anchor: anchor(500), list: { width: 200, height: 1200 }, viewport: view, scroll: { x: 0, y: 0 } }).up).toBe(false);
    // 文書をもっと送ってあれば上に開ける
    expect(placeList({ anchor: anchor(500), list: { width: 200, height: 1200 }, viewport: view, scroll: { x: 0, y: 2000 } }).up).toBe(true);
  });

  it("右にはみ出すなら右を揃える。最小の幅はボタンと同じ", () => {
    expect(placeList({ anchor: anchor(100, 32, 1150, 100), list: { width: 240, height: 100 }, viewport: view, scroll: { x: 0, y: 0 } }).left).toBe(1250 - 240);
    expect(placeList({ anchor: anchor(100, 32, 1100, 150), list: { width: 80, height: 100 }, viewport: view, scroll: { x: 0, y: 0 } }).left).toBe(1100);
  });
});

describe("選ぶ部品: 検索・複数", () => {
  const { items } = readOptions([
    h("optgroup", { key: "a", label: "医療" }, opt("o2", "酸素"), opt("dial", "透析", { "data-sub": "週 3 回" })),
    h("optgroup", { key: "b", label: "連絡" }, opt("tel", "電話"), opt("mail", "メール")),
  ]);

  it("12 を超えるか searchable で検索の欄", () => {
    expect(wantsSearch(12, undefined)).toBe(false);
    expect(wantsSearch(13, undefined)).toBe(true);
    expect(wantsSearch(3, true)).toBe(true);
  });

  it("文字か説明の行に含む物だけに絞る（全角半角・大文字小文字を揃える）。空なら全部", () => {
    expect(filterItems(items, "")).toEqual([0, 1, 2, 3]);
    expect(filterItems(items, "透")).toEqual([1]);
    expect(filterItems(items, "週３")).toEqual([1]);
    expect(filterItems(items, "ﾒｰﾙ")).toEqual([3]);
    expect(filterItems(items, "無い")).toEqual([]);
  });

  it("絞ると見出しも残る項目のある物だけ。無ければ「該当なし」", () => {
    const m = readOptions([
      h("optgroup", { key: "a", label: "医療" }, opt("o2", "酸素")),
      h("optgroup", { key: "b", label: "連絡" }, opt("tel", "電話")),
    ]);
    const draw = (shown: number[]) =>
      renderToStaticMarkup(h(SelectList, { id: "l", model: m, shown, values: [], active: -1, multiple: false, search: { query: "電", onQuery: () => {}, onKeyDown: () => {} } }));
    const one = draw([1]);
    expect(one).toContain("連絡");
    expect(one).not.toContain("医療");
    expect(one).toContain('type="search"');
    expect(one).toContain(`aria-label="${SELECT_LABELS.search}"`);
    expect(draw([])).toContain(SELECT_LABELS.empty);
  });

  it("複数: ボタンの字は「a・b」、3 つ以上は「N 件」。値は項目の順、「,」区切り", () => {
    expect(summaryLabel([])).toBeNull();
    expect(summaryLabel(["酸素"])).toBe("酸素");
    expect(summaryLabel(["酸素", "透析"])).toBe("酸素・透析");
    expect(summaryLabel(["a", "b", "c"])).toBe(`3 ${SELECT_LABELS.count}`);
    expect(toggleValue(items, ["tel"], "o2")).toEqual(["o2", "tel"]);
    expect(toggleValue(items, ["o2", "tel"], "o2")).toEqual(["tel"]);
    expect(joinValues(["o2", "tel"])).toBe("o2,tel");
  });
});

describe("選ぶ部品: 描画と aria", () => {
  const children = [opt("", "未確認"), opt("yes", "あり"), opt("no", "なし")];

  it("閉じているとき: 選んだ項目の文字、開く印、隠しの欄（name）、listbox を開くボタン", () => {
    // data-* は JSX なら書ける（createElement の型の検査は通らないので、いったん変数に置く）
    const props = { name: "home", value: "yes", onChange: () => {}, "aria-label": "在宅避難", className: "h-8 w-full", "data-filter": "x" };
    const html = renderToStaticMarkup(h(Select, props, children));
    expect(html).toMatch(/<button[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
    expect(html).toContain('aria-label="在宅避難"');
    expect(html).toContain('data-filter="x"');
    expect(html).toContain("h-8 w-full");
    expect(html).toContain(">あり</span>");
    expect(html).toContain('<input type="hidden" name="home" value="yes"/>');
    expect(html).not.toContain("<select");
  });

  it("value が無ければ defaultValue、それも無ければ 1 つ目の選べる項目", () => {
    expect(renderToStaticMarkup(h(Select, { name: "to", defaultValue: "no" }, children))).toContain('value="no"');
    const first = renderToStaticMarkup(h(Select, { name: "to" }, [opt("x", "選べない", { disabled: true }), opt("y", "山本")]));
    expect(first).toContain('value="y"');
    expect(first).toContain(">山本</span>");
  });

  it("選べない項目が選ばれている・何も無いときは薄い字。disabled は押せない", () => {
    const off = renderToStaticMarkup(h(Select, { name: "to", defaultValue: "" }, [opt("", "未割当", { disabled: true }), opt("y", "山本")]));
    expect(off).toMatch(/text-muted[^>]*>未割当<\/span>/);
    const none = renderToStaticMarkup(h(Select, { value: "zzz", onChange: () => {} }, children));
    expect(none).toMatch(/text-muted[^>]*>未選択<\/span>/);
    expect(renderToStaticMarkup(h(Select, { value: "", disabled: true, onChange: () => {} }, children))).toMatch(/<button[^>]*disabled=""/);
  });

  it("複数: 隠しの欄は同じ name で複数、ボタンは「a・b」", () => {
    const html = renderToStaticMarkup(h(Select, { name: "dev", multiple: true, value: ["o2", "tel"], onChange: () => {} }, [opt("o2", "酸素"), opt("tel", "電話"), opt("x", "他")]));
    expect(html).toContain('<input type="hidden" name="dev" value="o2"/><input type="hidden" name="dev" value="tel"/>');
    expect(html).toContain(">酸素・電話</span>");
  });

  it("一覧: listbox と option、選んだ印は太字と右のチェック（下地なし）、選べない物は薄い字、見出しは小さな薄い字", () => {
    const m = readOptions([opt("", "未確認"), h("optgroup", { key: "g", label: "医療" }, opt("o2", "酸素", { "data-sub": "内蔵電池 2 時間" }), opt("x", "使えない", { disabled: true }))]);
    const html = renderToStaticMarkup(h(SelectList, { id: "l", label: "項目", model: m, shown: all(m.items), values: ["o2"], active: 1, multiple: false, search: null }));
    expect(html).toMatch(/role="listbox"[^>]*aria-label="項目"/);
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html).toMatch(/role="option" aria-selected="true"[^>]*font-bold/);
    expect(html).toContain('role="group"');
    expect(html).toMatch(/text-xs text-muted">医療</);
    expect(html).toMatch(/aria-disabled="true"[^>]*text-muted/);
    expect(html).toContain("内蔵電池 2 時間");
    expect(html).toContain("focus:outline-accent");
    // 選んだ印にテーマ色の下地を敷かない。内側で送る箱を作らない
    expect(html).not.toMatch(/bg-accent|overflow-(y-)?auto|overflow-(y-)?scroll|max-h-/);
  });

  it("複数の一覧はチェックの枠（選んだ物は操作の色の塗りとチェック）、aria-multiselectable", () => {
    const m = readOptions([opt("a", "甲"), opt("b", "乙")]);
    const html = renderToStaticMarkup(h(SelectList, { id: "l", model: m, shown: [0, 1], values: ["b"], active: 0, multiple: true, search: null }));
    expect(html).toContain('aria-multiselectable="true"');
    expect(html.match(/bg-accent/g)).toHaveLength(1);
    expect(html).toContain("outline-muted");
    expect(html).not.toContain("font-bold");
  });
});

describe("待ちの印・manifest（T44 から残した物）", () => {
  it("動きを減らす設定・animate の無い環境では止める", () => {
    expect(loaderMotion({ reducedMotion: false, canAnimate: true })).toBe("spin");
    expect(loaderMotion({ reducedMotion: true, canAnimate: true })).toBe("still");
    expect(loaderMotion({ reducedMotion: false, canAnimate: false })).toBe("still");
  });

  it("待ちの印は読み上げの欄で、渡した文字を出す", () => {
    const html = renderToStaticMarkup(h(Loader72, { label: WAIT_LABELS.think }));
    expect(html).toContain('role="status"');
    expect(html).toContain(WAIT_LABELS.think);
  });

  it("待ちの言葉は場面ごと（split・think のキーは変えない）", () => {
    expect(WAIT_LABELS).toMatchObject({ split: "分けています", think: "考えています", listen: "聞いています", read: "読み取っています", review: "書いています" });
  });

  it("manifest はケア72、standalone、色はライトの地、印 3 つ", () => {
    const m = manifest();
    expect([m.name, m.short_name, m.display, m.start_url]).toEqual(["ケア72", "ケア72", "standalone", "/"]);
    expect(m.background_color).toBe(MANIFEST_BACKGROUND);
    expect(m.theme_color).toBe(MANIFEST_BACKGROUND);
    expect(m.icons?.map((i) => i.src)).toEqual(["/icon.svg", "/icon-192.png", "/icon-512.png"]);
  });
});
