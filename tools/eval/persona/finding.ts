// 指摘の形（docs/tasks/T156.md）。3 つの台（書類・訓練・使う側）の指摘と点を 1 つの表にまとめる作業（T157）に合わせ、
// 「場所・重さ・再現の手順・疑うファイル・受け入れの確かめ」を持つ。T157 が tools/eval/ に共通の型を作ったら、そちらに寄せる
// （この型は findings.json の 1 件の形。名前を変えるときは T157 の読み手と合わせる）。

import { routeText } from "./check.ts";
import type { GoalResult } from "./judge.ts";
import type { RouteMove } from "./personas.ts";
import { LOST_LABELS, type LostEvent, type LostKind, type StepRecord } from "./types.ts";

export const WEIGHTS = ["高", "中", "低"] as const;
export type Weight = (typeof WEIGHTS)[number];

export type Finding = {
  /** persona:<筋>:<番号> */
  id: string;
  /** どの台の指摘か */
  source: "persona";
  /** 場所: 画面（道の id を [id] にした形）・開いた道・押した物 */
  where: { screen: string; path: string; target: string | null };
  weight: Weight;
  title: string;
  /** 再現の手順（筋の初めからの手） */
  repro: string[];
  /** 疑うファイル（repo の中の道） */
  suspects: string[];
  /** 受け入れの確かめ（直ったと言える条件） */
  accept: string;
  /** 何から出た指摘か（迷いの種類・届かない目標・審査役） */
  kind: LostKind | "unreached" | "judge";
  persona: string;
  goal: string | null;
  step: number | null;
};

/** 道の id の段を [id] に（/people/chk-p-01/forms/own → /people/[id]/forms/own）。query は落とす */
export function screenOf(path: string): string {
  const p = path.split(/[?#]/)[0] || "/";
  return p
    .split("/")
    .map((s) => (/^(chk-)?p-\d+$|^[0-9a-f]{8}-[0-9a-f-]{27,}$|^[a-z]+-[0-9a-f]{6,}$|^\d+$/.test(s) ? "[id]" : s))
    .join("/");
}

/** 筋の初めから n 手目までの再現の手順（長ければ頭と終わりだけ） */
export function reproOf(steps: readonly StepRecord[], upTo: number, start: string, prelogin: boolean): string[] {
  const lines = steps
    .filter((s) => s.n <= upTo)
    .map((s) => {
      const t = s.target?.name ? `「${s.target.name}」` : "";
      switch (s.move.action) {
        case "click":
          return `${s.before.path} で${t}を押す`;
        case "type":
          return `${s.before.path} で${t}に書く`;
        case "select":
          return `${s.before.path} で${t}を選ぶ`;
        case "back":
          return `${s.before.path} で戻る`;
        case "done":
          return `${s.before.path} で済んだと思う`;
        default:
          return `${s.before.path} であきらめる`;
      }
    });
  const head = [`${prelogin ? "山本で入って " : ""}${start} を開く`];
  const body = lines.length > 9 ? [...lines.slice(0, 2), `（${lines.length - 6} 手 略）`, ...lines.slice(-4)] : lines;
  return [...head, ...body];
}

const WEIGHT_OF: Readonly<Record<LostKind, Weight>> = {
  timeout: "高",
  error: "中",
  not_found: "中",
  dead_end: "中",
  misread: "低",
  back: "低",
};

export type FindingContext = {
  persona: string;
  start: string;
  prelogin: boolean;
  steps: readonly StepRecord[];
  goals: readonly GoalResult[];
  routes: Readonly<Record<string, readonly RouteMove[]>>;
  suspects: (path: string, names: ReadonlyArray<string | null>) => string[];
};

/**
 * 台が数えた物からの指摘: 届かなかった目標 1 つに 1 件（高）と、迷いを（種類・画面・押した物）でまとめて 1 件。
 * 同じ所の迷いが 2 回以上なら 1 段重く（低 → 中）
 */
export function mechanicalFindings(lost: readonly LostEvent[], ctx: FindingContext): Finding[] {
  const out: Finding[] = [];
  let seq = 0;
  const id = () => `persona:${ctx.persona}:${String(++seq).padStart(2, "0")}`;
  for (const g of ctx.goals) {
    if (g.reached) continue;
    const last = [...ctx.steps].reverse().find((s) => s.goal === g.id) ?? null;
    const path = last?.after.path ?? ctx.start;
    const route = ctx.routes[g.id] ?? [];
    out.push({
      id: id(),
      source: "persona",
      where: { screen: screenOf(path), path, target: last?.target?.name ?? null },
      weight: "高",
      title: `目標「${g.text}」に届かない（${g.gaveUp ? "あきらめた" : g.timedOut ? "時間切れ" : "途中で止まった"}、${g.steps} 手）`,
      repro: last ? reproOf(ctx.steps, last.n, ctx.start, ctx.prelogin) : [`${ctx.start} を開く`],
      suspects: ctx.suspects(path, [last?.target?.name ?? null, ...route.map((m) => ("click" in m ? m.click : "type" in m ? m.type : "select" in m ? m.select : null))]),
      accept: `同じ使う人で「${g.text}」が ${Math.max(g.shortest * 2, g.shortest + 3)} 手以内に届く（最短 ${g.shortest} 手: ${route.map(routeText).join(" → ")}）`,
      kind: "unreached",
      persona: ctx.persona,
      goal: g.id,
      step: last?.n ?? null,
    });
  }
  const groups = new Map<string, LostEvent[]>();
  for (const e of lost) {
    // 時間切れ・あきらめたは届かない目標の指摘に入れた
    if (e.kind === "timeout" || (e.kind === "dead_end" && e.note === "あきらめた")) continue;
    const k = `${e.kind}|${screenOf(e.path)}|${e.target ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const evs of groups.values()) {
    const e = evs[0];
    const base = WEIGHT_OF[e.kind];
    const http5xx = evs.some((x) => /HTTP 5\d\d|頁の例外/.test(x.note));
    const weight: Weight = http5xx ? "高" : evs.length >= 2 && base === "低" ? "中" : base;
    out.push({
      id: id(),
      source: "persona",
      where: { screen: screenOf(e.path), path: e.path, target: e.target },
      weight,
      title: `${LOST_LABELS[e.kind]}: ${e.target ? `「${e.target}」` : screenOf(e.path)}（${e.note}${evs.length > 1 ? `、${evs.length} 回` : ""}）`,
      repro: reproOf(ctx.steps, e.step, ctx.start, ctx.prelogin),
      suspects: ctx.suspects(e.path, [e.target]),
      accept: `同じ筋でこの画面の${LOST_LABELS[e.kind]}が 0 回`,
      kind: e.kind,
      persona: ctx.persona,
      goal: e.goal,
      step: e.step,
    });
  }
  const rank: Record<Weight, number> = { 高: 0, 中: 1, 低: 2 };
  return out.sort((a, b) => rank[a.weight] - rank[b.weight]);
}
