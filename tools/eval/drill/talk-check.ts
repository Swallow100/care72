// 評価の台（T108）の検査 11: 通話の往復の繰り返しと、いる所の揺れ（T158）。外へ掛けた電話（手の返事の talk）と掛かってきた電話
// （drive.ts が往復の返事から集めた incoming）の両方を、通話 1 つずつ見る。色と順位は決めない・付け直さない。数えるだけ。
//
// - 繰り返し（repeat）: 電話に出た人の AI の返事が、同じ通話の前の AI の返事とほぼ同じ（3 字の並びの 6 割以上が重なる。新しい返事の側から見る）。
//   評価の 6 回目の数え方（27/112）と同じ。最初の言葉は前の返事に入れない
// - いる所の揺れ（place_drift）: 同じ通話の中で、前に言ったいる所と食い違う事を言う（避難所にいると言ったあとに家にいる・避難所へ向かう・
//   避難所ではない、家にいると言ったあとに避難所にいる・家に物を置いてきた、家に置いてきたと言ったあとに家にいる）。最初の言葉から見る。
//   いる所の言い方は本人役の門と同じ物差し（lib/drill/person-facts.ts の placeSaid）に、台が足した「避難所ではない」を足す
// - 生の返事の繰り返し（repeatRaw）: 往復の本人役（persona_talk）の生の返事が、送った「それまでの話」の電話に出た人の行とほぼ同じ。
//   門（同じ通話の前の返事の文を落とす、T158）の前の数なので、指示の効き目を見る
// 帳面との食い違い（避難所にいる人の「家で過ごす」など）は facts-check.ts が通話の言葉も見る

import { overlapOf, placeSaid, REPEAT_OVERLAP, type PlaceSaid } from "../../../lib/drill/person-facts.ts";
import type { CheckHit } from "./checks.ts";
import type { RunOutcome } from "./drive.ts";
import type { AiRecord, LogRecord } from "./record.ts";

/** 通話 1 つ（外へ掛けた電話の手か、着信 1 つ） */
export type TalkCall = {
  key: string;
  via: "out" | "in";
  person: string | null;
  minute: number | null;
  first: string | null;
  lines: ReadonlyArray<{ who?: string; text?: string; ai?: boolean; minute?: number }>;
};

/** 台が足した「避難所にいない」言い方（本人役の門には無い。避難所にいると言ったあとは言わない） */
const NOT_SHELTER = /避難所では(?:ない|ありません|なく)|避難所に(?:は)?(?:い(?:ない|ません)|着いてい(?:ない|ません)|移れてい(?:ない|ません))/;

/** 回の通話の全部（往復のある物だけ） */
export function talkCallsOf(outcome: Pick<RunOutcome, "replay" | "incoming">): TalkCall[] {
  const out: TalkCall[] = [];
  for (const a of outcome.replay?.actions ?? []) {
    const t = a.result?.talk;
    if (!t || t.length === 0) continue;
    out.push({ key: `action:${a.id ?? "?"}`, via: "out", person: a.person ?? null, minute: a.result?.atMinute ?? a.atMinute ?? null, first: a.result?.speech ?? null, lines: t });
  }
  for (const c of outcome.incoming ?? []) {
    if (c.lines.length === 0) continue;
    out.push({ key: `signal:${c.signal}`, via: "in", person: c.person, minute: c.minute, first: c.first, lines: c.lines });
  }
  return out;
}

/** 前に言ったいる所と食い違うか（T158） */
function drifted(said: PlaceSaid, next: PlaceSaid | null, text: string): boolean {
  if (said === "shelter") return next === "home" || next === "going" || NOT_SHELTER.test(text);
  if (said === "home") return next === "shelter" || next === "left";
  if (said === "left") return next === "home";
  return false;
}

const cut = (t: string) => Array.from(t).slice(0, 40).join("");

