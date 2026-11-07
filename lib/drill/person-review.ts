// 人ごとの講評（docs/tasks/T185.md）。訓練の参加者 1 人ずつに、その人への手と結果を見た講評（良かった手・次に試す事）を、
// 訓練を進めながら裏で作る（app/api/drill/[id]/step の waitUntil）。数字は機械（lib/drill/score.ts）で、言葉だけ Haiku。
//
// - いつ作るか: 刻みのたびにその人の入力の文（personText）の印（personPrint）を数え、前の刻みで見た印と同じ（その人の流れが 1 刻み
//   動かなかった）で、講評を作った時の印と違うときだけ作る。後の刻みで手が入れば印が変わり、また落ち着いた所で作り直す（1 人 PERSON_TRIES_MAX 回まで）
// - 1 刻みに作るのは PERSONS_PER_TICK 人まで（Workers の外への接続は同時に 6 本。waitUntil は応答のあと 30 秒まで）
// - 訓練が終わったら、全体の講評（Opus）と並べて、まだ作っていない人・印の変わった人を作る（lib/drill/record-http.ts の reviewPost）
// - 入力は全体の講評と同じ仮名（reviewKeyOf。並びの順に A さん…）と同じ伏せ方（pseudonymizeText・通話の言葉は 1 行ずつ maskReply）
// - 出力は下書き（画面に AI の印）。使わない言葉に掛かった文だけ捨てる（reviewSentences）。鍵が無い・失敗は作らず数字だけの講評のまま

import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { HAIKU, type PurposeSpec } from "../claude/models.ts";
import { maskReply, pseudonymizeText, type ForClaude, type PseudonymKey } from "../pseudonym/index.ts";
import { COLOR_LABELS } from "../labels.ts";
import { scenarioOf } from "./scenarios.ts";
import { SCENARIO_LABELS } from "./labels.ts";
import { askWords, FORM9_PLAN_LABELS, minuteText, reachedText } from "./score-labels.ts";
import { PLAN_ACT_WORDS, PLAN_NEED_WORDS, sameWording } from "./person-facts.ts";
import { ACTION_LABELS } from "./labels.ts";
import {
  historyLines,
  REVIEW_SOURCES,
  REVIEW_WORLD_LINES,
  reviewError,
  reviewSentences,
  talkWordsSection,
  WASTE_WORDS,
  type PersonDigest,
  type ReviewContext,
  type ReviewDeps,
  type ReviewError,
} from "./review.ts";

// ---------- 形 ----------

export type PersonReviewBody = {
  /** その人への対応の講評（数文） */
  text: string;
  /** 良かった手 */
  good: string[];
  /** 次の訓練で試す事 */
  next: string[];
};

/** drills.score の persons の 1 人分（T185） */
export type StoredPerson = {
  /** 前の刻みで見た入力の印 */
  seen?: string;
  /** 作った回数（失敗を含む） */
  tries: number;
  done?: PersonReviewBody & { print: string; at: string; model: string };
  failed?: { print: string; at: string; error: ReviewError };
};

export type StoredPersons = Record<string, StoredPerson>;

/** 1 人の講評の数（作り直しを含む）。参加者 20 人（T186）で 1 回の訓練に最大 60 回 */
export const PERSON_TRIES_MAX = 3;
/** 1 刻みに作る人数（Workers の外への接続は同時に 6 本。本人役の呼び出しと重ならないように少なめ） */
export const PERSONS_PER_TICK = 3;
/** 終わったあと全体の講評と並べて作る人数の上限（全体の講評〔Opus〕と同時に開く接続を 5 本までに） */
export const PERSONS_AT_END = 8;
/** 1 日の上限に残す回数（全体の講評 1 回と、本人役の 1 刻み分）。これを割るなら人ごとの講評は作らない */
export const PERSON_USAGE_RESERVE = 12;

/** 字数（指示に書く数と、切る数） */
export const PERSON_TEXT_ASK = 160;
export const PERSON_TEXT_MAX = 260;
export const PERSON_ITEM_MAX = 2;
export const PERSON_ITEM_ASK = 60;
export const PERSON_ITEM_TEXT_MAX = 100;

