// 自由に書く手（docs/tasks/T91.md の 4、T110 の 3）。表に無い対応をケアマネが文で書き、監督役の Claude（Opus、用途 director）が
// 「手の表のどの手に当たるか」を読み替える。当たらなければ（T110）そのままの手として、相手・やり方・所要・できるか・起きたことを返す。
// 表の手に当たったときの世界の変化と結果（届いた・届かない）は読み替えた手の表の行と確率でコードが決める（lib/drill/actions.ts の act）。
// そのままの手は世界を変えない（効き目なし・聞いた安否なし）。結果の文は AI の「起きたこと」で、本人役・監督が次の区切りでその手を読む。
//
// 線:
// - ケアマネが打った文が Claude に渡る口。必ず仮名化の門（lib/pseudonym の pseudonymizeText → lib/claude/call.ts の askJson）を通し、
//   伏せきれない文（PseudonymLeakError）は手を断る（API は 400「伏字不可」。黙って送らない）。メモ（T59）は今までどおり渡さない
// - 文（record.text）と読み替えの理由（record.reason）と AI の判断の記録（record.judge）はサーバーの中だけ。engine の withoutMemo が落とすので、
//   監督・世界・本人役・講評に渡るのは kind free と読み替えた手の id（as）か、そのままの手の 1 文（words。名前・町名を含まない物だけ）
// - 「119 を呼ぶ」「救急車を呼んだ」に当たる文は 119勧奨（advise_119）に落とす。救急が来た・運ばれた、の結果は作らない
// - 表に無い id・何もしない（note）は記録。その本人に使えない表の手は、AI が所要を返していればそのままの手、無ければ記録
// - 所要は FREE_MINUTES の中。夜・浸水・電話の混み具合・電池の足し分と押せない理由は決まりの表（lib/drill/action-terms.ts）がコードで決める
// - 色と連絡順（lib/triage）には触れない。そのままの手は左の表を直接動かさない
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
  maskReply,
  pseudonymize,
  pseudonymizeText,
  PseudonymLeakError,
  restoreText,
  sealItemCatalog,
  type ForClaude,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import {
  ACTION_CATALOG,
  actionRow,
  FIXED_CALLEE_LABELS,
  FREE_MAX,
  FREE_MINUTES,
  FREE_TEXT_MAX,
  isCatalogAction,
  type FixedCallee,
} from "./action-catalog.ts";
import { actionTerm, blockOf, FREE_WAYS, isFreeWay, termFactsOf, type FreeWay, type TermCallee, type TermSource } from "./action-terms.ts";
import type { FreeJudge, FreePlan } from "./action-types.ts";
import type { ActTarget } from "./actions.ts";
import { drillScope } from "./db.ts";
import { clockLabel, PHONE_LABELS } from "./labels.ts";
import { cleanWords, isPersonaFailure, loadPersonaSources, personaPlaces } from "./persona.ts";
import { fitKindOf, profileOf } from "./fit.ts";
import { gateWords } from "./gate.ts";
import type { DrillCounts, WorldState } from "./scenarios.ts";

// ---------- 言葉と上限 ----------

export { FREE_LABELS } from "./action-catalog.ts";

/** 画面の 1 文（Claude の現場の言い方）の長さの上限（字） */
export const FREE_WORDS_MAX = 30;
/** 読み替えの理由の長さの上限（字。サーバーの中だけ） */
export const FREE_REASON_MAX = 60;
/** そのままの手の起きたことの長さの上限（字） */
export const FREE_OUTCOME_MAX = 40;
/** できない理由（AI）の長さの上限（字） */
export const FREE_WHY_NOT_MAX = 8;
/**
 * 1 訓練の AI の呼び出しの上限（T90 の lib/drill/clock.ts の DRILL_CALL_CAP と同じ数）。counts の合計がこれに達したら読み替えない。
 * T90 の本体が入ったら、そちらの定数を読む形に寄せる
 */
const DRILL_CALL_CAP = 150;

/** そのままの手の所要の既定（AI が所要を返さなかったとき。やり方ごと） */
const FREE_DEFAULT_MINUTES: Readonly<Record<FreeWay, number>> = { phone: 10, visit: 40, desk: 5 };

/** 119 を呼ぶ・救急車に当たる文（コードで見る。Claude の読み替えより先）。救急病院・救急外来は病院の手なので当てない */
const CALL_119 = /119|１１９|救急車|救急(?:要請|隊)/;

