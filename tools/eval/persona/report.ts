// 使う側の模擬の報告（docs/tasks/T156.md）。
// - 回のフォルダ（repo の外）の report.md: 筋ごとの達成・手数・迷い、迷った所の一覧（画面・押した物・思ったこと）、分かりにくい言葉、直す候補
// - docs/progress の md（--md）: 数と場所と言葉だけ（使う人の AI の「思ったこと」の文は入れない。生の記録は repo の外）

import { countByKind } from "./lost.ts";
import type { Finding } from "./finding.ts";
import { screenOf } from "./finding.ts";
import type { JudgeOut } from "./judge.ts";
import type { WalkOutcome } from "./walk.ts";
import { LOST_KINDS, LOST_LABELS, type LostKind } from "./types.ts";

export type PathSummary = {
  persona: string;
  label: string;
  stop: WalkOutcome["stop"];
  note: string | null;
  goals: { reached: number; total: number; list: WalkOutcome["goals"] };
  steps: number;
  /** 達した目標の最短の手の合計と、使った手の合計 */
  shortest: number;
  used: number;
  lost: Record<LostKind, number>;
  ease: number | null;
  unclear: number;
  costUsd: number;
  ms: number;
};

export type Summary = {
  version: 1;
  stamp: string;
  client: "fake" | "real";
  surface: "chrome" | "fake";
  base: string | null;
  viewport: string;
  args: Record<string, unknown>;
  estimateUsd: number;
  paths: PathSummary[];
  totals: { goals: number; reached: number; steps: number; lost: Record<LostKind, number>; findings: Record<string, number>; costUsd: number };
  notes: string[];
};

export function pathSummary(o: WalkOutcome, label: string, judge: JudgeOut | null, costUsd: number): PathSummary {
  const reached = o.goals.filter((g) => g.reached);
  return {
    persona: o.persona,
    label,
    stop: o.stop,
    note: o.note,
    goals: { reached: reached.length, total: o.goals.length, list: o.goals },
    steps: o.steps.length,
    shortest: reached.reduce((a, g) => a + g.shortest, 0),
    used: reached.reduce((a, g) => a + g.steps, 0),
    lost: countByKind(o.lost),
    ease: judge?.ease ?? null,
    unclear: judge?.unclear.length ?? 0,
    costUsd,
    ms: o.ms,
  };
}

export function totalsOf(paths: readonly PathSummary[], findings: readonly Finding[]): Summary["totals"] {
  const lost = { not_found: 0, misread: 0, dead_end: 0, back: 0, error: 0, timeout: 0 };
  for (const p of paths) for (const k of LOST_KINDS) lost[k] += p.lost[k];
  const byWeight: Record<string, number> = { 高: 0, 中: 0, 低: 0 };
  for (const f of findings) byWeight[f.weight] += 1;
  return {
    goals: paths.reduce((a, p) => a + p.goals.total, 0),
    reached: paths.reduce((a, p) => a + p.goals.reached, 0),
    steps: paths.reduce((a, p) => a + p.steps, 0),
    lost,
    findings: byWeight,
    costUsd: paths.reduce((a, p) => a + p.costUsd, 0),
  };
}

const STOP_LABELS: Readonly<Record<WalkOutcome["stop"], string>> = { all: "全部済", steps: "手の上限", time: "時間切れ", budget: "費用上限", gate: "門で停止", ai: "AI 失敗", open: "開けない" };
const lostCell = (l: Record<LostKind, number>) => LOST_KINDS.map((k) => `${LOST_LABELS[k]} ${l[k]}`).join("・");
const esc = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");

export type ReportInput = {
  summary: Summary;
  outcomes: readonly WalkOutcome[];
  judges: ReadonlyMap<string, JudgeOut>;
  findings: readonly Finding[];
  /** 使う人の「思ったこと」を入れるか（回のフォルダの報告だけ） */
  thoughts: boolean;
};

export function markdown(r: ReportInput): string {
  const s = r.summary;
  const lines: string[] = [];
  lines.push(`# 使う側の模擬 ${s.stamp}（${s.client === "real" ? "本物" : "偽"}の client、${s.surface === "chrome" ? `手元の画面 ${s.base}` : "偽の画面"}、幅 ${s.viewport}）`, "");
  lines.push(`目標 ${s.totals.reached}/${s.totals.goals}、手 ${s.totals.steps}、迷い ${lostCell(s.totals.lost)}、指摘 高 ${s.totals.findings["高"]}・中 ${s.totals.findings["中"]}・低 ${s.totals.findings["低"]}、費用 $${s.totals.costUsd.toFixed(3)}（見積もり $${s.estimateUsd.toFixed(2)}）`, "");
  lines.push("| 筋 | 達成 | 手 | 最短 / 使った | 迷い | 通しやすさ | 止まり方 |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const p of s.paths) {
    lines.push(`| ${p.label} | ${p.goals.reached}/${p.goals.total} | ${p.steps} | ${p.shortest} / ${p.used} | ${lostCell(p.lost)} | ${p.ease ?? "—"} | ${STOP_LABELS[p.stop]}${p.note ? `（${esc(p.note)}）` : ""} |`);
  }
  lines.push("");
  for (const o of r.outcomes) {
    const p = s.paths.find((x) => x.persona === o.persona);
    lines.push(`## ${p?.label ?? o.persona}`, "");
    lines.push("| 目標 | 達成 | 手 | 最短 |", "| --- | --- | --- | --- |");
    for (const g of o.goals) lines.push(`| ${esc(g.text)} | ${g.reached ? `済（${g.reachedAt} 手目）` : g.gaveUp ? "断念" : g.timedOut ? "時間切れ" : "未着手"} | ${g.steps} | ${g.shortest} |`);
    lines.push("");
    if (o.lost.length > 0) {
      lines.push("迷った所:", "");
      for (const e of o.lost) {
        lines.push(`- ${e.step} 手目 ${LOST_LABELS[e.kind]} ${screenOf(e.path)}${e.target ? ` 「${esc(e.target)}」` : ""}: ${esc(e.note)}${r.thoughts && e.thought ? ` ／ 思ったこと「${esc(e.thought)}」` : ""}`);
      }
      lines.push("");
    }
    const j = r.judges.get(o.persona);
    if (j) {
      if (r.thoughts) lines.push(`講評（審査役）: ${esc(j.summary)}`, "");
      if (j.unclear.length > 0) {
        lines.push("分かりにくい言葉:", "");
        for (const u of j.unclear) lines.push(`- 「${esc(u.word)}」 ${screenOf(u.path)}${r.thoughts ? `: ${esc(u.why)}` : ""}（案「${esc(u.idea)}」）`);
        lines.push("");
      }
    }
  }
  if (r.findings.length > 0) {
    lines.push("## 直す候補", "");
    for (const f of r.findings) {
      lines.push(`- [${f.weight}] ${esc(f.title)} — ${f.where.screen}${f.where.target ? ` 「${esc(f.where.target)}」` : ""}。疑う: ${f.suspects.length ? f.suspects.join("・") : "—"}。確かめ: ${esc(f.accept)}`);
    }
    lines.push("");
  }
  if (s.notes.length > 0) lines.push("## 記録", "", ...s.notes.map((n) => `- ${n}`), "");
  return `${lines.join("\n")}\n`;
}