export type TalkNumbers = {
  /** 往復のある通話の数 */
  calls: number;
  /** 電話に出た人の返事の数（AI の物も固定の物も） */
  replies: number;
  /** 前の AI の返事とほぼ同じ AI の返事 */
  repeats: number;
  /** 同じ通話の中のいる所の食い違い */
  placeDrift: number;
  /** 往復の本人役の生の返事（数）と、そのうち送った「それまでの話」とほぼ同じ物 */
  raw: number;
  repeatRaw: number;
};

/** 11. 通話の往復の繰り返しといる所の揺れ（T158） */
export function talkHits(outcome: Pick<RunOutcome, "replay" | "incoming">, records: ReadonlyArray<LogRecord> = []): { numbers: TalkNumbers; hits: CheckHit[] } {
  const hits: CheckHit[] = [];
  let replies = 0;
  let repeats = 0;
  let drift = 0;
  const calls = talkCallsOf(outcome);
  for (const c of calls) {
    const prior: string[] = [];
    let said: PlaceSaid | null = c.first ? placeSaid(c.first) : null;
    if (said === "going") said = null;
    for (const l of c.lines) {
      if (l.who === "cm" || !l.text) continue;
      replies += 1;
      const minute = typeof l.minute === "number" ? l.minute : c.minute;
      if (l.ai && prior.some((p) => overlapOf(l.text!, p) >= REPEAT_OVERLAP)) {
        repeats += 1;
        hits.push({ check: "talk", rule: "repeat", person: c.person, minute, evidence: `${c.via}: ${cut(l.text)}` });
      }
      if (l.ai) prior.push(l.text);
      const next = placeSaid(l.text);
      if (said && drifted(said, next, l.text.normalize("NFKC"))) {
        drift += 1;
        hits.push({ check: "talk", rule: "place_drift", person: c.person, minute, evidence: `${c.via} ${said} → ${next ?? "避難所でない"}: ${cut(l.text)}` });
      }
      if (next === "home" || next === "shelter" || next === "left") said = next;
    }
  }
  const raw = rawRepeats(records);
  for (const h of raw.hits) hits.push(h);
  return { numbers: { calls: calls.length, replies, repeats, placeDrift: drift, raw: raw.checked, repeatRaw: raw.hits.length }, hits };
}

const parse = (text: string | null | undefined): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** 送った往復の文の「それまでの話」のうち、電話に出た人（ケアマネでない）の行 */
function priorOfSent(user: string): string[] {
  const input = parse(user) as { 電話?: { text?: unknown } } | null;
  const text = typeof input?.電話?.text === "string" ? input.電話.text : user;
  const at = text.indexOf("それまでの話:");
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(at).split("\n").slice(1)) {
    const m = line.match(/^- ([^:：]+)[:：] 「(.*)」$/u);
    if (!m) {
      if (!line.startsWith("- ")) break;
      continue;
    }
    if (m[1].trim() !== "ケアマネ") out.push(m[2]);
  }
  return out;
}

/** 往復の本人役の生の返事が、送った「それまでの話」とほぼ同じ（門の前の数） */
export function rawRepeats(records: ReadonlyArray<LogRecord>): { checked: number; hits: CheckHit[] } {
  const hits: CheckHit[] = [];
  let checked = 0;
  for (const r of records) {
    if (r.type !== "ai") continue;
    const a = r as AiRecord;
    if (a.role !== "persona_talk" || !a.returned) continue;
    const v = parse(a.returned.text) as { speech?: unknown } | null;
    if (typeof v?.speech !== "string" || !v.speech.trim()) continue;
    checked += 1;
    const prior = priorOfSent(a.sent.user);
    if (prior.some((p) => overlapOf(v.speech as string, p) >= REPEAT_OVERLAP)) {
      hits.push({ check: "talk", rule: "repeat_raw", role: a.role, seq: a.seq, evidence: cut(v.speech) });
    }
  }
  return { checked, hits };
}
