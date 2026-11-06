// T157 の指摘の形・点数の表・下書き・守りを、偽の client と手で組んだ結果で確かめる。本物の API と評価の生の記録は読まない。
// 記録は一時のフォルダに書いて消す。

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { draftMarkdown, groupFindings, guardSnippet, indexMarkdown, loadFindings, writeDrafts } from "./drafts.ts";
import { runEval, type EvalConfig } from "./drill/run.ts";
import { causeCounts, readFindings, withFirstSeen, writeFindings, type Finding, type FindingsFile } from "./findings.ts";
import { formsFindings, writeFormsFindings } from "./forms/findings.ts";
import type { RunResult } from "./forms/run.ts";
import { GUARDS, guardFindings, type Guard } from "./guards.ts";
import { buildScorecard, marksOf, scorecardMarkdown, seedColumns } from "./scorecard.ts";
import { ITEMS, itemOf, valuesOf } from "./scorecard-items.ts";
import { SEED, SEED_ROWS } from "./scorecard-seed.ts";
import { readRunDir } from "./scorecard-shapes.ts";
import { talkFindings, writeTalkFindings } from "./talk/findings.ts";
import { runTalkEval } from "./talk/run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = mkdtempSync(join(tmpdir(), "t157-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SLOW = 240_000;

/** repo に書かない語（文字の番号で持つ。このファイルにも字で書かない） */
const AVOID = ["診断", "判定", "重症", "緊急度", "札"];
const avoided = (text: string) => AVOID.filter((w) => text.includes(w));

const drillConfig = (over: Partial<EvalConfig>): EvalConfig => ({
  runs: 2,
  seed: "t157",
  real: false,
  key: "fake-key-not-used",
  world: "session",
  scenarios: ["heavy_rain", "earthquake"],
  judge: 2,
  review: false,
  maxAdvances: 12,
  out: join(tmp, "drill"),
  md: null,
  noise: 0.4,
  maxUsd: null,
  terms: true,
  say: () => {},
  ...over,
});

