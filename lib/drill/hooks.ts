// 訓練の route（app/api/drill の開始と 1 刻み）が engine に渡す hooks を env から作る。
// 鍵（ANTHROPIC_API_KEY）が無ければ何も渡さない → 想定の表の固定の状況と固定の安否のまま（今までの動き）。
// 鍵があれば監督（T19、Opus × 1 刻み 1 回）と本人役（T18、Haiku × 参加者）。engine の順は 監督 → 本人役。
// 台帳は 1 要求に 1 回の batch で読み、監督と本人役で分け合う。
// getCloudflareContext を呼ばない（env と Principal を引数で受け取る。テストで node:sqlite と偽の client を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { hasAnthropicKey, type AiEnv, type ClaudeClient } from "../claude/client.ts";
import { d1UsageStore, type UsageStore } from "../claude/usage.ts";
import { pseudonymize, pseudonymizeText, restoreText, type ForClaude, type PseudonymInput, type PseudonymKey } from "../pseudonym/index.ts";
import type { ActionHooks, CallHook } from "./actions.ts";
import { drillScope } from "./db.ts";
import { stopLog, type ClockHooks, type DrillState } from "./engine.ts";
import { castFactsMap } from "./cast-facts.ts";
import { capReached, clockMarksOf, type ClockMark } from "./clock.ts";
import { quickKindOf, quickReply } from "./talk-quick.ts";
import { drillClocks } from "./world-clocks.ts";
import { clockRuns } from "./score.ts";
import { createDirectorHook } from "./director.ts";
import { createOutcomeHook, loadOutcomeSources, outageForRuns, type OutcomeSource } from "./outcome.ts";
import {
  buildPersona,
  createPersonaBatchHook,
  createPersonaHook,
  isPersonaFailure,
  loadPersonaSources,
  personaCallReply,
  personaFacts,
  personaPlaces,
  personaTalkReply,
  talkAsked,
  talkPrior,
  personaVisitReport,
  talkText,
} from "./persona.ts";
import { TALK_ASK_WORDS, type TalkHook, type TalkReply, type VisitHook } from "./dialogue.ts";
import { createWorldHook, roomClientOf, worldModeOf, type RoomClient } from "./world-room.ts";
import { gateLog } from "./person-facts.ts";

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
  // 上限で止まった役を刻みの印にする（T70）
  const stops = stopLog();
  // 帳面の門で落とした・直した数（T130、lib/drill/person-facts.ts）。engine が世界の gated に足す
  const gates = gateLog();
  return {
    stops,
    gates,
    director: createDirectorHook({ load, ai, stops, gates }),
    persona: createPersonaHook({ load, ai, stops, gates }),
    // 連続の時計の区切りの本人役はまとめて呼ぶ（T121。10 分版の刻みの道は persona のまま）
    personas: createPersonaBatchHook({ load, ai, stops, gates }),
    call: createCallHook({ load, ai }),
    // 訪問で着いたときの様子と頼み事（T93、本人役 Haiku × 1 回）
    visit: createVisitHook({ load, ai }),
    // 仮想モード（T50・T53）だけが使う。世界は部屋（Managed Agents）か 1 回呼びで、結末も世界が決める。outcome は時計の目安
    world: createWorldHook({
      mode,
      load,
      loadOutcome,
      ai,
      stops,
      ...(mode === "session" ? { room: () => ({ db: env.DB, client: opts.room ?? roomClientOf(env), ai, ...(opts.roomTime ?? {}) }) } : {}),
    }),
    outcome: createOutcomeHook({ load: loadOutcome }),
    // 連続の時計（T90）: 時計の半分・切れ（本人役の理由と「次まで」）と押せる人（巡回）。Claude を呼ばない
    clock: createClockHooks({ loadOutcome, load }),
  };
}

/**
 * 訓練の route が使う hooks。鍵があれば drillHooks、無ければ時計の目安だけ（仮想モードは世界が止まり「世界 停止」の印、結末は出ない。T53。
 * 固定の筋は outcome を使わないので、鍵が無いときの動きは今までどおり）
 */
export function drillStepHooks(env: DrillHookEnv, p: Principal | null, opts: Parameters<typeof drillHooks>[2] = {}): ActionHooks | undefined {
  const hooks = drillHooks(env, p, opts);
  if (hooks) return hooks;
  const scope = drillScope(p);
  if (!scope) return undefined;
  const loadOutcome = () => loadOutcomeSources(env.DB, scope.officeId);
  // 連続の時計（T90）の「次まで」は鍵が無くても時計の半分・切れを読む（本人役は呼ばないので押せる人は要らない）
  return { outcome: createOutcomeHook({ load: loadOutcome }), clock: createClockHooks({ loadOutcome }) };
}

/**
 * 連続の時計（T90）の口。marks は走っている時計（ルールの表と同じ時計を訓練の世界で書き換えた物。採点の clockRuns）の半分と切れの時刻、
 * pressable はスマホで押せる人のいる本人（本人役と同じ reportersOf、lib/drill/cast-facts.ts）。台帳は 1 要求に 1 回だけ読む
 */
