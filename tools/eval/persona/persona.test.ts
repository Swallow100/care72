// T156 使う側の模擬の台（docs/tasks/T156.md）。偽の client と偽の画面で筋が通るか、迷いの数え方、指摘の形、門、引数、費用の上限。
// Claude も Chrome も使わない（Chrome の口は chrome.test.ts）。

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ACTOR_SYSTEM } from "./actor.ts";
import { isDone } from "./check.ts";
import { fakeActor, parseItemLine } from "./fake.ts";
import { FakeSurface } from "./fake-site.ts";
import { readFindings } from "../findings.ts";
import { readRunDir } from "../scorecard-shapes.ts";
import { buildScorecard } from "../scorecard.ts";
import { screenOf } from "./finding.ts";
import { assertLocalBase, screenGate } from "./guard.ts";
import { JUDGE_SYSTEM } from "./judge.ts";
import { lostOf } from "./lost.ts";
import { DEFAULT_LOGIN_ID, PERSONA_IDS, personas, shortestOf } from "./personas.ts";
import { estimateUsd, parseArgs, runPersonaEval, type PersonaConfig } from "./run.ts";
import type { Snapshot, StepRecord } from "./types.ts";
import { DEFAULT_LIMITS } from "./walk.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "t156-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const cfg = (over: Partial<PersonaConfig> = {}): PersonaConfig => ({
  real: false,
  key: "",
  surface: "fake",
  base: "http://localhost:3072",
  width: "1536",
  personas: [...PERSONA_IDS],
  limits: DEFAULT_LIMITS,
  maxUsd: null,
  judge: true,
  reset: false,
  shots: false,
  stray: false,
  loginId: DEFAULT_LOGIN_ID,
  password: "fake-site-password",
  out: tmp(),
  md: null,
  stamp: "20261106-000000-fake",
  say: () => {},
  ...over,
});

describe("使う人と目標", () => {
  const list = personas();
  it("4 人と審査員の 10 分の 5 筋、目標は印・最短の手・言葉の決まりを持つ", () => {
    expect(list.map((p) => p.id)).toEqual(["first", "veteran", "admin", "medical", "judge10"]);
    for (const p of list) {
      expect(p.goals.length).toBeGreaterThan(0);
      for (const g of p.goals) {
        expect(g.route.length).toBeGreaterThan(0);
        expect(shortestOf(g)).toBeGreaterThan(0);
        const checks = "any" in g.done ? g.done.any : [g.done];
        for (const c of checks) for (const src of [c.path, c.text, c.header, c.notHeader]) if (src) expect(() => new RegExp(src)).not.toThrow();
      }
    }
  });
  it("渡す文に言わない言葉と本物の形の電話が無い", () => {
    const all = [ACTOR_SYSTEM, JUDGE_SYSTEM, ...list.flatMap((p) => [p.profile, p.label, ...p.info, ...p.goals.map((g) => g.text)])].join("\n");
    expect(all).not.toMatch(/診断|判定|重症|緊急度|札/);
    for (const m of all.matchAll(/0\d{1,4}-\d{1,4}-\d{3,4}/g)) expect(m[0]).toMatch(/^090-0000-00\d\d$/);
    // パスワードの値は書かず印だけ
    expect(list.find((p) => p.id === "first")!.info.join("")).toContain("{{password}}");
  });
  it("医療班の受入の筋は受入一覧の氏名検索から（訓練の受入依頼ではない）", () => {
    const m = list.find((p) => p.id === "medical")!;
    expect(m.goals.map((g) => g.id)).toEqual(["role", "receive", "summary", "note"]);
    expect(m.goals[1].route).toContainEqual({ click: "氏名検索" });
  });
});