describe("通し（偽の client の訓練 → findings.json → 下書き → 点数の表）", () => {
  it(
    "訓練の回が findings.json を書き、2 回目は初めて出た回を引き継ぐ。下書きは同じ原因をまとめ、点数の表は r1〜r5 の種と回の列を並べる",
    async () => {
      const a = await runEval(drillConfig({ stamp: "20261106-000001-fake" }));
      const b = await runEval(drillConfig({ stamp: "20261106-000002-fake" }));
      expect(readdirSync(a.dir)).toContain("findings.json");
      const fa = readFindings(a.findingsPath)!;
      const fb = readFindings(b.findingsPath)!;
      expect(fa).toMatchObject({ version: 1, bench: "drill", run: "20261106-000001-fake", client: "fake" });
      expect(fa.findings.length).toBeGreaterThan(0);
      for (const f of [...fa.findings, ...fb.findings]) {
        expect(f.bench).toBe("drill");
        expect(["high", "mid", "low"]).toContain(f.severity);
        expect(f.repro.length).toBeGreaterThan(0);
        expect(f.repro[0]).toMatch(/^npm run eval:drill -- --runs 2 --seed t157/);
        expect(f.accept.item.length).toBeGreaterThan(0);
        expect(f.count).toBeGreaterThan(0);
        // 場所に絶対の道を入れない
        expect(JSON.stringify(f.where)).not.toMatch(/[A-Za-z]:[\\/]|\/Users\/|\/home\//);
      }
      // 決まりどおりに断った手は指摘にしない
      expect(fa.findings.some((f) => f.cause.startsWith("drill:terms:refused"))).toBe(false);
      // 同じ原因が 2 回とも出たら、2 回目の初めて出た回は 1 回目
      const both = fb.findings.filter((f) => fa.findings.some((x) => x.id === f.id));
      expect(both.length).toBeGreaterThan(0);
      for (const f of both) expect(f.firstSeen).toBe("20261106-000001-fake");

      // 下書き: 2 つの回の同じ原因は 1 つに（回 2 つ）。根拠の抜き書きは写さない
      const { files } = loadFindings([a.dir, b.dir]);
      const drafts = groupFindings(files);
      expect(new Set(drafts.map((d) => d.cause)).size).toBe(drafts.length);
      // 守りの外れは同じ項目の下書きに寄せるので、ふつうの原因で見る
      const plainBoth = both.find((f) => !f.cause.startsWith("guard:"))!;
      const twice = drafts.find((d) => d.cause === plainBoth.cause)!;
      expect(twice.runs).toEqual(["20261106-000001-fake", "20261106-000002-fake"]);
      const written = writeDrafts(drafts, join(tmp, "drafts"));
      const evidence = [...fa.findings, ...fb.findings].flatMap((f) => f.evidence ?? []).filter((e) => e.length >= 6);
      for (const path of written) {
        const md = readFileSync(path, "utf8");
        for (const e of evidence) expect(md).not.toContain(e);
        expect(avoided(md)).toEqual([]);
      }
      expect(readFileSync(written[0], "utf8")).toContain("| 重さ | 台 | 原因 |");

      // 点数の表: 種の r1〜r5 と、回の列 r6・r7
      const { md, columns } = buildScorecard({ runs: [{ label: "r6", dir: a.dir }, { label: "r7", dir: b.dir }], out: join(tmp, "sc.md"), seed: true, print: true });
      expect(columns.map((c) => c.label)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
      expect(md).toContain("| 項目 | 向き | しきい値 | r1 | r2 | r3 | r4 | r5 | r6 | r7 |");
      expect(md).toMatch(/^\| 72 時間まで終わった回 \|.*\| \d\/2[^|]* \| \d\/2[^|]* \|$/m);
      expect(md).toContain("偽の client の回の数は台の確かめ用");
      expect(avoided(md)).toEqual([]);
    },
    SLOW,
  );
});

describe("守り（guards）", () => {
  it("見本の守り（T139 の文の途中の切れ）がある。外れたら重さ「重」の指摘、合えば無し。count: は同じ原因の指摘の数で見る", () => {
    const cut = GUARDS.find((g) => g.item === "drill.cut")!;
    expect(cut).toMatchObject({ bench: "drill", op: "<=", value: 0, task: "T139" });
    expect(itemOf(cut.item)).toBeDefined();
    const repro = ["npm run eval:drill -- --runs 1"];
    expect(guardFindings({ bench: "drill", run: "x", values: { "drill.cut": 0 }, counts: {}, repro })).toEqual([]);
    const out = guardFindings({ bench: "drill", run: "x", values: { "drill.cut": 3 / 60 }, counts: {}, repro });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cause: "guard:drill-cut-none", severity: "high", accept: { item: "drill.cut", op: "<=", value: 0 } });
    // 項目の数が無い（台が数えていない）回は確かめない
    expect(guardFindings({ bench: "drill", run: "x", values: {}, counts: {}, repro })).toEqual([]);
    const byCount: Guard = { id: "t", bench: "forms", item: "count:forms:paper.wrong", op: "<=", value: 0, since: "r6", task: "T0", label: "紙の置き間違いなし" };
    expect(guardFindings({ bench: "forms", run: "x", values: {}, counts: { "forms:paper.wrong": 2 }, repro, guards: [byCount] })).toHaveLength(1);
    expect(guardFindings({ bench: "forms", run: "x", values: {}, counts: {}, repro, guards: [byCount] })).toEqual([]);
  });

  it("下書きの受け入れは GUARDS にそのまま足せる形。守りの外れは同じ項目の下書きに寄せる", () => {
    const f = (over: Partial<Finding>): Finding => ({
      id: "drill:shape:cut_mid",
      bench: "drill",
      cause: "drill:shape:cut_mid",
      rule: "cut_mid",
      title: "本人役の言葉が文の途中で終わる",
      where: { screen: "訓練 > 経過", file: "run-01.jsonl" },
      severity: "mid",
      count: 2,
      repro: ["npm run eval:drill -- --runs 1 --seed s"],
      suspects: ["lib/drill/persona.ts"],
      accept: { item: "drill.cut", op: "<=", value: 0 },
      firstSeen: "r6",
      evidence: ["生の言葉の抜き書き"],
      ...over,
    });
    const file: FindingsFile = {
      version: 1,
      bench: "drill",
      run: "r6",
      client: "fake",
      findings: [f({}), f({ id: "guard:drill-cut-none", cause: "guard:drill-cut-none", rule: "guard:drill-cut-none", severity: "high", count: 1, title: "守りが外れた" })],
    };
    const ds = groupFindings([file]);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: "high", guards: ["drill-cut-none"], count: 2 });
    expect(draftMarkdown(ds[0])).toContain("守り drill-cut-none");
    expect(draftMarkdown(ds[0])).not.toContain("生の言葉の抜き書き");
    const plain = groupFindings([{ ...file, findings: [f({})] }])[0];
    const snippet = guardSnippet(plain);
    expect(snippet).toContain('item: "drill.cut"');
    expect(snippet).toContain('op: "<="');
    expect(draftMarkdown(plain)).toContain("```ts");
    expect(indexMarkdown([plain])).toContain("draft-drill-shape-cut-mid.md");
    // 重さで絞る
    expect(groupFindings([file], { min: "high" }).map((d) => d.cause)).toEqual(["guard:drill-cut-none"]);
  });
});