/** 画面の 1 文に書かせない物（救急が来た・運ばれた・人の生き死に） */
const WORDS_DANGER = /救急車|搬送|運ばれ|亡くな|死亡|死ん|心肺停止|意識が(?:ない|無い)/;
/** 起きたことに書かせない物（上に加えて、本人の安否の言い切り。色と順は本人役と表が決める） */
const OUTCOME_DANGER = /救急車|搬送|運ばれ|亡くな|死亡|死ん|心肺停止|意識が(?:ない|無い)|無事|けが|怪我|重症|容体|容態/;

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

/** そのままの手の相手の固定の区分（事業所の職員・市役所・福祉避難所・ほかの事業所） */
const FIXED_KEYS: ReadonlyArray<FixedCallee> = ["staff", "city", "shelter", "office"];

/** そのままの手で選べる相手（その本人の台帳の連絡先の区分と固定の相手。人の値は持たない） */
export function ownCallees(person: string | null, contacts: ReadonlyArray<ActTarget>): Array<{ key: string; label: string }> {
  const kinds = person ? [...new Set(contacts.map((c) => c.kind))] : [];
  return [
    ...kinds.map((k) => ({ key: k as string, label: CONTACT_KIND_LABELS[k] })),
    ...FIXED_KEYS.map((k) => ({ key: k as string, label: FIXED_CALLEE_LABELS[k] })),
  ];
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

/** そのままの手（T110）。相手・やり方・所要（決まりの足し分の前） */
export type OwnFree = { way: FreeWay; minutes: number; callee: ContactKind | null; fixed: FixedCallee | null };

/** 読み替えた手と相手（表に無い・使えない・相手の無い物は記録）。own はそのままの手（as は null） */
export type FreeResolved = { as: DrillAction; target: ActTarget | null } | { as: null; target: ActTarget | null; own: OwnFree };

const NOTE: FreeResolved = { as: "note", target: null };

/** AI の所要を下限と上限の中に（整数の分） */
export function clampFreeMinutes(v: unknown, way: FreeWay): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : FREE_DEFAULT_MINUTES[way];
  return Math.min(FREE_MINUTES.max, Math.max(FREE_MINUTES.min, n));
}

/** そのままの手に決める（相手は台帳の連絡先の区分か固定の相手。無ければ相手なし） */
function ownOf(reading: Pick<FreeReading, "callee" | "way" | "minutes">, contacts: ReadonlyArray<ActTarget>, person: string | null): FreeResolved {
  const key = reading.callee.trim();
  const target = person && key ? pickTarget(contacts, [key as ContactKind]) : null;
  const fixed = !target && (FIXED_KEYS as ReadonlyArray<string>).includes(key) ? (key as FixedCallee) : null;
  const way: FreeWay = isFreeWay(reading.way) ? reading.way : target || fixed ? "phone" : "desk";
  return { as: null, target, own: { way, minutes: clampFreeMinutes(reading.minutes, way), callee: target?.kind ?? null, fixed } };
}

/**
 * Claude の読み替え（kind・callee）を、表の手と台帳の相手に決める。119 に当たる文は Claude の答えに関わらず 119勧奨
 * （相手が無ければ記録）。読み替えが無い（鍵なし・失敗・上限）なら記録。
 * T110: kind free はそのままの手。表の手でその本人に使えない・相手が無い物は、AI が所要を返していればそのままの手、無ければ記録
 */
export function resolveFree(
  reading: (Pick<FreeReading, "kind" | "callee"> & Partial<Pick<FreeReading, "way" | "minutes">>) | null,
  ctx: { text: string; person: string | null; contacts: ReadonlyArray<ActTarget> },
): FreeResolved {
  const to119 = CALL_119.test(ctx.text);
  const kind = to119 ? "advise_119" : (reading?.kind.trim() ?? "");
  const asOwn = reading && typeof reading.minutes === "number" ? () => ownOf({ way: null, minutes: null, ...reading }, ctx.contacts, ctx.person) : null;
  if (!to119 && kind === "free" && asOwn) return asOwn();
  if (!isCatalogAction(kind) || kind === "free") return NOTE;
  const choice = freeChoices(ctx.person, ctx.contacts).find((c) => c.id === kind);
  if (!choice) return asOwn && !to119 ? asOwn() : NOTE;
  const row = actionRow(kind);
  if (row.targetKinds.length === 0) return { as: kind, target: null };
  const callee = reading?.callee.trim() ?? "";
  if ((choice.callees as ReadonlyArray<string>).includes(callee)) return { as: kind, target: pickTarget(ctx.contacts, [callee as ContactKind]) };
  // 119 はコードが決めたので、相手の区分が無ければ本人・家族・支援者の順で台帳から
  if (to119) return { as: kind, target: pickTarget(ctx.contacts, CALL_119_ORDER) };
  // 相手の区分が無い・台帳に無い: 相手が要る手はそのままの手か記録。本人電話は本人、固定の相手のある手（訪問依頼・移送・電源）は固定の相手
  if (row.needsTarget) return asOwn ? asOwn() : NOTE;
  return { as: kind, target: kind === "call_person" ? pickTarget(ctx.contacts, ["self"]) : null };
}

