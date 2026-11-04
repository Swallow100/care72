// 安全のための見出し（見直しの安全 低）。next.config.ts は読み込むと OpenNext の手元の模擬を始めるので、文字で確かめる。
// 頁が実際に見出しを返すことは next build → next start で確かめた（docs/progress/t83.md）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./headers.ts";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("安全のための見出し", () => {
  it("frame-ancestors 'none'・nosniff・strict-origin-when-cross-origin", () => {
    const h = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("地図のタイル・雨雲・声・黒塗りの画面の blob: と pdf.js の worker を縛らない（読み込みの元の項目は付けない）", () => {
    for (const d of ["default-src", "script-src", "style-src", "img-src", "connect-src", "media-src", "worker-src", "font-src", "frame-src"]) {
      expect(CONTENT_SECURITY_POLICY).not.toContain(d);
    }
    expect(CONTENT_SECURITY_POLICY.split("; ").sort()).toEqual(["base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"]);
  });

  it("next.config.ts が全部の道に付ける", () => {
    const src = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(src).toMatch(/import \{ SECURITY_HEADERS \} from "\.\/lib\/security\/headers\.ts";/);
    expect(src).toMatch(/async headers\(\) \{\s*return \[\{ source: "\/:path\*", headers: \[\.\.\.SECURITY_HEADERS\] \}\];/);
  });

  it("画面は枠（iframe）・<object>・<embed>・<base> を使わず、フォームは同じ origin に送る（見出しで壊れる物が無い）", () => {
    const files = ["app", "components"].flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/<(iframe|object|embed|base)[\s>]/);
      expect(src, f).not.toMatch(/action=\{?["'`]https?:/);
    }
  });
});