/**
 * 人ごとの講評の呼び方。用途は scoring（講評として数える。ai_calls の CHECK はそのまま、録音のまとめと同じ形）。
 * 刻みの応答のあとの waitUntil（30 秒）に収めるため、録音のまとめ（RECORDING_SUMMARY）と同じ Haiku・4000・20 秒・再試行なし。
 * 入力は 1 人分で短く、言葉は表の手の名前と時刻を並べ直すだけなので medium
 */
export const PERSON_REVIEW_SPEC: PurposeSpec = { model: HAIKU, effort: "medium", maxTokens: 4000, timeoutMs: 20_000, maxRetries: 0 };

export const PERSON_REVIEW_SYSTEM = [
  "災害の訓練（発災から 72 時間。人は全部架空）で、ケアマネが 1 人の利用者（本人）に打った手と、その結果を振り返る講評を書く。",
  "入力は JSON の「記録」（その人の分だけ）。",
  "",
  ...REVIEW_WORLD_LINES,
  "",
  "返す JSON:",
  `- text: その人への対応の講評（${PERSON_TEXT_ASK} 字まで、2〜4 文）。いつ・どの手を打ち、どうなったか（届いた時刻・時計の期限・左の表の色の移り）を、手の履歴の時刻と上の手の言葉で書く。`,
  `- good: 良かった手（${PERSON_ITEM_MAX} つまで、1 つ ${PERSON_ITEM_ASK} 字まで）。時刻と手の名前で。無ければ空の配列。`,
  `- next: 次の訓練で試す事（${PERSON_ITEM_MAX} つまで、1 つ ${PERSON_ITEM_ASK} 字まで）。上の手の言葉で。無ければ空の配列。`,
  "",
  "決まり:",
  "1. 数字は機械で数えた物。数え直さない・変えない・新しい数字を作らない。",
  "2. 書くのは行動の振り返り（手の順番・選び方・時刻・電話での聞き取りと伝え方・頼み事への対応）だけ。病気の名前・薬の名前・薬の量・処置・医療の助言を書かない（手の名前の薬手配と、頼み事の「薬」は書いてよい）。本人の体の状態を言い切らない。",
  "3. 時計が切れるまでにその人へ手が届かなかったことは「条件に達した」とだけ書く。その先に起きる事を想像して書かない。電池・薬・機器が今どうなったかを言い切らない。",
  "4. 色と順位はルールの表が決めた物。色・順位を付け直す・変えることを書かない。",
  "5. その人は「本人」と書く。役割名（家族 娘・訪問看護など）のほかの名前、場所の名前を書かない。",
  "6. 責める書き方をしない。次の訓練で試す形で書く。",
  "7. 通話の言葉があれば、聞けた事・伝えた事・聞き漏らした事を書いてよい（言葉を長く写さない）。",
  "8. 手の履歴が無ければ、手が無かった事と、次に試す最初の手を書く。",
].join("\n");

export const PersonReviewSchema = z.object({
  text: z.string(),
  good: z.array(z.string()),
  next: z.array(z.string()),
});

export function buildPersonReviewRequest(record: ForClaude<{ text: string }>): AskJsonRequest<typeof PersonReviewSchema> {
  return {
    purpose: "scoring",
    spec: PERSON_REVIEW_SPEC,
    system: PERSON_REVIEW_SYSTEM,
    input: { 記録: record },
    schema: PersonReviewSchema,
    sources: REVIEW_SOURCES,
  };
}

// ---------- 入力の文 ----------

const triageWord = (c: string | undefined) => (c && c in COLOR_LABELS ? COLOR_LABELS[c as keyof typeof COLOR_LABELS] : null);

