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
  /** SDK の再試行の回数。無ければ lib/claude/client.ts の MAX_RETRIES（1 回）。録音のまとめは 0（waitUntil の 30 秒に収める。T69b） */
  maxRetries?: number;
};

/**
 * effort は分類（low）と本人役（medium）のほかは high（docs/DECISIONS.md 11/4 00:5x 確定、本人役は 11/4 16:4x 案）。
 * high は考える分が増え、考えた分も maxTokens に入る（超えると AiBadOutput の max_tokens で、再試行しない）。
 * 待ちと上限の決め方は docs/progress/t67.md:
 * - Opus・Sonnet の high は 16000・180 秒にそろえる（前から high だった様式の読み取り・講評と同じ）
 * - 本人役（Haiku）は 8000・90 秒。訓練の 1 刻みで 10 人を Promise.all で呼ぶが、Workers の 1 要求は外への接続を
 *   同時に 6 本までしか開かず、残りの 4 人は前の呼び出しが終わるまで待つ。SDK の待ちは並ぶ前から数えるので 2 回分を見る
 * - 訓練の 1 要求（監督 → 本人役）は、ブラウザの fetch に待ちの上限が無く、Workers も接続が続く間は待てる（CPU の上限は
 *   API の待ちを数えない）ので、長くなっても切れない。切れるのはここに書いた待ちだけ
 */
export const PURPOSES: Readonly<Record<ClaudePurpose, PurposeSpec>> = {
  // 様式の写真・PDF から欄の対応表を作る（T08）
  form_read: { model: OPUS, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 訓練の監督: 出来事の差し込み、世界の状態（T19）。仮想モードの世界の 1 回呼び（world-oneshot.ts）もこれ
  director: { model: OPUS, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 訓練の採点とレビュー（T22）
  scoring: { model: OPUS, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 入れる欄: 文字・貼り付け・話した物を項目に分ける（T03）。写真・PDF の読み取り（lib/intake/read.ts）は Opus でこれを使う
  ledger_input: { model: SONNET, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 要約・記入欄の分け方（T07 など。アンケートの集計 tools/survey/summarize.ts がこの用途で Sonnet を呼ぶ）。
  // 録音のまとめ（T69b）も同じ用途で数えるが、待ちと上限は下の RECORDING_SUMMARY で呼ぶ（要求ごとの spec）
  summary: { model: SONNET, effort: "high", maxTokens: 16000, timeoutMs: 180_000 },
  // 訓練の本人役・家族役の 1 刻み（T18）と、電話に出た人の言う事（T20）。
  // effort は medium（T89）。固定の筋の 1 刻みは 監督（Opus）→ 本人役（10 人）の順で、本人役は監督の差し込みを読むので並べられない。
  // 手元の試験で、本人役を high → medium にすると 10 分版の 1 刻みが平均 27.9 → 22.8 秒になり、本人役の返事の質は保った。
  // 電話に出た人の言う事（1 回）も同じ medium。待ちと上限（8000・90 秒）は high のときのまま（余裕を見る）
  persona: { model: HAIKU, effort: "medium", maxTokens: 8000, timeoutMs: 90_000 },
  // 録音と自由文を 5 つに分ける（T12）。録音の応答のあとに waitUntil で走らせ、Workers が応答のあとに待つ 30 秒に
  // 再試行（1 回）込みで収める（12 秒 × 2）。短い文 1 つの分類で、これを超えたら分類なし（AI 失敗）にする。
  // このため分類だけは high にせず low のまま（11/4 00:5x。high にすると考える分で 12 秒を超えやすい）
  classify: { model: HAIKU, effort: "low", maxTokens: 4000, timeoutMs: 12_000 },
};

/**
 * 録音のまとめ（T69b）の呼び方。用途は summary（ai_calls の CHECK はそのまま）で、要求に spec として渡す（lib/classify/summary.ts）。
 * 録音の応答のあとに分類と並べて waitUntil で走らせ、Workers が応答のあとに待つ 30 秒に収める。summary の Sonnet・16000・180 秒
 * （アンケートの集計が使う）は収まらないので、Haiku・high・4000・20 秒・再試行なし（失敗は「まとめ なし」で、ケアマネが「生成」で呼び直す）
 */
export const RECORDING_SUMMARY: PurposeSpec = { model: HAIKU, effort: "high", maxTokens: 4000, timeoutMs: 20_000, maxRetries: 0 };

/**
 * 断られた（stop_reason が refusal）ときにサーバー側で別のモデルに回す設定を送るモデル。
 * Haiku 5.5 には回す先が無く、送っても断られたままなので送らない（skill claude-api）。
 */
export const SERVER_FALLBACK_MODELS: ReadonlySet<ClaudeModel> = new Set([OPUS, SONNET]);
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