// ---------- 世界の事実（名前を書かない） ----------

/** その時に分かっている世界の事実（電話の様子・家の電話・家の前の道・職員の空き）。名前・町名は書かない */
export function freeFacts(world: WorldState, person: string | null, minute: number): string {
  const lines = [`時刻: 発災から ${clockLabel(minute)}`, `電話: ${PHONE_LABELS[world.phone]}`];
  if (person) {
    if (world.marks[person]?.lineDown !== undefined) lines.push(`家の電話: ${PHONE_LABELS.down}`);
    const road = world.roads.find((r) => r.person === person && !r.open);
    lines.push(`家の前の道: ${road ? "通行止" : "通れる"}`);
  }
  lines.push(`職員の空き: ${world.staff} 人`);
  return lines.join("\n");
}

// ---------- Claude に頼む ----------

export type FreeAsk = {
  /** ケアマネの文（200 字まで、仮名化の前。サーバーの中だけ） */
  text: string;
  /** 相手の本人（任意） */
  person: string | null;
  /** 訓練の参加者（仮名の並び） */
  participants: ReadonlyArray<string>;
  /** その本人に使える手 */
  choices: ReadonlyArray<FreeChoice>;
  /** その時に分かっている世界の事実（freeFacts） */
  facts: string;
  /** そのままの手で選べる相手（T110。無ければ固定の相手だけ） */
  callees?: ReadonlyArray<{ key: string; label: string }>;
};

/**
 * Claude の読み替え（形を確かめたあと。kind と callee はまだ表で絞る前）。
 * T110 の欄（way・minutes・can・whyNot・outcome）は省略可（前の形の答えは表の手か記録だけ）
 */
export type FreeReading = {
  kind: string;
  callee: string;
  text: string | null;
  reason: string | null;
  way?: FreeWay | null;
  minutes?: number | null;
  can?: boolean;
  whyNot?: string | null;
  outcome?: string | null;
  /** 本人役・監督・世界に渡してよい 1 文（名前・町名を含まない。無ければ null） */
  safeText?: string | null;
  /** AI の判断の記録に残す理由（仮名のまま、氏名に戻さない。無ければ null） */
  judgeReason?: string | null;
};

/**
 * 読み替えの返事。stored は伏せた文を氏名に戻した物（手の記録の text。サーバーの中だけ）。reading は失敗なら null（記録に落とす）。
 * masked・facts は Claude に渡した伏せた文と事実（AI の判断の記録に残す）。伏せきれない文は PseudonymLeakError を投げる（手を断る）
 */
export type FreeReply = { stored: string; reading: FreeReading | null; masked?: string; facts?: string };
export type FreeHook = (ask: FreeAsk) => Promise<FreeReply>;

