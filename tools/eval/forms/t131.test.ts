// T131 評価の台の直し（評価の 3 回目、docs/progress/eval-r3-findings.md の 3・4・5・9）。本物の API は呼ばない。
// - 様式 9 の正解の表: 欄の名前と段はひな形の見出しの字、場所は原本の枠（1 行目）、表の外の事業所名・作成、担当ケアマネの項目、一覧の表の形
// - 災害診療記録の薬の区分の □ は常用薬、松山市の【手段】【時間】は避難場所ごとの項目
// - 入れる欄の正解: 機器の中身に種類の名前を重ねない（T120 の決まり）、特記の終わりの句点
// - 紙の数え方: 正解の表に合わない AI の欄が同じ場所に正解の字を置いた
// - 呼び出しの数え: 出力の上限で切れた呼び出し

import { describe, expect, it } from "vitest";
import { FORM9_HEADS } from "../../../lib/forms/frame-form9.ts";
import { checkReadResult, type FormMapping, type MappingField } from "../../../lib/forms/mapping.ts";
import type { PageImage } from "../../../lib/forms/page-images.ts";
import { seedRows } from "../../../lib/forms/print-harness.ts";
import type { IntakeChange } from "../../../lib/intake/changes.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { GOLD_FORMS, goldMapping, goldReading, type GoldForm } from "./gold.ts";
import { deviceDetail, factsOf } from "./inputs.ts";
import { buildSheets } from "./paper.ts";
import { METRICS } from "./report.ts";
import { canonical, cellOfSheet, scorePaper, scoreRead } from "./score.ts";

const form = (id: string) => GOLD_FORMS.find((f) => f.id === id)!;
const norm = (s: string) => s.normalize("NFKC").replace(/[\s　()（）※]/g, "");

describe("様式 9 の正解の表（T131）", () => {
  const f9 = form("form9");

  it("欄の名前と段はひな形の見出しの字。場所は原本の枠の 1 行目、表の外に事業所名と作成", () => {
    const heads = new Set(FORM9_HEADS.map((h) => norm(h.text)));
    for (const g of f9.fields) {
      if (g.label === "事業所名" || g.label === "作成") continue;
      expect(heads.has(norm(g.label)), g.label).toBe(true);
      if (g.section) expect(heads.has(norm(g.section)) || heads.has(norm(`${g.section}※`)), g.section).toBe(true);
    }
    expect(f9.fields.map((g) => g.label)).toEqual(expect.arrayContaining(["事業所名", "作成", "No", "地域区分", "担当ケアマネ"]));
    for (const g of f9.fields) {
      expect(g.box).toBeDefined();
      expect(g.box!.x + g.box!.w).toBeLessThanOrEqual(1);
      expect(g.box!.y + g.box!.h).toBeLessThanOrEqual(1);
    }
    // 表の列の欄は同じ高さ（7 行目）。評価の 3 回目の本物の答えの 1 行目の枠（y 0.21・高さ 0.033）と同じ所
    const row = f9.fields.filter((g) => !["事業所名", "作成"].includes(g.label));
    expect(new Set(row.map((g) => g.box!.y)).size).toBe(1);
    expect(row[0].box!.y).toBeCloseTo(0.21, 2);
    expect(row[0].box!.h).toBeCloseTo(0.033, 2);
  });

  it("担当ケアマネは担当ケアマネの項目（項目なしは別解にしない）。正解どおりの返事は全部当たり・一覧の形も対応表に", () => {
    const cm = f9.fields.find((g) => g.label === "担当ケアマネ")!;
    expect(cm.item).toBe("plan.careManager");
    expect(cm.accept).not.toContain(null);
    const { mapping, rejected } = checkReadResult(goldReading(f9, 1));
    expect(mapping.list?.rows).toBe(20);
    const { score } = scoreRead(f9, mapping, rejected.length);
    expect(score.hit).toBe(f9.fields.length);
    expect(score.boxHit).toBe(f9.fields.length);
    expect(goldMapping(f9, 1).list?.rows).toBe(20);
  });
});

