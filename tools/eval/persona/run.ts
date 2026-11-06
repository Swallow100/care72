// 使う側の模擬の評価の台（docs/tasks/T156.md）。AI が使う人を演じて手元のアプリの画面を歩き、どこで迷ったかを記録する。
//
//   npm run eval:persona                                       偽の client ＋偽の画面（既定。Claude も Chrome も使わない）
//   CARE72_PASSWORD=… npm run eval:persona -- --chrome --base http://localhost:3156   偽の client で手元の画面を歩く（道の確かめ）
//   CARE72_PASSWORD=… node --env-file=<鍵のファイル> tools/eval/persona/run.ts --real --base http://localhost:3156 --max-usd 3
//                                                              本物（評価専用の作業者が回す。--real は手元の画面を開く）
//
// 引数: --real・--chrome（手元の画面。--real なら既定）・--base URL（既定 http://localhost:3072。localhost・127.0.0.1 だけ）・
//       --personas first,veteran,admin,medical,judge10（既定 全部）・--max-steps N（40）・--goal-steps N（15）・--max-minutes N（15）・
//       --width 1536|1280（1536）・--max-usd X（本物の既定 3。超えそうなら次の手・次の筋を始めない）・--no-judge・--no-reset・
//       --no-shots・--stray（偽の使う人が目標ごとに 1 回寄り道する）・--out <dir>（既定はリポジトリの隣の care72-qa/eval/persona）・
//       --md <dir>（数と場所の表。既定 docs/progress）・--no-md・--login <ID>（既定 yamamoto。環境変数 CARE72_LOGIN_ID でも）
//
// 手元のログイン: パスワードは環境変数 CARE72_PASSWORD だけ（ファイルに書かない）。使い捨ての値のハッシュを
// `CAREMANAGER_DEMO_PASSWORD_HASH=<ハッシュ> npm run db:reset` で種に入れ、.dev.vars の無い worktree で next dev を起こす（docs/progress/t156.md）。
// 鍵は環境変数 ANTHROPIC_API_KEY だけを読む。鍵のファイルは読まない。
// 記録: <out>/<日時>-<fake|real>/ に summary.json・findings.json・report.md（思ったことつき）と、筋ごとの log.jsonl（AI に送った中身と
// 返った中身の全文）・step-NN.png。手元の種の架空の人の名前が入るのでリポジトリに入れない。md は数と場所と言葉だけ。

import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { PRICES_USD_PER_MTOK } from "../drill/prices.ts";
import { recordClaude, runLog, type LogRecord } from "../drill/record.ts";
import { ACTOR_SPEC } from "./actor.ts";
import { fakeActor } from "./fake.ts";
import { FakeSurface } from "./fake-site.ts";
import { causeCounts, writeFindings, type Finding as SharedFinding } from "../findings.ts";
import { guardFindings } from "../guards.ts";
import type { GenericScorecard } from "../scorecard-items.ts";
import { goalItem, mechanicalFindings, screenOf, sharedFinding, type PersonaFinding as Finding } from "./finding.ts";
import { assertLocalBase } from "./guard.ts";
import { JUDGE_SPEC, judgePath, type JudgeOut } from "./judge.ts";
import { DEFAULT_LOGIN_ID, PERSONA_IDS, personas, type Persona, type PersonaId } from "./personas.ts";
import { markdown, pathSummary, totalsOf, type PathSummary, type Summary } from "./report.ts";
import { LOST_KINDS } from "./types.ts";
import { suspectIndex } from "./suspects.ts";
import { ChromeSurface, VIEWPORTS, type Surface } from "./surface.ts";
import { DEFAULT_LIMITS, walkPersona, type WalkLimits, type WalkOutcome } from "./walk.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_OUT = resolve(REPO, "..", "care72-qa", "eval", "persona");
export const DEFAULT_MD = join(REPO, "docs", "progress");
export const DEFAULT_BASE = "http://localhost:3072";

export type PersonaConfig = {
  real: boolean;
  /** 本物の鍵（real のときだけ） */
  key: string;
  surface: "chrome" | "fake";
  base: string;
  width: "1536" | "1280";
  personas: PersonaId[];
  limits: WalkLimits;
  maxUsd: number | null;
  judge: boolean;
  reset: boolean;
  shots: boolean;
  stray: boolean;
  loginId: string;
  password: string;
  out: string;
  md: string | null;
  stamp?: string;
  say?: (line: string) => void;
  /** テスト: 面と client を差し替える */
  makeSurface?: () => Surface;
  makeClient?: (list: readonly Persona[]) => ClaudeClient;
};

// ---------- 費用の見積もり ----------