export const FREE_SYSTEM = [
  "あなたは災害の訓練の監督役。ケアマネが訓練の中で文で書いた対応を、手の一覧のどの手に当たるかに読み替える。",
  "当たる手が無ければ、そのままの手（free）として、相手・やり方・所要・できるか・起きたことを決める。",
  "入力: 文（ケアマネの文。人は仮名）、手（この本人に使える手の一覧。id・名前・中身・相手の区分）、相手（そのままの手で選べる相手の区分）、事実（その時に分かっている世界の事実と、本人の仮名）。",
  "",
  "返す物:",
  "- kind: 手の一覧の id 1 つ。当たる手が無ければ free。何もしない・書き留めるだけなら note（記録）。",
  "- callee: その手の相手の区分（手の一覧の「相手」の区分。free なら「相手」の一覧の区分）から 1 つ。相手が無ければ空の文字。",
  "- way: free のやり方。phone（電話・連絡）・visit（自分が出向く）・desk（机の上の調整・記録）のどれか。free でなければ空の文字。",
  "- minutes: free の所要（分、平常時の目安の整数、2〜120）。夜・浸水・電話の混み具合・電池の足し分はコードが足すので入れない。free でなければ 0。",
  "- can: 事実から見てできるか（true か false）。",
  "- whyNot: できないときの理由（8 字まで。「電話 通話不可」など事実の言葉）。できるなら空の文字。",
  "- text: ケアマネが何をしたかを、現場の言い方の 1 文で（30 字まで）。結果（つながった・着いた・受けてもらえた）は書かない。",
  "- outcome: free のとき、その対応で起きたことの 1 文（40 字まで。相手の受け答え・手配の見込み）。free でなければ空の文字。",
  "- reason: なぜその手・やり方に読み替えたか（60 字まで）。",
  "",
  "決まり:",
  "1. kind は手の一覧の id か free か note だけ。一覧に無い手の id を作らない。",
  "2. 119 を呼ぶ・救急車を呼んだ、に当たる文は advise_119（119 への連絡を勧める）。救急が来た・運ばれた、は書かない。",
  "3. 文がいくつもの手を書いていたら、最初に打つ手 1 つ。",
  "4. 仮名・名前・場所の名前・電話番号を書かない。診断・病名・薬の量・医療の助言を書かない。人の生き死にを書かない。",
  "5. outcome に本人の安否（無事・けが）や容体を書かない。世界の様子（停電・道・避難所）を変えない。安否と連絡の順は本人役とルールの表が決める。",
].join("\n");

/**
 * 返事の形。kind・callee は文字にし、表と台帳でコードが絞る（enum にすると外の値 1 つで返事全部が形の違いになる。T18 と同じ）。
 * T110 の欄は省略可（前の形の答えも通す）
 */
export const FreeSchema = z.object({
  kind: z.string(),
  callee: z.string(),
  text: z.string(),
  reason: z.string(),
  way: z.string().optional(),
  minutes: z.number().optional(),
  can: z.boolean().optional(),
  whyNot: z.string().optional(),
  outcome: z.string().optional(),
});
export type FreeAnswer = z.output<typeof FreeSchema>;

type FreeInput = { 文: ForClaude<{ text: string }>; 手: ForClaude<object>; 事実: ForClaude<{ text: string }> };

/** Claude に渡す要求。入力は伏せた文と、人の値を含まない手の一覧だけ（型で縛る）。用途 director（Opus） */
export function buildFreeRequest(input: FreeInput): AskJsonRequest<typeof FreeSchema> {
  return { purpose: "director", system: FREE_SYSTEM, input, schema: FreeSchema };
}

/** 手の一覧（人の値を含まない。相手は区分と言い方だけ）。T110: そのままの手で選べる相手の区分も */
export function choicesCatalog(choices: ReadonlyArray<FreeChoice>, callees: ReadonlyArray<{ key: string; label: string }> = []) {
  return sealItemCatalog({
    一覧: choices.map((c) => ({
      id: c.id,
      名前: c.label,
      中身: c.words,
      相手: c.callees.map((k) => ({ 区分: k, 言い方: CONTACT_KIND_LABELS[k] })),
    })),
    ...(callees.length > 0 ? { 相手: callees.map((c) => ({ 区分: c.key, 言い方: c.label })) } : {}),
  });
}

/**
 * 本人役・監督・世界に戻してよい 1 文（T110）。画面の掃除（cleanWords）のあと、町名か地区の別名が入る物は捨てる
 * （cleanWords は画面のために地区の別名を町名に戻すので、そのまま Claude に戻すと町名が渡る）
 */
function safeWords(raw: string, key: PseudonymKey, max: number): string | null {
  const shown = cleanWords(raw, key, max);
  if (shown === null) return null;
  if ((key.places ?? []).some((p) => shown.includes(p.town) || shown.includes(p.alias))) return null;
  return shown;
}

