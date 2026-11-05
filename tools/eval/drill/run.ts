// 訓練の AI の評価の台（docs/tasks/T108.md）。画面を通さず訓練を何度も回し、壊れ方と単調さを数にして、前の回との差を 1 行で出す。
//
//   npm run eval:drill -- --runs 4                  偽の client（既定。Claude を呼ばない）
//   npm run eval:drill -- --runs 4 --seed 1a2b3c4d  同じ種で同じ回の選び方を作り直す
//   node --env-file=<鍵のファイル> tools/eval/drill/run.ts --real --runs 2 --max-usd 10   本物（作者だけが回す）
//
// 引数: --runs N（4）・--seed S（無ければ新しく作って記録）・--real・--world session|messages|off（session）・
//       --scenario short,virtual,heavy_rain,earthquake（全部）・--judge K（審査役に読ませる回の数、2）・--review（講評も作る）・
//       --max-advances N（1 回の進める回数の上限、400）・--out <dir>（記録の置き場。既定はリポジトリの隣の care72-qa/eval/drill）・
//       --md <dir>（差の表。既定 docs/progress）・--no-md・--noise P（偽の client に決まりを破る言葉を混ぜる割合、0）・
//       --latency S（偽の client の待ちの縮尺。役ごとの本物の待ちの目安に掛ける。0.01 で 100 分の 1、0 は待たない。T123）・
//       --max-usd X（本物の見積もりの上限。超えたら次の回を始めない。本物の既定 10）・
//       --terms on|off（連続の時計の訓練の開始に手の決まり〔T110 の terms〕を送るか。既定 on、開始の画面と同じ。T121）・
//       --all-people（参加する人を担当の全員に。ほかの選び方は同じ種のまま）
//
// 記録: <out>/<日時>-<fake|real>/run-NN.jsonl（1 回の訓練の起きた順。AI の呼び出しは送った中身の全文と返った中身の全文つき）と
// summary.json。架空の人の台詞が入るのでリポジトリに入れない。md は数だけ。
// 鍵は環境変数 ANTHROPIC_API_KEY だけを読む（tools/survey/summarize.ts と同じ）。鍵のファイルは読まない。

import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { officePlaces } from "../../../lib/drill/area.ts";
import { roomClientOf, worldModeOf, type WorldMode } from "../../../lib/drill/world-room.ts";
import { pseudonymize, type PseudonymInput } from "../../../lib/pseudonym/index.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";
import { checkRun, type CheckContext } from "./checks.ts";
import { diversityOf } from "./diversity.ts";
import { caseloadOf, runDrill, seededSqlite, type RunOutcome } from "./drive.ts";
import { fakeClaude, fakeRoom } from "./fake.ts";
import { judgeRun, type JudgeScore } from "./judge.ts";
import { isEvalScenario, planRun, SCENARIOS, type EvalScenario } from "./plan.ts";
import { ROOM_BUDGET_USD } from "./prices.ts";
import { recordClaude, recordRoom, runLog } from "./record.ts";
import { diffLine, findPrevious, judgeMeanOf, markdown, totalsOf, type RunSummary, type Summary } from "./report.ts";
import { freshSeed, rngOf } from "./rng.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** 記録の既定の置き場（リポジトリの隣の care72-qa） */
export const DEFAULT_OUT = resolve(REPO, "..", "care72-qa", "eval", "drill");
export const DEFAULT_MD = join(REPO, "docs", "progress");

export type EvalConfig = {
  runs: number;
  seed: string;
  real: boolean;
  /** 本物の鍵（real のときだけ）。偽のときは飾りの値 */
  key: string;
  world: WorldMode;
  scenarios: ReadonlyArray<EvalScenario>;
  judge: number;
  review: boolean;
  maxAdvances: number;
  out: string;
  md: string | null;
  noise: number;
  /** 偽の client の待ちの縮尺（T123。--latency S。0 は待たない） */
  latency?: number;
  maxUsd: number | null;
  /** 手の決まり（T110 の terms）を送るか（T121。既定は送る。--terms off で送らない） */
  terms: boolean;
  /** 参加する人を担当の全員にする（--all-people） */
  allPeople?: boolean;
  /** 記録の名前の日時（テストで固定） */
  stamp?: string;
  /** 途中の知らせ（既定は標準出力） */
  say?: (line: string) => void;
};

/** 種の 10 人（仮名化の前。サーバーの中と同じ物） */
export const SEED_SOURCES: ReadonlyArray<PseudonymInput> = SEED_PEOPLE.map((p) => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }));

