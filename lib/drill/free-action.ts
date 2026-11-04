// 自由に書く手（docs/tasks/T91.md の 4）。表に無い対応をケアマネが文で書き、監督役の Claude（Opus、用途 director）が
// 「手の表のどの手に当たるか」だけを読み替える。世界の変化と結果（届いた・届かない）は読み替えた手の表の行と確率でコードが決める
// （lib/drill/actions.ts の act。Claude が世界を変える道は作らない）。
//
// 線:
// - ケアマネが打った文が Claude に渡る初めての口。必ず仮名化の門（lib/pseudonym の pseudonymizeText → lib/claude/call.ts の askJson）を通し、
//   伏せきれない文（PseudonymLeakError）は手を断る（API は 400「伏字不可」。黙って送らない）。メモ（T59）は今までどおり渡さない
// - 文（record.text）と読み替えの理由（record.reason）はサーバーの中だけ。engine の withoutMemo が落とすので、
//   監督・世界・本人役・講評に渡るのは kind free と読み替えた手の id（as）と表の言い方だけ
// - 「119 を呼ぶ」「救急車を呼んだ」に当たる文は 119勧奨（advise_119）に落とす。救急が来た・運ばれた、の結果は作らない
// - 表に無い手・その本人に使えない手・相手の区分が無い物は記録（note）に落とす
// - 1 訓練 10 回まで（world.counts.free）。超えたら・1 訓練の上限（T90 の 150）に達したら・鍵が無ければ、読み替えずに記録

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import type { Principal } from "../auth/principal.ts";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { hasAnthropicKey, type AiEnv, type ClaudeClient } from "../claude/client.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { ContactKind, DrillAction } from "../db/types.ts";
import { CONTACT_KIND_LABELS } from "../labels.ts";
import {
  pseudonymize,
  pseudonymizeText,
  PseudonymLeakError,
  restoreText,
  sealItemCatalog,
  type ForClaude,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { ACTION_CATALOG, actionRow, FREE_MAX, FREE_TEXT_MAX, isCatalogAction } from "./action-catalog.ts";
import type { ActTarget } from "./actions.ts";
import { drillScope } from "./db.ts";
import { clockLabel, PHONE_LABELS } from "./labels.ts";
import { cleanWords, isPersonaFailure, loadPersonaSources, personaPlaces } from "./persona.ts";
import type { DrillCounts, WorldState } from "./scenarios.ts";

// ---------- 言葉と上限 ----------

export { FREE_LABELS } from "./action-catalog.ts";

/** 画面の 1 文（Claude の現場の言い方）の長さの上限（字） */
export const FREE_WORDS_MAX = 30;
/** 読み替えの理由の長さの上限（字。サーバーの中だけ） */
export const FREE_REASON_MAX = 60;
/**
 * 1 訓練の AI の呼び出しの上限（T90 の lib/drill/clock.ts の DRILL_CALL_CAP と同じ数）。counts の合計がこれに達したら読み替えない。
 * T90 の本体が入ったら、そちらの定数を読む形に寄せる
 */
const DRILL_CALL_CAP = 150;

/** 119 を呼ぶ・救急車に当たる文（コードで見る。Claude の読み替えより先） */
const CALL_119 = /119|１１９|救急/;

/** 画面の 1 文に書かせない物（救急が来た・運ばれた・人の生き死に） */
const WORDS_DANGER = /救急車|搬送|運ばれ|亡くな|死亡|死ん|心肺停止|意識が(?:ない|無い)/;

// ---------- その本人に使える手 ----------

/** Claude に渡す手の一覧の 1 行（名前と言い方は表から。相手の区分はその本人の台帳の連絡先にある物だけ） */
export type FreeChoice = { id: DrillAction; label: string; words: string; callees: ReadonlyArray<ContactKind> };

/**
 * その本人に使える手（自由対応のほか）。本人が要る手は本人を選んだときだけ、相手の連絡先が要る手は台帳に相手の区分があるときだけ。
 * 画面（ActionPanel）の押せる・押せないと同じ決め
 */
export function freeChoices(person: string | null, contacts: ReadonlyArray<ActTarget>): FreeChoice[] {
  return ACTION_CATALOG.flatMap((row): FreeChoice[] => {
    if (row.id === "free") return [];
    if (row.needsPerson && !person) return [];
    const callees = person ? [...new Set(contacts.filter((c) => row.targetKinds.includes(c.kind)).map((c) => c.kind))] : [];
    if (row.needsTarget && callees.length === 0) return [];
    return [{ id: row.id, label: row.label, words: row.words, callees }];
  });
}

/** 119勧奨の相手の順（読み替えで相手の区分が無いとき） */
const CALL_119_ORDER: ReadonlyArray<ContactKind> = ["self", "family", "supporter"];

/** 相手の区分から台帳の連絡先を 1 つ（番号のある物を先に） */
function pickTarget(contacts: ReadonlyArray<ActTarget>, kinds: ReadonlyArray<ContactKind>): ActTarget | null {
  for (const k of kinds) {
    const hit = contacts.find((c) => c.kind === k && c.hasPhone) ?? contacts.find((c) => c.kind === k);
    if (hit) return hit;
  }
  return null;
}

/** 読み替えた手と相手（表に無い・使えない・相手の無い物は記録） */
export type FreeResolved = { as: DrillAction; target: ActTarget | null };

const NOTE: FreeResolved = { as: "note", target: null };

/**
 * Claude の読み替え（kind・callee）を、表の手と台帳の相手に決める。119 に当たる文は Claude の答えに関わらず 119勧奨
 * （相手が無ければ記録）。読み替えが無い（鍵なし・失敗・上限）なら記録
 */
export function resolveFree(
  reading: { kind: string; callee: string } | null,
  ctx: { text: string; person: string | null; contacts: ReadonlyArray<ActTarget> },
): FreeResolved {
  const to119 = CALL_119.test(ctx.text);
  const kind = to119 ? "advise_119" : (reading?.kind.trim() ?? "");
  if (!isCatalogAction(kind) || kind === "free") return NOTE;
  const choice = freeChoices(ctx.person, ctx.contacts).find((c) => c.id === kind);
  if (!choice) return NOTE;
  const row = actionRow(kind);
  if (row.targetKinds.length === 0) return { as: kind, target: null };
  const callee = reading?.callee.trim() ?? "";
  if ((choice.callees as ReadonlyArray<string>).includes(callee)) return { as: kind, target: pickTarget(ctx.contacts, [callee as ContactKind]) };
  // 119 はコードが決めたので、相手の区分が無ければ本人・家族・支援者の順で台帳から
  if (to119) return { as: kind, target: pickTarget(ctx.contacts, CALL_119_ORDER) };
  // 相手の区分が無い・台帳に無い: 相手が要る手は記録。本人電話は本人、固定の相手のある手（訪問依頼・移送・電源）は固定の相手
  if (row.needsTarget) return NOTE;
  return { as: kind, target: kind === "call_person" ? pickTarget(ctx.contacts, ["self"]) : null };
}

// ---------- 世界の事実（名前を書かない） ----------

/** その時に分かっている世界の事実（電話の様子・家の電話・家の前の道・職員の空き）。名前・町名は書かない */
export function freeFacts(world: WorldState, person: string | null, minute: number): string {
  const lines = [`時刻: 発災から ${clockLabel(minute)}`, `電話: ${PHONE_LABELS[world.phone]}`];
  if (person) {
    if (world.marks[person]?.lineDown !== undefined) lines.push("家の電話: 不通");
    const road = world.roads.find((r) => r.person === person && !r.open);
    lines.push(`家の前の道: ${road ? "通行止" : "通れる"}`);
  }
  lines.push(`職員の空き: ${world.staff} 人`);
  return lines.join("\n");
}

// ---------- Claude に頼む ----------

export type FreeAsk = {
  /** ケアマネの文（120 字まで、仮名化の前。サーバーの中だけ） */
  text: string;
  /** 相手の本人（任意） */
  person: string | null;
  /** 訓練の参加者（仮名の並び） */
  participants: ReadonlyArray<string>;
  /** その本人に使える手 */
  choices: ReadonlyArray<FreeChoice>;
  /** その時に分かっている世界の事実（freeFacts） */
  facts: string;
};

/** Claude の読み替え（形を確かめたあと。kind と callee はまだ表で絞る前） */
export type FreeReading = { kind: string; callee: string; text: string | null; reason: string | null };

/**
 * 読み替えの返事。stored は伏せた文を氏名に戻した物（手の記録の text。サーバーの中だけ）。reading は失敗なら null（記録に落とす）。
 * 伏せきれない文は PseudonymLeakError を投げる（手を断る）
 */
export type FreeReply = { stored: string; reading: FreeReading | null };
export type FreeHook = (ask: FreeAsk) => Promise<FreeReply>;

export const FREE_SYSTEM = [
  "あなたは災害の訓練の監督役。ケアマネが訓練の中で文で書いた対応を、手の一覧のどの手に当たるかに読み替える。",
  "入力: 文（ケアマネの文。人は仮名）、手（この本人に使える手の一覧。id・名前・中身・相手の区分）、事実（その時に分かっている世界の事実と、本人の仮名）。",
  "",
  "返す物:",
  "- kind: 手の一覧の id 1 つ。当たる手が無ければ note（記録）。",
  "- callee: その手の相手の区分（手の一覧の「相手」の区分）から 1 つ。相手の一覧が空の手は空の文字。",
  "- text: ケアマネが何をしたかを、現場の言い方の 1 文で（30 字まで）。結果（つながった・着いた・受けてもらえた）は書かない。結果はコードが決める。",
  "- reason: なぜその手に読み替えたか（60 字まで）。",
  "",
  "決まり:",
  "1. kind は手の一覧の id か note だけ。一覧に無い手を作らない。",
  "2. 119 を呼ぶ・救急車を呼んだ、に当たる文は advise_119（119 への連絡を勧める）。救急が来た・運ばれた、は書かない。",
  "3. 文がいくつもの手を書いていたら、最初に打つ手 1 つ。",
  "4. 仮名・名前・場所の名前・電話番号を書かない。診断・病名・薬の量・医療の助言を書かない。人の生き死にを書かない。",
].join("\n");

/** 返事の形。kind・callee は文字にし、表と台帳でコードが絞る（enum にすると外の値 1 つで返事全部が形の違いになる。T18 と同じ） */
export const FreeSchema = z.object({
  kind: z.string(),
  callee: z.string(),
  text: z.string(),
  reason: z.string(),
});
export type FreeAnswer = z.output<typeof FreeSchema>;

type FreeInput = { 文: ForClaude<{ text: string }>; 手: ForClaude<object>; 事実: ForClaude<{ text: string }> };

/** Claude に渡す要求。入力は伏せた文と、人の値を含まない手の一覧だけ（型で縛る）。用途 director（Opus） */
export function buildFreeRequest(input: FreeInput): AskJsonRequest<typeof FreeSchema> {
  return { purpose: "director", system: FREE_SYSTEM, input, schema: FreeSchema };
}

/** 手の一覧（人の値を含まない。相手は区分と言い方だけ） */
export function choicesCatalog(choices: ReadonlyArray<FreeChoice>) {
  return sealItemCatalog({
    一覧: choices.map((c) => ({
      id: c.id,
      名前: c.label,
      中身: c.words,
      相手: c.callees.map((k) => ({ 区分: k, 言い方: CONTACT_KIND_LABELS[k] })),
    })),
  });
}

/** 返事を確かめる。画面の 1 文は本人役と同じ掃除（仮名は「本人」、使わない言葉・元の情報が残る物は捨てる）。理由は氏名に戻して長さで切る */
export function readingOf(answer: FreeAnswer, key: PseudonymKey): FreeReading {
  const raw = answer.text.replace(/\s+/g, " ").trim();
  const text = raw && !WORDS_DANGER.test(raw) ? cleanWords(raw, key, FREE_WORDS_MAX) : null;
  const reason = Array.from(restoreText(answer.reason.replace(/\s+/g, " ").trim(), key)).slice(0, FREE_REASON_MAX).join("");
  return { kind: answer.kind.trim(), callee: answer.callee.trim(), text, reason: reason || null };
}

export type FreeDeps = {
  /** 事業所の本人の台帳（仮名化の前）。本人役・監督と同じ物 */
  load: () => Promise<ReadonlyMap<string, PseudonymInput>>;
  ai: AskJsonContext;
  /** 年齢を数える日（JST、YYYY-MM-DD）。無ければ今日 */
  on?: string;
};

/**
 * 自由対応の読み替えの口（1 要求ごと）。参加者を先に、事業所のほかの本人も並べて伏せる（文に誰の名前が書かれても伏せる）。
 * 伏せきれない文は PseudonymLeakError（断る）。台帳が読めない・仮名化の前の台帳に漏れがある・Claude の失敗は読み替えなし（記録）
 */
export function createFreeHook(deps: FreeDeps): FreeHook {
  let loaded: Promise<ReadonlyMap<string, PseudonymInput>> | null = null;
  return async (ask): Promise<FreeReply> => {
    let key: PseudonymKey;
    try {
      const sources = await (loaded ??= deps.load());
      const ids = [...ask.participants.filter((p) => sources.has(p)), ...[...sources.keys()].filter((p) => !ask.participants.includes(p))];
      if (ids.length === 0) return { stored: ask.text, reading: null };
      key = pseudonymize(
        ids.map((p) => sources.get(p)!),
        { ...(deps.on ? { on: deps.on } : {}), places: personaPlaces(deps.ai, sources) },
      ).key;
    } catch (e) {
      console.error("自由対応の台帳に失敗", e instanceof Error ? e.name : typeof e);
      return { stored: ask.text, reading: null };
    }
    // ケアマネの文を伏せる。伏せきれなければここで投げる（手を断る。Claude には何も送らない）
    const masked = pseudonymizeText(ask.text, key);
    const stored = restoreText(masked.text, key);
    try {
      const alias = ask.person ? (key.people.find((p) => p.personId === ask.person)?.alias ?? null) : null;
      const facts = pseudonymizeText([`本人: ${alias ?? "なし（全体の対応）"}`, ask.facts].join("\n"), key);
      const r = await askJson(buildFreeRequest({ 文: masked, 手: choicesCatalog(ask.choices), 事実: facts }), deps.ai);
      return { stored, reading: readingOf(r.value, key) };
    } catch (e) {
      if (!isPersonaFailure(e) && !(e instanceof PseudonymLeakError)) console.error("自由対応の読み替えに失敗", e instanceof Error ? e.name : typeof e);
      return { stored, reading: null };
    }
  };
}

/** 訓練の手の route が使う自由対応の口。鍵があり、ケアマネの役（審査員のケアマネの役も）なら作る。無ければ undefined（記録に落とす） */
export function drillFreeHook(
  env: AiEnv & { DB: D1Database },
  p: Principal | null,
  opts: { claude?: ClaudeClient; now?: () => Date } = {},
): FreeHook | undefined {
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
  return createFreeHook({ load: () => (sources ??= loadPersonaSources(env.DB, scope.officeId)), ai });
}

// ---------- 手の所（lib/drill/actions.ts の act）が呼ぶ ----------

/** 読み替えの結果。called は Claude の口を呼んだか（counts.free に数える） */
export type FreeOutcome = FreeResolved & {
  /** 手の記録の text（伏せて戻した文。鍵が無ければ打った文のまま。サーバーの中だけ） */
  stored: string;
  /** 画面の 1 文（Claude の現場の言い方、AI の印）。無ければ固定の文 */
  words: string | null;
  /** 読み替えの理由（サーバーの中だけ） */
  reason: string | null;
  called: boolean;
};

const ZERO_COUNTS: DrillCounts = { director: 0, persona: 0, call: 0, free: 0 };

/** この訓練でまだ読み替えを頼めるか（10 回と 1 訓練の上限） */
export function canReadFree(world: WorldState): boolean {
  const c = world.counts ?? ZERO_COUNTS;
  return c.free < FREE_MAX && c.director + c.persona + c.call + c.free < DRILL_CALL_CAP;
}

/** counts.free を 1 つ増やした世界 */
export function countFree(world: WorldState): WorldState {
  const c = world.counts ?? ZERO_COUNTS;
  return { ...world, counts: { ...c, free: c.free + 1 } };
}

/**
 * 自由対応を表の手に読み替える。口が無い・上限なら読み替えずに（119 に当たる文だけはコードで 119勧奨に）。
 * 伏せきれない文は口が PseudonymLeakError を投げ、そのまま上へ（手を断る）
 */
export async function readFree(
  ctx: { world: WorldState; participants: ReadonlyArray<string>; minute: number },
  input: { text: string; person: string | null; contacts: ReadonlyArray<ActTarget> },
  hook: FreeHook | undefined,
): Promise<FreeOutcome> {
  const text = Array.from(input.text.trim()).slice(0, FREE_TEXT_MAX).join("");
  const base = { text, person: input.person, contacts: input.contacts };
  if (!hook || !text || !canReadFree(ctx.world)) {
    return { ...resolveFree(null, base), stored: text, words: null, reason: null, called: false };
  }
  const r = await hook({
    text,
    person: input.person,
    participants: ctx.participants,
    choices: freeChoices(input.person, input.contacts),
    facts: freeFacts(ctx.world, input.person, ctx.minute),
  });
  const resolved = resolveFree(r.reading, base);
  return {
    ...resolved,
    stored: r.stored,
    // 記録に落ちたときは Claude の 1 文を使わない（読み替えた手と文が食い違わないように）
    words: resolved.as === "note" && r.reading?.kind !== "note" ? null : (r.reading?.text ?? null),
    reason: r.reading?.reason ?? null,
    called: true,
  };
}