describe("正解の表の古い所（T131）", () => {
  it("災害診療記録の薬の区分の □ は常用薬（項目なしは別解）", () => {
    const kiroku = form("kiroku");
    for (const label of ["抗血小板薬", "抗凝固薬", "糖尿病治療薬", "ステロイド", "抗てんかん薬", "その他"]) {
      const g = kiroku.fields.find((x) => x.label === label)!;
      expect([label, g.item, g.accept]).toEqual([label, "medical.medications", [null]]);
    }
  });

  it("松山市の【手段】【時間】は避難場所ごとの項目。避難先1 の手段を別の避難場所の欄に当てても別解にしない", () => {
    const m = form("matsuyama");
    const means = m.fields.filter((g) => g.label.includes("手段"));
    expect(means.map((g) => g.item).sort()).toEqual(["evacuation.destination2Means", "evacuation.nearestMeans", "evacuation.transport"].sort());
    for (const g of means.filter((x) => x.item !== "evacuation.transport")) expect(g.accept ?? []).not.toContain("evacuation.transport");
    expect(m.fields.some((g) => g.item === "evacuation.nearestMinutes")).toBe(true);
  });

  it("機器の中身は種類の名前を重ねない（T120 の決まりどおりの答えを外れと数えない）", () => {
    expect(deviceDetail("tube_feeding", "胃ろう 経管栄養")).toBe("胃ろう");
    expect(deviceDetail("oxygen", "酸素濃縮器 1L/分")).toBe("酸素濃縮器 1L/分");
    expect(deviceDetail("other", "電動ベッド")).toBe("電動ベッド");
    for (const p of SEED_PEOPLE) {
      for (const f of factsOf(p)) for (const d of f.piece.devices ?? []) expect(d.detail).not.toContain("経管栄養");
    }
  });

  it("特記は終わりの句点の有無を同じ特記に数える", () => {
    const a = canonical({ t: "note", value: "薬は2階の箪笥" } as IntakeChange);
    const b = canonical({ t: "note", value: "薬は2階の箪笥。" } as IntakeChange);
    expect(a?.id).toBe(b?.id);
  });
});

describe("紙の数え方: 同じ場所の別の欄（T131）", () => {
  // 種類の □ の 1 つ目を「避難先1」の □、名前を書く所を「避難所名」の欄に読んだ答え（評価の 3 回目の災害診療記録の形）
  const gold: GoldForm = {
    id: "t131",
    title: "様式",
    issuer: "",
    city: null,
    source: { kind: "corpus" },
    typeface: "gothic",
    pages: [1],
    fields: [{ page: 1, section: "", label: "避難先１", shape: "text", options: [], item: "evacuation.destination1", box: { x: 0.1, y: 0.3, w: 0.8, h: 0.04 } }],
  };
  const f = (o: Partial<MappingField>): MappingField => ({ id: "f1", page: 1, section: "", label: "", position: "", shape: "text", options: [], item: null, removed: false, ai: null, ...o });
  const ai: FormMapping = {
    title: "様式",
    issuer: "",
    pages: 1,
    fields: [
      f({ id: "f1", label: "避難先1", shape: "check", item: null, box: { x: 0.12, y: 0.31, w: 0.01, h: 0.01 } }),
      f({ id: "f2", label: "避難所名", item: "evacuation.destination1", box: { x: 0.4, y: 0.3, w: 0.2, h: 0.03 } }),
    ],
  };
  const IMG: PageImage[] = [{ page: 1, width: 1414, height: 2000, bytes: 1 }];

  it("合わせた欄が空でも、合わない AI の欄が正解の欄の場所に正解の字を置けば当たり。読み取りの段は取りこぼしのまま", () => {
    const person = SEED_PEOPLE.find((p) => p.ledger.evacuation.destination1)!;
    const rows = seedRows(person);
    const read = scoreRead(gold, ai, 0);
    expect(read.score.missItem).toBe(1);
    const gm = goldMapping(gold, 1);
    const expected = buildSheets(rows, gm, IMG, "2026-11-05");
    const actual = buildSheets(rows, ai, IMG, "2026-11-05");
    const s = scorePaper({ form: gold, input: "x", pairs: read.pairs, goldMapping: gm, aiMapping: ai, expectedCell: cellOfSheet(expected.mapped), actualCell: cellOfSheet(actual.mapped), expected, actual });
    expect(s.score.hit).toBe(1);
    expect(s.judgements.map((j) => j.verdict)).toContain("当たり（同じ場所の別の欄）");
    // 場所が外なら数えない
    const far: FormMapping = { ...ai, fields: [ai.fields[0], { ...ai.fields[1], box: { x: 0.4, y: 0.6, w: 0.2, h: 0.03 } }] };
    const actualFar = buildSheets(rows, far, IMG, "2026-11-05");
    const s2 = scorePaper({ form: gold, input: "x", pairs: read.pairs, goldMapping: gm, aiMapping: far, expectedCell: cellOfSheet(expected.mapped), actualCell: cellOfSheet(actualFar.mapped), expected, actual: actualFar });
    expect(s2.score.miss).toBe(1);
  });
});

describe("呼び出しの数え（T131）", () => {
  it("md の表に出力の上限で切れた呼び出しと、様式の読み取りの 1 回の出力の最大", () => {
    const labels = METRICS.map((m) => m.label);
    expect(labels).toContain("AI の失敗 うち出力の上限で切れた");
    expect(labels).toContain("様式の読み取り 1 回の出力の最大（token）");
  });
});
