// 訓練の route（app/api/drill の開始と 1 刻み）が engine に渡す hooks を env から作る。
// 鍵（ANTHROPIC_API_KEY）が無ければ何も渡さない → 想定の表の固定の状況と固定の安否のまま（今までの動き）。
// 鍵があれば監督（T19、Opus × 1 刻み 1 回）と本人役（T18、Haiku × 参加者）。engine の順は 監督 → 本人役。
// 台帳は 1 要求に 1 回の batch で読み、監督と本人役で分け合う。
// getCloudflareContext を呼ばない（env と Principal を引数で受け取る。テストで node:sqlite と偽の client を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { hasAnthropicKey, type AiEnv, type ClaudeClient } from "../claude/client.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { drillScope } from "./db.ts";
import { createDirectorHook } from "./director.ts";
import type { StepHooks } from "./engine.ts";
import { createPersonaHook, loadPersonaSources } from "./persona.ts";

export type DrillHookEnv = AiEnv & { DB: D1Database };

/** 鍵があり、ケアマネの役（審査員のケアマネの役も）なら監督と本人役の hooks。無ければ undefined（固定の状況と安否） */
export function drillHooks(
  env: DrillHookEnv,
  p: Principal | null,
  opts: { claude?: ClaudeClient; now?: () => Date } = {},
): StepHooks | undefined {
  if (!hasAnthropicKey(env)) return undefined;
  const scope = drillScope(p);
  if (!scope || !p?.office) return undefined;
  const ai: AskJsonContext = {
    env,
    usage: d1UsageStore(env.DB),
    office: { id: p.office.id, kind: p.office.kind },
    ...(opts.claude ? { claude: opts.claude } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };
  let sources: Promise<ReadonlyMap<string, PseudonymInput>> | null = null;
  const load = () => (sources ??= loadPersonaSources(env.DB, scope.officeId));
  return { director: createDirectorHook({ load, ai }), persona: createPersonaHook({ load, ai }) };
}
