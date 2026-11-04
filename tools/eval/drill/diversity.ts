// 評価の台（docs/tasks/T108.md）の多様さ。N 回の訓練をまとめて、単調さを数にする。
//
// - 出来事: AI（監督・世界）が作った出来事の種類（監督は inject、世界は変化の種類）。想定の表の固定の出来事は数えない
//   （表は毎回同じで、数えると作り物の表を測る）。種類の数・偏り（正規化したエントロピーと最多の割合）・並びの重なり（回どうしの Jaccard）
// - 言葉: 本人役（AI）の言う事（刻みの安否・通話・往復・訪問）。文字の 3-gram の重なり（回どうしの Jaccard）、異なり、同じ文の割合
// - 人ごとの反応: 同じ人の違う回どうし、違う人の同じ回どうしの、言葉の離れ（1 − Jaccard）と赤の割合の差
// 数の向き: 重なり・同じ文の割合は低いほど多様。異なり・エントロピー・離れは高いほど多様

import type { RunOutcome } from "./drive.ts";

export type DiversityNumbers = {
  runs: number;
  kinds: { total: number; distinct: number; entropy: number | null; topShare: number | null; byKind: Record<string, number> };
  sequence: { kindJaccard: number | null; bigramJaccard: number | null; sameScenarioKindJaccard: number | null };
  words: { sayings: number; distinct3: number | null; crossRunJaccard: number | null; duplicateRate: number | null };
  persons: {
    samePersonAcrossRuns: number | null;
    differentPersonsSameRun: number | null;
    redRateSamePerson: number | null;
    redRateDifferentPersons: number | null;
    pairsSame: number;
    pairsDifferent: number;
  };
};

/** 数えない変化（止まった印・代替の印・世界の刻みごとの 1 文） */
const NOT_STORY = new Set(["ai_stop", "world_note", "narration"]);

/** AI が作った出来事の種類の並び（時刻の順） */
export function aiKinds(o: RunOutcome): string[] {
  const out: Array<{ at: number; kind: string }> = [];
  for (const t of o.replay?.ticks ?? []) {
    for (const e of t.incidents) {
      if (e.ai !== true) continue;
      const kind = typeof e.inject === "string" ? e.inject : (e.change?.kind ?? "?");
      if (NOT_STORY.has(kind)) continue;
      out.push({ at: e.at ?? t.hour, kind });
    }
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.kind);
}

/** 本人役（AI）の言う事。人ごと */
export function aiSayings(o: RunOutcome): Array<{ person: string; text: string }> {
  const out: Array<{ person: string; text: string }> = [];
  for (const t of o.replay?.ticks ?? []) for (const u of t.turns) if (u.ai === true && u.saying && u.person) out.push({ person: u.person, text: u.saying });
  for (const a of o.replay?.actions ?? []) {
    const r = a.result;
    if (!r || !a.person) continue;
    if (r.speech && r.speechAi) out.push({ person: a.person, text: r.speech });
    for (const l of r.talk ?? []) if (l.who !== "cm" && l.text && l.ai === true) out.push({ person: a.person, text: l.text });
    if (r.visit?.speech && r.visit.ai) out.push({ person: a.person, text: r.visit.speech });
  }
  return out;
}

