// 評価の台（docs/tasks/T108.md）の審査役。見本の数回だけ、1 回の訓練の流れを Opus に読ませ、5 つの物差しで 1〜5 を付けさせる。
// 用途は採点（scoring、Opus）。新しい用途は足さない（ai_calls の CHECK に縛られるため）。
// 渡す流れは記録の値から作り、人は仮名（A さん）、町名は地区の別名にし、最後に pseudonymizeText で伏せ直す（伏せきれなければ渡さない）。
// 審査役の呼び出しは訓練の ai_calls の外（台の手元の数え）で数える。

import * as z from "zod";
import { askJson, type AskJsonContext } from "../../../lib/claude/call.ts";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import type { UsageStore } from "../../../lib/claude/usage.ts";
import { officePlaces } from "../../../lib/drill/area.ts";
import { contactRoles, pseudonymize, pseudonymizeText, type PseudonymInput } from "../../../lib/pseudonym/index.ts";
import { NIGHT_START_HOUR } from "../../../lib/drill/night.ts";
import { ARRIVAL_WORDS } from "../../../lib/drill/person-facts.ts";
import { runStart, type RunOutcome } from "./drive.ts";

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

/** 往復の 1 行・訪問の言葉の長さ（字。T165。流れが長くなりすぎないよう切る） */
const TALK_CUT = 40;
/** 1 つの通話から流れに書く往復の行の数（T165） */
const TALK_LINES = 6;
const cutText = (t: string, n = TALK_CUT): string => {
  const a = Array.from(t.replace(/\s+/g, " ").trim());
  return a.length > n ? `${a.slice(0, n).join("")}…` : a.join("");
};

/**
 * 訓練の中の時刻（T165）。夜間発災は深夜 2 時（lib/drill/night.ts）、ほかは台の回の開始の時刻（drive.ts の runStart、日本の時刻）。
 * 審査役が「朝・昼・夕方」の言葉と経過を照らせるように、流れの行に添える。回の番号の無い流れ（手で組んだ物）は null
 */
export function storyClock(o: Pick<RunOutcome, "plan">): ((hour: number) => string) | null {
  if (typeof o.plan.index !== "number") return null;
  const start = o.plan.night ? NIGHT_START_HOUR : (new Date(runStart(o.plan.index)).getUTCHours() + 9) % 24;
  return (hour: number) => {
    const total = start + Math.max(0, Math.floor(hour));
    return `${Math.floor(total / 24) + 1}日目 ${total % 24}時`;
  };
}

type TalkLineLike = { who?: string; text?: string; ai?: boolean };

/**
 * 通話 1 つの往復の要約（T165）。電話に出た人の行を切って並べ、ケアマネの行は数だけ（ケアマネの文は名前に戻した物なので書かない）。
 * コードの短い返事（相づち・待ちます。T167）と固定の言葉は本人役の言葉でないので並べない（行の上限を相づちで埋めない）
 */
export function talkSummary(ls: ReadonlyArray<TalkLineLike> | undefined): string {
  const all = ls ?? [];
  const said = all.filter((l) => l.who !== "cm" && l.ai !== false && typeof l.text === "string" && l.text.trim() !== "");
  if (said.length === 0) return "";
  const cm = all.filter((l) => l.who === "cm").length;
  const shown = said.slice(0, TALK_LINES).map((l) => `「${cutText(l.text!)}」`);
  return ` 往復（ケアマネ ${cm} 回）: ${shown.join(" ")}${said.length > TALK_LINES ? ` ほか ${said.length - TALK_LINES} 行` : ""}`;
}

/**
 * 1 回の流れの文（伏せる前。人は仮名に置き換え済み、町名は pseudonymizeText が別名にする）。
 * roleOf は連絡先の id → 役割名（弟・民生委員・支援者 1。T123: 電話の相手を書く。評価の 2 回目で、民生委員と弟への電話の言葉を
 * 審査役が「話し手の続柄が替わる」と読んだ。相手の書かれていない流れでは見分けられない）
 *
 * T165: 審査役に見えていなかった物を足す（物差しの文 JUDGE_SYSTEM と点の付け方は変えない）。評価の 7 回目で、届いた薬・着いた人・
 * 往復の言葉・訪問の様子が流れに無く、「頼んだのに来ない」と読まれていた。
 * - 先頭に発災の時刻、行の経過に訓練の中の時刻（「2日目 22時」）
 * - 着いた人・届いた物（world.arrivals と world.dispatched の着いた物）
 * - 手の結果の訳（because）・着く見込み（arriveAt）
 * - 外へ掛けた電話の往復（result.talk）と掛かってきた電話の往復（outcome.incoming）の要約（talkSummary）
 * - 訪問の様子（result.visit）
 * - 同じ時刻・同じ人・同じ出どころの出来事は 1 行に（1 つの出来事が 2 つの変化〔土砂の警戒と道の通行止め〕を持つと 2 行に見えた）
 */