/** 左の表の色の移り（手の前の色と着信の色を時刻の順に。続けて同じ色は 1 つ） */
export function colorTrail(ctx: Pick<ReviewContext, "actions" | "calls">, person: string): string[] {
  const marks: Array<{ at: number; color: string | null }> = [
    ...ctx.actions.filter((a) => a.person === person).map((a) => ({ at: a.atMinute, color: triageWord(a.before.triage?.color) })),
    ...ctx.calls
      .filter((c) => c.person === person)
      .map((c) => ({ at: c.minute, color: c.color === "red" || c.color === "green" ? triageWord(c.color) : triageWord("unknown") })),
  ].sort((a, b) => a.at - b.at);
  const out: string[] = [];
  for (const m of marks) if (m.color && out[out.length - 1] !== m.color) out.push(m.color);
  return out;
}

/**
 * 人ごとの講評の入力の文（仮名で書く。T185）。その人の機械の数、手の履歴と着信、通話の言葉、その人の状況。
 * 訓練の今の時刻は入れない（その人の流れが動かなければ同じ文になり、印が変わらない）
 */
export function personText(
  ctx: ReviewContext,
  person: string,
  aliasOf: ReadonlyMap<string, string>,
  opts: { words?: (text: string) => string | null } = {},
): string {
  const who = (p: string | null | undefined) => (p && aliasOf.has(p) ? aliasOf.get(p)! : "（不明）");
  const s = ctx.score;
  const kind = scenarioOf(ctx.scenario).kind;
  const scene = kind === "earthquake" ? "地震（南海トラフ 震度 6強・津波・停電）" : "大雨（警戒レベル 3 → 4 → 浸水）";
  const lines: string[] = [
    `想定: ${ctx.scenario === "virtual" ? "仮想（実在の地域の地理の上で、想定の出来事を刻みごとに AI が決めた）" : scene}${ctx.scenario === "short" ? `（${SCENARIO_LABELS.short}）` : ""}。発災から 72 時間`,
    `本人: ${who(person)}`,
  ];
  const trail = colorTrail(ctx, person);
  lines.push(`左の表の色の移り: ${trail.length > 0 ? trail.join(" → ") : "記録なし"}`, "", "機械で数えた結果（この人の分。数え直さない）:");
  const miss = s.order.misses.find((m) => m.person === person);
  const turned = s.order.turns.some((t) => t.person === person);
  lines.push(
    `- 対応の順番: ${
      miss
        ? miss.why
            .map((w) => (w === "late" ? `先に別の人へ手（その時の一番上は ${miss.expected ? who(miss.expected) : "（不明）"}）` : w === "missing" ? "手なし" : w === "declined" ? "赤の着信を拒否" : "並びの記録なし"))
            .join("・")
        : turned
          ? "一致"
          : "手なし"
    }`,
  );
  const r = s.reached.find((x) => x.person === person);
  lines.push(`- 条件に達した: ${r ? `${reachedText(r)}（切れた時刻 ${minuteText(r.outMinute)}、切れるまでの届かなかった手 ${r.tries}）` : "なし"}`);
  const blank = s.form9.rows.find((x) => x.person === person);
  lines.push(`- 様式 9 の空欄: ${blank ? blank.columns.map((c) => FORM9_PLAN_LABELS[c]).join("・") : "なし"}`);
  const wasted = (s.wasted?.rows ?? []).filter((x) => x.person === person);
  lines.push(`- 空振り: ${wasted.length > 0 ? wasted.map((x) => `${minuteText(x.atMinute)} ${ACTION_LABELS[x.kind]}（${WASTE_WORDS[x.why]}）`).join("・") : "なし"}`);
  const repeat = (s.repeat?.rows ?? []).filter((x) => x.person === person);
  lines.push(`- 重複: ${repeat.length > 0 ? repeat.map((x) => `${minuteText(x.atMinute)} ${ACTION_LABELS[x.kind]}（前の同じ手から ${x.gap} 分）`).join("・") : "なし"}`);
  const asks = (s.asks?.rows ?? []).find((x) => x.person === person);
  lines.push(`- 頼み事の未対応: ${asks ? askWords(asks.kinds) : "なし"}`);
  const plan = s.plans?.rows.find((x) => x.person === person);
  if (plan && plan.acted.length > 0) lines.push(`- 計画で動けた: ${plan.acted.map((a) => PLAN_ACT_WORDS[a]).join("・")}`);
  if (plan && plan.needed.length > 0) lines.push(`- 計画が無く手が要った: ${plan.needed.map((a) => PLAN_NEED_WORDS[a]).join("・")}`);
  const calls = ctx.calls.filter((c) => c.person === person);
  if (calls.length > 0) {
    const n = (r: string) => calls.filter((c) => c.response === r).length;
    lines.push(`- 着信: ${calls.length} 件（出た ${n("answer")}・出なかった ${n("decline")}・未応答 ${calls.length - n("answer") - n("decline")}）`);
  }
  lines.push(
    "",
    "手の履歴（時刻は発災から。色と順位はその手の前の左の表。［事実］はその手を打った時に分かっていた事、→ のあとは結果）:",
    ...historyLines(ctx, who, person),
  );
  if (opts.words) lines.push(...talkWordsSection(ctx, who, opts.words, person));
  const mine = ctx.incidents.filter((e) => e.person === person);
  if (mine.length > 0) {
    lines.push("", "この人の状況:");
    for (const e of mine) lines.push(`- ${minuteText(Math.round(e.at * 60))} ${e.text}`);
  }
  return lines.join("\n");
}