describe("指摘の形の書き出し", () => {
  it("初めて出た回は同じ置き場・同じ client の前の回の findings.json から引き継ぐ（偽と本物は分ける）", () => {
    const root = join(tmp, "carry");
    const finding = (run: string): Finding => ({
      id: "forms:paper.wrong@様式 x",
      bench: "forms",
      cause: "forms:paper.wrong",
      rule: "paper.wrong",
      title: "紙",
      where: {},
      severity: "mid",
      count: 1,
      repro: ["npm run eval:forms"],
      suspects: [],
      accept: { item: "count:forms:paper.wrong", op: "<=", value: 0 },
      firstSeen: run,
    });
    for (const [run, client] of [
      ["20261101-000000-real", "real"],
      ["20261102-000000-fake", "fake"],
      ["20261103-000000-fake", "fake"],
    ] as const) {
      mkdirSync(join(root, run), { recursive: true });
      writeFindings(join(root, run), { bench: "forms", run, client, findings: [finding(run)] }, { root });
    }
    expect(readFindings(join(root, "20261103-000000-fake", "findings.json"))!.findings[0].firstSeen).toBe("20261102-000000-fake");
    expect(readFindings(join(root, "20261101-000000-real", "findings.json"))!.findings[0].firstSeen).toBe("20261101-000000-real");
    expect(withFirstSeen([finding("now")], []).map((x) => x.firstSeen)).toEqual(["now"]);
    expect(causeCounts([finding("a"), { ...finding("b"), count: 2 }])).toEqual({ "forms:paper.wrong": 3 });
  });

  it("書類: 結果の数から様式ごと・入れ方ごとの指摘。漏れは重さ「重」で点数の表の項目を受け入れに", () => {
    const r = formsResult();
    const fs = formsFindings(r);
    const by = (cause: string) => fs.filter((f) => f.cause === cause);
    expect(by("forms:paper.wrong")).toHaveLength(1);
    expect(by("forms:paper.wrong")[0]).toMatchObject({ count: 3, where: { file: "様式 matsuyama" }, repro: [expect.stringContaining("--forms=matsuyama"), expect.any(String)] });
    expect(by("forms:leak.strong")[0]).toMatchObject({ severity: "high", accept: { item: "forms.leaks", op: "<=", value: 0 } });
    expect(by("forms:input.failed")[0]).toMatchObject({ where: { file: "理由 ai_timeout" }, count: 1 });
    expect(by("forms:intake.wrong")[0]).toMatchObject({ where: { file: "入れ方 photo" } });
    // 予算で飛ばした入力は失敗に数えない
    expect(fs.some((f) => f.where.file === "理由 budget")).toBe(false);
    // 値は書かない（様式の id・入れ方・理由・数だけ）
    expect(JSON.stringify(fs)).not.toContain("見直しの所の名前");
    const dir = join(tmp, "forms", r.run);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "result.json"), JSON.stringify({ ...r, dir }), "utf8");
    const w = writeFormsFindings({ ...r, dir }, join(tmp, "forms"));
    expect(w.findings).toBe(fs.length);
    // 点数の表が result.json を読む
    const data = readRunDir(dir);
    expect(data.map((d) => d.bench)).toEqual(["forms"]);
    const v = valuesOf(data[0]);
    expect(v["forms.read.matsuyama"]).toBeCloseTo(60 / 70);
    expect(v["forms.paper.matsuyama"]).toBeCloseTo(97 / 100);
    expect(v["forms.leaks"]).toBe(1);
    expect(v["forms.readOk"]).toBeCloseTo(1 / 2);
    // 飛ばした様式は回した数に入れない
    expect(valuesOf({ ...data[0], data: { ...r, forms: [...r.forms, { ...r.forms[1], id: "skip", status: "skipped" }] } } as typeof data[0])["forms.readOk"]).toBeCloseTo(1 / 2);
  });

  it("声の会話: 偽の client で決まりを破る文を混ぜても、言わない事・漏れの指摘は出ず、戻しは軽い指摘。summary.json は点数の表が読める形", async () => {
    let i = 0;
    const s = await runTalkEval({ real: false, noise: 1, rnd: () => (i++ * 0.37) % 1 });
    const fs = talkFindings(s, "talk-run", { noise: 1 });
    expect(fs.some((f) => f.cause === "talk:banned" || f.cause === "talk:leak" || f.cause === "talk:closed_early")).toBe(false);
    for (const f of fs) expect(f.repro[0]).toBe("npm run eval:talk -- --noise 1");
    const root = join(tmp, "talk");
    const dir = join(root, "2026-11-06T00-00-00-000Z-fake");
    mkdirSync(dir, { recursive: true });
    const { talkSummaryJson } = await import("./talk/findings.ts");
    writeFileSync(join(dir, "summary.json"), JSON.stringify(talkSummaryJson(s, "2026-11-06T00-00-00-000Z-fake")), "utf8");
    writeTalkFindings(s, dir, "2026-11-06T00-00-00-000Z-fake", root, { noise: 1 });
    const data = readRunDir(dir);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ bench: "talk", client: "fake" });
    expect(valuesOf(data[0])).toMatchObject({ "talk.banned": 0, "talk.leaks": 0, "talk.closedEarly": 0 });
    // T157 より前の形（totals だけ）も読む
    const old = join(root, "2026-11-05T00-00-00-000Z-real");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "summary.json"), JSON.stringify(s.totals), "utf8");
    expect(readRunDir(old)[0]).toMatchObject({ bench: "talk", client: "real" });
  });
});