describe("偽の client と偽の画面で筋が通る", () => {
  it("5 筋とも最後まで行き、最短の手に近い手数で全部の目標に届く", async () => {
    const r = await runPersonaEval(cfg());
    expect(r.summary.paths).toHaveLength(5);
    for (const p of r.summary.paths) {
      expect(p.stop).toBe("all");
      expect(p.goals.reached).toBe(p.goals.total);
    }
    const first = r.summary.paths.find((p) => p.persona === "first")!;
    expect(first.goals.total).toBe(7);
    // 使った手は最短と、出ていれば押す物（訓練の着信の窓を閉じる）の分だけ違う
    expect(first.used).toBeGreaterThanOrEqual(first.shortest);
    expect(first.used - first.shortest).toBeLessThanOrEqual(2);
    expect(r.summary.totals.reached).toBe(r.summary.totals.goals);
    // 記録は回のフォルダに（summary・findings・report と筋ごとの log）
    const summary = JSON.parse(readFileSync(join(r.dir, "summary.json"), "utf8"));
    expect(summary.paths).toHaveLength(5);
    const log = readFileSync(join(r.dir, "first", "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.filter((x) => x.type === "ai").length).toBe(first.steps + 1); // 手ごとに 1 回と審査役 1 回
    expect(log.some((x) => x.type === "judge")).toBe(true);
    // 偽の client の費用も見積もりの表で数える
    expect(r.summary.totals.costUsd).toBeGreaterThan(0);
  });

  it("寄り道すると戻り・読み違いを数え、指摘は場所・重さ・再現・疑うファイル・確かめを持つ", async () => {
    const r = await runPersonaEval(cfg({ personas: ["first"], stray: true }));
    const p = r.summary.paths[0];
    expect(p.goals.reached).toBe(p.goals.total);
    expect(p.lost.back).toBeGreaterThan(0);
    expect(p.lost.misread).toBeGreaterThan(0);
    expect(p.used).toBeGreaterThan(p.shortest);
    // findings.json は評価の台の共通の形（tools/eval/findings.ts、T157）
    const file = readFindings(join(r.dir, "findings.json"))!;
    expect(file).toMatchObject({ version: 1, bench: "persona", run: "20261106-000000-fake", client: "fake" });
    const findings = file.findings;
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.bench).toBe("persona");
      expect(f.cause.startsWith("persona:")).toBe(true);
      expect(f.where.screen?.startsWith("/")).toBe(true);
      expect(["high", "mid", "low"]).toContain(f.severity);
      expect(f.repro.length).toBeGreaterThan(0);
      expect(f.repro.at(-1)).toMatch(/^確かめ: /);
      expect(Array.isArray(f.suspects)).toBe(true);
      expect(f.accept.item.startsWith("count:persona:") || f.accept.item.startsWith("persona.goal.")).toBe(true);
      // 題に思ったことを入れない（根拠は evidence だけ）
      expect(f.title).not.toContain("かと思った");
    }
    expect(findings.some((f) => f.rule === "back")).toBe(true);
    expect(findings.some((f) => (f.evidence ?? []).some((e) => e.includes("かと思った")))).toBe(true);
    // 疑うファイルは repo の中の道（画面の道から app の page.tsx）
    expect(findings.flatMap((f) => f.suspects).some((s) => s.startsWith("app/") && s.endsWith("page.tsx"))).toBe(true);
    // repo に置く表には思ったことを入れない
    const report = readFileSync(join(r.dir, "report.md"), "utf8");
    expect(report).toContain("思ったこと");
  });

  it("届かない目標は高い指摘になり、受け入れの確かめに最短の手を書く", async () => {
    // 担当一覧に「一括印刷」の無い画面（偽の画面から消す）
    const r = await runPersonaEval(
      cfg({
        personas: ["veteran"],
        makeSurface: () => {
          const s = new FakeSurface({ loginId: DEFAULT_LOGIN_ID, password: "fake-site-password" });
          const snap = s.snapshot.bind(s);
          s.snapshot = async () => {
            const x = await snap();
            return { ...x, items: x.items.filter((i) => i.name !== "一括印刷") };
          };
          return s;
        },
      }),
    );
    const p = r.summary.paths[0];
    expect(p.goals.reached).toBe(p.goals.total - 1);
    const high = r.findings.filter((f) => f.weight === "高" && f.kind === "unreached");
    expect(high).toHaveLength(1);
    expect(high[0].accept).toContain("「一括印刷」を押す");
    expect(high[0].goal).toBe("sheets");
    // 共通の形では、受け入れは点数の表の目標の値 ≧ 1、点数の表の値は 0
    const shared = r.shared.find((f) => f.cause === "persona:unreached:sheets")!;
    expect(shared).toMatchObject({ severity: "high", accept: { item: "persona.goal.veteran.sheets", op: ">=", value: 1 } });
    expect(r.scorecard.values["persona.goal.veteran.sheets"]).toBe(0);
    expect(r.scorecard.values["persona.veteran.reached"]).toEqual([4, 5]);
  });

  it("scorecard.json を点数の表（T157）が読み、使う側の模擬の段に筋ごとの達成・手数・迷いを並べる", async () => {
    const r = await runPersonaEval(cfg({ personas: ["first", "medical"], stray: true }));
    const data = readRunDir(r.dir);
    expect(data.map((d) => d.bench)).toEqual(["persona"]);
    expect(r.scorecard.values["persona.reached"]).toEqual([11, 11]);
    expect(r.scorecard.values["persona.gate"]).toBe(0);
    expect(r.scorecard.values["persona.first.lost"]).toBeGreaterThan(0);
    const { md } = buildScorecard({ runs: [{ label: "r6", dir: r.dir }], out: "", seed: false, print: true });
    expect(md).toContain("## 使う側の模擬");
    expect(md).toMatch(/\| 使う人 目標の達成 \|.*\| 11\/11 \|/);
    expect(md).toContain("| 初めて触るケアマネ 迷いの数 |");
    expect(md).toContain("| 医療班 手の数 |");
    // 門の守り（persona-gate-none）は外れない
    expect(r.shared.some((f) => f.cause.startsWith("guard:"))).toBe(false);
  });

  it("md（repo に置く表）は思ったことを持たない", async () => {
    const md = tmp();
    const r = await runPersonaEval(cfg({ personas: ["first"], stray: true, md }));
    const body = readFileSync(r.mdPath!, "utf8");
    expect(body).toContain("初めて触るケアマネジャー");
    expect(body).not.toContain("思ったこと");
    expect(body).not.toContain("かと思った");
  });
});

