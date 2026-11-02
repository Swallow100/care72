// Claude のモデルと、用途ごとの既定（CLAUDE.md「作り」、docs/tasks/T00.md）。
// モデル名は Claude Code の skill claude-api の表のとおり（日付を付けない名前）。
// 用途を足すときは lib/db/types.ts の AI_PURPOSES と migrations の ai_calls の CHECK にも足す。

import type { AiPurpose } from "../db/types.ts";

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-5-5";

export const CLAUDE_MODELS = [OPUS, SONNET, HAIKU] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

/** Claude で呼ぶ用途（声は Gemini なので除く） */
export type ClaudePurpose = Exclude<AiPurpose, "voice">;

/**
 * output_config.effort。考える深さと token の量を決める。
 * Opus 5.5 と Haiku 5.5 は書かないと medium になるので、用途ごとに必ず書く。
 * 考える（adaptive thinking）は 3 つのモデルとも既定で入る。thinking は送らない（Opus 5.5 は止めると 400）。
 */
export type Effort = "low" | "medium" | "high";

export type PurposeSpec = {
  model: ClaudeModel;
  effort: Effort;
  /** 考える分も含めた出力の上限。stream しない呼び方なので 16000 まで */
  maxTokens: number;
  /** 1 回の待ち（ミリ秒）。SDK の再試行（1 回）があるので、最長でこの倍 */
  timeoutMs: number;
};

export const PURPOSES: Readonly<Record<ClaudePurpose, PurposeSpec>> = {
  // 様式の写真・PDF から欄の対応表を作る（T08）
  form_read: { model: OPUS, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 訓練の監督: 出来事の差し込み、世界の状態（T19）
  director: { model: OPUS, effort: "medium", maxTokens: 16000, timeoutMs: 120_000 },
  // 訓練の採点とレビュー（T22）
  scoring: { model: OPUS, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 入れる欄: 文字・貼り付け・話した物を項目に分ける（T03）
  ledger_input: { model: SONNET, effort: "medium", maxTokens: 16000, timeoutMs: 120_000 },
  // 要約の短縮（T07 など）
  summary: { model: SONNET, effort: "low", maxTokens: 8000, timeoutMs: 90_000 },
  // 訓練の本人役・家族役の 1 刻み（T18）
  persona: { model: HAIKU, effort: "low", maxTokens: 4000, timeoutMs: 60_000 },
  // 録音と自由文を 5 つに分ける（T12）。録音の応答のあとに waitUntil で走らせ、Workers が応答のあとに待つ 30 秒に
  // 再試行（1 回）込みで収める（12 秒 × 2）。短い文 1 つの分類で、これを超えたら分類なし（AI 失敗）にする
  classify: { model: HAIKU, effort: "low", maxTokens: 4000, timeoutMs: 12_000 },
};

/**
 * 断られた（stop_reason が refusal）ときにサーバー側で別のモデルに回す設定を送るモデル。
 * Haiku 5.5 には回す先が無く、送っても断られたままなので送らない（skill claude-api）。
 */
export const SERVER_FALLBACK_MODELS: ReadonlySet<ClaudeModel> = new Set([OPUS, SONNET]);
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