describe("点数の表", () => {
  it("種の行は全部が項目にあり、写した行の表もそろう。種だけの表は docs/progress/eval-scorecard.md と同じ", () => {
    const ids = new Set(ITEMS.map((x) => x.id));
    for (const r of SEED) for (const id of Object.keys(r.values)) expect(ids.has(id), id).toBe(true);
    for (const [, , id] of SEED_ROWS) expect(ids.has(id), id).toBe(true);
    expect(SEED.map((r) => r.round)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    const { md } = buildScorecard({ runs: [], out: "", seed: true, print: true });
    const committed = readFileSync(join(REPO, "docs", "progress", "eval-scorecard.md"), "utf8").replace(/\r\n/g, "\n");
    // r6 からの列は本物の回の記録から足すので、種の r1〜r5 の列（項目と 5 つの値）がそのまま残っているかを見る
    const head6 = (text: string) =>
      text
        .split("\n")
        .filter((l) => l.startsWith("|"))
        .map((l) => l.split("|").slice(1, 7).map((c) => c.trim()).join("|"));
    const kept = new Set(head6(committed));
    for (const row of head6(md)) expect(kept.has(row), row).toBe(true);
    expect(avoided(md)).toEqual([]);
  });

  it("前の回より悪い向きに動いた物に（悪）、しきい値を外れた物に（外）。向きの無い項目は印を付けない", () => {
    const lower = itemOf("drill.bannedShown")!;
    expect(marksOf(lower, { value: 0 }, { value: 2 })).toEqual({ worse: true, outside: true });
    expect(marksOf(lower, { value: 2 }, { value: 0 })).toEqual({ worse: false, outside: false });
    const higher = itemOf("forms.intake")!;
    expect(marksOf(higher, { value: 0.99 }, { value: 0.98 }).worse).toBe(true);
    const none = itemOf("talk.aiCalls")!;
    expect(marksOf(none, { value: 10 }, { value: 100 })).toEqual({ worse: false, outside: false });
    // 種の r4 → r5 で、講評の待ち（最長）が 35 → 57 秒に延びたのは（悪）
    const md = scorecardMarkdown(seedColumns());
    expect(md).toMatch(/\| 講評の待ち（秒、最長）（種だけ） \|.*\| 26〜35 秒 \| 57・56 秒（悪） \|/);
    // 漏れ 20 の r1 は（外）
    expect(md).toMatch(/\| 送った文の漏れ（氏名・電話・町名） \| 少ないほど良い \| ≦ 0 \| 20（外） \|/);
  });

  it("ほかの台（T156 の使う側の模擬）の scorecard.json の項目も、同じ名前の列に並べる", () => {
    const dir = join(tmp, "persona", "20261107-000000-fake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "scorecard.json"),
      JSON.stringify({
        version: 1,
        bench: "persona",
        run: "20261107-000000-fake",
        client: "fake",
        values: { "persona.stuck": 2, "persona.done": [3, 4] },
        items: [{ id: "persona.stuck", label: "詰まった所", better: "lower", threshold: { op: "<=", value: 0 } }],
      }),
      "utf8",
    );
    const { md } = buildScorecard({ runs: [{ label: "r6", dir }], out: "", seed: false, print: true });
    expect(md).toContain("## 使う側の模擬");
    expect(md).toMatch(/\| 詰まった所 \| 少ないほど良い \| ≦ 0 \| 2（外） \|/);
    expect(md).toMatch(/\| persona\.done \| - \| - \| 3\/4 \|/);
  });
});

describe("repo に足したファイル", () => {
  it("書かない語を使わない", () => {
    const files = [
      "tools/eval/findings.ts",
      "tools/eval/scorecard.ts",
      "tools/eval/scorecard-items.ts",
      "tools/eval/scorecard-seed.ts",
      "tools/eval/scorecard-shapes.ts",
      "tools/eval/drafts.ts",
      "tools/eval/guards.ts",
      "tools/eval/drill/findings.ts",
      "tools/eval/forms/findings.ts",
      "tools/eval/talk/findings.ts",
      "docs/tasks/T157.md",
      "docs/progress/t157.md",
      "docs/progress/eval-scorecard.md",
    ];
    for (const f of files) expect(avoided(readFileSync(join(REPO, f), "utf8")), f).toEqual([]);
  });
});

/** 手で組んだ書類の結果（様式 2 つ・入力 3 つ・紙 2 枚） */
function formsResult(): Pick<RunResult, "run" | "mode" | "fakeStyle" | "forms" | "inputs" | "papers" | "calls" | "leaks"> {
  const read = { goldFields: 70, aiFields: 70, matched: 70, hit: 58, alt: 2, wrong: 4, missItem: 3, missField: 1, extraField: 0, rejected: 0, boxHit: 0, boxMiss: 0 };
  const paper = { judged: 100, filled: 100, hit: 97, miss: 0, wrong: 2, extra: 1, boxMiss: 0, annexOverflow: 0, annexUnplaced: 0, expectedAnnex: 0, unconfirmedActual: 0, unconfirmedExpected: 0 };
  const look = { texts: 10, marks: 0, overlap: 0, outside: 0, neighbor: 0, shifted: 0, unplaced: 2, inkPages: 1, blanks: 0, blanksChoice: 0, masks: 0, unplacedOption: 0, unplacedRoom: 0, unplacedBox: 0, annexGap: 0 };
  const intake = { expected: 10, actual: 10, hit: 8, wrong: 1, miss: 1, extra: 0, masked: 0, dropped: 0 };
  return {
    run: "20261106-000000-fake",
    mode: "fake",
    fakeStyle: "noisy",
    forms: [
      { id: "matsuyama", title: "計画書", gold: true, status: "ok", pages: 2, read: read as RunResult["forms"][number]["read"], overlay: true },
      { id: "aozora", title: "見本", gold: false, status: "failed", reason: "ai_timeout", pages: 1, read: null, overlay: false },
    ],
    inputs: [
      { id: "photo-p-01", kind: "photo", personId: "p-01", status: "ok", failures: [], pieces: 1, sentPieces: 1, rawOverLimit: false, intake, carryLoss: 0 },
      { id: "text-p-01", kind: "text", personId: "p-01", status: "failed", failures: ["ai_timeout"], pieces: 1, sentPieces: 1, rawOverLimit: false, intake: null, carryLoss: 0 },
      { id: "text-p-02", kind: "text", personId: "p-02", status: "skipped", failures: ["budget"], pieces: 0, sentPieces: 0, rawOverLimit: false, intake: null, carryLoss: 0 },
    ],
    papers: [{ form: "matsuyama", input: "photo-p-01", kind: "photo", score: paper as RunResult["papers"][number]["score"], look: look as RunResult["papers"][number]["look"], files: {} }],
    calls: {
      aiCalls: { rows: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byPurpose: {} },
      calls: 3,
      ok: 2,
      failed: 1,
      retried: 0,
      attempts: 3,
      durationMs: 1000,
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0,
      byModel: {},
      truncated: 0,
      formReadMaxOutput: 1000,
    },
    leaks: { calls: 3, textHits: 1, strongHits: 1, birthHits: 0, weakHits: 0, images: 0, imagesRedacted: 0, imagesNotRedacted: 0 },
  };
}
