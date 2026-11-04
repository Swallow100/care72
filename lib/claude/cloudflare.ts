// 配信先（と next dev）で Cloudflare の env と D1 を読み、AI の層に渡す形にする。
// 鍵は env にだけある（配信は secret、手元は .dev.vars）。値を画面・ログ・応答に出さない。
// テストはここを通らない（getCloudflareContext は OpenNext の外では動かない）。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { OfficeKind } from "../db/types.ts";
import { hasAnthropicKey } from "./client.ts";
import { aiStatusOf, type AiStatus } from "./status.ts";
import { readAiStatus } from "./status-read.ts";
import { d1UsageStore, type AiContext } from "./usage.ts";

/** 事業所の AI の呼び出しに要る物。事業所が無ければ投げる */
export async function aiContextFor(officeId: string): Promise<AiContext> {
  const { env } = await getCloudflareContext({ async: true });
  const office = await env.DB.prepare("SELECT id, kind FROM offices WHERE id = ?1")
    .bind(officeId)
    .first<{ id: string; kind: OfficeKind }>();
  if (!office) throw new Error("事業所が無い");
  return { env, usage: d1UsageStore(env.DB), office };
}

/**
 * 事業所の AI の今の状態（未設定・上限到達・本日残り。lib/claude/status.ts）。画面はどれもこれを読む（T76）。
 * 鍵が無ければ D1 を読まずに未設定。事業所・回数が読めなければ使える（残りなし）として、画面を止めない
 */
export async function aiStatusFor(officeId: string): Promise<AiStatus> {
  const { env } = await getCloudflareContext({ async: true });
  if (!hasAnthropicKey(env)) return aiStatusOf(false, null);
  try {
    return await readAiStatus(await aiContextFor(officeId));
  } catch (e) {
    console.error("AI の状態を読めない", e instanceof Error ? e.name : typeof e);
    return aiStatusOf(true, null);
  }
}
