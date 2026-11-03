// 紙面の印刷（T36）: 頁数・印刷で画面の帯が消える・禁則・空欄の「未確認」・頁の下の端・?print=1。
// 頁数は headless Chrome の印刷（printToPDF、CSS の @page）で PDF を作って数える。Chrome・Edge か BIZ UDPゴシックが無ければ飛ばす。
// サーバーも D1 も使わない（lib/forms/print-harness.ts）。本物の画面の書体での頁数は tools/print/samples.ts --count（docs/progress/t36.md）。

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Form9Paper, shortAt } from "../../components/forms/Form9Paper.tsx";
import { KeepNumbers } from "../../components/forms/FormCell.tsx";
import { MappedSheet } from "../../components/forms/MappedSheet.tsx";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { MedicalSummarySheet } from "../../components/forms/MedicalSummarySheet.tsx";
import { OwnSheetPaper, type OwnQr } from "../../components/forms/OwnSheet.tsx";
import { QrSheet } from "../../components/forms/QrSheet.tsx";
import { wantsPrint } from "../../components/ui/PaperBar.tsx";
import { SEED_ACCOUNTS, SEED_PEOPLE } from "../../seed/people.ts";
import { chromePath, pdfPageCount } from "../../tools/print/chrome.ts";
import { medicalConsentOf } from "../qr/view.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { buildForm9, type Form9PersonInput } from "./form9.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { checkReadResult } from "./mapping.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary, buildOwnSheetMedical } from "./medical-summary.ts";
import { buildOwnSheet } from "./own-sheet.ts";
import { FONT_PROBE, PAPER_CSS_FILES, paperCss, paperPage, readRepoFile, seedRows } from "./print-harness.ts";
import { autoPrint, type PrintWindow } from "./print.ts";
import { warekiText } from "./wareki.ts";

const TODAY = "2026-11-03";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const IDS = SEED_PEOPLE.map((p) => p.person.id);
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const html = (el: ReactElement) => renderToStaticMarkup(el);
const MAPPING = checkReadResult(CAO_FORM_READ).mapping;
const EXPIRES = "2027-02-01T00:00:00.000Z";
const QR_URL = `https://care72.app/q/${"x".repeat(160)}`;
const QR: OwnQr = { status: "active", url: QR_URL, expiresAt: EXPIRES };

const matsuyamaHtml = (id: string) => html(createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(rowsOf(id), OPTS) }));
function medicalHtml(id: string): string | null {
  const r = buildMedicalSummary(rowsOf(id), OPTS);
  return r.kind === "sheet" ? html(createElement(MedicalSummarySheet, { sheet: r.sheet })) : null;
}
const ownHtml = (id: string) =>
  html(
    createElement(OwnSheetPaper, {
      sheet: buildOwnSheet(rowsOf(id), OPTS),
      medical: buildOwnSheetMedical(rowsOf(id), OPTS),
      qr: QR,
    }),
  );
const mappedHtml = (id: string) =>
  html(
    createElement(MappedSheet, {
      sheet: buildMappedSheet(rowsOf(id), MAPPING, OPTS),
      meta: { date: warekiText(TODAY), checked: "2026-11-03 山本", office: "デモ事業所", author: "山本" },
    }),
  );
function qrHtml(id: string): string {
  const rows = rowsOf(id);
  return html(
    createElement(QrSheet, {
      personId: id,
      name: rows.person.name,
      kana: rows.person.kana,
      url: QR_URL,
      expiresAt: EXPIRES,
      generation: 1,
      consent: medicalConsentOf(rows),
      date: warekiText(TODAY),
      office: "デモ事業所",
      careManager: "山本",
    }),
  );
}
const cmName = SEED_ACCOUNTS.find((a) => a.id === "acct-yamamoto")!.display_name;
const FORM9_PEOPLE: Form9PersonInput[] = SEED_PEOPLE.map((p) => ({
  person: { ...p.person, ledger: JSON.stringify(p.ledger) },
  careManager: cmName,
  contacts: p.contacts,
  clocks: p.clocks,
}));
const form9Html = (report: string | null) =>
  html(
    createElement(Form9Paper, {
      sheet: buildForm9(FORM9_PEOPLE, { today: TODAY }),
      office: "デモ事業所",
      date: warekiText(TODAY),
      order: "平時 順番の骨格の段 1〜8 → 時計の短い順 → 支援者なしが先 → カナ",
      report,
    }),
  );

