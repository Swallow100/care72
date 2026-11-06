// 声の聞き取りの会話の台（T137）の指摘（T157）。筋ごとの数（runTalkEval の結果）から、指摘の共通の形（tools/eval/findings.ts）を作る。
// 読んだ文（lines）は写さない（台の作った言葉だが、下書きに中身を入れない決まりにそろえる）。数と筋の名前だけ。

import { causeCounts, findingId, writeFindings, type Accept, type Finding, type Severity } from "../findings.ts";
import { guardFindings } from "../guards.ts";
import { valuesOf } from "../scorecard-items.ts";
import type { TalkSummaryLike } from "../scorecard-shapes.ts";
import type { CaseResult, TalkEvalSummary } from "./run.ts";

type Spec = { cause: string; title: string; severity: Severity; suspects: string[]; accept?: Accept };

const SPECS = {
  banned: { cause: "talk:banned", title: "読んだ文に言わない事が残った", severity: "high", suspects: ["lib/signals/talk.ts", "lib/signals/talk-ai.ts"], accept: { item: "talk.banned", op: "<=", value: 0 } },
  leaks: { cause: "talk:leak", title: "Claude に渡した文に名前・電話", severity: "high", suspects: ["lib/signals/talk-ai.ts", "lib/pseudonym/index.ts"], accept: { item: "talk.leaks", op: "<=", value: 0 } },
  closedEarly: { cause: "talk:closed_early", title: "表の 2 問を聞く前に「つかめた」で締めた", severity: "mid", suspects: ["lib/signals/talk-ai.ts", "lib/signals/talk.ts"], accept: { item: "talk.closedEarly", op: "<=", value: 0 } },
  noButtons: { cause: "talk:no_buttons", title: "聞き取れない答えでボタンに替えなかった", severity: "mid", suspects: ["lib/signals/talk.ts", "lib/signals/hearing.ts"] },
  noDanger: { cause: "talk:no_danger", title: "危ない言葉で締めなかった", severity: "high", suspects: ["lib/signals/talk.ts", "lib/signals/phrases.ts"] },
  fallback: { cause: "talk:fallback", title: "決まった問いに戻した（門・話題の外・失敗・上限）", severity: "low", suspects: ["lib/signals/talk-ai.ts"] },
} satisfies Record<string, Spec>;

/** 筋ごとに、こう終わるはずの物（tools/eval/talk/run.test.ts と同じ） */
const EXPECT: Readonly<Record<string, "buttons" | "danger">> = { moan: "buttons", silent: "buttons", danger: "danger" };

export function talkFindings(s: Pick<TalkEvalSummary, "real" | "cases">, run: string, opts: { noise?: number } = {}): Finding[] {
  const out: Finding[] = [];
  const cmd = s.real ? "node --env-file=<鍵のファイル> tools/eval/talk/run.ts --real" : `npm run eval:talk${opts.noise ? ` -- --noise ${opts.noise}` : ""}`;
  const push = (spec: Spec, c: CaseResult, count: number) => {
    if (count <= 0) return;
    out.push({
      id: findingId(spec.cause, c.id),
      bench: "talk",
      cause: spec.cause,
      rule: spec.cause.slice("talk:".length),
      title: spec.title,
      where: { screen: "本人のスマホ > 声の聞き取り", file: `筋 ${c.id}`, refs: [`cases.jsonl id ${c.id}`] },
      severity: spec.severity,
      count,
      repro: [cmd, `回のフォルダ ${run} の cases.jsonl の id ${c.id} の行（数と終わり）を見る`],
      suspects: spec.suspects,
      accept: spec.accept ?? { item: `count:${spec.cause}`, op: "<=", value: 0 },
      firstSeen: run,
    });
  };
  for (const c of s.cases) {
    push(SPECS.banned, c, c.banned);
    push(SPECS.leaks, c, c.leaks);
    push(SPECS.closedEarly, c, c.closedEarly ? 1 : 0);
    if (EXPECT[c.id] === "buttons") push(SPECS.noButtons, c, c.buttons ? 0 : 1);
    if (EXPECT[c.id] === "danger") push(SPECS.noDanger, c, c.danger ? 0 : 1);
    // 門で外した分を除いた戻し（失敗・上限・話題の外）
    const gated = Object.values(c.gate).reduce((a, b) => a + b, 0);
    push(SPECS.fallback, c, Math.max(0, c.fallback - gated));
  }
  return out;
}

/** 回の summary.json の形（点数の表が読む。T157 から version・bench・run・real を足した） */
export function talkSummaryJson(s: TalkEvalSummary, run: string): TalkSummaryLike & { version: 1; bench: "talk"; run: string; real: boolean } {
  return { version: 1, bench: "talk", run, real: s.real, totals: s.totals };
}

/** 回の findings.json を書く（指摘と守りの外れ） */
export function writeTalkFindings(s: TalkEvalSummary, dir: string, run: string, root: string, opts: { noise?: number } = {}): { path: string; findings: number; guarded: number } {
  const found = talkFindings(s, run, opts);
  const client = s.real ? "real" : "fake";
  const guarded = guardFindings({
    bench: "talk",
    run,
    values: valuesOf({ bench: "talk", run, client, data: talkSummaryJson(s, run) }),
    counts: causeCounts(found),
    repro: [s.real ? "node --env-file=<鍵のファイル> tools/eval/talk/run.ts --real" : "npm run eval:talk"],
  });
  const path = writeFindings(dir, { bench: "talk", run, client, findings: [...found, ...guarded] }, { root });
  return { path, findings: found.length + guarded.length, guarded: guarded.length };
}