export function storyText(o: RunOutcome, aliasOf: ReadonlyMap<string, string>, roleOf: ReadonlyMap<string, string> = new Map()): string {
  const who = (p: unknown) => (typeof p === "string" && p !== "" ? (aliasOf.get(p) ?? "参加者の外") : null);
  const role = (t: unknown) => (typeof t === "string" ? (roleOf.get(t) ?? null) : null);
  const clock = storyClock(o);
  const when = (at: number) => (clock ? `${hm(at)}（${clock(at)}）` : hm(at));
  const lines: Array<{ at: number; text: string }> = [];
  for (const t of o.replay?.ticks ?? []) {
    // 同じ時刻・同じ人・同じ出どころの出来事を 1 行に（T165）。人の無い出来事はそのまま
    const merged: Array<{ at: number; head: string; texts: string[]; key: string | null }> = [];
    for (const e of t.incidents) {
      const w = who(e.person);
      const at = e.at ?? t.hour;
      const head = `出来事（${e.actor === "director" ? "監督" : "世界"}${e.ai ? "・AI" : ""}）${w ? ` ${w}:` : ""}`;
      const key = w ? `${at}|${head}` : null;
      const prev = key ? merged.find((m) => m.key === key) : undefined;
      if (prev) prev.texts.push(e.text ?? "");
      else merged.push({ at, head, texts: [e.text ?? ""], key });
    }
    for (const m of merged) lines.push({ at: m.at, text: `${when(m.at)} ${m.head} ${m.texts.filter((x) => x.trim() !== "").join("・")}` });
    for (const u of t.turns) {
      const at = u.at ?? t.hour;
      lines.push({ at, text: `${when(at)} 連絡 ${who(u.person) ?? ""}（${u.source ?? ""}・${u.color ?? ""}）${u.saying ? ` 「${u.saying}」` : ""}${u.doing ? ` する事: ${u.doing}` : ""}` });
    }
  }
  for (const a of o.replay?.actions ?? []) {
    const at = (a.atMinute ?? 0) / 60;
    const r = a.result;
    const visit = r?.visit;
    const visitText = visit && (visit.condition || visit.speech) ? ` 訪問の様子: ${visit.condition ? cutText(visit.condition) : ""}${visit.speech ? ` 「${cutText(visit.speech)}」` : ""}` : "";
    const because = typeof r?.because === "string" && r.because.trim() !== "" ? `（訳 ${cutText(r.because)}）` : "";
    const arrive = typeof r?.arriveAt === "number" ? `（着く見込み ${when(r.arriveAt / 60)}）` : "";
    lines.push({
      at,
      text: `${when(at)} ケアマネの手 ${a.as ?? a.kind ?? ""}${who(a.person) ? ` → ${who(a.person)}` : ""}${role(a.target) ? `（相手 ${role(a.target)}）` : ""}: ${r?.status ?? "返事待ち"}${because}${arrive}${r?.speech ? ` 「${r.speech}」` : ""}${talkSummary(r?.talk)}${visitText}`,
    });
  }
  // 着いた人・届いた物（T165）
  const world = (o.replay?.world ?? {}) as { arrivals?: ReadonlyArray<Record<string, unknown>>; dispatched?: ReadonlyArray<Record<string, unknown>> };
  for (const x of world.arrivals ?? []) {
    if (x.arrived !== true || typeof x.arrive !== "number") continue;
    const w = who(x.person);
    const what = typeof x.role === "string" ? (ARRIVAL_WORDS[x.role] ?? x.role) : "人";
    lines.push({ at: x.arrive / 60, text: `${when(x.arrive / 60)} 着いた ${what}${w ? ` → ${w}` : ""}` });
  }
  for (const x of world.dispatched ?? []) {
    if (x.arrived !== true || typeof x.arrive !== "number") continue;
    const w = who(x.person);
    lines.push({ at: x.arrive / 60, text: `${when(x.arrive / 60)} 着いた 頼んだ人${w ? ` → ${w}` : ""}` });
  }
  // 掛かってきた電話の往復（T165。手の記録の外にあるので台が集めた物）
  for (const c of o.incoming ?? []) {
    const at = c.minute / 60;
    lines.push({ at, text: `${when(at)} 着信 ${who(c.person) ?? ""}${c.first ? ` 「${cutText(c.first)}」` : ""}${talkSummary(c.lines)}` });
  }
  lines.sort((x, y) => x.at - y.at);
  const start = clock ? `。発災は ${clock(0).replace(/^1日目 /, "")}ごろ（行の経過は発災から、かっこは訓練の中の時刻）` : "";
  return [`想定: ${o.plan.scenario}${o.plan.scale ? `（${o.plan.scale.kind} ${o.plan.scale.level}）` : ""}。参加 ${o.plan.participants.length} 人${start}`, ...lines.map((l) => l.text)].join("\n");
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
    const roleOf = new Map(
      sources.flatMap((s) => {
        const roles = contactRoles(s.contacts);
        return s.contacts.map((c, i) => [c.id, roles[i]] as const);
      }),
    );
    const story = pseudonymizeText(storyText(o, aliasOf, roleOf), key);
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