/** 頁の下の端の「n / N」（data-paper-foot）を並べる */
const foots = (markup: string) => [...markup.matchAll(/data-paper-foot="(\d+)\/(\d+)"/g)].map((m) => `${m[1]}/${m[2]}`);

describe("紙面の CSS（Chrome なしで読む）", () => {
  const css = PAPER_CSS_FILES.map(readRepoFile).join("\n");

  it("禁則: 行頭の句読点・閉じ括弧を避け（line-break: strict）、語の途中で割らない（anywhere・break-all を使わない）", () => {
    const paper = readRepoFile("components/forms/paper.css");
    expect(paper).toMatch(/\.paper \{[^}]*line-break: strict;/);
    expect(paper).toMatch(/\.paper \{[^}]*word-break: normal;/);
    expect(paper).toMatch(/\.paper \{[^}]*overflow-wrap: normal;/);
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/word-break:\s*break-all/);
    expect(css).not.toMatch(/letter-spacing:(?!\s*0[;\s])/);
  });

  it("A4 の頁は名前付き（paper・form9）で、名前の無い @page を書かない（ほかの画面の印刷に効かない）", () => {
    expect(css).toMatch(/@page paper \{[^}]*size: A4 portrait;[^}]*margin: 0;/);
    expect(css).toMatch(/@page form9 \{\s*size: A4 landscape;/);
    expect(css).not.toMatch(/@page\s*\{/);
  });

  it("印刷では上の帯・画面だけの操作を消し、背景の灰色も刷る（print-color-adjust: exact）", () => {
    const paper = readRepoFile("components/forms/paper.css");
    const print = paper.slice(paper.indexOf("@media print"));
    expect(print).toContain("body > *:not(main):not(:has([data-paper-root]))");
    expect(print).toContain(".screen-only");
    expect(print).toContain("print-color-adjust: exact");
  });

  it("角の丸み・影・色の面を使わない（白地に黒）", () => {
    expect(css).not.toMatch(/box-shadow|linear-gradient|radial-gradient/);
    // 丸はメディカル ID の性別の ○（様式の「丸で囲む」）だけ
    expect(css.match(/border-radius/g) ?? []).toHaveLength(1);
  });
});