describe("迷いの数え方", () => {
  const step = (n: number, over: Partial<StepRecord> = {}): StepRecord => ({
    n,
    goal: "g",
    before: { path: "/", hash: "h1", look: "l1", title: "", alerts: [] },
    move: { action: "click", ref: 1, text: null, thought: "", expect: "", surprised: false },
    target: { name: "担当一覧", role: "link" },
    result: { ok: true },
    after: { path: "/x", hash: "h2", look: "l2", title: "", alerts: [], errors: [] },
    reached: [],
    shot: null,
    ms: 0,
    ...over,
  });
  it("同じ画面に 3 回で見つからない、変わらない押しは行き止まり、HTTP の失敗はエラー、達してない済みは読み違い", () => {
    const same = { path: "/", hash: "h1", look: "l1", title: "", alerts: [] };
    const ev = lostOf([
      step(1),
      step(2, { target: { name: "訓練", role: "link" } }),
      step(3, { target: { name: "書類", role: "link" }, after: { ...same, errors: [] } }),
      step(4, { target: { name: "事業所", role: "link" }, after: { path: "/", hash: "h9", look: "l9", title: "", alerts: [], errors: ["HTTP 500 /api/x"] } }),
      step(5, { move: { action: "done", ref: null, text: null, thought: "", expect: "", surprised: true } }),
    ]);
    const kinds = ev.map((e) => `${e.kind}@${e.step}`);
    expect(kinds).toContain("not_found@3");
    expect(kinds).toContain("dead_end@3");
    expect(kinds).toContain("error@4");
    expect(kinds).toContain("misread@4"); // 5 手目の「思ったのと違う」は 4 手目に付く
    expect(kinds).toContain("misread@5"); // 済んだと思ったが未達
  });
  it("画面の切替で今の画面を押したのは行き止まりに数えない", () => {
    const same = { path: "/", hash: "h1", look: "l1", title: "", alerts: [], errors: [] };
    const ev = lostOf([step(1, { target: { name: "担当一覧", role: "link", zone: "切替:画面" }, after: same })]);
    expect(ev.filter((e) => e.kind === "dead_end")).toHaveLength(0);
  });
  it("押したあとに新しく出た断りの知らせはエラー（前からある知らせは数えない）", () => {
    const ev = lostOf([
      step(1, { before: { path: "/staff", hash: "a", look: "a", title: "", alerts: ["AI 停止"] }, after: { path: "/staff", hash: "b", look: "b", title: "", alerts: ["AI 停止", "避難所 未入力"], errors: [] } }),
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["error"]);
  });
});

describe("門と達成の印", () => {
  const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
    url: "http://localhost/",
    path: "/",
    title: "",
    headings: [],
    items: [],
    alerts: [],
    header: "ケア72 担当一覧 訓練 事業所 書類 平時 デモ事業所（確認用） 管理者 山本 役変更 ログアウト",
    text: "",
    printed: false,
    errors: [],
    hash: "",
    look: "",
    ...over,
  });
  it("手元のほかの host は開かない", () => {
    expect(() => assertLocalBase("https://care72.app")).toThrow();
    expect(() => assertLocalBase("http://192.168.0.9:3072")).toThrow();
    expect(assertLocalBase("http://localhost:3156").port).toBe("3156");
    expect(assertLocalBase("http://127.0.0.1:3072").hostname).toBe("127.0.0.1");
  });
  it("架空の形でない電話・種でない事業所の頁は AI に渡さない", () => {
    expect(screenGate(snap({ text: "連絡先 090-0000-0011" })).ok).toBe(true);
    expect(screenGate(snap({ text: "連絡先 089-123-4567" })).ok).toBe(false);
    expect(screenGate(snap({ header: "ケア72 担当一覧 事業所 さくら居宅介護支援事業所 山本" })).ok).toBe(false);
    expect(screenGate(snap({ header: "ケア72 担当一覧 事業所 試用事業所 管理者" })).ok).toBe(true);
    expect(screenGate(snap({ header: "ケア72 受入一覧 医療班" })).ok).toBe(true);
  });
  it("発災開始の印は上の帯の災害の言葉で、平時のままなら立たない", () => {
    const g = personas()[0].goals.find((x) => x.id === "disaster")!;
    expect(isDone(g.done, snap())).toBe(false);
    expect(isDone(g.done, snap({ header: "ケア72 担当一覧 大雨 デモ事業所（確認用）" }))).toBe(true);
  });
  it("道の id は [id] に", () => {
    expect(screenOf("/people/chk-p-01/forms/own?print=1")).toBe("/people/[id]/forms/own");
    expect(screenOf("/drill/d028bbd2-797f-462a-b5c5-51844517d50d")).toBe("/drill/[id]");
  });
  it("偽の使う人は押せる物の 1 行から番号・名前・場所を読む", () => {
    expect(parseItemLine("[12] button 伊藤 フミ 担当 @窓:発災開始")).toEqual({ ref: 12, role: "button", name: "伊藤 フミ 担当", zone: "窓:発災開始" });
    expect(parseItemLine("[3] textbox 氏名 =山川")).toEqual({ ref: 3, role: "textbox", name: "氏名" });
  });
});

