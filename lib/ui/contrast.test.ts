// 文字の色の対比（T79、11/4 の点検の中 9）。app/globals.css のライトとダークの値を読み、文字に使う色が
// 地（base）・面（panel）・面の中（panel2）のどれの上でも 4.5 以上か、印の塗りの上の文字が 4.5 以上かを見る。
// 塗りの面の色（--state-*-fill・--danger・--accent）と帯の色（--state-*）は T79 で変えていないことも見る。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} が無い`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const LIGHT = block(":root");
const DARK = { ...LIGHT, ...block(':root[data-theme="dark"]') };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = ["ink", "muted", "state-ok-text", "state-urgent-text", "state-unknown-text", "danger-text", "accent-text"] as const;
const GROUNDS = ["base", "panel", "panel2"] as const;
const ON_FILL = [
  ["on-state-ok", "state-ok-fill"],
  ["on-state-urgent", "state-urgent-fill"],
  ["on-state-check", "state-check-fill"],
  ["on-state-unknown", "state-unknown-fill"],
  ["on-accent", "accent"],
  ["on-accent", "danger"],
] as const;

describe.each([
  ["ライト", LIGHT],
  ["ダーク", DARK],
])("%s の文字の対比", (_, t) => {
  it("文字の色は地・面・面の中の上で 4.5 以上", () => {
    for (const fg of TEXT) {
      for (const bg of GROUNDS) expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("印・塗りのボタンの上の文字は 4.5 以上", () => {
    for (const [fg, bg] of ON_FILL) expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("塗りと帯の色は変えない（T79 は文字の色だけ）", () => {
  it("ライトの塗り・帯の色は前の値のまま", () => {
    expect(LIGHT).toMatchObject({
      "state-ok": "#1a994a",
      "state-urgent": "#e11c22",
      "state-check": "#c17a00",
      "state-unknown": "#66717d",
      "state-ok-fill": "#1a994a",
      "state-urgent-fill": "#e11c22",
      "state-check-fill": "#f2b125",
      "state-unknown-fill": "#6b7682",
      danger: "#e11c22",
      accent: "#116bdf",
    });
  });

  it("text-state-*・text-danger・text-accent は文字の色、bg-danger-fill・bg-accent-fill は塗りの色を指す", () => {
    expect(css).toContain("--color-state-ok: var(--state-ok-text);");
    expect(css).toContain("--color-state-urgent: var(--state-urgent-text);");
    expect(css).toContain("--color-state-unknown: var(--state-unknown-text);");
    expect(css).toContain("--color-danger: var(--danger-text);");
    expect(css).toContain("--color-danger-fill: var(--danger);");
    expect(css).toContain("--color-accent: var(--accent-text);");
    expect(css).toContain("--color-accent-fill: var(--accent);");
  });
});
