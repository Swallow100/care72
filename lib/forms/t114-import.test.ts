// 計画書・医療の記録の「原本取込」の帯（components/forms/OriginalImport.tsx、docs/tasks/T114.md の 3）。
// 前は保存できたあと描き直すまでの数秒、帯が「原本未取込」「原本取込」に戻っていて、取り込めたか分からなかった。
// 今は 原本未取込 → 取得中 → 変換中 → 保存中 → 取込済（反映中、押せない）→ 描き直しで原本の紙に替わる（帯ごと消える）。
// 描き直しても帯が残れば 取込済 と「再表示」。途中で投げた物も含め、失敗は理由の短い言葉で止まる（取得中のまま固まらない）。
// 流れは偽の fetch・ハッシュ・PNG 化を渡して、帯の状態の並びを見る。見た目は状態ごとに static に描く。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  IMPORT_LABELS,
  ImportBand,
  importFromFile,
  importFromSource,
  OriginalImport,
  type ImportDeps,
  type ImportState,
} from "../../components/forms/OriginalImport.tsx";
import { ORIGINAL_ERROR_LABELS, originalImportHref, originalSourceHref } from "./originals.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const SHA = "a".repeat(64);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

type Fake = { deps: ImportDeps; states: ImportState[]; calls: string[] };

/** 偽の道具。source は公式の頁の応答、store は保存の応答（throw を渡すと投げる） */
function fake(opts: {
  source?: Response | "throw";
  store?: Response | "throw";
  sha?: string | "throw";
  raster?: "throw";
}): Fake {
  const states: ImportState[] = [];
  const calls: string[] = [];
  const deps: ImportDeps = {
    id: "matsuyama",
    spec: { sha256: SHA, usePages: [1, 2] },
    fetch: async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      const r = input === originalSourceHref("matsuyama") ? opts.source : opts.store;
      if (r === "throw" || r === undefined) throw new TypeError("network");
      return r;
    },
    sha256Hex: async () => {
      if (opts.sha === "throw") throw new Error("subtle");
      return opts.sha ?? SHA;
    },
    rasterize: async (_pdf, pages) => {
      if (opts.raster === "throw") throw new Error("canvas");
      return new Map(pages.map((n) => [n, new Blob([`png${n}`], { type: "image/png" })]));
    },
    set: (s) => states.push(s),
  };
  return { deps, states, calls };
}

const pdfResponse = () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const steps = (states: ImportState[]) => states.map((s) => (s.kind === "busy" ? s.step : s.kind === "error" ? `error:${s.label}` : s.kind));

describe("原本取込の流れ（帯の状態の並び）", () => {
  it("公式の頁から: 取得中 → 変換中 → 保存中 → 取込済 で true（描き直しは呼び手）。原本未取込に戻さない", async () => {
    const f = fake({ source: pdfResponse(), store: json(200, { ok: true }) });
    expect(await importFromSource(f.deps)).toBe(true);
    expect(steps(f.states)).toEqual([IMPORT_LABELS.fetching, IMPORT_LABELS.converting, IMPORT_LABELS.saving, "done"]);
    expect(f.states.some((s) => s.kind === "idle")).toBe(false);
    expect(f.calls).toEqual([`GET ${originalSourceHref("matsuyama")}`, `POST ${originalImportHref("matsuyama")}`]);
  });

  it("選んだ PDF から: 確認中 → 変換中 → 保存中 → 取込済", async () => {
    const f = fake({ store: json(200, { ok: true }) });
    expect(await importFromFile(f.deps, new Blob([PDF]))).toBe(true);
    expect(steps(f.states)).toEqual([IMPORT_LABELS.checking, IMPORT_LABELS.converting, IMPORT_LABELS.saving, "done"]);
  });

  it("公式の頁が断る・つながらない・本文を読めない: 取得失敗（または応答の理由）で止まり、原本選択を出す", async () => {
    const refused = fake({ source: json(502, { ok: false, error: "source_failed" }) });
    expect(await importFromSource(refused.deps)).toBe(false);
    expect(refused.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.source_failed, pick: true });

    const forbidden = fake({ source: json(403, { ok: false, error: "forbidden" }) });
    await importFromSource(forbidden.deps);
    expect(forbidden.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.forbidden, pick: true });

    const offline = fake({ source: "throw" });
    expect(await importFromSource(offline.deps)).toBe(false);
    expect(offline.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.source_failed, pick: true });

    // 本文の読み出しで投げる（前は try の外で、「取得中」のまま固まった）
    const broken = pdfResponse();
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(new TypeError("aborted"));
    const cut = fake({ source: broken });
    expect(await importFromSource(cut.deps)).toBe(false);
    expect(cut.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.source_failed, pick: true });
  });

  it("版が違う: 版相違。ハッシュが作れない・PNG にできない: 形式不正。どれも原本選択を出す", async () => {
    const other = fake({ source: pdfResponse(), sha: "b".repeat(64) });
    expect(await importFromSource(other.deps)).toBe(false);
    expect(other.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.version, pick: true });

    const noSubtle = fake({ source: pdfResponse(), sha: "throw" });
    expect(await importFromSource(noSubtle.deps)).toBe(false);
    expect(noSubtle.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.invalid, pick: true });

    const raster = fake({ source: pdfResponse(), raster: "throw" });
    expect(await importFromSource(raster.deps)).toBe(false);
    expect(raster.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.invalid, pick: true });

    const unreadable = fake({});
    const file = new Blob([PDF]);
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new DOMException("NotReadableError"));
    expect(await importFromFile(unreadable.deps, file)).toBe(false);
    expect(unreadable.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.invalid, pick: true });
  });

  it("保存が断る・つながらない: 応答の理由か保存失敗。原本選択は出さない（同じ原本でやり直せる）", async () => {
    const denied = fake({ source: pdfResponse(), store: json(403, { ok: false, error: "forbidden" }) });
    expect(await importFromSource(denied.deps)).toBe(false);
    expect(denied.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.forbidden, pick: false });

    const down = fake({ source: pdfResponse(), store: "throw" });
    expect(await importFromSource(down.deps)).toBe(false);
    expect(down.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.store_failed, pick: false });

    const unknown = fake({ source: pdfResponse(), store: json(500, { ok: false, error: "what" }) });
    await importFromSource(unknown.deps);
    expect(unknown.states.at(-1)).toEqual({ kind: "error", label: ORIGINAL_ERROR_LABELS.store_failed, pick: false });
  });
});

