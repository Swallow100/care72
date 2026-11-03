// 元の様式とコードの欄の照合（T47 の 2）を固定する。照合の表（lib/forms/form-audit.ts）とコードの欄の一覧が食い違えば落ちる。
// 欄を足す・消す・並べ替える・名前を変えるときは、元の様式を見て照合の表も直す（docs/progress/t47.md の表も auditMarkdown() から作り直す）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { auditMarkdown, FORM9_AUDIT, MATSUYAMA_AUDIT, MEDICAL_AUDIT, normalizeLabel, type AuditRow } from "./form-audit.ts";
import { FORM9_COLUMNS } from "./form9.ts";
import { buildMatsuyamaSheet, MATSUYAMA_FIELDS, MATSUYAMA_TEXTS, type MatsuyamaFieldDef } from "./matsuyama.ts";
import { MEDICAL_FIELDS, type MedicalFieldDef } from "./medical-summary.ts";
import { readRepoFile, seedRows } from "./print-harness.ts";

const keysOf = (rows: readonly AuditRow[]) => rows.flatMap((r) => r.keys);
const formRows = (rows: readonly AuditRow[]) => rows.filter((r) => r.result !== "様式外");
const outRows = (rows: readonly AuditRow[]) => rows.filter((r) => r.result === "様式外");

/** 1 つの欄の名前の照合: 書き方が違う欄はコードの名前を照合の表に書いて固定、ほかは様式の名前と同じ */
function expectLabel(r: AuditRow, label: string) {
  if (r.code !== undefined) expect(label, r.keys[0]).toBe(r.code);
  else expect(normalizeLabel(label), r.keys[0]).toBe(normalizeLabel(r.original));
  if (r.result === "一致" || r.result === "直した") {
    // 一致・直した欄で名前が違うのは、照合の表で様式の段の名前を前に付けた物だけ
    if (r.code !== undefined && r.result === "一致") expect(normalizeLabel(r.original).endsWith(normalizeLabel(r.code)), r.keys[0]).toBe(true);
  }
}

describe("松山市の様式（2026.9.10）", () => {
  const byKey = new Map<string, MatsuyamaFieldDef>(MATSUYAMA_FIELDS.map((f) => [f.key, f]));

  it("コードの欄の一覧は、照合の表の欄を様式の読む順に並べた物と同じ（足した・消した・順の違いが無い）", () => {
    expect(MATSUYAMA_FIELDS.map((f) => f.key)).toEqual(keysOf(MATSUYAMA_AUDIT.rows));
  });

  it("欄の名前と選択肢は様式の字のまま。名前の無い欄は紙面に名前を出さない印（unnamed）を持つ", () => {
    for (const r of MATSUYAMA_AUDIT.rows) {
      if (r.keys.length !== 1) continue;
      const f = byKey.get(r.keys[0])!;
      expectLabel(r, f.label);
      expect(f.unnamed === true, r.keys[0]).toBe(r.result === "名付け");
      if (r.options && r.options.length > 0) expect(f.options?.map(normalizeLabel), r.keys[0]).toEqual(r.options.map(normalizeLabel));
    }
  });

  it("様式に無い欄は extra で、紙面では特記事項の中に出す（ほかの段に行を足さない）", () => {
    const extras = MATSUYAMA_FIELDS.filter((f) => "extra" in f && f.extra).map((f) => f.key);
    expect(extras).toEqual(keysOf(outRows(MATSUYAMA_AUDIT.rows)));
    const markup = renderToStaticMarkup(
      createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(seedRows(SEED_PEOPLE[0]), { today: "2026-11-03", officeName: "デモ事業所" }) }),
    );
    const notes = markup.slice(markup.indexOf('data-block="notes"'), markup.indexOf('data-block="route"'));
    for (const k of extras) expect(notes, k).toContain(`data-field="${k}"`);
  });

  it("様式に刷ってある文（題・注・同意の問い）は全部、字のまま紙面に出る", () => {
    const markup = renderToStaticMarkup(
      createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(seedRows(SEED_PEOPLE[0]), { today: "2026-11-03", officeName: "デモ事業所" }) }),
    );
    for (const [k, v] of Object.entries(MATSUYAMA_TEXTS)) expect(markup, k).toContain(v);
    // 様式に無い 1 行・段の名前を足さない
    expect(markup).not.toContain("※欄は松山市");
    expect(markup).not.toMatch(/class="blk-h[^"]*">同意</);
    expect(markup).not.toContain("機器は特記事項");
  });
});

describe("災害診療記録 2018（医療要約の順）", () => {
  const byKey = new Map<string, MedicalFieldDef>(MEDICAL_FIELDS.map((f) => [f.key, f]));

  it("様式の欄に当たるコードの欄は、様式の読む順（性別は（漢字等）の右、住所は状態の左、メディカル ID は既往症の前）", () => {
    const formKeys = MEDICAL_FIELDS.filter((f) => !("extra" in f && f.extra)).map((f) => f.key);
    expect(formKeys).toEqual(keysOf(formRows(MEDICAL_AUDIT.rows)));
  });

  it("様式に無い欄（extra）は照合の表の様式外の行と同じで、紙面では補足の段に出す", () => {
    const extras = MEDICAL_FIELDS.filter((f) => "extra" in f && f.extra).map((f) => f.key);
    expect([...extras].sort()).toEqual([...keysOf(outRows(MEDICAL_AUDIT.rows))].sort());
  });

  it("欄の名前は様式の字のまま（違う欄は照合の表に固定）。医療班が書く欄は書かない", () => {
    for (const r of formRows(MEDICAL_AUDIT.rows)) {
      if (r.keys.length === 0) {
        expect(["書かない", "未照合"], r.original).toContain(r.result);
        continue;
      }
      expectLabel(r, byKey.get(r.keys[0])!.label);
    }
  });
});

describe("様式 9（BCP ひな形）", () => {
  it("ひな形の列はひな形の順と言葉、ケア72 の列はそのあと", () => {
    const mhlw = FORM9_COLUMNS.filter((c) => c.origin === "mhlw");
    expect(mhlw.map((c) => c.id)).toEqual(keysOf(formRows(FORM9_AUDIT.rows)));
    expect(FORM9_COLUMNS.filter((c) => c.origin === "care72").map((c) => c.id)).toEqual(keysOf(outRows(FORM9_AUDIT.rows)));
    for (const r of formRows(FORM9_AUDIT.rows)) expectLabel(r, mhlw.find((c) => c.id === r.keys[0])!.csv);
  });
});

describe("照合の表の書き物", () => {
  it("docs/progress/t47.md の照合の表は auditMarkdown() と同じ", () => {
    expect(readRepoFile("docs/progress/t47.md")).toContain(auditMarkdown());
  });
});
