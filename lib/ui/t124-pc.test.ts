// T124 の追加（審査員には PC で触ってもらう）: ログインの画面の「PC 推奨」の 1 語と、
// 表の画面（ケアマネ・事業所・行政・医療班）を 768px 未満で開いたときだけの「PC 推奨」の 1 行（閉じられる・端末に覚える）。
// 本人・家族のスマホの頁には出さない。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ROLES, showsPcHint } from "../auth/roles.ts";
import { PC_HINT_LABELS } from "./labels.ts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({ getPrincipal: async () => null }));

const { PcHint, PC_HINT_STORAGE_KEY } = await import("../../components/PcHint.tsx");
const { default: LoginPage } = await import("../../app/login/page.tsx");

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("PC 推奨", () => {
  it("言葉は 2〜4 字の漢語の 1 語（説明文にしない）", () => {
    expect(PC_HINT_LABELS.hint).toBe("PC 推奨");
    expect(PC_HINT_LABELS.close).toBe("閉じる");
  });

  it("ログインの画面: 見出し「ログイン」の横に 1 語。閉じるボタンは無い", async () => {
    const m = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(m).toMatch(/data-pc-hint-login="true">PC 推奨<\/span>/);
    expect(m).not.toContain("data-pc-hint-close");
    // 見出しは「ログイン」のまま（T66）
    expect(m).toMatch(/<h1 id="login-title"[^>]*>\s*ログイン\s*<\/h1>/);
  });

  it("出す役は表の画面を使う役だけ（ケアマネ・行政・医療班）。本人・家族と役を選ぶ前には出さない", () => {
    expect(ROLES.filter(showsPcHint)).toEqual(["care_manager", "government", "medical"]);
    for (const r of ["self", "family", "unselected"] as const) expect(showsPcHint(r)).toBe(false);
    // ヘッダーは役を見て出す（本人・家族の頁の印は付かない）
    expect(read("components/AppHeader.tsx")).toContain("{p && showsPcHint(p.role) && <PcHint />}");
  });

  it("1 行の形: 描いた直後は隠し（端末の記録を読むまで）、出すのは 768px 未満だけ（md で隠す）。閉じるはアイコンと文字", () => {
    const m = renderToStaticMarkup(createElement(PcHint));
    expect(m).toContain('data-pc-hint="true"');
    expect(m).toMatch(/class="[^"]*\bhidden\b[^"]*"[^>]*data-closed=""/);
    expect(m).toContain("PC 推奨");
    expect(m).toMatch(/<button[^>]*data-pc-hint-close="true"[^>]*><svg[\s\S]*?<\/svg>閉じる<\/button>/);
    const src = read("components/PcHint.tsx");
    expect(src).toContain('"flex md:hidden"');
    expect(src).toContain("localStorage");
    expect(PC_HINT_STORAGE_KEY).toBe("care72.pcHint.closed");
  });
});
