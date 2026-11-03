// 紙の書き方（数字と単位・年月日を詰める。T37、docs/DECISIONS.md 11/3 07:3x の 1）
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormCell } from "../../components/forms/FormCell.tsx";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { MedicalSummarySheet } from "../../components/forms/MedicalSummarySheet.tsx";
import { OwnSheetFront } from "../../components/forms/OwnSheet.tsx";
import { QrSummary } from "../../components/qr/QrSummary.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { buildQrPage } from "../qr/view.ts";
import { buildMatsuyamaSheet, raw, t, value } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { buildOwnSheet } from "./own-sheet.ts";
import { paperText, paperWords } from "./paper-text.ts";
import { seedRows } from "./print-harness.ts";
import { warekiText } from "./wareki.ts";

const OPTS = { today: "2026-11-03", officeName: "デモ事業所" };
const rowsOf = (id: string) => seedRows(SEED_PEOPLE.find((p) => p.person.id === id)!);
const textOf = (html: string) => html.replace(/<rt>[^<]*<\/rt>|<rp>[^<]*<\/rp>/g, "").replace(/<[^>]+>/g, "");

describe("paperText", () => {
  it("数字と単位・年月日の間を詰める（公文書の書き方）", () => {
    const cases: Array<[string, string]> = [
      ["84 歳", "84歳"],
      ["令和 8 年 11 月 3 日", "令和8年11月3日"],
      ["令和 元年 5 月 1 日", "令和元年5月1日"],
      ["1942 年 4 月 18 日", "1942年4月18日"],
      ["1 日 1 回", "1日1回"],
      ["1 日 2 回", "1日2回"],
      ["残り 4 日", "残り 4日"],
      ["内蔵電池 2 時間", "内蔵電池 2時間"],
      ["予備ボンベ 8 時間", "予備ボンベ 8時間"],
      ["1 L/分", "1L/分"],
      ["浸水 3 m", "浸水 3m"],
      ["浸水 0.5 m", "浸水 0.5m"],
      ["2 階建", "2階建"],
      ["1 階に住む", "1階に住む"],
      ["1948 年築", "1948年築"],
      ["（82 歳）", "（82歳）"],
      ["12 時 30 分", "12時30分"],
    ];
    for (const [from, to] of cases) expect(paperText(from), from).toBe(to);
  });

  it("言葉 → 数字の間・番号・電話・時刻・ラテン文字の続く語は詰めない", () => {
    for (const s of [
      "警戒レベル 3 が 出たら",
      "実施者 1",
      "緊急連絡 2",
      "090-0000-0011",
      "2026-11-02 12:00",
      "3 min",
      "TEL 090-0000-0025",
      "要介護3",
      "数字なし",
    ]) {
      expect(paperText(s), s).toBe(s);
    }
  });

  it("語をまたぐ空白も詰める（ふりがなの語の並び）。人の名前の語は触らない", () => {
    expect(paperWords([{ text: "水 3 " }, { text: "日", ruby: "にち" }, { text: "分" }]).map((w) => w.text)).toEqual(["水 3", "日", "分"]);
    expect(paperWords([{ text: "84 歳" }]).map((w) => w.text)).toEqual(["84歳"]);
    expect(paperWords([{ text: "3 年", name: true }]).map((w) => w.text)).toEqual(["3 年"]);
  });
});

describe("紙の部品だけが詰める（画面は今のまま）", () => {
  it("欄の値: 紙（FormCell の既定）は詰め、画面（tight={false}）と本人の言葉（raw）は台帳のまま", () => {
    const cell = value([t("84 歳")], [raw("薬は 2 階の箪笥")]);
    const paper = textOf(renderToStaticMarkup(createElement(FormCell, { cell })));
    expect(paper).toContain("84歳");
    expect(paper).toContain("薬は 2 階の箪笥");
    const screen = textOf(renderToStaticMarkup(createElement(FormCell, { cell, tight: false })));
    expect(screen).toContain("84 歳");
  });

  it("計画書: 作成日・年齢・住まいは詰め、本人の言葉は台帳の文のまま", () => {
    const html = textOf(renderToStaticMarkup(createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(rowsOf("p-01"), OPTS) })));
    expect(html).toContain(`${warekiText(OPTS.today).replace(/ /g, "")} 作成`);
    expect(html).not.toMatch(/\d 歳/);
    expect(html).not.toMatch(/\d 年 \d/);
    const notes = SEED_PEOPLE.find((p) => p.person.id === "p-01")!.ledger.notes;
    for (const n of notes) expect(html).toContain(n);
  });

  it("医療要約: 生年月日・作成日・残りは詰める", () => {
    const r = buildMedicalSummary(rowsOf("p-08"), OPTS);
    if (r.kind !== "sheet") throw new Error("要約が出ない");
    const html = textOf(renderToStaticMarkup(createElement(MedicalSummarySheet, { sheet: r.sheet })));
    expect(html).toContain("1950年5月3日");
    expect(html).toContain("作成 2026年11月3日");
    expect(html).toContain("4日");
    expect(html).not.toMatch(/\d (歳|年|月|日|時間)/);
  });

  it("QR の頁の要約（医療班のスマホの画面）は画面の書き方のまま", () => {
    const page = buildQrPage(rowsOf("p-08"), OPTS);
    if (page.kind !== "sheet") throw new Error("要約が出ない");
    const html = textOf(renderToStaticMarkup(createElement(QrSummary, { sheet: page.sheet, expiresAt: "2027-02-01T00:00:00.000Z" })));
    expect(html).toContain("1950 年 5 月 3 日");
  });

  it("本人の 1 枚の表: 本人の言葉の段は台帳の文のまま", () => {
    const html = textOf(renderToStaticMarkup(createElement(OwnSheetFront, { sheet: buildOwnSheet(rowsOf("p-01"), OPTS) })));
    const notes = SEED_PEOPLE.find((p) => p.person.id === "p-01")!.ledger.notes;
    for (const n of notes) expect(html.replace(/\s+/g, " ")).toContain(n.replace(/\s+/g, " "));
    expect(html).toContain("作った 日 2026年11月3日");
  });
});
