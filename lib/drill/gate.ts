// AI の出力の 1 つの門（docs/tasks/T125.md）。監督・世界の部屋・1 回呼びの出来事（lib/drill/state-rules.ts の screenIncidents が
// 想定の表と世界の状態の両方で見る）、本人役の言葉（刻み・通話・往復・訪問）、自由対応の 1 文と理由を、想定の表（lib/drill/fit.ts）と
// 世界の今の状態に照らしてから画面と記録に出す。合わない文は落とし（文ごと）、落とした数は世界の gated に残す（評価の台が数える）。
// 画面の文に残った内部の名前（手の id・相手の区分の英字）は画面の名前に置き換え、置き換えられない英字の id が残る文は出さない。
// Claude を呼ばない。色と連絡順（lib/triage）には触れない（言葉を落とすだけで、安否の色・答えは変えない）。

import type { ContactKind } from "../db/types.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import { ACTION_CATALOG, CATALOG_LABELS, FIXED_CALLEE_LABELS, FREE_LABELS } from "./action-catalog.ts";
import { FREE_WAY_LABELS, FREE_WAYS } from "./action-terms.ts";
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

// ---------- 内部の名前（T125 の門。自由対応の口 T129 の plainWords もここを呼ぶ） ----------

/**
 * 手・相手・固定の相手・やり方・効き目の内部の名前 → 画面の言葉（T129 の言い方の表をここに 1 つ）。長い名前から当てる（advise_119 を先に）
 */
const INNER_NAMES: ReadonlyMap<string, string> = new Map(
  [
    ...ACTION_CATALOG.map((r): [string, string] => [r.id, CATALOG_LABELS[r.id]]),
    ...(Object.entries(CONTACT_KIND_LABELS) as Array<[ContactKind, string]>),
    ...(Object.entries(FIXED_CALLEE_LABELS) as Array<[string, string]>),
    ...FREE_WAYS.map((w): [string, string] => [w, FREE_WAY_LABELS[w]]),
    ["home", "家"] as [string, string],
    ["move", "避難"] as [string, string],
    ["none", FREE_LABELS.idle] as [string, string],
    ["reach", "到達"] as [string, string],
    ["arrival", "到着"] as [string, string],
  ].sort((a, b) => b[0].length - a[0].length),
);
const INNER_RE = new RegExp(`(?<![A-Za-z0-9_])(?:${[...INNER_NAMES.keys()].join("|")})(?![A-Za-z0-9_])`, "g");

/**
 * 文の中の内部の名前（英字の id）を画面の名前に置き換える。置き換えたあとに英字の id らしい語（「_」を含む語、小文字を含む 3 字以上の語）
 * が残れば null（出さない）。大文字だけの略語（AED）と 2 字までの単位（km）は残す
 */
export function nameIds(text: string): string | null {
  const out = text.replace(INNER_RE, (m) => INNER_NAMES.get(m) ?? m);
  const tokens = out.match(/[A-Za-z0-9_]+/g) ?? [];
  const inner = tokens.some((t) => t.includes("_") || (/[a-z]/.test(t) && t.replace(/[0-9]/g, "").length >= 3));
  return inner ? null : out;
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
