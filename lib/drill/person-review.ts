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

/** 1 人の講評を作る数（訓練の間に 1 回、終わりに流れが変わっていれば作り直しの 1 回） */
export const PERSON_TRIES_MAX = 2;
/**
 * 1 回の呼び出しにまとめる人数。偽の台（評価の訓練 10 人）で 1 人 1 回にすると 1 回の訓練に 23〜25 回増え、
 * AI の呼び出しの守り（1 回 77 回まで）を越えたので、まとめて呼ぶ（docs/progress/t185.md）
 */
export const PERSONS_PER_CALL = 4;
/**
 * 刻みの裏で呼ぶ回数の上限（1 回の訓練に。1 刻みに 1 回）。評価の 12 回目で、刻みの裏で作った人は 2 回とも全員が終わりに作り直され
 * （手の印が後の刻みで変わる）、呼び出しが無駄になったので 0 にし、終わりに全体の講評と並べて作る（並べるので最後の待ちは延びない）
 */
export const PERSON_TICK_CALLS_MAX = 0;
/** 1 刻みに作る人数（1 回の呼び出し分） */
export const PERSONS_PER_TICK = PERSONS_PER_CALL;
/** 終わったあと全体の講評と並べて作る人数の上限（4 人ずつ 5 回まで＝参加者の上限 20 人。全体の講評〔Opus〕と同時に開く接続は 6 本） */
export const PERSONS_AT_END = PERSONS_PER_CALL * 5;
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
 * 刻みの応答のあとの waitUntil（30 秒）に収めるため、録音のまとめ（RECORDING_SUMMARY）と同じ Haiku・20 秒・再試行なし。
 * 4 人分の返事（1 人 300 字ほど）を収めるため上限 6000、言葉は機械の数と手の履歴を並べ直すだけなので考える深さは low
 */
export const PERSON_REVIEW_SPEC: PurposeSpec = { model: HAIKU, effort: "low", maxTokens: 6000, timeoutMs: 20_000, maxRetries: 0 };

export const PERSON_REVIEW_SYSTEM = [
  "災害の訓練（発災から 72 時間。人は全部架空）で、ケアマネが利用者 1 人ずつ（本人）に打った手と、その結果を振り返る講評を書く。",
  "入力は JSON の「記録」。「## 仮名」の節ごとに 1 人分（その人の分だけ）。",
  "",
  ...REVIEW_WORLD_LINES,
  "",
  "返す JSON: persons（入力の節の人ごとに 1 つ、節の順に）。各要素:",
  "- person: 節の見出しの仮名（「A さん」）",
  `- text: その人への対応の講評（${PERSON_TEXT_ASK} 字まで、2〜4 文）。いつ・どの手を打ち、どうなったか（届いた時刻・時計の期限・左の表の色の移り）を、手の履歴の時刻と上の手の言葉で書く。`,
  `- good: 良かった手（${PERSON_ITEM_MAX} つまで、1 つ ${PERSON_ITEM_ASK} 字まで）。時刻と手の名前で。無ければ空の配列。`,
  `- next: 次の訓練で試す事（${PERSON_ITEM_MAX} つまで、1 つ ${PERSON_ITEM_ASK} 字まで）。上の手の言葉で。無ければ空の配列。`,
  "",
  "決まり:",
  "1. 数字は機械で数えた物。数え直さない・変えない・新しい数字を作らない。",
  "2. 書くのは行動の振り返り（手の順番・選び方・時刻・電話での聞き取りと伝え方・頼み事への対応）だけ。病気の名前・薬の名前・薬の量・処置・医療の助言を書かない（手の名前の薬手配と、頼み事の「薬」は書いてよい）。本人の体の状態を言い切らない。",
  "3. 時計が切れるまでにその人へ手が届かなかったことは「条件に達した」とだけ書く。その先に起きる事を想像して書かない。時計は入力の書き方（「〇〇 N 時間を超過」）のまま写し、電池・薬・機器が今どうなったかを言い切らない。",
  "4. 色と順位はルールの表が決めた物。色・順位を付け直す・変えることを書かない。",
  "5. その人は「本人」と書く。役割名（家族 娘・訪問看護など）のほかの名前、場所の名前を書かない。",
  "6. 責める書き方をしない。次の訓練で試す形で書く。",
  "7. 通話の言葉があれば、聞けた事・伝えた事・聞き漏らした事を書いてよい（言葉を長く写さない）。伝えた事は、連絡の順（かかりつけ・家族・119 への連絡）と頼み事への答えで書き、体や薬の扱いの話は書かない。",
  "8. 手の履歴が無ければ、手が無かった事と、次に試す最初の手を書く。good は空の配列にする。",
  "9. good はケアマネが手の履歴で打った手だけ。計画の記録・世界の出来事・本人や家族が自分でした事は入れない。二重の否定を使わない。",
].join("\n");