/** 入力の文の印（FNV-1a 32 bit。同じ文かどうかを見るだけ） */
export function personPrint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** その人に手か着信があるか（刻みの裏では、何も無い人は作らない。終わりには作る） */
export const hasActivity = (ctx: Pick<ReviewContext, "actions" | "calls">, person: string) =>
  ctx.actions.some((a) => a.person === person) || ctx.calls.some((c) => c.person === person);

// ---------- いつ作るか ----------

export type PersonPlan = {
  /** 作る人（順に） */
  make: string[];
  /** 見た印を書き直す人 */
  seen: Record<string, string>;
};

/**
 * 作る人を決める（DB も AI も触らない）。tick は刻みの裏（前の刻みと同じ印＝落ち着いた人だけ）、end は終わり（印の変わった人を全部）。
 * まだ作っていない人を先に、参加者の並びの順。作り直しは PERSON_TRIES_MAX 回まで、同じ印の失敗は刻みの裏では作り直さない
 */
export function planPersons(
  prints: ReadonlyArray<{ person: string; print: string; active: boolean }>,
  stored: Readonly<StoredPersons>,
  mode: "tick" | "end",
  room: number,
): PersonPlan {
  const seen: Record<string, string> = {};
  const fresh: string[] = [];
  const redo: string[] = [];
  for (const { person, print, active } of prints) {
    const s = stored[person];
    if (s?.seen !== print) seen[person] = print;
    if (s?.done?.print === print) continue;
    if ((s?.tries ?? 0) >= PERSON_TRIES_MAX) continue;
    if (mode === "tick") {
      if (!active || s?.seen !== print || s?.failed?.print === print) continue;
    }
    (s?.done ? redo : fresh).push(person);
  }
  return { make: [...fresh, ...redo].slice(0, Math.max(0, room)), seen };
}

// ---------- 作る ----------

export type PersonOutcome = { ok: true; body: PersonReviewBody; model: string } | { ok: false; error: ReviewError };

/** 返事を人ごとの講評にする。使わない言葉に掛かった文だけ捨てる。何も残らなければ null */
export function personBody(answer: z.output<typeof PersonReviewSchema>, key: PseudonymKey): PersonReviewBody | null {
  const items = (xs: ReadonlyArray<string>) => {
    const out: string[] = [];
    for (const x of xs) {
      if (out.length >= PERSON_ITEM_MAX) break;
      const t = reviewSentences(x, key, PERSON_ITEM_TEXT_MAX);
      if (t && !out.some((y) => sameWording(y, t))) out.push(t);
    }
    return out;
  };
  const text = reviewSentences(answer.text, key, PERSON_TEXT_MAX) ?? "";
  const good = items(answer.good);
  const next = items(answer.next);
  if (!text && good.length === 0 && next.length === 0) return null;
  return { text, good, next };
}

