// T107 評価の台のテスト。本物の API・Chrome は使わない（偽の client、頁の画像は形だけの JPEG）。
// 1. 数え方: 手で崩した対応表・変更で、当たり・外れ・取りこぼし・読み落とし・余分・位置違いの数がその通りになる
// 2. 送る中身の漏れの検査が、種の氏名・電話・町名を見つけ、伏せ字は見つけない
// 3. 偽の client で 1 周（gold で外れ 0、noisy で数が合う、記録の JSON Lines の形、出力先の守り）

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkReadResult, type FormMapping } from "../../../lib/forms/mapping.ts";
import type { DiffItem } from "../../../lib/intake/diff.ts";
import { GOLD_FORMS, goldReading } from "./gold.ts";
import { buildInputs, factsOf, mergeExtract } from "./inputs.ts";
import { diffMarkdown, oneLine, totals } from "./report.ts";
import { scanLeaks } from "./record.ts";
import { assertOutside, REPO_ROOT, runEval, type RunResult } from "./run.ts";
import { scoreIntake, scoreRead } from "./score.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";

/** 形だけの JPEG（SOI・JFIF・SOF0・SOS・EOI。付け足しなし）。lib/forms/t86-read.test.ts と同じ形 */
function tinyJpeg(width: number, height: number, seed = 0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    seed & 0xff, 0x00, 0x12, 0x34,
    0xff, 0xd9,
  ]);
}

const komorebi = GOLD_FORMS.find((f) => f.id === "komorebi")!;

describe("数え方（様式の読み取り）", () => {
  it("正解どおりの返事は全部当たり、場所も合う", () => {
    const { mapping, rejected } = checkReadResult(goldReading(komorebi, 2));
    const { score } = scoreRead(komorebi, mapping, rejected.length);
    expect(score.goldFields).toBe(komorebi.fields.length);
    expect(score.hit).toBe(komorebi.fields.length);
    expect(score.wrong + score.missItem + score.missField + score.extraField + score.boxMiss + score.boxNone).toBe(0);
  });

  it("崩した返事を、崩した数のとおりに数える", () => {
    const r = goldReading(komorebi, 2);
    const byLabel = (section: string, label: string) => r.fields.findIndex((f) => f.section === section && f.label === label);
    // 1. 欄の読み落とし（本人 フリガナ）
    r.fields.splice(byLabel("本人", "フリガナ"), 1);
    // 2. 取りこぼし（避難先を対応なしに）
    r.fields[byLabel("避難", "避難先")].item = null;
    // 3. 外れ（緊急連絡先 続柄 → 避難支援者1 続柄）
    r.fields[byLabel("緊急連絡先", "続柄")].item = "supporter1.relation";
    // 4. 台帳に無い項目名（緊急連絡先 電話）→ 弾かれて対応なし＝取りこぼし
    r.fields[byLabel("緊急連絡先", "電話")].item = "person.nickname";
    // 5. 場所違い（本人 氏名 の矩形を下へ）
    const name = r.fields[byLabel("本人", "氏名")];
    name.box = { ...name.box!, y: name.box!.y + 0.2 };
    // 6. 余分な欄
    r.fields.push({ page: 1, section: "", label: "備考", position: "", shape: "lines", options: [], item: "notes.other", confidence: "low", reason: "", box: null, option_boxes: [] });
    const { mapping, rejected } = checkReadResult(r);
    const { score, judgements } = scoreRead(komorebi, mapping, rejected.length);
    expect(score.missField).toBe(1);
    expect(score.missItem).toBe(2);
    expect(score.wrong).toBe(1);
    expect(score.rejected).toBe(1);
    expect(score.extraField).toBe(1);
    expect(score.boxMiss).toBe(1);
    expect(score.hit + score.alt + score.wrong + score.missItem + score.missField).toBe(score.goldFields);
    // 判定の記録に理由がある
    expect(judgements.find((j) => j.verdict === "取りこぼし" && j.reason.includes("person.nickname"))).toBeTruthy();
    expect(judgements.find((j) => j.verdict === "欄の読み落とし")?.target).toContain("フリガナ");
  });

  it("別解は当たりに数え、判定に別解と残す", () => {
    const aozora = GOLD_FORMS.find((f) => f.id === "aozora")!;
    const r = goldReading(aozora, 1);
    const i = r.fields.findIndex((f) => f.label === "避難時の配慮事項");
    r.fields[i].item = "notes.other";
    const { mapping } = checkReadResult(r);
    const { score, judgements } = scoreRead(aozora, mapping, 0);
    expect(score.alt).toBe(1);
    expect(score.wrong).toBe(0);
    expect(judgements.some((j) => j.verdict === "当たり（別解）")).toBe(true);
  });
});