describe("書き方（Chrome なしで読む）", () => {
  it("頁の下の端に文書名と頁番号: 計画書 1/2・2/2、医療要約 1/1、本人の1枚 1/2・2/2、差し込み 1/2・2/2、QR 1/1", () => {
    for (const id of IDS) {
      expect(foots(matsuyamaHtml(id)), id).toEqual(["1/2", "2/2"]);
      expect(foots(ownHtml(id)), id).toEqual(["1/2", "2/2"]);
      expect(foots(mappedHtml(id)), id).toEqual(["1/2", "2/2"]);
      expect(foots(qrHtml(id)), id).toEqual(["1/1"]);
      const med = medicalHtml(id);
      if (med) expect(foots(med), id).toEqual(["1/1"]);
    }
    expect(matsuyamaHtml("p-01")).toContain("個別避難計画　山田 ハナ");
    expect(ownHtml("p-01")).toContain("本人の1枚 裏（医療要約）　山田 ハナ");
    // 本人の 1 枚の表は頁番号だけ（漢字を出さない）
    expect(ownHtml("p-01")).toContain('<div class="paper-foot" data-paper-foot="1/2"><span></span>');
  }, 60_000);

  it("空欄は「未確認」を小さく灰色の印（p-unc）で出す。理由のある欄は理由を括弧で（p-unc-r）", () => {
    const m = matsuyamaHtml("p-01");
    expect(m).toContain('<span class="p-unc">未確認</span>');
    expect(m).toMatch(/<span class="p-unc-r" data-pending="unknown">未確認（不明）<\/span>/);
  });

  it("電話番号・日付・時刻は途中で行を割らない（.nowrap の塊）", () => {
    expect(html(createElement(KeepNumbers, { text: "娘 森 恵子 090-0000-0011" }))).toBe('娘 森 恵子 <span class="nowrap">090-0000-0011</span>');
    expect(html(createElement(KeepNumbers, { text: "記録 2026-11-02 12:00 山本" }))).toBe(
      '記録 <span class="nowrap">2026-11-02</span> <span class="nowrap">12:00</span> 山本',
    );
    expect(html(createElement(KeepNumbers, { text: "薬は 2 階の箪笥" }))).toBe("薬は 2 階の箪笥");
    expect(matsuyamaHtml("p-01")).toContain('<span class="nowrap">090-0000-0001</span>');
  });

  it("「／」で区切った塊（機器の電池・予備）は塊ごとにまとめ、塊の切れ目でだけ折り返す", () => {
    const m = matsuyamaHtml("p-01");
    const notes = m.slice(m.indexOf('data-field="notes.medical"'), m.indexOf('data-field="notes.words"'));
    // 機器の行（本体・電池・予備）と、アレルギー・既往・予防接種の行
    expect(notes.match(/class="grp"/g)?.length).toBe(6);
    // 区切りは前の塊の終わり（行頭に「／」を出さない）
    expect(notes).toMatch(/<span class="p-sub">／<\/span><\/span><span class="grp">/);
  });

  it("本人の言葉は言い換えない（台帳の文のまま、空きも残す）", () => {
    const m = matsuyamaHtml("p-01");
    expect(m.slice(m.indexOf('data-field="notes.words"'))).toContain("薬は 2 階の箪笥");
  });

  it("様式 9 の紙: 順位の順に 10 人、ひな形の列の見出し、安否確認の時刻は 11/3 01:39 の形、報告の下書きは発災時だけ", () => {
    const f = form9Html(null);
    expect([...f.matchAll(/data-rank="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const h of ["優先順位※", "地域・区分", "氏名（年齢）", "住所（自治会）", "想定される避難場所", "特記", "担当ケアマネ", "安否確認できた日"]) {
      expect(f, h).toContain(`>${h}</th>`);
    }
    expect(f).toContain("様式9：災害時利用者一覧表（安否確認優先順位）");
    expect(f).not.toContain('data-block="report"');
    expect(form9Html("【安否報告（下書き）】")).toContain('data-block="report"');
    expect(shortAt("2026-11-03 01:39")).toBe("11/3 01:39");
    expect(shortAt("")).toBe("");
  });
});

describe("?print=1（1 押しで印刷）", () => {
  it("ページの wantsPrint（components/ui/PaperBar）は print=1 のときだけ", () => {
    expect(wantsPrint("1")).toBe(true);
    for (const v of [undefined, "0", "yes", ["1", "1"]]) expect(wantsPrint(v)).toBe(false);
  });

  it("紙面の 6 つのページが ?print=1 を受けて印刷のボタンの auto に渡す", () => {
    const pages = [
      "app/people/[id]/forms/matsuyama/page.tsx",
      "app/people/[id]/forms/medical/page.tsx",
      "app/people/[id]/forms/own/page.tsx",
      "app/people/[id]/forms/mapped/[mappingId]/page.tsx",
      "app/people/[id]/forms/qr/page.tsx",
    ];
    for (const p of pages) expect(readRepoFile(p), p).toMatch(/autoPrint=\{autoPrint/);
    expect(readRepoFile("app/office/form9/page.tsx")).toContain("<PrintButton auto={wantsPrint(q.print)} />");
    expect(readRepoFile("components/ui/PrintButton.tsx")).toContain("autoPrint(window)");
  });

  function fakeWindow(href: string) {
    let fontsDone!: () => void;
    const ready = new Promise<void>((r) => (fontsDone = r));
    const calls: string[] = [];
    const win: PrintWindow = {
      location: { href },
      history: {
        replaceState: (_d, _u, url) => {
          calls.push(`replace ${url}`);
          win.location.href = url;
        },
      },
      document: { fonts: { ready } },
      print: () => calls.push("print"),
    };
    return { win, calls, fontsDone };
  }

  it("書体を読み終えてから、URL の印を外して 1 回だけ印刷の窓を出す", async () => {
    const { win, calls, fontsDone } = fakeWindow("http://localhost:3136/people/p-01/forms/matsuyama?print=1");
    const done = autoPrint(win);
    await Promise.resolve();
    expect(calls).toEqual([]);
    fontsDone();
    expect(await done).toBe(true);
    expect(calls).toEqual(["replace http://localhost:3136/people/p-01/forms/matsuyama", "print"]);
    // 読み直しても印が無いので出さない
    expect(await autoPrint(win)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("印が無ければ出さない。待つ間にほかの部品が印を外したら出さない（2 回出さない）", async () => {
    const plain = fakeWindow("http://localhost/office/form9");
    plain.fontsDone();
    expect(await autoPrint(plain.win)).toBe(false);
    expect(plain.calls).toEqual([]);

    const other = fakeWindow("http://localhost/office/form9?print=1&sort=name");
    const done = autoPrint(other.win);
    other.win.location.href = "http://localhost/office/form9?sort=name";
    other.fontsDone();
    expect(await done).toBe(false);
    expect(other.calls).toEqual([]);
  });
});

const chrome = chromePath();

describe.skipIf(!chrome)("印刷（headless Chrome の printToPDF）", () => {
  let browser: Browser;
  let page: Page;
  let fontOk = false;
  const css = paperCss();

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ["--no-first-run", "--lang=ja-JP"] });
    page = await browser.newPage();
    await page.setContent(paperPage("<p>書体</p>", css));
    fontOk = (await page.evaluate(FONT_PROBE)) === true;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function pdfOf(body: string): Promise<Uint8Array> {
    await page.emulateMediaType(undefined);
    await page.setContent(paperPage(body, css), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return page.pdf({ preferCSSPageSize: true, printBackground: true });
  }
  const pages = async (body: string) => pdfPageCount(await pdfOf(body));

  it("計画書は 10 人とも A4 2 頁", async (ctx) => {
    if (!fontOk) ctx.skip();
    const got: Record<string, number> = {};
    for (const id of IDS) got[id] = await pages(matsuyamaHtml(id));
    expect(got).toEqual(Object.fromEntries(IDS.map((id) => [id, 2])));
  }, 180_000);

  it("医療要約は要約を作る人（医療班提供に同意）とも A4 1 頁", async (ctx) => {
    if (!fontOk) ctx.skip();
    const got: Record<string, number> = {};
    for (const id of IDS) {
      const m = medicalHtml(id);
      if (m) got[id] = await pages(m);
    }
    expect(Object.keys(got).length).toBeGreaterThanOrEqual(8);
    expect(got).toEqual(Object.fromEntries(Object.keys(got).map((id) => [id, 1])));
  }, 180_000);

  it("本人の 1 枚は 10 人とも表と裏の 2 頁（裏に QR）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const got: Record<string, number> = {};
    for (const id of IDS) got[id] = await pages(ownHtml(id));
    expect(got).toEqual(Object.fromEntries(IDS.map((id) => [id, 2])));
  }, 180_000);

  it("在宅避難の印を付けても 10 人とも表と裏の 2 頁（地震の行の添え。T37）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const got: Record<string, number> = {};
    for (const p of SEED_PEOPLE) {
      const rows = seedRows({ ...p, ledger: { ...p.ledger, evacuation: { ...p.ledger.evacuation, stayHome: true } } });
      got[p.person.id] = await pages(
        html(createElement(OwnSheetPaper, { sheet: buildOwnSheet(rows, OPTS), medical: buildOwnSheetMedical(rows, OPTS), qr: QR })),
      );
    }
    expect(got).toEqual(Object.fromEntries(IDS.map((id) => [id, 2])));
  }, 180_000);

  it("差し込み（内閣府の様式例の対応表）は 10 人とも表・裏の 2 頁", async (ctx) => {
    if (!fontOk) ctx.skip();
    const got: Record<string, number> = {};
    for (const id of IDS) got[id] = await pages(mappedHtml(id));
    expect(got).toEqual(Object.fromEntries(IDS.map((id) => [id, 2])));
  }, 180_000);

  it("QR の紙は 10 人とも 1 頁", async (ctx) => {
    if (!fontOk) ctx.skip();
    const got: Record<string, number> = {};
    for (const id of IDS) got[id] = await pages(qrHtml(id));
    expect(got).toEqual(Object.fromEntries(IDS.map((id) => [id, 1])));
  }, 180_000);

  it("様式 9 は A4 横で、10 人の表と報告の下書きが続く（3 頁まで）", async (ctx) => {
    if (!fontOk) ctx.skip();
    const pdf = Buffer.from(await pdfOf(form9Html("【安否報告（下書き）】\n事業所：デモ事業所"))).toString("latin1");
    const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    expect(boxes.length).toBeLessThanOrEqual(3);
    for (const [w, h] of boxes) {
      expect(Math.round(w)).toBe(842);
      expect(Math.round(h)).toBe(595);
    }
  }, 60_000);

  it("印刷では上の帯と画面だけの操作が消え、紙面と紙だけの物（様式 9・QR）が出る。画面では紙だけの物を出さない", async (ctx) => {
    if (!fontOk) ctx.skip();
    // 見えるか（親が display: none でも子の display は残るので、checkVisibility で見る）
    const shown = (sel: string) =>
      page.evaluate((s: string) => {
        const v = (q: string) => document.querySelector(q)?.checkVisibility() ?? null;
        return { header: v('[data-test="app-header"]'), bar: v('[data-test="screen-bar"]'), paper: v(s) };
      }, sel);
    const both = async (body: string, sel: string) => {
      await page.setContent(paperPage(body, css), { waitUntil: "load" });
      await page.emulateMediaType("screen");
      const screen = await shown(sel);
      await page.emulateMediaType("print");
      const print = await shown(sel);
      await page.emulateMediaType(undefined);
      return { screen, print };
    };
    // 画面に出す紙面（計画書）: 画面でも紙でも出る。上の帯と操作は紙で消える
    expect(await both(matsuyamaHtml("p-01"), '[data-sheet="matsuyama"] .paper')).toEqual({
      screen: { header: true, bar: true, paper: true },
      print: { header: false, bar: false, paper: true },
    });
    // 紙だけの物（様式 9・QR の紙）: 画面では出さず、紙では出す。同じ main の画面の表・操作は紙で消える
    for (const [body, sel] of [
      [`<section data-test="screen-table">表</section>${form9Html(null)}`, '[data-sheet="form9"]'],
      [`<section data-test="screen-table">閲覧記録</section>${qrHtml("p-01")}`, '[data-sheet="qr"] .paper'],
    ] as const) {
      expect(await both(body, sel), sel).toEqual({
        screen: { header: true, bar: true, paper: false },
        print: { header: false, bar: false, paper: true },
      });
      await page.emulateMediaType("print");
      expect(await page.evaluate(() => document.querySelector('[data-test="screen-table"]')!.checkVisibility()), sel).toBe(false);
      await page.emulateMediaType(undefined);
    }
  }, 60_000);

  it("紙の字: 禁則（strict）・字間なし・書体は BIZ UDPゴシック・本文 10.5pt（様式 10pt）・未確認は小さく灰色", async (ctx) => {
    if (!fontOk) ctx.skip();
    await page.setContent(paperPage(matsuyamaHtml("p-01") + qrHtml("p-01"), css), { waitUntil: "load" });
    await page.emulateMediaType("print");
    const s = await page.evaluate(() => {
      const st = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      const form = st('[data-sheet="matsuyama"] .paper');
      const doc = st('[data-sheet="qr"] .paper');
      const unc = st('[data-sheet="matsuyama"] .p-unc');
      return {
        lineBreak: form.lineBreak,
        wordBreak: form.wordBreak,
        overflowWrap: form.overflowWrap,
        letterSpacing: form.letterSpacing,
        font: form.fontFamily,
        formSize: form.fontSize,
        docSize: doc.fontSize,
        uncSize: unc.fontSize,
        uncColor: unc.color,
        bg: form.backgroundColor,
      };
    });
    await page.emulateMediaType(undefined);
    expect(s.lineBreak).toBe("strict");
    expect(s.wordBreak).toBe("normal");
    expect(s.overflowWrap).toBe("normal");
    expect(s.letterSpacing).toBe("normal");
    expect(s.font).toContain("BIZ UDPGothic");
    // 10pt = 13.33px、10.5pt = 14px
    expect(Number.parseFloat(s.formSize)).toBeCloseTo(13.33, 1);
    expect(Number.parseFloat(s.docSize)).toBeCloseTo(14, 1);
    expect(Number.parseFloat(s.uncSize)).toBeLessThan(Number.parseFloat(s.formSize));
    expect(s.uncColor).not.toBe("rgb(0, 0, 0)");
    expect(s.bg).toBe("rgb(255, 255, 255)");
  }, 60_000);
});