export function createClockHooks(deps: {
  loadOutcome: () => Promise<ReadonlyMap<string, OutcomeSource>>;
  load?: () => Promise<ReadonlyMap<string, PseudonymInput>>;
}): ClockHooks {
  let outcome: Promise<ReadonlyMap<string, OutcomeSource>> | null = null;
  const load = deps.load;
  return {
    marks: async (state: DrillState): Promise<ClockMark[]> => {
      const sources = await (outcome ??= deps.loadOutcome());
      const members = state.participants.filter((p) => sources.has(p) && !state.world.ended?.[p]);
      const ledgers = members.map((p) => sources.get(p)!.ledger);
      const towns = new Map(members.map((p) => [p, sources.get(p)!.ledger.basic.address?.town ?? null] as const));
      const clocks = members.flatMap((p) => [...sources.get(p)!.clocks]);
      return clockMarksOf(clockRuns(drillClocks(clocks, state.world), towns, outageForRuns(state.world, ledgers)));
    },
    ...(load
      ? {
          pressable: async () => {
            const facts = castFactsMap(await load());
            return new Set([...facts].filter(([, f]) => f.canPress).map(([id]) => id));
          },
        }
      : {}),
  };
}

/**
 * ai_calls に行を足せた（呼んだ）かを数える包み（T118）。1 日の上限（ai_calls）と同じ物を数えるので、
 * 1 訓練の数えと ai_calls の行の数がそろう（上限で断られた呼び出しは行が無いので数えない）
 */
function tallied(ai: AskJsonContext): { ai: AskJsonContext; called: () => boolean } {
  let n = 0;
  const usage: UsageStore = {
    reserve: async (call, limit) => {
      const ok = await ai.usage.reserve(call, limit);
      if (ok) n += 1;
      return ok;
    },
    finish: (id, done) => ai.usage.finish(id, done),
    countDay: (officeId, day) => ai.usage.countDay(officeId, day),
  };
  return { ai: { ...ai, usage }, called: () => n > 0 };
}

/**
 * 電話に出た人の言う事（T18 の personaCallReply）。相手の呼び方は本人役の役割名（本人・娘・支援者 1）。
 * 台帳に無い本人・読めない台帳・Haiku の失敗は言葉なし（手の所が固定の言葉にする）。
 * 1 訓練の上限（T90 の 150）に達していれば呼ばない（言葉なし。訪問・往復と同じ）。called は Claude を呼んだか（T118。ai_calls の行で数える）
 */
export function createCallHook(deps: { load: () => Promise<ReadonlyMap<string, PseudonymInput>>; ai: AskJsonContext; on?: string }): CallHook {
  return async (ask) => {
    // 結末の人（仮想モード、T50）は出ない
    if (ask.world.ended?.[ask.person]) return { pickup: "no_answer", speech: null, ai: false, called: false };
    if (capReached(ask.world.counts)) return { pickup: ask.pickup, speech: null, ai: false, called: false };
    const tally = tallied(deps.ai);
    try {
      const sources = await deps.load();
      const source = sources.get(ask.person);
      if (!source) return { pickup: ask.pickup, speech: null, ai: false, called: false };
      // 町名は地区の別名で渡す（T88。本人役と同じ作り方）
      const persona = buildPersona(source, { ...(deps.on ? { on: deps.on } : {}), places: personaPlaces(deps.ai, sources), fit: ask.fit });
      const callee = ask.target.kind === "self" ? "本人" : (persona.roles.get(ask.target.id) ?? null);
      if (!callee) return { pickup: ask.pickup, speech: null, ai: false, called: false };
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
          ...(ask.night ? { night: true } : {}),
        },
        ask.pickup,
        tally.ai,
      );
      return { pickup: r.pickup, speech: r.speech, ai: r.ai, called: tally.called() };
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("通話の相手に失敗", e instanceof Error ? e.name : typeof e);
      return { pickup: ask.pickup, speech: null, ai: false, called: tally.called() };
    }
  };
}

/**
 * 訪問で着いたときの様子と頼み事（T93 の personaVisitReport、本人役 Haiku × 1 回）。手の所（lib/drill/actions.ts）が訪問の到着でだけ呼ぶ。
 * 結末の人・台帳に無い本人・1 訓練の上限（T90 の 150）・失敗は様子なし（聞いた安否は今までどおりコードが決める）。
 * called は Claude を呼んだか（T118。ai_calls の行で数え、手の所が counts.persona に足す）
 */
