// 受け持ちの表（components/staff/StaffTable.tsx）の狭い幅と広い幅（T55）。
// 640px 未満は「解除」の列を省き、解除のボタンを行の中（氏名の下）に出す（375 で列が切れて押せなかった。T54 の問い 1）。
// 768px 以上の医療の列は担当一覧の狭い幅（氏名の下）と同じ印（時計のいちばん短い残りつき、残りの色は印の文字、11/4 から至急・要確認は印ごと塗り）に（T54 の問い 2）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaffTable } from "../../components/staff/StaffTable.tsx";
import type { StaffRow } from "./board.ts";

const AT = "2026-11-05T01:00:00.000Z";

const staffRow = (p: Partial<StaffRow>): StaffRow => ({
  custodyId: "cu-1",
  personId: "p-01",
  name: "山田 ハナ",
  kana: "ヤマダ ハナ",
  age: 84,
  ageReported: false,
  marks: [],
  markItems: [],
  medications: [],
  devices: [],
  remain: null,
  shelter: "そらみ台小学校",
  via: "search",
  receivedAt: AT,
  receivedWhen: "11/5 10:00",
  office: "デモ事業所",
  unaffiliated: false,
  color: "red",
  tone: "urgent",
  reason: "",
  rank: 1,
  summary: false,
  ...p,
});

const ROWS: StaffRow[] = [
  staffRow({
    marks: ["酸素", "抗凝固"],
    markItems: [
      { label: "酸素", tone: "urgent", remaining: "23分" },
      { label: "抗凝固", tone: null, remaining: null },
    ],
    medications: ["ワルファリン"],
  }),
  staffRow({ custodyId: "cu-2", personId: "p-x", name: "松本 カズオ", kana: "マツモト カズオ", rank: 2, devices: ["在宅酸素"] }),
  // 医療班への提供に同意が無い人（印・機器・薬は空で来る）
  staffRow({ custodyId: "cu-3", personId: "p-y", name: "架空 次郎", kana: "カクウ ジロウ", rank: 3, color: "yellow", tone: "check" }),
];

function render(rows: StaffRow[] = ROWS): string {
  return renderToStaticMarkup(createElement(StaffTable, { shelters: ["そらみ台小学校"], rows }));
}

/** 1 人分の行（<tr data-person=…>…</tr>） */
function rowHtml(html: string, personId: string): string {
  const m = html.match(new RegExp(`<tr data-person="${personId}"[^>]*>(.*?)</tr>`));
  expect(m, personId).not.toBeNull();
  return m![1];
}

/** 行の <td> を順に（class と中身） */
function cells(row: string): { cls: string; body: string }[] {
  return [...row.matchAll(/<td class="([^"]*)"[^>]*>(.*?)<\/td>/g)].map((m) => ({ cls: m[1], body: m[2] }));
}

const textOf = (s: string) => [...s.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

describe("受け持ちの表の解除（640px 未満は行の中）", () => {
  it("解除の列（見出しと各行の末尾）は 640px 以上だけ", () => {
    const html = render();
    const head = html.match(/<thead>(.*?)<\/thead>/)![1];
    const ths = [...head.matchAll(/<th class="([^"]*)"[^>]*>(.*?)<\/th>/g)];
    const last = ths[ths.length - 1];
    expect(last[2]).toContain("解除");
    expect(last[1]).toContain("hidden sm:table-cell");
    for (const id of ["p-01", "p-x", "p-y"]) {
      const tds = cells(rowHtml(html, id));
      const end = tds[tds.length - 1];
      expect(end.body).toContain("解除");
      expect(end.cls).toContain("hidden sm:table-cell");
    }
  });

  it("どの行も氏名の下に解除のボタン（640px 未満だけ）。赤の文字、アイコン＋文字", () => {
    const html = render();
    for (const id of ["p-01", "p-x", "p-y"]) {
      const name = cells(rowHtml(html, id))[2];
      const inline = name.body.match(/<div class="([^"]*)" data-release-inline="[^"]*">(.*?)<\/div>/);
      expect(inline, id).not.toBeNull();
      expect(inline![1]).toContain("sm:hidden");
      expect(inline![2]).toContain("<button");
      expect(inline![2]).toContain("<svg");
      expect(inline![2]).toContain("解除");
      expect(inline![2]).toContain("text-danger");
      expect(inline![2]).toContain('aria-expanded="false"');
    }
  });

  it("列の解除も同じ赤（幅で見た目を変えない）", () => {
    const html = render();
    const tds = cells(rowHtml(html, "p-01"));
    expect(tds[tds.length - 1].body).toContain("text-danger");
  });
});

describe("受け持ちの表の医療の列（768px 以上）", () => {
  it("担当一覧の氏名の下と同じ印: 項目名に時計のいちばん短い残り、至急・要確認の残りは印ごと塗り。薬は今のまま", () => {
    const html = render();
    const medical = cells(rowHtml(html, "p-01")).find((c) => c.cls.includes("hidden md:table-cell") && c.body.includes("data-medical-marks"))!;
    expect(medical).toBeDefined();
    const marks = medical.body.match(/<div class="([^"]*)" data-medical-marks="[^"]*">(.*?)<\/div>/)!;
    expect(textOf(marks[2])).toEqual(["酸素 23分", "抗凝固"]);
    expect(marks[2]).toContain('data-tone="urgent"');
    // 至急の残りは印ごと赤の塗り（11/4 作者）。列を広げないよう空白の所で折り返す
    expect(marks[2]).toContain("break-keep");
    expect(marks[2]).toMatch(/bg-state-urgent-fill text-on-state-urgent" data-tone="urgent">酸素 23分</);
    expect(medical.body).toContain("ワルファリン");
  });

  it("時計の無い人は台帳の機器、同意の無い人は「—」", () => {
    const html = render();
    const mx = cells(rowHtml(html, "p-x")).find((c) => c.body.includes("data-medical-marks"))!;
    expect(textOf(mx.body.match(/data-medical-marks="[^"]*">(.*?)<\/div>/)![1])).toEqual(["在宅酸素"]);
    const none = cells(rowHtml(html, "p-y"));
    expect(none.some((c) => c.body.includes("data-medical-marks"))).toBe(false);
    // 医療の列（5 列目）は「—」
    expect(none[4].cls).toContain("hidden md:table-cell");
    expect(none[4].body).toContain("—");
  });
});