/** 1 手の使う人の AI の token の目安（頁の読み 200 物ほどと今までの手 8 つ。思考 low） */
export const ACTOR_TOKENS = { input: 7000, output: 500 };
/** 1 筋の審査役の token の目安（40 手の記録と迷い。思考 high） */
export const JUDGE_TOKENS = { input: 25_000, output: 7000 };

const usd = (model: string, t: { input: number; output: number }) => {
  const p = PRICES_USD_PER_MTOK[model];
  return p ? (t.input * p.input + t.output * p.output) / 1_000_000 : 0;
};
export const ACTOR_STEP_USD = usd(ACTOR_SPEC.model, ACTOR_TOKENS);
export const JUDGE_PATH_USD = usd(JUDGE_SPEC.model, JUDGE_TOKENS);

/** 回の費用の見積もり（筋ごとに手の上限まで使い、審査役を 1 回） */
export function estimateUsd(list: readonly Persona[], limits: WalkLimits, judge: boolean): number {
  return list.reduce((a, p) => a + (p.maxSteps ?? limits.maxSteps) * ACTOR_STEP_USD + (judge ? JUDGE_PATH_USD : 0), 0);
}

const costOf = (records: readonly LogRecord[]) => records.reduce((a, r) => a + (r.type === "ai" && typeof r.costUsd === "number" ? r.costUsd : 0), 0);

