// 共通の部品（T44）のテスト: 読み込みの印の動かし方、OS の選択の代わりの項目の読み方とキー、manifest の形
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest, { MANIFEST_BACKGROUND } from "../../app/manifest.ts";
import { Loader72, loaderMotion } from "../../components/ui/Loader72.tsx";
import { nextEnabled, Select, selectItems } from "../../components/ui/Select.tsx";

describe("読み込みの印（Loader72）", () => {
  it("動きを減らす設定と animate の無い環境では止めて文字だけ", () => {
    expect(loaderMotion({ reducedMotion: true, canAnimate: true })).toBe("still");
    expect(loaderMotion({ reducedMotion: false, canAnimate: false })).toBe("still");
    expect(loaderMotion({ reducedMotion: true, canAnimate: false })).toBe("still");
    expect(loaderMotion({ reducedMotion: false, canAnimate: true })).toBe("spin");
  });

  it("role=status で、文字は呼ぶ側が渡す。輪は読み上げない", () => {
    const html = renderToStaticMarkup(createElement(Loader72, { label: "分けています" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("分けています");
    expect(html).toContain('aria-hidden="true"');
    // 色は操作の色と薄い本文色だけ（状態の色を使わない）
    expect(html).toContain("var(--accent)");
    expect(html).not.toMatch(/--state-/);
  });

  it("呼ぶ側の欄がもう status なら入れ子にしない", () => {
    const html = renderToStaticMarkup(createElement(Loader72, { label: "x", live: false }));
    expect(html).not.toContain('role="status"');
  });
});

describe("OS の選択の代わり（Select）", () => {
  const options = [
    createElement("option", { key: "u", value: "", disabled: true }, "未割当"),
    createElement("optgroup", { key: "g", label: "本人" }, [
      createElement("option", { key: "a", value: "a" }, "氏名"),
      createElement("option", { key: "b", value: "b", disabled: true }, "住所"),
    ]),
    createElement(Fragment, { key: "f" }, createElement("option", { value: 3 }, "数", "の値")),
    createElement("option", { key: "t" }, "値なし"),
  ];

  it("中の option・optgroup・Fragment をたどって項目にする（値の無い option は文字が値）", () => {
    expect(selectItems(options)).toEqual([
      { value: "", label: "未割当", disabled: true },
      { value: "a", label: "氏名", disabled: false, group: "本人" },
      { value: "b", label: "住所", disabled: true, group: "本人" },
      { value: "3", label: "数の値", disabled: false },
      { value: "値なし", label: "値なし", disabled: false },
    ]);
  });

  it("↑↓・Home・End は選べない項目を飛ばし、端で止まる", () => {
    const items = selectItems(options);
    expect(nextEnabled(items, -1, "ArrowDown")).toBe(1);
    expect(nextEnabled(items, 1, "ArrowDown")).toBe(3);
    expect(nextEnabled(items, 4, "ArrowDown")).toBe(4);
    expect(nextEnabled(items, 3, "ArrowUp")).toBe(1);
    expect(nextEnabled(items, 1, "ArrowUp")).toBe(1);
    expect(nextEnabled(items, 3, "Home")).toBe(1);
    expect(nextEnabled(items, 1, "End")).toBe(4);
  });

  it("閉じた形は選んでいる項目の文字と、name の隠しの欄（フォームで送る）", () => {
    const html = renderToStaticMarkup(createElement(Select, { name: "to", defaultValue: "a", "aria-label": "担当", children: options }));
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain("氏名");
    expect(html).toContain('<input type="hidden" name="to" value="a"/>');
    expect(html).not.toContain("<select");
  });

  it("値も既定も無ければ最初の選べる項目（<select> と同じ）", () => {
    const html = renderToStaticMarkup(createElement(Select, { name: "x", children: options }));
    expect(html).toContain('value="a"');
  });
});

describe("ホーム画面に追加の manifest", () => {
  const m = manifest();

  it("名前・開き方・始めの画面", () => {
    expect(m.name).toBe("ケア72");
    expect(m.short_name).toBe("ケア72");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
  });

  it("色は globals.css のライトの地", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
    const base = css.match(/:root\s*\{[^}]*--base:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(base).toBe(MANIFEST_BACKGROUND);
    expect(m.theme_color).toBe(base);
    expect(m.background_color).toBe(base);
  });

  it("印は svg と 192・512 の PNG（public にある）", async () => {
    const { stat } = await import("node:fs/promises");
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(["any", "192x192", "512x512"]);
    for (const i of icons.filter((x) => x.type === "image/png")) {
      const s = await stat(new URL(`../../public${i.src}`, import.meta.url));
      expect(s.size).toBeGreaterThan(0);
    }
  });
});