describe("数え方（入れる欄）", () => {
  const item = (change: DiffItem["change"]): DiffItem => ({ id: "x", section: "basic", label: "", current: null, next: "", state: "add", masked: false, change });
  it("相手と値で、当たり・外れ・取りこぼし・余分", () => {
    const expected = [
      item({ t: "field", key: "care.careLevel", value: "care3" }),
      item({ t: "field", key: "care.walking", value: "some" }),
      item({ t: "medication", value: { name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回" } }),
      item({ t: "note", value: "薬は 2 階の箪笥" }),
    ];
    const actual = [
      item({ t: "field", key: "care.careLevel", value: "care3" }),
      item({ t: "field", key: "care.walking", value: "hard" }),
      item({ t: "device", value: { kind: "oxygen", detail: "酸素濃縮器" } }),
      { ...item({ t: "note", value: "（氏名）が来る" }), masked: true },
    ];
    const { score } = scoreIntake("t", expected, actual, 2);
    expect(score).toMatchObject({ expected: 4, actual: 4, hit: 1, wrong: 1, miss: 2, extra: 2, masked: 1, dropped: 2 });
  });
});

describe("送る中身の漏れの検査", () => {
  it("種の氏名・カナ・電話・町名・生年月日を見つける", () => {
    const hits = scanLeaks("山田 ハナさん（ヤマダ ハナ）は かわなぎ町。電話 090-0000-0011、昭和 17 年 4 月 18 日生");
    const kinds = new Set(hits.map((h) => h.kind));
    expect(kinds).toEqual(new Set(["name", "kana", "town", "phone", "birth", "weak"]));
  });
  it("伏せ字と役割名は見つけない", () => {
    expect(scanLeaks("A さんは（町名）小学校へ。娘（電話）、支援者 1、（氏名）")).toEqual([]);
  });
});

describe("入力の束", () => {
  it("種の 10 人から入れ方ごとの入力を作り、正解の分け方を持つ", () => {
    const inputs = buildInputs();
    const kinds = new Set(inputs.map((i) => i.kind));
    expect(kinds).toEqual(new Set(["text", "voice", "long", "handwrite", "photo", "heic", "pdf", "ledger"]));
    // PDF は 4 頁（読む頁の上限 3 を超える）
    expect(inputs.find((i) => i.kind === "pdf")!.oracle).toHaveLength(4);
    // 長すぎる書き起こしは上限を超える
    expect(inputs.find((i) => i.kind === "long")!.text!.length).toBeGreaterThan(4000);
    // 自由文の正解は事実を足した物
    const p = SEED_PEOPLE[0];
    expect(inputs.find((i) => i.id === "text-p-01")!.oracle[0]).toEqual(mergeExtract(factsOf(p).map((f) => f.piece)));
  });
});

describe("出力先の守り", () => {
  it("リポジトリの中を指すと止まる", () => {
    expect(() => assertOutside(join(REPO_ROOT, "docs", "x"))).toThrow(/リポジトリの中/);
    expect(() => assertOutside(REPO_ROOT)).toThrow();
    expect(() => assertOutside(join(tmpdir(), "x"))).not.toThrow();
  });
});

describe("偽の client で 1 周（Chrome を使わない）", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  const run = async (fakeStyle: "gold" | "noisy", runId: string, outRoot?: string): Promise<RunResult> => {
    const root = outRoot ?? mkdtempSync(join(tmpdir(), "care72-eval-"));
    if (!outRoot) roots.push(root);
    return runEval({
      mode: "fake",
      fakeStyle,
      outRoot: root,
      corpusRoot: null,
      progressDir: null,
      paper: "none",
      forms: ["komorebi", "aozora"],
      people: ["p-01", "p-02"],
      inputs: ["text-", "voice-", "ledger-", "long-"],
      renderer: null,
      runId,
      formPages: { komorebi: [tinyJpeg(1240, 1754, 1), tinyJpeg(1240, 1754, 2)], aozora: [tinyJpeg(1240, 1754, 3)] },
    });
  };

  it("gold: 正解どおりの偽は、様式・入れる欄・紙の外れが 0", async () => {
    const r = await run("gold", "t-gold");
    const t = totals(r);
    expect(r.forms.map((f) => f.status)).toEqual(["ok", "ok"]);
    expect(t.read.hit).toBe(t.read.goldFields);
    expect(t.read.wrong + t.read.missItem + t.read.missField + t.read.extraField + t.read.boxMiss).toBe(0);
    expect(t.intake.expected).toBeGreaterThan(20);
    expect(t.intake.hit).toBe(t.intake.expected);
    expect(t.intake.wrong + t.intake.miss + t.intake.extra).toBe(0);
    expect(t.paper.filled).toBeGreaterThan(0);
    expect(t.paper.hit).toBe(t.paper.filled);
    expect(t.paper.miss + t.paper.wrong + t.paper.extra + t.paper.boxMiss + t.paper.uncountedBlank).toBe(0);
    // 長すぎる書き起こしは失敗に数え、AI を呼ばない
    expect(r.inputs.find((i) => i.kind === "long")!.failures).toEqual(["too_long"]);
    // 呼び出し: 様式 2 ＋ 文 4（自由文・書き起こし × 2 人）
    expect(r.calls.calls).toBe(6);
    expect(r.calls.failed).toBe(0);
    // 送った文に種の氏名・電話・町名が無い（仮名化の門を通った後）
    expect(r.leaks.strongHits).toBe(0);
  }, 60_000);

  it("記録: 呼び出しごとの中身・判定・段・結果の JSON", async () => {
    const r = await run("gold", "t-log");
    const lines = (f: string) => readFileSync(join(r.dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const calls = lines("calls.jsonl");
    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(c).toMatchObject({ run: "t-log", usage: { status: "ok" } });
      expect(typeof (c.request as { userText: string }).userText).toBe("string");
      expect((c.response as { text: string }).text.length).toBeGreaterThan(0);
      expect(c.attempts).toHaveLength(1);
      expect(c.effort).toBe("high");
    }
    const formCall = calls.find((c) => c.stage === "form_read")!;
    expect(formCall).toMatchObject({ purpose: "form_read", model: "claude-opus-5-5" });
    expect((formCall.request as { attachments: unknown[] }).attachments.length).toBeGreaterThan(0);
    const textCall = calls.find((c) => c.stage === "intake_text")!;
    expect(textCall).toMatchObject({ purpose: "ledger_input", model: "claude-sonnet-5-5" });
    expect((textCall.request as { userText: string }).userText).not.toContain("山田");
    expect(lines("steps.jsonl").some((s) => s.stage === "paper")).toBe(true);
    expect(lines("judgements.jsonl").every((j) => typeof j.reason === "string")).toBe(true);
    const saved = JSON.parse(readFileSync(join(r.dir, "result.json"), "utf8")) as RunResult;
    expect(saved.calls.calls).toBe(6);
  }, 60_000);

  it("noisy: 崩した数が数に出て、足すと正解の数になる。送り直しと形の違う返事も数える", async () => {
    const root = mkdtempSync(join(tmpdir(), "care72-eval-"));
    roots.push(root);
    const prev = await run("gold", "20261105-000000-fake", root);
    const r = await run("noisy", "20261105-000001-fake", root);
    const t = totals(r);
    expect(t.read.wrong).toBeGreaterThan(0);
    expect(t.read.missItem).toBeGreaterThan(0);
    expect(t.read.missField).toBeGreaterThan(0);
    expect(t.read.extraField).toBe(2);
    expect(t.read.rejected).toBe(2);
    expect(t.read.hit + t.read.alt + t.read.wrong + t.read.missItem + t.read.missField).toBe(t.read.goldFields);
    expect(t.intake.miss + t.intake.wrong).toBeGreaterThan(0);
    expect(t.paper.hit + t.paper.miss + t.paper.wrong).toBeLessThanOrEqual(t.paper.filled + t.paper.wrong);
    // 判定の記録の数と数が合う
    const js = readFileSync(join(r.dir, "judgements.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { stage: string; verdict: string });
    expect(js.filter((j) => j.stage === "read" && j.verdict === "外れ").length).toBe(t.read.wrong);
    expect(js.filter((j) => j.stage === "intake" && j.verdict === "取りこぼし").length).toBe(t.intake.miss);
    // 前の回との差の表と 1 行
    const md = diffMarkdown(r, prev);
    expect(md).toContain("| 様式 当たり（別解を含む） |");
    expect(md).not.toMatch(/山田|かわなぎ|090-0000/);
    expect(oneLine(r, prev)).toMatch(/^20261105-000001-fake（偽 noisy） \| 様式 当\d+\/\d+\([+-]\d+|±0\)/);
  }, 60_000);
});