/** 1 人の講評を 1 回作る（投げない。失敗は error） */
export async function createPersonReview(
  deps: { ai: AskJsonContext; key: PseudonymKey; aliasOf: ReadonlyMap<string, string> },
  ctx: ReviewContext,
  person: string,
): Promise<PersonOutcome> {
  try {
    const record = pseudonymizeText(personText(ctx, person, deps.aliasOf, { words: (t) => maskReply(t, deps.key) }), deps.key);
    const r = await askJson(buildPersonReviewRequest(record), deps.ai);
    const body = personBody(r.value, deps.key);
    if (!body) return { ok: false, error: "bad_output" };
    return { ok: true, body, model: r.model };
  } catch (e) {
    const code = reviewError(e);
    if (code) return { ok: false, error: code };
    console.error("人ごとの講評に失敗", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "failed" };
  }
}

/**
 * 決めた人の講評を並べて作り、1 人分ずつ保存の形にして返す（save に渡す）。上限に当たったら残りは作らない
 */
export async function runPersonReviews(
  deps: Pick<ReviewDeps, "ai"> & { key: PseudonymKey; aliasOf: ReadonlyMap<string, string>; now: () => string },
  ctx: ReviewContext,
  plan: { make: ReadonlyArray<string>; prints: ReadonlyMap<string, string> },
  stored: Readonly<StoredPersons>,
  save: (person: string, rec: StoredPerson) => Promise<void>,
): Promise<StoredPersons> {
  const out: StoredPersons = {};
  let limited = false;
  await Promise.all(
    plan.make.map(async (person) => {
      if (limited) return;
      const print = plan.prints.get(person)!;
      const before = stored[person] ?? { tries: 0 };
      const r = await createPersonReview(deps, ctx, person);
      if (!r.ok && r.error === "limit") limited = true;
      const rec: StoredPerson = r.ok
        ? { seen: print, tries: before.tries + 1, done: { ...r.body, print, at: deps.now(), model: r.model } }
        : { seen: print, tries: before.tries + 1, ...(before.done ? { done: before.done } : {}), failed: { print, at: deps.now(), error: r.error } };
      out[person] = rec;
      await save(person, rec);
    }),
  );
  return out;
}

/** 全体の講評に渡す要旨（できた人だけ） */
export function personDigests(stored: Readonly<StoredPersons>, participants: ReadonlyArray<string>): PersonDigest[] {
  return participants.flatMap((p) => {
    const d = stored[p]?.done;
    return d ? [{ person: p, good: d.good, next: d.next }] : [];
  });
}

// ---------- 読む ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** drills.score の persons を読む（形の崩れた人は外す） */
export function parsePersons(v: unknown): StoredPersons {
  if (!isObj(v)) return {};
  const out: StoredPersons = {};
  for (const [id, x] of Object.entries(v)) {
    if (!isObj(x)) continue;
    const rec: StoredPerson = { tries: typeof x.tries === "number" ? x.tries : 0 };
    if (typeof x.seen === "string") rec.seen = x.seen;
    const d = x.done;
    if (isObj(d) && typeof d.text === "string" && typeof d.print === "string") {
      rec.done = {
        text: d.text,
        good: strs(d.good),
        next: strs(d.next),
        print: d.print,
        at: typeof d.at === "string" ? d.at : "",
        model: typeof d.model === "string" ? d.model : "",
      };
    }
    const f = x.failed;
    if (isObj(f) && typeof f.print === "string") {
      rec.failed = { print: f.print, at: typeof f.at === "string" ? f.at : "", error: (typeof f.error === "string" ? f.error : "failed") as ReviewError };
    }
    out[id] = rec;
  }
  return out;
}

/** 画面と紙面に出す人ごとの講評（できた人だけ。id → 本体と、作った時刻） */
export type ShownPersons = Record<string, PersonReviewBody & { at: string }>;

export function shownPersons(stored: Readonly<StoredPersons> | undefined): ShownPersons {
  const out: ShownPersons = {};
  for (const [id, s] of Object.entries(stored ?? {})) {
    if (s.done) out[id] = { text: s.done.text, good: s.done.good, next: s.done.next, at: s.done.at };
  }
  return out;
}