/** 文字の 3-gram（空白と句読点を除く） */
export function trigrams(text: string): string[] {
  const cs = Array.from(text.replace(/[\s。、，．！？!?「」『』（）()・…ー〜]/gu, ""));
  if (cs.length < 3) return cs.length > 0 ? [cs.join("")] : [];
  const out: string[] = [];
  for (let i = 0; i + 3 <= cs.length; i++) out.push(cs.slice(i, i + 3).join(""));
  return out;
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const mean = (xs: ReadonlyArray<number | null>): number | null => {
  const ys = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return ys.length > 0 ? ys.reduce((s, x) => s + x, 0) / ys.length : null;
};

function pairs<T>(xs: ReadonlyArray<T>): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

/** 正規化したエントロピー（種類が 1 つなら 0） */
export function entropyOf(counts: ReadonlyArray<number>): number | null {
  const total = counts.reduce((s, n) => s + n, 0);
  if (total === 0) return null;
  if (counts.length <= 1) return 0;
  const h = -counts.reduce((s, n) => (n > 0 ? s + (n / total) * Math.log(n / total) : s), 0);
  return h / Math.log(counts.length);
}

const bigrams = (xs: ReadonlyArray<string>) => new Set(xs.slice(1).map((x, i) => `${xs[i]}>${x}`));

function redRate(o: RunOutcome, person: string): number | null {
  const turns = (o.replay?.ticks ?? []).flatMap((t) => t.turns).filter((u) => u.person === person);
  return turns.length > 0 ? turns.filter((u) => u.color === "red").length / turns.length : null;
}

export function diversityOf(outcomes: ReadonlyArray<RunOutcome>): DiversityNumbers {
  const kindsByRun = outcomes.map(aiKinds);
  const all = kindsByRun.flat();
  const byKind: Record<string, number> = {};
  for (const k of all) byKind[k] = (byKind[k] ?? 0) + 1;
  const counts = Object.values(byKind);
  const runPairs = pairs(outcomes.map((o, i) => ({ o, i })));

  const sayings = outcomes.map(aiSayings);
  const grams = sayings.map((ss) => new Set(ss.flatMap((s) => trigrams(s.text))));
  const allGrams = sayings.flat().flatMap((s) => trigrams(s.text));
  const texts = sayings.flat().map((s) => s.text);

  // 人ごと: (回, 人) → 3-gram の集合
  const personGrams = outcomes.map((_, i) => {
    const m = new Map<string, Set<string>>();
    for (const s of sayings[i]) m.set(s.person, new Set([...(m.get(s.person) ?? []), ...trigrams(s.text)]));
    return m;
  });
  const persons = [...new Set(outcomes.flatMap((o) => o.plan.participants))];
  const same: Array<number | null> = [];
  const sameRed: Array<number | null> = [];
  for (const p of persons) {
    const runs = outcomes.map((o, i) => ({ o, i })).filter(({ o }) => o.plan.participants.includes(p));
    for (const [a, b] of pairs(runs)) {
      const ga = personGrams[a.i].get(p);
      const gb = personGrams[b.i].get(p);
      if (ga && gb) {
        const j = jaccard(ga, gb);
        same.push(j === null ? null : 1 - j);
      }
      const ra = redRate(a.o, p);
      const rb = redRate(b.o, p);
      if (ra !== null && rb !== null) sameRed.push(Math.abs(ra - rb));
    }
  }
  const diff: Array<number | null> = [];
  const diffRed: Array<number | null> = [];
  outcomes.forEach((o, i) => {
    for (const [a, b] of pairs(o.plan.participants)) {
      const ga = personGrams[i].get(a);
      const gb = personGrams[i].get(b);
      if (ga && gb) {
        const j = jaccard(ga, gb);
        diff.push(j === null ? null : 1 - j);
      }
      const ra = redRate(o, a);
      const rb = redRate(o, b);
      if (ra !== null && rb !== null) diffRed.push(Math.abs(ra - rb));
    }
  });

  return {
    runs: outcomes.length,
    kinds: {
      total: all.length,
      distinct: counts.length,
      entropy: entropyOf(counts),
      topShare: all.length > 0 ? Math.max(...counts) / all.length : null,
      byKind,
    },
    sequence: {
      kindJaccard: mean(runPairs.map(([a, b]) => jaccard(new Set(kindsByRun[a.i]), new Set(kindsByRun[b.i])))),
      bigramJaccard: mean(runPairs.map(([a, b]) => jaccard(bigrams(kindsByRun[a.i]), bigrams(kindsByRun[b.i])))),
      sameScenarioKindJaccard: mean(
        runPairs.filter(([a, b]) => a.o.plan.scenario === b.o.plan.scenario).map(([a, b]) => jaccard(new Set(kindsByRun[a.i]), new Set(kindsByRun[b.i]))),
      ),
    },
    words: {
      sayings: texts.length,
      distinct3: allGrams.length > 0 ? new Set(allGrams).size / allGrams.length : null,
      crossRunJaccard: mean(runPairs.map(([a, b]) => (grams[a.i].size > 0 && grams[b.i].size > 0 ? jaccard(grams[a.i], grams[b.i]) : null))),
      duplicateRate: texts.length > 0 ? 1 - new Set(texts).size / texts.length : null,
    },
    persons: {
      samePersonAcrossRuns: mean(same),
      differentPersonsSameRun: mean(diff),
      redRateSamePerson: mean(sameRed),
      redRateDifferentPersons: mean(diffRed),
      pairsSame: same.filter((x) => x !== null).length,
      pairsDifferent: diff.filter((x) => x !== null).length,
    },
  };
}