const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** 返事を確かめる。画面の 1 文は本人役と同じ掃除（仮名は「本人」、使わない言葉・元の情報が残る物は捨てる）。理由は氏名に戻して長さで切る */
export function readingOf(answer: FreeAnswer, key: PseudonymKey): FreeReading {
  const raw = oneLine(answer.text);
  const text = raw && !WORDS_DANGER.test(raw) ? cleanWords(raw, key, FREE_WORDS_MAX) : null;
  const safeText = raw && !WORDS_DANGER.test(raw) ? safeWords(raw, key, FREE_WORDS_MAX) : null;
  const reason = Array.from(restoreText(oneLine(answer.reason), key)).slice(0, FREE_REASON_MAX).join("");
  const outRaw = oneLine(answer.outcome);
  // 起きたことは本人役・監督が次の区切りで読む（手の返事の文）ので、町名の入らない物だけ
  const outcome = outRaw && !OUTCOME_DANGER.test(outRaw) ? safeWords(outRaw, key, FREE_OUTCOME_MAX) : null;
  const whyRaw = oneLine(answer.whyNot);
  const whyNot = whyRaw ? safeWords(whyRaw, key, FREE_WHY_NOT_MAX) : null;
  const way = oneLine(answer.way);
  return {
    kind: answer.kind.trim(),
    callee: answer.callee.trim(),
    text,
    reason: reason || null,
    ...(answer.way !== undefined ? { way: isFreeWay(way) ? way : null } : {}),
    ...(answer.minutes !== undefined ? { minutes: answer.minutes } : {}),
    ...(answer.can !== undefined ? { can: answer.can } : {}),
    ...(answer.whyNot !== undefined ? { whyNot } : {}),
    ...(answer.outcome !== undefined ? { outcome } : {}),
    safeText,
    judgeReason: Array.from(maskReply(oneLine(answer.reason), key) ?? "").slice(0, FREE_REASON_MAX).join("") || null,
  };
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
    let facts: { text: string } | null = null;
    try {
      const alias = ask.person ? (key.people.find((p) => p.personId === ask.person)?.alias ?? null) : null;
      const sealedFacts = pseudonymizeText([`本人: ${alias ?? "なし（全体の対応）"}`, ask.facts].join("\n"), key);
      facts = sealedFacts;
      const r = await askJson(buildFreeRequest({ 文: masked, 手: choicesCatalog(ask.choices, ask.callees ?? []), 事実: sealedFacts }), deps.ai);
      return { stored, reading: readingOf(r.value, key), masked: masked.text, facts: sealedFacts.text };
    } catch (e) {
      if (!isPersonaFailure(e) && !(e instanceof PseudonymLeakError)) console.error("自由対応の読み替えに失敗", e instanceof Error ? e.name : typeof e);
      return { stored, reading: null, masked: masked.text, ...(facts ? { facts: facts.text } : {}) };
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
  /** Claude の答え（表で絞る前。AI の判断の記録） */
  reading?: FreeReading | null;
  /** Claude に渡した伏せた文と事実（AI の判断の記録） */
  masked?: string;
  facts?: string;
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

/** 自由対応の文を長さで切る（前後の空白を落とし FREE_TEXT_MAX 字まで） */
export const freeText = (text: string): string => Array.from(text.trim()).slice(0, FREE_TEXT_MAX).join("");

/**
 * 自由対応を表の手に読み替える。口が無い・上限なら読み替えずに（119 に当たる文だけはコードで 119勧奨に）。
 * 伏せきれない文は口が PseudonymLeakError を投げ、そのまま上へ（手を断る）
 */
export async function readFree(
  ctx: { world: WorldState; participants: ReadonlyArray<string>; minute: number },
  input: { text: string; person: string | null; contacts: ReadonlyArray<ActTarget> },
  hook: FreeHook | undefined,
): Promise<FreeOutcome> {
  const text = freeText(input.text);
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
    callees: ownCallees(input.person, input.contacts),
  });
  const resolved = resolveFree(r.reading, base);
  return {
    ...resolved,
    stored: r.stored,
    // 記録に落ちたときは Claude の 1 文を使わない（読み替えた手と文が食い違わないように）
    words: resolved.as === "note" && r.reading?.kind !== "note" ? null : (r.reading?.text ?? null),
    reason: r.reading?.reason ?? null,
    called: true,
    reading: r.reading,
    ...(r.masked !== undefined ? { masked: r.masked } : {}),
    ...(r.facts !== undefined ? { facts: r.facts } : {}),
  };
}

/** 固定の相手の決まりの区分（決まりの表の fixed） */
const termCallee = (target: ActTarget | null, fixed: boolean): TermCallee | null => (target ? target.kind : fixed ? "fixed" : null);

