// AI の出力の 1 つの門（docs/tasks/T125.md）。監督・世界の部屋・1 回呼びの出来事（lib/drill/state-rules.ts の screenIncidents が
// 想定の表と世界の状態の両方で見る）、本人役の言葉（刻み・通話・往復・訪問）、自由対応の 1 文と理由を、想定の表（lib/drill/fit.ts）と
// 世界の今の状態に照らしてから画面と記録に出す。合わない文は落とし（文ごと）、落とした数は世界の gated に残す（評価の台が数える）。
// 画面の文に残った内部の名前（手の id・相手の区分の英字）は画面の名前に置き換え、置き換えられない英字の id が残る文は出さない。
// Claude を呼ばない。色と連絡順（lib/triage）には触れない（言葉を落とすだけで、安否の色・答えは変えない）。

import type { ContactKind } from "../db/types.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import { ACTION_CATALOG } from "./action-catalog.ts";
import { wordMisfit, type FitProfile, type FitWorld } from "./fit.ts";
import type { DrillTurn } from "./persona-types.ts";
import type { WorldState } from "./scenarios.ts";

/** 門を通した物の出どころ（数えの鍵の頭） */
export type GateBy = "director" | "world" | "persona" | "free";

/** 落とした数を世界に足す（鍵は「出どころ:決まり」。drills.world の JSON に入る。migration は要らない） */
export function tallyGate(world: WorldState, by: GateBy, rules: ReadonlyArray<string>): WorldState {
  if (rules.length === 0) return world;
  const gated = { ...(world.gated ?? {}) };
  for (const r of rules) gated[`${by}:${r}`] = (gated[`${by}:${r}`] ?? 0) + 1;
  return { ...world, gated };
}

// ---------- 内部の名前 ----------

/** 手の id → 画面の名前（手の表から）。長い id を先に置き換える（free が free_xxx の一部を食わないように） */
const ACTION_NAMES: ReadonlyArray<readonly [string, string]> = ACTION_CATALOG.map((r) => [r.id as string, r.label] as const).sort(
  (a, b) => b[0].length - a[0].length,
);
const CONTACT_NAMES: ReadonlyArray<readonly [string, string]> = (Object.entries(CONTACT_KIND_LABELS) as Array<[ContactKind, string]>).sort(
  (a, b) => b[0].length - a[0].length,
);

/** 英字の id らしい物（下線つきの英小文字・単語の free・note） */
const LEFT_ID = /(?<![A-Za-z0-9])(?:[a-z][a-z0-9]*_[a-z0-9_]+|free|note)(?![A-Za-z0-9])/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 文の中の手の id・相手の区分の英字を画面の名前に。置き換えられない英字の id が残れば null */
export function nameIds(text: string): string | null {
  let t = text;
  for (const [id, label] of [...ACTION_NAMES, ...CONTACT_NAMES]) {
    if (!t.includes(id)) continue;
    t = t.replace(new RegExp(`(?<![A-Za-z0-9_])${escape(id)}(?![A-Za-z0-9_])`, "g"), label);
  }
  return LEFT_ID.test(t) ? null : t;
}

// ---------- 文の門 ----------

/** 文の区切り（句点・感嘆・疑問）。区切りの字は前の文に付ける（lib/drill/persona.ts と同じ） */
const sentencesOf = (t: string): string[] => t.split(/(?<=[。！？!?])/u).filter((x) => x.trim() !== "");

/**
 * 文を想定と内部の名前で見る。合わない文・内部の名前が残る文は落とし、残りを返す（全部落ちれば null）。
 * dropped は落とした決まりの名前（「fit:quake_word」「internal_id」）
 */
export function gateWords(text: string | null | undefined, profile: FitProfile | null, world: FitWorld): { text: string | null; dropped: string[] } {
  if (text === null || text === undefined) return { text: null, dropped: [] };
  if (!text.trim()) return { text, dropped: [] };
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const s of sentencesOf(text)) {
    const mis = wordMisfit(profile, s, world);
    if (mis) {
      dropped.push(mis);
      continue;
    }
    const named = nameIds(s);
    if (named === null) {
      dropped.push("internal_id");
      continue;
    }
    kept.push(named);
  }
  if (dropped.length === 0) return { text, dropped };
  const joined = kept.join("").trim();
  return { text: joined || null, dropped };
}

/**
 * 本人役の安否の言う事・する事を門に通す（色・答え・いる所は変えない）。言う事が全部落ちたら言う事なし（電話の形でなくなる）
 */
export function gateTurns(turns: ReadonlyArray<DrillTurn>, profile: FitProfile | null, world: FitWorld): { turns: DrillTurn[]; dropped: string[] } {
  const dropped: string[] = [];
  const out = turns.map((t) => {
    if (!t.ai) return t;
    const s = gateWords(t.saying, profile, world);
    const d = gateWords(t.doing, profile, world);
    if (s.dropped.length === 0 && d.dropped.length === 0) return t;
    dropped.push(...s.dropped, ...d.dropped);
    return { ...t, saying: s.text, doing: d.text };
  });
  return { turns: out, dropped };
}