export function createVisitHook(deps: { load: () => Promise<ReadonlyMap<string, PseudonymInput>>; ai: AskJsonContext; on?: string }): VisitHook {
  return async (v) => {
    if (v.world.ended?.[v.person] || capReached(v.world.counts)) return { report: null, called: false };
    const tally = tallied(deps.ai);
    try {
      const sources = await deps.load();
      const source = sources.get(v.person);
      if (!source) return { report: null, called: false };
      const persona = buildPersona(source, { ...(deps.on ? { on: deps.on } : {}), places: personaPlaces(deps.ai, sources), fit: v.fit });
      const report = await personaVisitReport(
        persona,
        { person: v.person, hour: v.hour, world: v.world, incidents: v.incidents, state: v.state, ...(v.night ? { night: true } : {}) },
        tally.ai,
      );
      return { report, called: tally.called() };
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("訪問の様子に失敗", e instanceof Error ? e.name : typeof e);
      return { report: null, called: tally.called() };
    }
  };
}

/**
 * 通話の往復の 1 回（T93、本人役 Haiku × 1 回）。ケアマネの自由の文は事業所の全員の鍵（本人が先頭で「A さん」。本人役の説明と同じ）で
 * pseudonymizeText を通し、伏せきれなければ PseudonymLeakError を投げる（往復を断る。Claude には何も送らない）。
 * それまでの往復と今の言葉も同じ鍵でもう一度伏せてから渡す。台帳が読めない・相手が本人役の周りにいない・Claude の失敗は言葉なし
 * （talk.ts が固定の言葉にする）
 */
export function createTalkHook(deps: { load: () => Promise<ReadonlyMap<string, PseudonymInput>>; ai: AskJsonContext; on?: string }): TalkHook {
  let loaded: Promise<ReadonlyMap<string, PseudonymInput>> | null = null;
  return async (t): Promise<TalkReply> => {
    const raw = t.text?.trim() ?? "";
    const plain: TalkReply = { said: t.ask ? TALK_ASK_WORDS[t.ask] : raw, speech: null, asks: [], ai: false, called: false };
    let key: PseudonymKey;
    let persona: ReturnType<typeof buildPersona>;
    try {
      const sources = await (loaded ??= deps.load());
      const source = sources.get(t.person);
      if (!source) return plain;
      const opts = { ...(deps.on ? { on: deps.on } : {}), places: personaPlaces(deps.ai, sources) };
      persona = buildPersona(source, { ...opts, fit: t.fit });
      const others = [...sources.entries()].filter(([id]) => id !== t.person).map(([, s]) => s);
      key = pseudonymize([source, ...others], opts).key;
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("通話の往復の台帳に失敗", e instanceof Error ? e.name : typeof e);
      return plain;
    }
    // ケアマネの自由の文を伏せる。伏せきれなければここで投げる（往復を断る）
    const said = t.ask ? TALK_ASK_WORDS[t.ask] : restoreText(pseudonymizeText(raw, key).text, key);
    const callee = t.callee.kind === "self" ? "本人" : t.callee.id ? (persona.roles.get(t.callee.id) ?? null) : null;
    if (!callee) return { ...plain, said };
    // T167: 相づち・待って・聞こえますか・同じ問いなどは Haiku を呼ばずコードの短い返事（lib/drill/talk-quick.ts）。中身のある文は本人役のまま
    const quick = quickKindOf({ ...(t.ask ? { ask: t.ask } : {}), said }, t.lines);
    if (quick) return { said, speech: quickReply(quick, t.lines, t.minute), asks: [], ai: false, called: false, coded: true };
    let text: ForClaude<{ text: string }>;
    try {
      text = pseudonymizeText(
        talkText(
          {
            person: t.person,
            hour: t.minute / 60,
            world: t.world,
            incidents: [],
            state: t.state,
            callee,
            ...(t.tell ? { tell: t.tell } : {}),
            ...(t.night ? { night: true } : {}),
            first: t.first,
            lines: t.lines,
            said,
            ...(t.incoming ? { incoming: true } : {}),
            ...(t.actions ? { actions: t.actions } : {}),
          },
          persona,
        ),
        key,
      );
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("通話の往復の文に失敗", e instanceof Error ? e.name : typeof e);
      return { ...plain, said };
    }
    // T130: 帳面と食い違う文と、電気が戻ったあとの電池・電源の頼み事を落とす
    // T158: この電話の前の返事とほぼ同じ文と、もう頼んだ頼み事を落とす（Claude をもう一度呼ばない）
    const prior = { said: talkPrior(t.lines), asked: talkAsked(t.lines) };
    const r = await personaTalkReply(persona, text, key, deps.ai, personaFacts(persona, { person: t.person, world: t.world, state: t.state, actions: t.actions ?? [], now: t.minute }), prior);
    return { said, speech: r.speech, asks: r.asks, ai: r.ai, called: true };
  };
}

/**
 * 通話の往復の route（app/api/drill/[id]/talk）が使う口。鍵があり、ケアマネの役（審査員のケアマネの役も）なら作る。
 * 無ければ undefined（talk.ts が固定の言葉で往復を残す。Claude は呼ばない）
 */
export function drillTalkHook(env: DrillHookEnv, p: Principal | null, opts: { claude?: ClaudeClient; now?: () => Date } = {}): TalkHook | undefined {
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
  return createTalkHook({ load: () => (sources ??= loadPersonaSources(env.DB, scope.officeId)), ai });
}
