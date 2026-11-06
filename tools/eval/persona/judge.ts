// 審査役（docs/tasks/T156.md）。強い型（Opus）が筋ごとに 1 回、使う人の記録を読み、分かりにくかった言葉と直す候補を出す。
// 目標の達成・手数・迷いの数は台が数えた物を渡し、審査役は変えない（達成の真偽は台が持つ）。疑うファイルは台が挙げた候補から選ばせる。

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { readJson } from "../../../lib/claude/call.ts";
import { OPUS } from "../../../lib/claude/models.ts";
import { WEIGHTS } from "./finding.ts";
import type { Persona } from "./personas.ts";
import type { LostEvent, StepRecord } from "./types.ts";

export const JUDGE_SYSTEM = `あなたは画面の分かりやすさを見る審査役。AI が演じた使う人（人物の文つき）が、手元の試験用のアプリ「ケア72」（介護の災害対応の道具）を PC で歩いた記録を読む。
記録は手ごとに、その時の画面の道・押した物の名前・思ったこと・押したあとの道、と台が数えた迷い（見つからない・読み違い・行き止まり・戻り・エラー・時間切れ）。
目標の達成と手数は台が数えた値で、あなたは変えない。あなたが出す物:
- ease: この人物にとっての通しやすさ 1〜5（5 が迷わない）
- summary: 2〜3 文の講評（200 字まで）
- unclear: 分かりにくかった言葉の一覧。画面にある言葉そのもの（word）、どの画面か（path）、なぜか（why）、言い換えの案（idea。2〜4 字の漢語）
- findings: 直す候補。場所（path と押した物の名前）、重さ（高・中・低）、短い題、再現の手順（手の並び）、疑うファイル（suspects は候補の一覧から選ぶ。無ければ空）、受け入れの確かめ（直ったと言える条件。数で言える形）
決まり:
- 記録にある事だけから言う。作らない
- 医療の助言をしない。人の状態を言い切らない
- 言葉の案は 2〜4 字の漢語。「を・が・の」でつなぐ文にしない
- 返事は JSON だけ`;

export const JudgeSchema = z.object({
  ease: z.number().int().min(1).max(5),
  summary: z.string().max(400),
  unclear: z
    .array(z.object({ word: z.string().max(40), path: z.string().max(120), why: z.string().max(160), idea: z.string().max(20) }))
    .max(20),
  findings: z
    .array(
      z.object({
        path: z.string().max(120),
        target: z.string().max(60).nullable(),
        weight: z.enum(WEIGHTS),
        title: z.string().max(80),
        repro: z.array(z.string().max(80)).max(10),
        suspects: z.array(z.string().max(120)).max(6),
        accept: z.string().max(160),
      }),
    )
    .max(12),
});
export type JudgeOut = z.infer<typeof JudgeSchema>;

export const JUDGE_SPEC = { model: OPUS, effort: "high" as const, maxTokens: 8000, timeoutMs: 180_000 };

export type GoalResult = {
  id: string;
  text: string;
  reached: boolean;
  /** 達した手（0 は手を打つ前に済んでいた） */
  reachedAt: number | null;
  steps: number;
  shortest: number;
  gaveUp: boolean;
  timedOut: boolean;
};

export type JudgeInput = {
  persona: Persona;
  goals: readonly GoalResult[];
  steps: readonly StepRecord[];
  lost: readonly LostEvent[];
  /** 疑うファイルの候補（画面の道と押した物の名前から台が探した物） */
  candidates: readonly string[];
};

export function judgeParams(input: JudgeInput) {
  const format = zodOutputFormat(JudgeSchema);
  const body = {
    persona: { label: input.persona.label, profile: input.persona.profile },
    goals: input.goals,
    steps: input.steps.map((s) => ({
      n: s.n,
      goal: s.goal,
      at: s.before.path,
      action: s.move.action,
      target: s.target?.name ?? null,
      zone: s.target?.zone ?? null,
      thought: s.move.thought,
      expect: s.move.expect,
      surprised: s.move.surprised,
      ok: s.result.ok,
      after: s.after.path,
      alerts: s.after.alerts,
      errors: s.after.errors,
    })),
    lost: input.lost,
    candidates: input.candidates,
  };
  return {
    model: JUDGE_SPEC.model,
    max_tokens: JUDGE_SPEC.maxTokens,
    system: [{ type: "text" as const, text: JUDGE_SYSTEM }],
    messages: [{ role: "user" as const, content: JSON.stringify(body) }],
    output_config: { effort: JUDGE_SPEC.effort, format: { type: "json_schema" as const, schema: format.schema } },
  };
}

export async function judgePath(client: ClaudeClient, input: JudgeInput): Promise<JudgeOut> {
  const m = await client.beta.messages.create(judgeParams(input), { timeout: JUDGE_SPEC.timeoutMs, maxRetries: 1 });
  const out = readJson(m, JudgeSchema);
  // 疑うファイルは候補にある物だけ（作った名前を残さない）
  const allowed = new Set(input.candidates);
  return { ...out, findings: out.findings.map((f) => ({ ...f, suspects: f.suspects.filter((x) => allowed.has(x)) })) };
}
