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
import type { ActionHooks, CallHook } from "./actions.ts";
import { drillScope } from "./db.ts";
import { createDirectorHook } from "./director.ts";
import { createOutcomeHook, loadOutcomeSources, type OutcomeSource } from "./outcome.ts";
import { buildPersona, createPersonaHook, isPersonaFailure, loadPersonaSources, personaCallReply } from "./persona.ts";
import { createWorldHook, roomClientOf, worldModeOf, type RoomClient } from "./world-room.ts";

/** DRILL_WORLD: 仮想モードの世界の道（session 既定 = Managed Agents の部屋・messages = 1 回呼び・off = 世界を動かさない） */
export type DrillHookEnv = AiEnv & { DB: D1Database; DRILL_WORLD?: string };

/**
 * 鍵があり、ケアマネの役（審査員のケアマネの役も）なら監督と本人役の hooks。無ければ undefined（固定の状況と安否）。
 * call はケアマネの手（T20）の電話に出た人の言う事（本人役 Haiku × 1 回）。刻みの route は使わない
 */
export function drillHooks(
  env: DrillHookEnv,
  p: Principal | null,
  opts: {
    claude?: ClaudeClient;
    now?: () => Date;
    /** 世界の部屋の client と待ち・時計（テストの差し替え口） */
    room?: RoomClient;
    roomTime?: { sleep: (ms: number) => Promise<void>; clock: () => number };
  } = {},
): ActionHooks | undefined {
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
  let outcomeSources: Promise<ReadonlyMap<string, OutcomeSource>> | null = null;
  const loadOutcome = () => (outcomeSources ??= loadOutcomeSources(env.DB, scope.officeId));
  const mode = worldModeOf(env.DRILL_WORLD);
  return {
    director: createDirectorHook({ load, ai }),
    persona: createPersonaHook({ load, ai }),
    call: createCallHook({ load, ai }),
    // 仮想モード（T50）だけが使う。世界は部屋（Managed Agents）か 1 回呼び、結末はコードの計算
    world: createWorldHook({
      mode,
      load,
      loadOutcome,
      ai,
      ...(mode === "session" ? { room: () => ({ db: env.DB, client: opts.room ?? roomClientOf(env), ai, ...(opts.roomTime ?? {}) }) } : {}),
    }),
    outcome: createOutcomeHook({ load: loadOutcome }),
  };
}

/**
 * 訓練の route が使う hooks。鍵があれば drillHooks、無ければ結末の計算だけ（仮想モードの結末は Claude を使わないので鍵が無くても出す。
 * 固定の筋は outcome を使わないので、鍵が無いときの動きは今までどおり）
 */
export function drillStepHooks(env: DrillHookEnv, p: Principal | null, opts: Parameters<typeof drillHooks>[2] = {}): ActionHooks | undefined {
  const hooks = drillHooks(env, p, opts);
  if (hooks) return hooks;
  const scope = drillScope(p);
  if (!scope) return undefined;
  return { outcome: createOutcomeHook({ load: () => loadOutcomeSources(env.DB, scope.officeId) }) };
}

/**
 * 電話に出た人の言う事（T18 の personaCallReply）。相手の呼び方は本人役の役割名（本人・娘・支援者 1）。
 * 台帳に無い本人・読めない台帳・Haiku の失敗は言葉なし（手の所が固定の言葉にする）
 */
export function createCallHook(deps: { load: () => Promise<ReadonlyMap<string, PseudonymInput>>; ai: AskJsonContext; on?: string }): CallHook {
  return async (ask) => {
    // 結末の人（仮想モード、T50）は出ない
    if (ask.world.ended?.[ask.person]) return { pickup: "no_answer", speech: null, ai: false };
    try {
      const source = (await deps.load()).get(ask.person);
      if (!source) return { pickup: ask.pickup, speech: null, ai: false };
      const persona = buildPersona(source, deps.on ? { on: deps.on } : {});
      const callee = ask.target.kind === "self" ? "本人" : (persona.roles.get(ask.target.id) ?? null);
      if (!callee) return { pickup: ask.pickup, speech: null, ai: false };
      const r = await personaCallReply(
        persona,
        {
          person: ask.person,
          hour: ask.hour,
          world: ask.world,
          incidents: ask.incidents,
          state: ask.state,
          callee,
          ...(ask.tell ? { tell: ask.tell } : {}),
        },
        ask.pickup,
        deps.ai,
      );
      return { pickup: r.pickup, speech: r.speech, ai: r.ai };
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("通話の相手に失敗", e instanceof Error ? e.name : typeof e);
      return { pickup: ask.pickup, speech: null, ai: false };
    }
  };
}
