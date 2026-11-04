// 評価の台（docs/tasks/T108.md）の審査役。見本の数回だけ、1 回の訓練の流れを Opus に読ませ、5 つの物差しで 1〜5 を付けさせる。
// 用途は採点（scoring、Opus）。新しい用途は足さない（ai_calls の CHECK に縛られるため）。
// 渡す流れは記録の値から作り、人は仮名（A さん）、町名は地区の別名にし、最後に pseudonymizeText で伏せ直す（伏せきれなければ渡さない）。
// 審査役の呼び出しは訓練の ai_calls の外（台の手元の数え）で数える。

import * as z from "zod";
import { askJson, type AskJsonContext } from "../../../lib/claude/call.ts";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import type { UsageStore } from "../../../lib/claude/usage.ts";
import { officePlaces } from "../../../lib/drill/area.ts";
import { pseudonymize, pseudonymizeText, type PseudonymInput } from "../../../lib/pseudonym/index.ts";
import type { RunOutcome } from "./drive.ts";

export const JUDGE_SYSTEM = [
  "災害の訓練（発災から 72 時間。在宅で介護を受ける高齢者を受け持つケアマネの訓練。人は全部架空）の、1 回分の流れを読んで、訓練の作りの出来を採点する審査役。",
  "採点するのは訓練の世界と本人役の出来で、ケアマネの手の良し悪しではない。入力は JSON の「訓練」（時刻順の出来事・本人と家族の連絡・ケアマネの手と結果）。",
  "",
  "物差し（どれも 1〜5 の整数。3 が普通）:",
  "- realism: 本当らしさ。災害の流れ・街の出来事・人の反応が、実際の災害で起こりそうか",
  "- difficulty: 難しさ。ケアマネが判断に迷う場面・限られた手で優先を決める場面があるか（易しすぎ・理不尽すぎは低い）",
  "- variety: 多様さ。出来事の種類と人の反応が単調でないか（同じ言い回し・同じ出来事の繰り返しは低い）",
  "- consistency: 人ごとの筋の通り方。同じ人の言う事・様子・暮らしが回の中で食い違わないか",
  "- learning: ケアマネが学べるか。誰から順に連絡するかを考え直すきっかけがあるか",
  "- notes: 根拠の短い文（1 つ 60 字まで、3 つまで）。仮名と地区の別名のほかの名前を書かない。",
  "",
  "決まり: 診断・病名・薬の量・医療の助言を書かない。色・順位を付け直さない。",
].join("\n");

export const JudgeSchema = z.object({
  realism: z.number(),
  difficulty: z.number(),
  variety: z.number(),
  consistency: z.number(),
  learning: z.number(),
  notes: z.array(z.string()),
});

export const JUDGE_AXES = ["realism", "difficulty", "variety", "consistency", "learning"] as const;
export type JudgeAxis = (typeof JUDGE_AXES)[number];
/** 物差しの言葉（md の見出し） */
export const JUDGE_LABELS: Readonly<Record<JudgeAxis, string>> = { realism: "本当らしさ", difficulty: "難しさ", variety: "多様さ", consistency: "人ごとの筋", learning: "学べるか" };
export type JudgeScore = { run: number; scores: Record<JudgeAxis, number> | null; notes: string[]; error: string | null };

const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

const hm = (hour: number | undefined) => {
  const m = Math.round((hour ?? 0) * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/** 1 回の流れの文（伏せる前。人は仮名に置き換え済み、町名は pseudonymizeText が別名にする） */
export function storyText(o: RunOutcome, aliasOf: ReadonlyMap<string, string>): string {
  const who = (p: unknown) => (typeof p === "string" ? (aliasOf.get(p) ?? "参加者の外") : null);
  const lines: Array<{ at: number; text: string }> = [];
  for (const t of o.replay?.ticks ?? []) {
    for (const e of t.incidents) {
      const w = who(e.person);
      lines.push({ at: e.at ?? t.hour, text: `${hm(e.at ?? t.hour)} 出来事（${e.actor === "director" ? "監督" : "世界"}${e.ai ? "・AI" : ""}）${w ? ` ${w}:` : ""} ${e.text ?? ""}` });
    }
    for (const u of t.turns) {
      lines.push({ at: u.at ?? t.hour, text: `${hm(u.at ?? t.hour)} 連絡 ${who(u.person) ?? ""}（${u.source ?? ""}・${u.color ?? ""}）${u.saying ? ` 「${u.saying}」` : ""}${u.doing ? ` する事: ${u.doing}` : ""}` });
    }
  }
  for (const a of o.replay?.actions ?? []) {
    const at = (a.atMinute ?? 0) / 60;
    const r = a.result;
    lines.push({
      at,
      text: `${hm(at)} ケアマネの手 ${a.as ?? a.kind ?? ""}${who(a.person) ? ` → ${who(a.person)}` : ""}: ${r?.status ?? "返事待ち"}${r?.speech ? ` 「${r.speech}」` : ""}`,
    });
  }
  lines.sort((x, y) => x.at - y.at);
  return [`想定: ${o.plan.scenario}${o.plan.scale ? `（${o.plan.scale.kind} ${o.plan.scale.level}）` : ""}。参加 ${o.plan.participants.length} 人`, ...lines.map((l) => l.text)].join("\n");
}

/** 台の手元の数え（審査役は訓練の ai_calls の外） */
export function memoryUsage(): UsageStore {
  let n = 0;
  return { reserve: async () => (n += 1) > 0, finish: async () => {}, countDay: async () => n };
}

/**
 * 1 回を採点する。sources は事業所の本人の台帳（仮名化の前。種の 10 人）。
 * 伏せきれない・Claude の失敗は scores null と理由
 */
export async function judgeRun(
  o: RunOutcome,
  sources: ReadonlyArray<PseudonymInput>,
  deps: { client: ClaudeClient; key: string; now?: () => Date },
): Promise<JudgeScore> {
  const ordered = [
    ...o.plan.participants.map((id) => sources.find((s) => s.person.id === id)).filter((s): s is PseudonymInput => !!s),
    ...sources.filter((s) => !o.plan.participants.includes(s.person.id)),
  ];
  const places = officePlaces("office-demo", sources.map((s) => s.ledger));
  const { key } = pseudonymize(ordered, { places });
  const aliasOf = new Map(key.people.map((x) => [x.personId, x.alias]));
  const ctx: AskJsonContext = {
    env: { ANTHROPIC_API_KEY: deps.key },
    usage: memoryUsage(),
    office: { id: "office-demo", kind: "demo" },
    claude: deps.client,
    ...(deps.now ? { now: deps.now } : {}),
  };
  try {
    const story = pseudonymizeText(storyText(o, aliasOf), key);
    const r = await askJson({ purpose: "scoring", system: JUDGE_SYSTEM, input: { 訓練: story }, schema: JudgeSchema }, ctx);
    const v = r.value;
    return {
      run: o.plan.index,
      scores: { realism: clamp(v.realism), difficulty: clamp(v.difficulty), variety: clamp(v.variety), consistency: clamp(v.consistency), learning: clamp(v.learning) },
      notes: v.notes.slice(0, 3).map((x) => Array.from(x).slice(0, 60).join("")),
      error: null,
    };
  } catch (e) {
    return { run: o.plan.index, scores: null, notes: [], error: e instanceof Error ? e.name : String(e) };
  }
}
