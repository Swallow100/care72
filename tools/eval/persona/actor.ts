// 使う人の AI（docs/tasks/T156.md）。安い型（Haiku）に、頁の読み・今の目標・手持ちの情報・今までの手を渡し、次の 1 手と思ったことを返させる。
// 返事の形は構造化出力（output_config.format）で縛り、lib/claude/call.ts の readJson（zod）で確かめる。
// アプリの仮名化の門（askJson）は ForClaude の型の人のデータのための口で、ここは手元の種の架空の人の頁の文を渡す。門は guard.ts
// （手元の host だけ・架空の形でない電話や種でない事業所の頁は渡さない）。パスワードは {{password}} の印だけを見せる。

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { readJson } from "../../../lib/claude/call.ts";
import { HAIKU } from "../../../lib/claude/models.ts";
import type { Goal, Persona } from "./personas.ts";
import { MOVE_ACTIONS, type Move, type Snapshot, type StepRecord } from "./types.ts";

export const ACTOR_SYSTEM = `あなたは介護の現場の人を演じ、手元の試験用のアプリ「ケア72」を PC で初めから触る。画面にある物だけを見て、目標に向けて 1 回に 1 手だけ決める。
画面は「[番号] 役 名前」の一覧（@ の後ろはどこにある物か）と、見出し・知らせ・本文の頭で見える。
手:
- click: 番号の物を押す
- type: 番号の欄に text を書く（今の値は消える）
- select: 番号の選ぶ欄で text の選択肢を選ぶ
- back: ブラウザの戻る
- done: 今の目標を果たしたと思う
- give_up: 今の目標をあきらめる（何度探しても見つからない・先へ進めない）
決まり:
- 人物になりきる。知らない言葉は知らないと思ってよい。画面の言葉だけを頼りに探す
- thought はその時に思ったことを 1〜2 文（80 字まで）。迷った・言葉の意味が分からない・思ったのと違う、は正直に書く
- expect は押したあとに起きると思うこと（40 字まで）
- surprised は、前の手の結果が思っていたのと違ったら true
- パスワードは {{password}} と書く（本当の値は知らない）。URL は打てない
- 医療の判断はしない。画面の操作だけ
- ref は click・type・select のとき番号、ほかは null。text は type・select のときだけ、ほかは null
- 返事は JSON だけ`;

export const MoveSchema = z.object({
  action: z.enum(MOVE_ACTIONS),
  ref: z.number().int().nullable(),
  text: z.string().max(200).nullable(),
  thought: z.string().max(240),
  expect: z.string().max(160),
  surprised: z.boolean(),
});

/** 使う人の AI の呼び方（docs/tasks/T156.md: 使う人の役は安い型） */
export const ACTOR_SPEC = { model: HAIKU, effort: "low" as const, maxTokens: 1500, timeoutMs: 30_000 };

/** 1 頁の読みを AI に渡す形（押せる物は 1 行ずつ） */
export function pageForActor(s: Snapshot): Record<string, unknown> {
  const line = (i: Snapshot["items"][number]) =>
    `[${i.ref}] ${i.role} ${i.name || "（名前なし）"}${i.value ? ` =${i.value}` : ""}${i.checked ? " ✓" : ""}${i.disabled ? " （押せない）" : ""}${i.options ? ` {${i.options.join("|")}}` : ""}${i.zone ? ` @${i.zone}` : ""}`;
  return {
    path: s.path,
    title: s.title,
    header: s.header,
    headings: s.headings,
    alerts: s.alerts,
    items: s.items.map(line),
    text: s.text,
  };
}

/** 今までの手の短い形（直近 limit 手） */
export function historyForActor(steps: readonly StepRecord[], limit = 8): Array<Record<string, unknown>> {
  return steps.slice(-limit).map((st) => ({
    n: st.n,
    action: st.move.action,
    target: st.target?.name ?? null,
    text: st.move.action === "type" || st.move.action === "select" ? st.move.text : null,
    thought: st.move.thought,
    result: st.result.ok ? (st.before.path === st.after.path ? (st.before.hash === st.after.hash ? "画面は変わらない" : "同じ道で画面が変わった") : `移った ${st.after.path}`) : `押せない ${st.result.error ?? ""}`,
  }));
}

export type ActorInput = {
  persona: Persona;
  goal: Goal;
  reached: readonly string[];
  left: number;
  steps: readonly StepRecord[];
  page: Snapshot;
};

export function actorParams(input: ActorInput) {
  const format = zodOutputFormat(MoveSchema);
  const body = {
    persona: input.persona.profile,
    goal: input.goal.text,
    reached: input.reached,
    goals_left_after_this: input.left,
    info: input.persona.info,
    history: historyForActor(input.steps),
    page: pageForActor(input.page),
  };
  return {
    model: ACTOR_SPEC.model,
    max_tokens: ACTOR_SPEC.maxTokens,
    system: [{ type: "text" as const, text: ACTOR_SYSTEM }],
    messages: [{ role: "user" as const, content: JSON.stringify(body) }],
    output_config: { effort: ACTOR_SPEC.effort, format: { type: "json_schema" as const, schema: format.schema } },
  };
}

/** 次の 1 手。返事が形に合わなければ例外 */
export async function nextMove(client: ClaudeClient, input: ActorInput): Promise<Move> {
  const m = await client.beta.messages.create(actorParams(input), { timeout: ACTOR_SPEC.timeoutMs, maxRetries: 1 });
  const out = readJson(m, MoveSchema);
  return { ...out, thought: out.thought.slice(0, 240), expect: out.expect.slice(0, 160) };
}