const band = (state: ImportState, reflecting = false) =>
  renderToStaticMarkup(
    createElement(ImportBand, {
      id: "matsuyama",
      state,
      reflecting,
      officialUrl: "https://example.invalid/original.pdf",
      onFetch: () => {},
      onReload: () => {},
      onPick: () => {},
    }),
  );
/** ボタンの文字と押せないか */
const buttons = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    text: m[2].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, ""),
    disabled: /\sdisabled=""/.test(m[1]),
  }));

describe("原本取込の帯の見た目", () => {
  it("取り込む前: 黄の「原本未取込」と押せる「原本取込」", () => {
    const html = band({ kind: "idle" });
    expect(html).toMatch(/data-tone="check"[^>]*>原本未取込</);
    expect(buttons(html)).toEqual([{ text: IMPORT_LABELS.fetch, disabled: false }]);
    expect(html).not.toContain(IMPORT_LABELS.done);
  });

  it("途中: その段の言葉で押せない（原本未取込のまま）", () => {
    for (const step of [IMPORT_LABELS.fetching, IMPORT_LABELS.checking, IMPORT_LABELS.converting, IMPORT_LABELS.saving] as const) {
      const html = band({ kind: "busy", step });
      expect(html).toContain(IMPORT_LABELS.missing);
      expect(buttons(html)).toEqual([{ text: step, disabled: true }]);
    }
  });

  it("保存できて描き直す間: 緑の「取込済」と押せない「反映中」。「原本未取込」「原本取込」は出さない", () => {
    const html = band({ kind: "done" }, true);
    expect(html).toMatch(/data-tone="ok"[^>]*>取込済</);
    expect(html).toContain('data-import-state="reflecting"');
    expect(html).toContain('role="status"');
    expect(buttons(html)).toEqual([{ text: IMPORT_LABELS.reflecting, disabled: true }]);
    expect(html).not.toContain(IMPORT_LABELS.missing);
    expect(html).not.toContain(`>${IMPORT_LABELS.fetch}<`);
  });

  it("描き直しても帯が残るとき: 「取込済」と押せる「再表示」", () => {
    const html = band({ kind: "done" }, false);
    expect(html).toContain('data-import-state="done"');
    expect(buttons(html)).toEqual([{ text: IMPORT_LABELS.reload, disabled: false }]);
  });

  it("失敗: 赤の太字の理由。選べる失敗は「原本選択」と「公式頁」、保存の失敗は理由だけ", () => {
    const pick = band({ kind: "error", label: ORIGINAL_ERROR_LABELS.version, pick: true });
    expect(pick).toMatch(/role="alert"[^>]*>版相違</);
    expect(buttons(pick).map((b) => b.text)).toEqual([IMPORT_LABELS.fetch, IMPORT_LABELS.pick]);
    expect(pick).toContain(`>${IMPORT_LABELS.page}</a>`);
    const store = band({ kind: "error", label: ORIGINAL_ERROR_LABELS.store_failed, pick: false });
    expect(store).toContain(ORIGINAL_ERROR_LABELS.store_failed);
    expect(buttons(store).map((b) => b.text)).toEqual([IMPORT_LABELS.fetch]);
    expect(store).not.toContain(IMPORT_LABELS.page);
  });

  it("言葉は 2〜5 字（原本未取込だけ 5 字。前からの言葉）", () => {
    for (const [k, v] of Object.entries(IMPORT_LABELS)) expect(v.length, k).toBeLessThanOrEqual(k === "missing" ? 5 : 4);
  });

  it("部品は帯の最初の形（原本未取込）で描き、隠したファイルの欄を持つ", () => {
    const html = renderToStaticMarkup(createElement(OriginalImport, { id: "kiroku" }));
    expect(html).toContain('data-original-import="kiroku"');
    expect(html).toContain('data-import-state="idle"');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="application\/pdf"/);
  });
});