const pad = (n: number) => String(n).padStart(2, "0");
export function stampOf(d: Date, client: "fake" | "real"): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${client}`;
}

export async function runPersonaEval(cfg: PersonaConfig): Promise<{ summary: Summary; findings: Finding[]; shared: SharedFinding[]; scorecard: GenericScorecard; outcomes: WalkOutcome[]; dir: string; mdPath: string | null }> {
  const say = cfg.say ?? ((x: string) => console.log(x));
  const client: Summary["client"] = cfg.real ? "real" : "fake";
  const stamp = cfg.stamp ?? stampOf(new Date(), client);
  const dir = join(cfg.out, stamp);
  mkdirSync(dir, { recursive: true });
  const list = personas(cfg.loginId).filter((p) => cfg.personas.includes(p.id));
  const estimate = estimateUsd(list, cfg.limits, cfg.judge);
  say(`使う側の模擬: ${list.map((p) => p.label).join("・")}、見積もり $${estimate.toFixed(2)}${cfg.maxUsd !== null ? `（上限 $${cfg.maxUsd}）` : ""}`);

  const index = suspectIndex();
  const chrome = cfg.surface === "chrome" && !cfg.makeSurface ? new ChromeSurface({ base: cfg.base, viewport: VIEWPORTS[cfg.width] }) : null;
  const surface: Surface = cfg.makeSurface?.() ?? chrome ?? new FakeSurface({ loginId: cfg.loginId, password: cfg.password });
  const secrets = { password: cfg.password };
  const outcomes: WalkOutcome[] = [];
  const paths: PathSummary[] = [];
  const judges = new Map<string, JudgeOut>();
  const findings: Finding[] = [];
  const notes: string[] = [];
  let spent = 0;

  try {
    for (const p of list) {
      if (cfg.maxUsd !== null && spent + ACTOR_STEP_USD > cfg.maxUsd) {
        notes.push(`費用の上限 $${cfg.maxUsd} に近いので「${p.label}」から先を始めなかった`);
        break;
      }
      const pdir = join(dir, p.id);
      mkdirSync(pdir, { recursive: true });
      // 筋の前に手元の種へ戻す（事業所の「最初に戻す」と同じ要求）
      if (chrome && cfg.reset) {
        const ok = (await chrome.login(cfg.loginId, secrets)) && (await chrome.resetSeed());
        await chrome.end();
        if (!ok) notes.push(`「${p.label}」の前に種へ戻せなかった（前の筋の変更が残る）`);
      }
      const log = runLog(join(pdir, "log.jsonl"));
      const inner: ClaudeClient = cfg.makeClient?.([p]) ?? (cfg.real ? (new Anthropic({ apiKey: cfg.key, maxRetries: 0 }) as unknown as ClaudeClient) : fakeActor([p], { stray: cfg.stray ? p.goals.map((g) => g.id) : [] }));
      const claude = recordClaude(inner, log);
      const spentNow = () => spent + costOf(log.records);
      say(`筋 ${p.label}`);
      const o = await walkPersona(p, {
        surface,
        client: claude,
        secrets,
        loginId: cfg.loginId,
        limits: cfg.limits,
        shots: cfg.shots && chrome ? pdir : null,
        budgetOk: () => !(cfg.real && cfg.maxUsd !== null && spentNow() + ACTOR_STEP_USD > cfg.maxUsd),
        say,
      });
      for (const st of o.steps) log.push({ type: "step", ...st });
      for (const e of o.lost) log.push({ type: "lost", ...e });

      const routes = Object.fromEntries(p.goals.map((g) => [g.id, g.route]));
      const suspects = (path: string, names: ReadonlyArray<string | null>) => index.of(path, names);
      const mech = mechanicalFindings(o.lost, { persona: p.id, start: p.start, prelogin: p.prelogin, steps: o.steps, goals: o.goals, routes, suspects });

      let judge: JudgeOut | null = null;
      const judgeAffordable = !(cfg.real && cfg.maxUsd !== null && spentNow() + JUDGE_PATH_USD > cfg.maxUsd);
      if (cfg.judge && o.steps.length > 0 && judgeAffordable) {
        const candidates = [...new Set([...mech.flatMap((f) => f.suspects), ...o.steps.flatMap((s) => index.of(s.before.path, [s.target?.name ?? null], 3))])].slice(0, 30);
        try {
          judge = await judgePath(claude, { persona: p, goals: o.goals, steps: o.steps, lost: o.lost, candidates });
          judges.set(p.id, judge);
          log.push({ type: "judge", ...judge });
        } catch (e) {
          notes.push(`「${p.label}」の審査役が答えない（${e instanceof Error ? e.name : "Error"}）`);
        }
      } else if (cfg.judge && !judgeAffordable) {
        notes.push(`「${p.label}」の審査役は費用の上限で呼ばなかった`);
      }
      const fromJudge: Finding[] = (judge?.findings ?? []).map((f, i) => ({
        id: `persona:${p.id}:j${pad(i + 1)}`,
        source: "persona",
        where: { screen: screenOf(f.path), path: f.path, target: f.target },
        weight: f.weight,
        title: f.title,
        repro: f.repro,
        suspects: f.suspects,
        accept: f.accept,
        kind: "judge",
        persona: p.id,
        goal: null,
        step: null,
        count: 1,
      }));
      findings.push(...mech, ...fromJudge);

      const cost = costOf(log.records);
      spent += cost;
      const ps = pathSummary(o, p.label, judge, cost);
      paths.push(ps);
      outcomes.push(o);
      if (o.note) notes.push(`「${p.label}」: ${o.note}`);
      say(`  達成 ${ps.goals.reached}/${ps.goals.total}、手 ${ps.steps}、迷い ${Object.values(ps.lost).reduce((a, b) => a + b, 0)}、$${cost.toFixed(3)}`);
    }
  } finally {
    await chrome?.close();
  }

  const summary: Summary = {
    version: 1,
    stamp,
    client,
    surface: cfg.makeSurface ? "fake" : cfg.surface,
    base: cfg.surface === "chrome" ? cfg.base : null,
    viewport: cfg.width,
    args: { personas: cfg.personas, limits: cfg.limits, maxUsd: cfg.maxUsd, judge: cfg.judge, reset: cfg.reset, stray: cfg.stray },
    estimateUsd: estimate,
    paths,
    totals: totalsOf(paths, findings),
    notes,
  };
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  // 点数の表の数（tools/eval/scorecard-items.ts の persona.〜）と、評価の台の共通の形の findings.json（T157）
  const scorecard = scorecardOf(stamp, client, paths, outcomes);
  writeFileSync(join(dir, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
  const base = findings.map((f) => sharedFinding(f, stamp));
  const guards = guardFindings({
    bench: "persona",
    run: stamp,
    values: Object.fromEntries(Object.entries(scorecard.values).flatMap(([k, v]) => (v === null ? [] : [[k, Array.isArray(v) ? (v[1] > 0 ? v[0] / v[1] : 0) : v]]))),
    counts: causeCounts(base),
    repro: [`npm run eval:persona -- ${cfg.real ? "--real " : ""}--personas ${cfg.personas.join(",")}`],
  });
  const shared = [...base, ...guards];
  writeFindings(dir, { bench: "persona", run: stamp, client, findings: shared }, { root: cfg.out });
  writeFileSync(join(dir, "report.md"), markdown({ summary, outcomes, judges, findings, thoughts: true }), "utf8");
  let mdPath: string | null = null;
  if (cfg.md) {
    mkdirSync(cfg.md, { recursive: true });
    mdPath = join(cfg.md, `eval-persona-${stamp}.md`);
    writeFileSync(mdPath, markdown({ summary, outcomes, judges, findings, thoughts: false }), "utf8");
  }
  say(`目標 ${summary.totals.reached}/${summary.totals.goals}、指摘 高 ${summary.totals.findings["高"]}・中 ${summary.totals.findings["中"]}・低 ${summary.totals.findings["低"]}、費用 $${summary.totals.costUsd.toFixed(3)}`);
  say(`記録: ${dir}${mdPath ? `\n表: ${mdPath}` : ""}`);
  return { summary, findings, shared, scorecard, outcomes, dir, mdPath };
}

/** 点数の表の数（scorecard.json）。比は [分子, 分母]。筋ごと・目標ごと（persona.goal.<筋>.<目標> は 1 か 0）も */
export function scorecardOf(run: string, client: "fake" | "real", paths: readonly PathSummary[], outcomes: readonly WalkOutcome[]): GenericScorecard {
  const values: GenericScorecard["values"] = {};
  const sum = (f: (p: PathSummary) => number) => paths.reduce((a, p) => a + f(p), 0);
  values["persona.reached"] = [sum((p) => p.goals.reached), sum((p) => p.goals.total)];
  values["persona.extra"] = sum((p) => p.used - p.shortest);
  values["persona.steps"] = sum((p) => p.steps);
  values["persona.lost"] = sum((p) => LOST_KINDS.reduce((a, k) => a + p.lost[k], 0));
  for (const k of LOST_KINDS) values[`persona.lost.${k}`] = sum((p) => p.lost[k]);
  values["persona.gate"] = paths.filter((p) => p.stop === "gate").length;
  const eases = paths.flatMap((p) => (p.ease === null ? [] : [p.ease]));
  values["persona.ease"] = eases.length > 0 ? eases.reduce((a, b) => a + b, 0) / eases.length : null;
  values["persona.usd"] = sum((p) => p.costUsd);
  for (const p of paths) {
    values[`persona.${p.persona}.reached`] = [p.goals.reached, p.goals.total];
    values[`persona.${p.persona}.steps`] = p.steps;
    values[`persona.${p.persona}.lost`] = LOST_KINDS.reduce((a, k) => a + p.lost[k], 0);
  }
  for (const o of outcomes) for (const g of o.goals) values[goalItem(o.persona, g.id)] = g.reached ? 1 : 0;
  return { version: 1, bench: "persona", run, client, values };
}

// ---------- 引数 ----------

export function parseArgs(argv: ReadonlyArray<string>, env: Readonly<Record<string, string | undefined>> = {}): PersonaConfig | { error: string } {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const real = has("real");
  const key = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (real && !key) return { error: "--real には環境変数 ANTHROPIC_API_KEY が要る（node --env-file=<鍵のファイル> で渡す）" };
  const surface = real || has("chrome") ? "chrome" : "fake";
  const base = get("base") ?? DEFAULT_BASE;
  if (surface === "chrome") {
    try {
      assertLocalBase(base);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "base が違う" };
    }
  }
  const password = env.CARE72_PASSWORD ?? "";
  if (surface === "chrome" && !password) return { error: "手元の画面には環境変数 CARE72_PASSWORD（種の山本の使い捨てのパスワード）が要る" };
  const ids = (get("personas") ?? PERSONA_IDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || !ids.every((x): x is PersonaId => (PERSONA_IDS as readonly string[]).includes(x))) return { error: `--personas は ${PERSONA_IDS.join("・")} の並び` };
  const width = get("width") ?? "1536";
  if (width !== "1536" && width !== "1280") return { error: "--width は 1536 か 1280" };
  const num = (name: string, def: number) => {
    const v = get(name);
    return v === undefined ? def : Number(v);
  };
  const maxSteps = num("max-steps", DEFAULT_LIMITS.maxSteps);
  const goalSteps = num("goal-steps", DEFAULT_LIMITS.goalSteps);
  const maxMinutes = num("max-minutes", DEFAULT_LIMITS.maxMs / 60_000);
  const maxUsdRaw = get("max-usd");
  const maxUsd = maxUsdRaw === undefined ? (real ? 3 : null) : Number(maxUsdRaw);
  if (![maxSteps, goalSteps, maxMinutes].every((n) => Number.isFinite(n) && n >= 1) || (maxUsd !== null && !(Number.isFinite(maxUsd) && maxUsd > 0))) {
    return { error: "数の引数が違う（--max-steps・--goal-steps・--max-minutes は 1 以上、--max-usd は正の数）" };
  }
  return {
    real,
    key: real ? key : "",
    surface,
    base,
    width,
    personas: ids,
    limits: { maxSteps: Math.floor(maxSteps), goalSteps: Math.floor(goalSteps), maxMs: Math.floor(maxMinutes * 60_000) },
    maxUsd,
    judge: !has("no-judge"),
    reset: !has("no-reset"),
    shots: !has("no-shots"),
    stray: has("stray"),
    loginId: get("login") ?? env.CARE72_LOGIN_ID ?? DEFAULT_LOGIN_ID,
    // 偽の画面は自分の決まった値で入る（本物のパスワードではない）
    password: surface === "chrome" ? password : "fake-site-password",
    out: resolve(get("out") ?? DEFAULT_OUT),
    md: has("no-md") ? null : resolve(get("md") ?? DEFAULT_MD),
  };
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2), process.env);
  if ("error" in cfg) {
    console.error(cfg.error);
    process.exitCode = 2;
    return;
  }
  await runPersonaEval(cfg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  });
}