const PersonAnswer = z.object({
  person: z.string(),
  text: z.string(),
  good: z.array(z.string()),
  next: z.array(z.string()),
});

export const PersonReviewSchema = z.object({ persons: z.array(PersonAnswer) });

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
 * 作る人を決める（DB も AI も触らない）。tick は刻みの裏: まだ作っていない人のうち、前の刻みと同じ印（落ち着いた）で手か着信のある人だけ
 * （同じ印の失敗は作り直さない）。end は終わり: まだ作っていない人と、作った時から印の変わった人（作り直し）を全部。
 * まだ作っていない人を先に、参加者の並びの順。1 人 PERSON_TRIES_MAX 回まで、room 人まで
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
    if (mode === "tick" && (s?.done || !active || s?.seen !== print || s?.failed?.print === print)) continue;
    (s?.done ? redo : fresh).push(person);
  }
  return { make: [...fresh, ...redo].slice(0, Math.max(0, room)), seen };
}

// ---------- 作る ----------

export type PersonOutcome = { ok: true; bodies: ReadonlyMap<string, PersonReviewBody>; model: string } | { ok: false; error: ReviewError };

/** 返事の 1 人分を人ごとの講評にする。使わない言葉に掛かった文だけ捨てる。何も残らなければ null */
export function personBody(answer: Omit<z.output<typeof PersonAnswer>, "person">, key: PseudonymKey): PersonReviewBody | null {
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

/** まとめて呼ぶ入力の文（「## 仮名」の節を人ごとに） */
export function personsText(ctx: ReviewContext, people: ReadonlyArray<string>, aliasOf: ReadonlyMap<string, string>, words?: (t: string) => string | null): string {
  return people.map((p) => [`## ${aliasOf.get(p) ?? "（不明）"}`, personText(ctx, p, aliasOf, words ? { words } : {})].join("\n")).join("\n\n");
}

/** 何人かの講評を 1 回で作る（投げない。失敗は error。返事に無い人・知らない仮名は入れない） */
export async function createPersonReviews(
  deps: { ai: AskJsonContext; key: PseudonymKey; aliasOf: ReadonlyMap<string, string> },
  ctx: ReviewContext,
  people: ReadonlyArray<string>,
): Promise<PersonOutcome> {
  try {
    const record = pseudonymizeText(personsText(ctx, people, deps.aliasOf, (t) => maskReply(t, deps.key)), deps.key);
    const r = await askJson(buildPersonReviewRequest(record), deps.ai);
    const byAlias = new Map(people.map((p) => [deps.aliasOf.get(p)?.replace(/\s+/g, ""), p]));
    const bodies = new Map<string, PersonReviewBody>();
    for (const x of r.value.persons) {
      const p = byAlias.get(x.person.replace(/\s+/g, ""));
      if (!p || bodies.has(p)) continue;
      const body = personBody(x, deps.key);
      if (body) bodies.set(p, body);
    }
    if (bodies.size === 0) return { ok: false, error: "bad_output" };
    return { ok: true, bodies, model: r.model };
  } catch (e) {
    const code = reviewError(e);
    if (code) return { ok: false, error: code };
    console.error("人ごとの講評に失敗", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "failed" };
  }
}

/**
 * 決めた人の講評を PERSONS_PER_CALL 人ずつまとめて並べて呼び、1 人分ずつ保存の形にして返す（save に渡す）。
 * 返事に無かった人は失敗（bad_output）として回数に数える
 */
export async function runPersonReviews(
  deps: Pick<ReviewDeps, "ai"> & { key: PseudonymKey; aliasOf: ReadonlyMap<string, string>; now: () => string },
  ctx: ReviewContext,
  plan: { make: ReadonlyArray<string>; prints: ReadonlyMap<string, string> },
  stored: Readonly<StoredPersons>,
  save: (person: string, rec: StoredPerson) => Promise<void>,
): Promise<StoredPersons> {
  const out: StoredPersons = {};
  const chunks: string[][] = [];
  for (let i = 0; i < plan.make.length; i += PERSONS_PER_CALL) chunks.push(plan.make.slice(i, i + PERSONS_PER_CALL));
  await Promise.all(
    chunks.map(async (people) => {
      const r = await createPersonReviews(deps, ctx, people);
      for (const person of people) {
        const print = plan.prints.get(person)!;
        const before = stored[person] ?? { tries: 0 };
        const body = r.ok ? r.bodies.get(person) : undefined;
        const rec: StoredPerson =
          r.ok && body
            ? { seen: print, tries: before.tries + 1, done: { ...body, print, at: deps.now(), model: r.model } }
            : {
                seen: print,
                tries: before.tries + 1,
                ...(before.done ? { done: before.done } : {}),
                failed: { print, at: deps.now(), error: r.ok ? "bad_output" : r.error },
              };
        out[person] = rec;
        await save(person, rec);
      }
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