/**
 * 自由対応の読み替えから、打つ前に見せる物と打つときに使う物（FreePlan）を作る（T110）。
 * 表の手に当たれば、その手の決まりの表の所要と押せない理由。そのままの手は AI の所要（下限と上限の中）に、やり方の決まりの足し分と押せない理由。
 * AI ができないと答えたら押せない（理由は AI の言葉、AI の印）。決まりの表の理由が先
 */
export async function planFree(
  s: TermSource & { participants: ReadonlyArray<string> },
  input: { text: string; person: string | null; contacts: ReadonlyArray<ActTarget> },
  hook: FreeHook | undefined,
): Promise<FreePlan> {
  const r = await readFree({ world: s.world as WorldState, participants: s.participants, minute: s.minute }, input, hook);
  const facts = termFactsOf(s, input.person);
  const on = s.options?.terms === true;
  const reading = r.reading ?? null;
  let plan: Omit<FreePlan, "judge">;
  if (r.as !== null) {
    const row = actionRow(r.as);
    const fixedLabel = !r.target && row.fixed ? FIXED_CALLEE_LABELS[row.fixed] : null;
    const callee = r.as === "call_person" ? "self" : (r.target?.kind ?? null);
    const term = actionTerm(r.as, facts, { on });
    const block = blockOf(term, r.as === "call_person" ? "self" : termCallee(r.target, row.fixed !== null));
    plan = {
      as: r.as,
      way: null,
      target: r.target,
      calleeLabel: r.target?.label ?? fixedLabel,
      callee,
      minutes: term.minutes,
      adds: term.adds,
      block,
      blockAi: false,
      words: r.words,
      outcome: null,
      reason: r.reason,
      stored: r.stored,
      called: r.called,
    };
  } else {
    const own = r.own;
    const term = actionTerm("free", facts, { on, way: own.way, minutes: own.minutes });
    const codeBlock = blockOf(term, termCallee(r.target, own.fixed !== null));
    const aiBlock = reading?.can === false ? (reading.whyNot ?? FREE_BLOCK_WORD) : null;
    plan = {
      as: null,
      way: own.way,
      target: r.target,
      calleeLabel: r.target?.label ?? (own.fixed ? FIXED_CALLEE_LABELS[own.fixed] : null),
      callee: own.callee,
      minutes: term.minutes,
      adds: term.adds,
      block: codeBlock ?? aiBlock,
      blockAi: codeBlock === null && aiBlock !== null,
      // 本人役・監督・世界に渡る 1 文は名前・町名の入らない物だけ（無ければ固定の言い方）
      words: reading?.safeText ?? null,
      outcome: reading?.outcome ?? null,
      reason: r.reason,
      stored: r.stored,
      called: r.called,
    };
  }
  const judge: FreeJudge = {
    v: 1,
    input: r.masked ?? "",
    facts: r.facts ?? "",
    output: reading
      ? {
          kind: reading.kind,
          callee: reading.callee,
          way: reading.way ?? null,
          minutes: typeof reading.minutes === "number" ? reading.minutes : null,
          can: reading.can !== false,
          whyNot: reading.whyNot ?? null,
          // 記録は仮名のまま（画面の 1 文・理由は町名・氏名に戻すので、戻す前の物）
          text: reading.safeText ?? null,
          outcome: reading.outcome ?? null,
          reason: reading.judgeReason ?? null,
        }
      : null,
    decided: { as: plan.as, way: plan.way, minutes: plan.minutes, block: plan.block },
    called: r.called,
  };
  // 画面に出る文（1 文・起きたこと・理由・AI のできない理由）を想定の門に（T125。想定に合わない文と内部の名前の残る文を落とす）
  const fit = profileOf(fitKindOf({ scenario: s.scenario ?? "heavy_rain", options: { scale: s.options?.scale ?? null } }, s.world as WorldState));
  const gated: string[] = [];
  const gate = (t: string | null): string | null => {
    const g = gateWords(t, fit, s.world as WorldState);
    gated.push(...g.dropped);
    return g.text;
  };
  const words = gate(plan.words);
  const outcome = gate(plan.outcome);
  const reason = gate(plan.reason);
  const block = plan.blockAi && plan.block ? (gate(plan.block) ?? FREE_BLOCK_WORD) : plan.block;
  return { ...plan, words, outcome, reason, block, judge, ...(gated.length > 0 ? { gated } : {}) };
}

/** AI ができないと答えて理由が無いときの言葉 */
const FREE_BLOCK_WORD = "不可";

/** そのままの手のやり方の一覧（画面と検査） */
export { FREE_WAYS };
