// 共通の部品（T44）の画面を持たない所のテスト: 読み込みの印の動かし方、manifest の形
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest, { MANIFEST_BACKGROUND } from "../../app/manifest.ts";
import { Loader72, loaderMotion } from "../../components/ui/Loader72.tsx";

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