/** 漏れの見張り: 事業所の全員の鍵（地区の別名つき）と、鍵に入らない避難先の名前・連絡先の名前と電話 */
export function checkContext(): CheckContext {
  const places = officePlaces("office-demo", SEED_SOURCES.map((s) => s.ledger));
  const { key } = pseudonymize(SEED_SOURCES, { places });
  const extra: Array<{ value: string; what: string }> = [];
  for (const s of SEED_SOURCES) {
    for (const d of [s.ledger.evacuation.destination1, s.ledger.evacuation.destination2]) if (typeof d === "string" && d.trim().length >= 3) extra.push({ value: d.trim(), what: "避難先の名前" });
    for (const c of s.contacts) {
      if (typeof c.name === "string" && c.name.trim().length >= 2) extra.push({ value: c.name.trim(), what: "連絡先の名前" });
      if (typeof c.phone === "string" && c.phone.trim()) extra.push({ value: c.phone.trim(), what: "連絡先の電話" });
    }
  }
  // 生年月日（台の表で和暦・略記・漢数字の書き方も。T118）
  const births = SEED_SOURCES.flatMap((s) => (s.person.birth_date ? [{ iso: s.person.birth_date, what: "生年月日（台の表）" }] : []));
  return { key, extra, births };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function stampOf(d: Date, client: "fake" | "real"): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${client}`;
}

export async function runEval(cfg: EvalConfig): Promise<{ summary: Summary; dir: string; mdPath: string | null; line: string }> {
  const say = cfg.say ?? ((x: string) => console.log(x));
  const client: Summary["client"] = cfg.real ? "real" : "fake";
  const stamp = cfg.stamp ?? stampOf(new Date(), client);
  const dir = join(cfg.out, stamp);
  mkdirSync(dir, { recursive: true });

  const probe = seededSqlite();
  const caseload = caseloadOf(probe);
  probe.close();
  const ctx = checkContext();

  const outcomes: RunOutcome[] = [];
  const runs: RunSummary[] = [];
  const judges: JudgeScore[] = [];
  const notes: string[] = [];
  let spent = 0;
  // 世界の部屋の Agent と Environment は最初の回で作り、あとの回は同じ物を使う（回ごとに新しい DB のため）
  let worldAgent: RunOutcome["worldAgent"] = null;

  for (let i = 1; i <= cfg.runs; i++) {
    if (cfg.real && cfg.maxUsd !== null && spent >= cfg.maxUsd) {
      notes.push(`見積もりの上限 $${cfg.maxUsd} に達したので ${i - 1} 回で止めた`);
      break;
    }
    const plan = planRun(cfg.seed, i, caseload, cfg.scenarios, { allPeople: cfg.allPeople });
    const log = runLog(join(dir, `run-${pad(i)}.jsonl`));
    const inner: ClaudeClient = cfg.real
      ? (new Anthropic({ apiKey: cfg.key, maxRetries: 0 }) as unknown as ClaudeClient)
      : fakeClaude({ rng: rngOf(`${plan.seed}/fake`), noise: cfg.noise, latency: cfg.latency ?? 0 });
    const claude = recordClaude(inner, log);
    const room = recordRoom(cfg.real ? roomClientOf({ ANTHROPIC_API_KEY: cfg.key }) : fakeRoom({ rng: rngOf(`${plan.seed}/room`), noise: cfg.noise, latency: cfg.latency ?? 0 }), log);
    if (worldAgent && plan.scenario === "virtual" && cfg.world === "session") room.reuse(worldAgent.agent_id);
    say(`回 ${i}/${cfg.runs}: ${plan.scenario}${plan.scale ? ` ${plan.scale.kind}:${plan.scale.level}` : ""}、${plan.participants.length} 人、種 ${plan.seed}`);
    const outcome = await runDrill(plan, { client: claude, room, log, key: cfg.key, world: cfg.world, real: cfg.real, maxAdvances: cfg.maxAdvances, review: cfg.review, worldAgent, terms: cfg.terms });
    room.finish();
    worldAgent = outcome.worldAgent ?? worldAgent;
    if (i <= cfg.judge && outcome.replay) {
      const j = await judgeRun(outcome, SEED_SOURCES, { client: claude, key: cfg.key });
      judges.push(j);
      log.push({ type: "judge", ...j });
    }
    const { hits, numbers } = checkRun(log.records, outcome, ctx);
    for (const h of hits) log.push({ type: "check", ...h });
    log.push({ type: "numbers", numbers });
    outcomes.push(outcome);
    runs.push({ index: i, seed: plan.seed, scenario: plan.scenario, scale: plan.scale, participants: plan.participants.length, numbers });
    spent += numbers.cost.usd + (plan.scenario === "virtual" && cfg.world === "session" ? ROOM_BUDGET_USD : 0);
    say(
      `  ${numbers.status}（${Math.round(numbers.minute / 60)} 時間、進めた ${numbers.advances}、手 ${numbers.acts}）AI ${numbers.aiCalls.total} 回、禁(生) ${numbers.banned.raw}・禁(画面) ${numbers.banned.shown}・形 ${numbers.shape.failed}・漏れ ${numbers.leaks}・矛盾 ${numbers.contradictions.total}`,
    );
  }

  const summary: Summary = {
    version: 1,
    stamp,
    client,
    seed: cfg.seed,
    world: cfg.world,
    args: { runs: cfg.runs, scenarios: cfg.scenarios, judge: cfg.judge, review: cfg.review, maxAdvances: cfg.maxAdvances, noise: cfg.noise, maxUsd: cfg.maxUsd, terms: cfg.terms, allPeople: cfg.allPeople ?? false },
    runs,
    totals: totalsOf(runs),
    diversity: diversityOf(outcomes),
    judge: judges,
    judgeMean: judgeMeanOf(judges),
    notes,
  };
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const prev = findPrevious(cfg.out, stamp, client);
  const line = diffLine(prev, summary);
  let mdPath: string | null = null;
  if (cfg.md) {
    mkdirSync(cfg.md, { recursive: true });
    mdPath = join(cfg.md, `eval-drill-${stamp}.md`);
    writeFileSync(mdPath, markdown(summary, prev, line), "utf8");
  }
  say(line);
  say(`記録: ${dir}${mdPath ? `\n差の表: ${mdPath}` : ""}`);
  return { summary, dir, mdPath, line };
}

// ---------- 引数 ----------

export function parseArgs(argv: ReadonlyArray<string>, env: Readonly<Record<string, string | undefined>> = {}): EvalConfig | { error: string } {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const num = (name: string, def: number): number => {
    const v = get(name);
    const n = v === undefined ? def : Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const real = has("real");
  const key = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (real && !key) return { error: "--real には環境変数 ANTHROPIC_API_KEY が要る（node --env-file=<鍵のファイル> で渡す）" };
  const scenarios = (get("scenario") ?? SCENARIOS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  if (scenarios.length === 0 || !scenarios.every(isEvalScenario)) return { error: `--scenario は ${SCENARIOS.join("・")} の並び` };
  const world = get("world");
  if (world !== undefined && !["session", "messages", "off"].includes(world)) return { error: "--world は session・messages・off" };
  const terms = get("terms");
  if (terms !== undefined && terms !== "on" && terms !== "off") return { error: "--terms は on・off" };
  const runs = num("runs", 4);
  const judge = num("judge", 2);
  const maxAdvances = num("max-advances", 400);
  const noise = num("noise", 0);
  const latency = num("latency", 0);
  const maxUsdRaw = get("max-usd");
  const maxUsd = maxUsdRaw === undefined ? (real ? 10 : null) : Number(maxUsdRaw);
  if (![runs, judge, maxAdvances, noise, latency].every(Number.isFinite) || runs < 1 || noise < 0 || noise > 1 || latency < 0 || latency > 1 || (maxUsd !== null && !Number.isFinite(maxUsd))) {
    return { error: "数の引数が違う（--runs 1 以上、--noise 0〜1）" };
  }
  return {
    runs: Math.floor(runs),
    seed: get("seed") ?? freshSeed(),
    real,
    // 偽の client でも hooks は「鍵あり」の道を通す（AI の呼び出しを偽が受ける）。値は使わない
    key: real ? key : "fake-key-not-used",
    world: worldModeOf(world),
    scenarios: scenarios as EvalScenario[],
    judge: Math.max(0, Math.floor(judge)),
    review: has("review"),
    maxAdvances: Math.max(1, Math.floor(maxAdvances)),
    out: resolve(get("out") ?? DEFAULT_OUT),
    md: has("no-md") ? null : resolve(get("md") ?? DEFAULT_MD),
    noise,
    latency,
    maxUsd,
    terms: terms !== "off",
    allPeople: has("all-people"),
  };
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2), process.env);
  if ("error" in cfg) {
    console.error(cfg.error);
    process.exitCode = 2;
    return;
  }
  await runEval(cfg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  });
}
