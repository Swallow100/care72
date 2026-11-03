// 紙面の太字（T47 の 1）: 様式の紙面（松山市の計画書・医療要約・差し込み・様式 9）に、元の様式に無い太字が無いこと。
// 太くしてよいのは元の様式で太い所だけ（lib/forms/form-audit.ts の bold）。本人の 1 枚と QR の紙は様式の無い文書なので見ない。

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Form9Paper } from "../../components/forms/Form9Paper.tsx";
import { MappedSheet } from "../../components/forms/MappedSheet.tsx";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { MedicalSummarySheet } from "../../components/forms/MedicalSummarySheet.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { MATSUYAMA_AUDIT } from "./form-audit.ts";
import { buildForm9, type Form9PersonInput } from "./form9.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult } from "./mapping.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { readRepoFile, seedRows } from "./print-harness.ts";
import { warekiText } from "./wareki.ts";

const TODAY = "2026-11-03";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const IDS = SEED_PEOPLE.map((p) => p.person.id);
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const html = (el: ReactElement) => renderToStaticMarkup(el);

function sheets(id: string): Array<[string, string]> {
  const out: Array<[string, string]> = [["計画書", html(createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(rowsOf(id), OPTS) }))]];
  const m = buildMedicalSummary(rowsOf(id), OPTS);
  if (m.kind === "sheet") out.push(["医療要約", html(createElement(MedicalSummarySheet, { sheet: m.sheet }))]);
  out.push([
    "差し込み",
    html(
      createElement(MappedSheet, {
        sheet: buildMappedSheet(rowsOf(id), checkReadResult(CAO_FORM_READ).mapping, OPTS),
        meta: { date: warekiText(TODAY), checked: "2026-11-03 山本", office: "デモ事業所", author: "山本" },
      }),
    ),
  ]);
  return out;
}

const form9Html = () =>
  html(
    createElement(Form9Paper, {
      sheet: buildForm9(
        SEED_PEOPLE.map(
          (p): Form9PersonInput => ({ person: { ...p.person, ledger: JSON.stringify(p.ledger) }, careManager: "山本", contacts: p.contacts, clocks: p.clocks }),
        ),
        { today: TODAY },
      ),
      office: "デモ事業所",
      date: warekiText(TODAY),
      order: "平時",
      report: "【安否報告（下書き）】",
    }),
  );

/** 太字を付ける印（HTML の要素・class） */
const BOLD_MARKS = [/<b[\s>]/, /<strong[\s>]/, /\bp-strong\b/, /\bfont-bold\b/, /\bfont-semibold\b/, /font-weight/];

describe("紙面の値に太字が無い", () => {
  it("計画書・医療要約・差し込みは 10 人とも、様式 9 の紙も、太字の要素と class が無い", () => {
    for (const id of IDS) {
      for (const [name, markup] of sheets(id)) {
        for (const re of BOLD_MARKS) expect(re.test(markup), `${id} ${name} ${re}`).toBe(false);
      }
    }
    const f9 = form9Html();
    for (const re of BOLD_MARKS) expect(re.test(f9), `様式9 ${re}`).toBe(false);
  });

  it("計画書で太くするのは元の様式で太い段の名前と、同意・マイ・タイムラインの選択肢の言葉だけ", () => {
    const markup = html(createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(rowsOf("p-01"), OPTS) }));
    const heads = [...markup.matchAll(/class="(?:blk-h b|f-l b)">([^<]+)/g)].map((m) => m[1]);
    expect(heads).toEqual(["近親者及緊急時の連絡先", "避難支援等実施者(近隣協力員)", "避難支援等実施組織", "私の避難場所", "住居", "支援の内容（複数選択可）", "避難経路"]);
    for (const h of heads) expect(MATSUYAMA_AUDIT.bold).toContain(h);
    const opt = [...markup.matchAll(/class="[^"]*\bopt-b\b[^"]*" data-field="([^"]+)"/g)].map((m) => m[1]);
    expect(opt).toEqual(["target.timeline", "consent.registry", "consent.planShare"]);
  });
});

/** CSS の規則のうち太字（font-weight 600 以上・bold）を付ける選び方 */
function boldSelectors(css: string): string[] {
  const out: string[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/font-weight:\s*(bold|[6-9]00)/.test(m[2])) out.push(m[1].trim().replace(/\s+/g, " "));
  }
  return out;
}

describe("紙面の CSS の太字", () => {
  it("paper.css で太くするのは、様式で太い所（題・段の名前・欄の名前・選択肢の言葉）と、様式の無い文書（QR の紙）の強めだけ", () => {
    expect(boldSelectors(readRepoFile("components/forms/paper.css"))).toEqual([
      ".paper :is(b, strong)",
      ".paper .title",
      ".paper .blk-h.b",
      ".paper .f-l.b",
      ".paper .opt-b .ch",
      ".paper .p-strong",
      ".paper .qr-name",
    ]);
  });

  it("様式の題は .paper.form で細くする（松山市・災害診療記録の題は太字でない）。様式 9 の紙は .form でなく太いまま（ひな形の題は太字）", () => {
    const css = readRepoFile("components/forms/paper.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.paper\.form \.title \{\s*font-weight: 400;/);
    expect(form9Html()).not.toMatch(/class="paper[^"]*\bform\b/);
  });

  it("医療要約・差し込み・様式 9 の CSS は太くしない", () => {
    for (const f of ["components/forms/medical-paper.css", "components/forms/mapped-paper.css", "components/forms/form9-paper.css"]) {
      expect(boldSelectors(readRepoFile(f)), f).toEqual([]);
    }
  });
});