describe("引数と費用", () => {
  it("本物は鍵、手元の画面はパスワード、base は手元だけ", () => {
    expect(parseArgs(["--real"], {})).toEqual({ error: expect.stringContaining("ANTHROPIC_API_KEY") });
    expect(parseArgs(["--chrome"], {})).toEqual({ error: expect.stringContaining("CARE72_PASSWORD") });
    expect(parseArgs(["--chrome", "--base", "https://care72.app"], { CARE72_PASSWORD: "x" })).toEqual({ error: expect.stringContaining("手元") });
    const ok = parseArgs(["--real", "--base", "http://localhost:3156", "--personas", "first,medical"], { ANTHROPIC_API_KEY: "k", CARE72_PASSWORD: "p" });
    if ("error" in ok) throw new Error(ok.error);
    expect(ok.surface).toBe("chrome");
    expect(ok.maxUsd).toBe(3);
    expect(ok.personas).toEqual(["first", "medical"]);
    const fake = parseArgs([], {});
    if ("error" in fake) throw new Error(fake.error);
    expect(fake.surface).toBe("fake");
    expect(fake.maxUsd).toBeNull();
    expect(parseArgs(["--personas", "nobody"], {})).toEqual({ error: expect.stringContaining("--personas") });
  });
  it("見積もりは筋の手の上限と審査役から、上限を超えそうなら次の手を打たない", async () => {
    const list = personas();
    const est = estimateUsd(list, DEFAULT_LIMITS, true);
    expect(est).toBeGreaterThan(0);
    expect(estimateUsd(list, DEFAULT_LIMITS, false)).toBeLessThan(est);
    const r = await runPersonaEval(cfg({ real: true, key: "not-used", personas: ["first", "veteran"], maxUsd: 0.004, makeSurface: () => new FakeSurface({ loginId: DEFAULT_LOGIN_ID, password: "fake-site-password" }), makeClient: (ps) => fakeActor(ps) }));
    expect(r.summary.totals.costUsd).toBeLessThanOrEqual(0.004 + 0.002);
    expect(r.summary.paths.some((p) => p.stop === "budget") || r.summary.notes.some((n) => n.includes("上限"))).toBe(true);
  });
});
