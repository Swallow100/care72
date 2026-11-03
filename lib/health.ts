// /api/health の中身（app/api/health/route.ts）。手元と配信先で binding と鍵が見えているか、配信中の commit と build の時刻。
// 値や秘密は返さない（有る・無いだけ）。route は getCloudflareContext を呼ぶのでテストはここを通す。
// 配信の確かめ（tools/deploy/check-remote.mjs・rebuild-remote.sh）がこの形を読む。

import { hasAnthropicKey, hasGeminiKey, type AiEnv } from "./claude/client.ts";

export type HealthEnv = AiEnv & { DB?: unknown; RECORDINGS?: unknown };

export type BuildInfo = {
  /** 短い hash（7 字）。git が無い build は "unknown" */
  commit: string;
  /** build の時刻（ISO 8601、UTC） */
  builtAt: string;
};

export type HealthBody = {
  ok: true;
  commit: string;
  builtAt: string;
  bindings: { DB: boolean; RECORDINGS: boolean };
  ai: { anthropic: boolean; gemini: boolean };
};

export function healthBody(env: HealthEnv, build: BuildInfo): HealthBody {
  return {
    ok: true,
    commit: build.commit,
    builtAt: build.builtAt,
    bindings: {
      DB: Boolean(env.DB),
      RECORDINGS: Boolean(env.RECORDINGS),
    },
    ai: {
      anthropic: hasAnthropicKey(env),
      gemini: hasGeminiKey(env),
    },
  };
}
