// 自由に書く手（docs/tasks/T91.md の 4、T110 の 3、T129）。表に無い対応をケアマネが文で書き、監督役の Claude（Opus、用途 director）が
// 今の状況（lib/drill/free-situation.ts。ケアマネの今いる所・電話・停電・道・職員・対象の人の分かっている事・時刻）を見て、この状況で
// この文の行動をすると何が起きるかを決める。表の手に当たれば「手の表のどの手に当たるか」、当たらなければ（T110）そのままの手として、
// 相手・やり方・所要・できるか・起きたことを返す。
// 表の手に当たったときの世界の変化と結果（届いた・届かない）は読み替えた手の表の行と確率でコードが決める（lib/drill/actions.ts の act）。
// そのままの手の結果は事実と確率でコードが決め（電話は線の様子、訪問は家の前の道。その本人の家にいれば会える）、文は AI の「起きたこと」。
// そのままの手の効き目は閉じた一覧（action-catalog.ts の OWN_EFFECTS: その人に届いた・人が向かった）の中だけで、左の表に届く物は持たない（T129）。
// 本人役・監督が次の区切りでその手を読む。
//
// 線:
// - ケアマネが打った文が Claude に渡る口。必ず仮名化の門（lib/pseudonym の pseudonymizeText → lib/claude/call.ts の askJson）を通し、
//   伏せきれない文（PseudonymLeakError）は手を断る（API は 400「伏字不可」。黙って送らない）。メモ（T59）は今までどおり渡さない
// - 文（record.text）と読み替えの理由（record.reason）と AI の判断の記録（record.judge）はサーバーの中だけ。engine の withoutMemo が落とすので、
//   監督・世界・本人役・講評に渡るのは kind free と読み替えた手の id（as）か、そのままの手の 1 文（words。名前・町名を含まない物だけ）。
//   T129: 手の記録の文はケアマネが打った文のまま（画面の内容。伏せた文を氏名に戻した物にすると、伏字の跡が残る）。Claude に渡すのは伏せた文だけ
// - 「119 を呼ぶ」「救急車を呼んだ」に当たる文は 119勧奨（advise_119）に落とす。救急が来た・運ばれた、の結果は作らない
// - T129: 何もしない文は「変化なし」（机上 2 分、世界を変えない）。その本人に使えない・今できない表の手は、その手として「できない」と
//   理由（決まりの表か、対象なし・相手なし）と今できる別の道を返す（黙って記録に落とさない）。表に無い id は、AI が所要を返していればそのままの手、
//   無ければ「変化なし」
// - 所要は FREE_MINUTES の中。夜・浸水・電話の混み具合・電池の足し分と押せない理由は決まりの表（lib/drill/action-terms.ts）がコードで決める
// - 色と連絡順（lib/triage）には触れない。そのままの手は左の表を直接動かさない（聞いた安否・時計の頼り先の確認を持たない）
// - 1 訓練 10 回まで（world.counts.free）。超えたら・1 訓練の上限（T90 の 150）に達したら・鍵が無ければ、読み替えずに「変化なし」
//   （119 に当たる文だけはコードで 119勧奨）
// - T129: 画面に出る文（AI の 1 文・理由・できない理由・起きたこと・別の道）に手の内部の名前（英字の id）を出さない。手の名前・相手の言い方に
//   置き換え、残れば出さない（plainWords）。全部の AI の出力の門（T125）とは別に、この口で確実に

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
  CATALOG_LABELS,
  FIXED_CALLEE_LABELS,
  FREE_IDLE_MINUTES,
  FREE_LABELS,
  FREE_MAX,
  FREE_MINUTES,
  FREE_TEXT_MAX,
  isCatalogAction,
  isOwnEffect,
  OWN_EFFECTS,
  type FixedCallee,
  type OwnEffect,
} from "./action-catalog.ts";
import {
  actionTerm,
  blockOf,
  FREE_WAY_LABELS,
  FREE_WAYS,
  isFreeWay,
  TERM_LABELS,
  termFactsOf,
  type ActionTerm,
  type FreeWay,
  type TermCallee,
} from "./action-terms.ts";
import type { FreeJudge, FreePlan } from "./action-types.ts";
import type { ActTarget } from "./actions.ts";
import { drillScope } from "./db.ts";
import { SPEECH_RULES } from "./dialogue.ts";
import { atHomeOf, situationText, whereOf, type CmWhere, type SituationSource } from "./free-situation.ts";
import { cleanWords, isPersonaFailure, loadPersonaSources, personaPlaces } from "./persona.ts";
import { fitKindOf, profileOf } from "./fit.ts";
import { gateWords, nameIds } from "./gate.ts";
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
/** 今できる別の道の長さの上限（字。T129） */
export const FREE_ALT_MAX = 40;
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

/** 何もしない（kind）。前の形の答えの note もここ（T129 で「記録」の手を候補から外した） */
const IDLE_KINDS: ReadonlySet<string> = new Set(["none", "note", ""]);

// ---------- 内部の名前（T129） ----------

/**
 * 画面に出す AI の文から、手の内部の名前（英字の id）を手の名前・相手の言い方に置き換える。置き換えたあとに英字の id らしい語が残れば null
 * （出さない）。置き換えの表と決まりは AI の出力の 1 つの門（T125、lib/drill/gate.ts の nameIds）の物を使う（自由対応の口はそれを呼ぶだけ）
 */
export function plainWords(text: string | null | undefined): string | null {
  if (!text) return null;
  return nameIds(text);
}

// ---------- その本人に使える手 ----------

/**
 * Claude に渡す手の一覧の 1 行（名前と言い方は表から。相手の区分はその本人の台帳の連絡先にある物だけ）。
 * T129: 今できない手も落とさずに、できない理由（why）と一緒に渡す。相手ごとの今できない理由は calleeWhy
 */
export type FreeChoice = {
  id: DrillAction;
  label: string;
  words: string;
  callees: ReadonlyArray<ContactKind>;
  /** 今できない理由（2〜4 字。対象なし・相手なし・決まりの表）。できれば null */
  why: string | null;
  calleeWhy?: Partial<Record<TermCallee, string>>;
};

/** 手の可否と所要（決まりの表）。無ければ決まりを当てない */
export type ChoiceTerm = (id: DrillAction) => ActionTerm | null;

/**
 * 自由対応の候補の手（自由対応と、手の一覧から外した「記録」のほか全部。T129）。本人が要る手は本人を選んでいなければ「対象なし」、
 * 相手の連絡先が要る手は台帳に相手の区分が無ければ「相手なし」、決まりの表（term）で押せなければその理由。
 * 画面（ActionPanel）の押せる・押せないと同じ決め
 */
export function freeChoices(person: string | null, contacts: ReadonlyArray<ActTarget>, term?: ChoiceTerm): FreeChoice[] {
  return ACTION_CATALOG.flatMap((row): FreeChoice[] => {
    if (row.id === "free" || row.id === "note") return [];
    const callees = person ? [...new Set(contacts.filter((c) => row.targetKinds.includes(c.kind)).map((c) => c.kind))] : [];
    const t = term?.(row.id) ?? null;
    const calleeWhy: Partial<Record<TermCallee, string>> = {};
    for (const k of [...callees, ...(row.fixed ? (["fixed"] as const) : [])]) {
      const why = t?.targets[k];
      if (why) calleeWhy[k] = why;
    }
    let why: string | null = null;
    if (row.needsPerson && !person) why = FREE_LABELS.noPerson;
    else if (row.needsTarget && callees.length === 0) why = FREE_LABELS.noCallee;
    else if (t?.block) why = t.block;
    else if (row.id === "call_person" && t?.targets.self) why = t.targets.self;
    else if (row.targetKinds.length > 0) {
      // 相手を選ぶ手は、選べる相手が全部押せないとき
      const keys: TermCallee[] = [...(row.fixed && !row.needsTarget ? (["fixed"] as const) : []), ...callees];
      if (keys.length > 0 && keys.every((k) => calleeWhy[k])) why = calleeWhy[keys[0]] ?? null;
    }
    return [{ id: row.id, label: row.label, words: row.words, callees, why, ...(Object.keys(calleeWhy).length > 0 ? { calleeWhy } : {}) }];
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

/** そのままの手（T110）。相手・やり方・所要（決まりの足し分の前）。effect は AI の言う効き目（T129。決まりで絞る前）、idle は何も起きない文 */
export type OwnFree = {
  way: FreeWay;
  minutes: number;
  callee: ContactKind | null;
  fixed: FixedCallee | null;
  effect?: OwnEffect;
  idle?: true;
};

/**
 * 読み替えた手と相手。own はそのままの手（as は null）。block は表の手でコードが決めた今できない理由（T129: 対象なし・相手なし）。
 * 決まりの表の押せない理由は planFree が足す
 */
export type FreeResolved = { as: DrillAction; target: ActTarget | null; block?: string } | { as: null; target: ActTarget | null; own: OwnFree };

/** 何も起きない文（T129。前の「記録」） */
const IDLE: FreeResolved = { as: null, target: null, own: { way: "desk", minutes: FREE_IDLE_MINUTES, callee: null, fixed: null, idle: true } };

/** AI の所要を下限と上限の中に（整数の分） */
export function clampFreeMinutes(v: unknown, way: FreeWay): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : FREE_DEFAULT_MINUTES[way];
  return Math.min(FREE_MINUTES.max, Math.max(FREE_MINUTES.min, n));
}

/** そのままの手に決める（相手は台帳の連絡先の区分か固定の相手。無ければ相手なし） */
function ownOf(reading: Pick<FreeReading, "callee" | "way" | "minutes" | "effect">, contacts: ReadonlyArray<ActTarget>, person: string | null): FreeResolved {
  const key = reading.callee.trim();
  const target = person && key ? pickTarget(contacts, [key as ContactKind]) : null;
  const fixed = !target && (FIXED_KEYS as ReadonlyArray<string>).includes(key) ? (key as FixedCallee) : null;
  const way: FreeWay = isFreeWay(reading.way) ? reading.way : target || fixed ? "phone" : "desk";
  const effect = isOwnEffect(reading.effect) ? reading.effect : null;
  return {
    as: null,
    target,
    own: { way, minutes: clampFreeMinutes(reading.minutes, way), callee: target?.kind ?? null, fixed, ...(effect ? { effect } : {}) },
  };
}

type ResolveReading = Pick<FreeReading, "kind" | "callee"> & Partial<Pick<FreeReading, "way" | "minutes" | "effect">>;

/**
 * Claude の読み替え（kind・callee）を、表の手と台帳の相手に決める。119 に当たる文は Claude の答えに関わらず 119勧奨。
 * 読み替えが無い（鍵なし・失敗・上限）・何もしない文は「変化なし」（T129）。
 * T110: kind free はそのままの手。T129: 表の手で本人を選んでいない・相手の連絡先が無い物は、その手のまま今できない理由（block）を付ける
 * （前は記録に落としていた。相手の区分が違うだけなら、その手の相手の区分の順で台帳から選ぶ）
 */
export function resolveFree(reading: ResolveReading | null, ctx: { text: string; person: string | null; contacts: ReadonlyArray<ActTarget> }): FreeResolved {
  const to119 = CALL_119.test(ctx.text);
  const kind = to119 ? "advise_119" : (reading?.kind.trim() ?? "");
  const asOwn = () => ownOf({ way: null, minutes: null, effect: null, ...reading! }, ctx.contacts, ctx.person);
  if (!to119 && kind === "free" && reading) return asOwn();
  if (!isCatalogAction(kind) || kind === "free" || kind === "note") {
    // 表に無い id は、AI が所要を返していればそのままの手（T110）、無ければ変化なし
    return reading && !IDLE_KINDS.has(kind) && typeof reading.minutes === "number" && reading.minutes > 0 ? asOwn() : IDLE;
  }
  const row = actionRow(kind);
  if (row.needsPerson && !ctx.person) return { as: kind, target: null, block: FREE_LABELS.noPerson };
  if (row.targetKinds.length === 0) return { as: kind, target: null };
  const callees = [...new Set(ctx.contacts.filter((c) => row.targetKinds.includes(c.kind)).map((c) => c.kind))];
  const callee = reading?.callee.trim() ?? "";
  if ((callees as ReadonlyArray<string>).includes(callee)) return { as: kind, target: pickTarget(ctx.contacts, [callee as ContactKind]) };
  // 相手の区分が無い・台帳に無い: 本人電話は本人、固定の相手のある手（訪問依頼・移送・電源・報告）は固定の相手
  if (!row.needsTarget) return { as: kind, target: kind === "call_person" ? pickTarget(ctx.contacts, ["self"]) : null };
  // 相手が要る手は、その手の相手の区分の順で台帳から（119 は本人・家族・支援者の順）。無ければ相手なし
  const order = to119 ? CALL_119_ORDER : row.targetKinds;
  const first = pickTarget(ctx.contacts, order.filter((k) => callees.includes(k)));
  return first ? { as: kind, target: first } : { as: kind, target: null, block: FREE_LABELS.noCallee };
}

// ---------- Claude に頼む ----------

export type FreeAsk = {
  /** ケアマネの文（200 字まで、仮名化の前。サーバーの中だけ） */
  text: string;
  /** 相手の本人（任意） */
  person: string | null;
  /** 訓練の参加者（仮名の並び） */
  participants: ReadonlyArray<string>;
  /** 候補の手（今できない手も、理由つきで） */
  choices: ReadonlyArray<FreeChoice>;
  /** 今の状況（lib/drill/free-situation.ts の situationText。名前・町名なし） */
  facts: string;
  /** そのままの手で選べる相手（T110。無ければ固定の相手だけ） */
  callees?: ReadonlyArray<{ key: string; label: string }>;
  /**
   * 本人を選ばずに打った文に参加者の名前が 1 人だけあったときに、その人の候補・状況・相手を作り直す口（T129）。
   * 口（createFreeHook）が伏せた文の仮名で人を決めてから呼ぶ。無ければ選んだ本人のまま
   */
  forPerson?: (person: string) => Promise<Pick<FreeAsk, "choices" | "facts" | "callees">>;
};

/**
 * Claude の読み替え（形を確かめたあと。kind と callee はまだ表で絞る前）。
 * T110 の欄（way・minutes・can・whyNot・outcome）と T129 の欄（alt・effect）は省略可（前の形の答えは表の手か変化なしだけ）
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
  /** 今できる別の道（T129。名前・町名・内部の名前を含まない。無ければ null） */
  alt?: string | null;
  /** そのままの手の効き目（T129。閉じた一覧の中だけ。外の値は null） */
  effect?: OwnEffect | null;
  /** 本人役・監督・世界に渡してよい 1 文（名前・町名を含まない。無ければ null） */
  safeText?: string | null;
  /** AI の判断の記録に残す理由（仮名のまま、氏名に戻さない。無ければ null） */
  judgeReason?: string | null;
};

/**
 * 読み替えの返事。stored はケアマネが打った文（手の記録の text。サーバーの中だけ。T129 で伏せて戻した物から打った文のままに）。
 * reading は失敗なら null（変化なし）。masked・facts は Claude に渡した伏せた文と事実（AI の判断の記録に残す）。
 * person は本人を選ばずに打った文で決めた対象（T129）。伏せきれない文は PseudonymLeakError を投げる（手を断る）
 */
export type FreeReply = { stored: string; reading: FreeReading | null; masked?: string; facts?: string; person?: string };
export type FreeHook = (ask: FreeAsk) => Promise<FreeReply>;

export const FREE_SYSTEM = [
  "あなたは災害の訓練のシミュレーションの監督役。ケアマネが訓練の中で文で書いた対応を、今の状況でその行動をすると何が起きるかで決める。",
  "手の一覧に当たる手があればその手に読み替える。当たる手が無ければ、そのままの手（free）として、相手・やり方・所要・できるか・起きたことを決める。",
  "入力: 文（ケアマネの文。人は仮名）、手（全部の手の一覧。id・名前・中身・今できるか・相手の区分）、相手（そのままの手で選べる相手の区分）、事実（今の状況。時刻と夜、ケアマネの今いる所、電話、停電、道、警戒、職員の空き、対象の本人の仮名と分かっている事）。",
  "",
  "返す物:",
  "- kind: 手の一覧の id 1 つ（今できない手でも、文の意図に当たればその id）。当たる手が無ければ free。何もしない文なら none。",
  "- callee: その手の相手の区分（手の一覧の「相手」の区分。free なら「相手」の一覧の区分）から 1 つ。相手が無ければ空の文字。",
  "- way: free のやり方。phone（電話・連絡）・visit（自分が出向く）・desk（その場でする・机の上の調整）のどれか。free でなければ空の文字。",
  "- minutes: free の所要（分、平常時の目安の整数、2〜120）。夜・浸水・電話の混み具合・電池の足し分はコードが足すので入れない。free でなければ 0。",
  "- can: 今の状況でできるか（true か false）。手の一覧で「不可」の手は false。",
  "- whyNot: できないときの理由（8 字まで。「通話不可」「通行止」「対象なし」など事実の言葉）。できるなら空の文字。",
  "- alt: できないときに、今の状況でできる別の道の 1 文（40 字まで。その場にいる職員・訪問中なら現場でできること・近くの人に頼む・自由対応のやり方など）。できるなら空の文字。",
  "- effect: free で起きる世界の小さな変化 1 つ。reach（ケアマネが対象の本人に会えた・話せた）・arrival（近くの人や家族が本人の所へ向かう）・none（変わらない）のどれか。free でなければ none。",
  "- text: ケアマネが何をしたかを、現場の言い方の 1 文で（30 字まで）。結果（つながった・着いた・受けてもらえた）は書かない。",
  "- outcome: free のとき、その対応で起きたことの 1 文（40 字まで。相手の受け答え・手配の見込み）。free でなければ空の文字。",
  "- reason: なぜその手・やり方にしたか（60 字まで）。",
  "",
  "決まり:",
  "1. kind は手の一覧の id か free か none だけ。一覧に無い手の id を作らない。",
  "2. 119 を呼ぶ・救急車を呼んだ、に当たる文は advise_119（119 への連絡を勧める）。電話が通話不可などで不可なら、can は false、whyNot に理由、alt に今できる別の道（訪問中なら近所の人に消防署へ知らせに走ってもらう、など）。救急が来た・運ばれた、は書かない。",
  "3. 文がいくつもの手を書いていたら、最初に打つ手 1 つ。",
  "4. 事実に合う結果だけを書く。電話が通話不可なら電話はつながらない。家の前の道が通行止めなら車で着けない。ケアマネが対象の本人の家にいれば、その場で会って話せる。夜は暗い。",
  "5. 仮名・名前・場所の名前・電話番号を書かない。診断・病名・薬の量・医療の助言を書かない。人の生き死にを書かない。",
  "6. outcome・alt に本人の安否（無事・けが）や容体を書かない。世界の様子（停電・道・避難所）を変えない。安否と連絡の順は本人役とルールの表が決める。",
  "7. text・whyNot・alt・outcome・reason に手の id・英字を書かない。手は一覧の名前（119勧奨・見守依頼など）、相手は言い方で書く。",
].join("\n");

/**
 * 返事の形。kind・callee は文字にし、表と台帳でコードが絞る（enum にすると外の値 1 つで返事全部が形の違いになる。T18 と同じ）。
 * T110 と T129 の欄は省略可（前の形の答えも通す）
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
  alt: z.string().optional(),
  effect: z.string().optional(),
  outcome: z.string().optional(),
});
export type FreeAnswer = z.output<typeof FreeSchema>;

type FreeInput = { 文: ForClaude<{ text: string }>; 手: ForClaude<object>; 事実: ForClaude<{ text: string }> };

/** Claude に渡す要求。入力は伏せた文と、人の値を含まない手の一覧だけ（型で縛る）。用途 director（Opus） */
export function buildFreeRequest(input: FreeInput): AskJsonRequest<typeof FreeSchema> {
  return { purpose: "director", system: FREE_SYSTEM, input, schema: FreeSchema };
}

/** 今できるかの言葉（候補の一覧） */
const canWord = (why: string | null | undefined) => (why ? `不可（${why}）` : "可");

/** 手の一覧（人の値を含まない。相手は区分と言い方だけ）。T110: そのままの手で選べる相手の区分も。T129: 今できるかと理由も */
export function choicesCatalog(choices: ReadonlyArray<FreeChoice>, callees: ReadonlyArray<{ key: string; label: string }> = []) {
  return sealItemCatalog({
    一覧: choices.map((c) => ({
      id: c.id,
      名前: c.label,
      中身: c.words,
      今: canWord(c.why),
      相手: c.callees.map((k) => ({ 区分: k, 言い方: CONTACT_KIND_LABELS[k], ...(c.calleeWhy?.[k] ? { 今: canWord(c.calleeWhy[k]) } : {}) })),
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

/** 別の道に書かせない物（人の生き死に・運ばれた・本人役の決まり〔診断・薬の量・病名・医療の助言〕） */
const altBanned = (t: string) => SPEECH_RULES.some((r) => r.re.test(t.normalize("NFKC")));

/**
 * 返事を確かめる。画面の 1 文は本人役と同じ掃除（仮名は「本人」、使わない言葉・元の情報が残る物は捨てる）。理由は氏名に戻して長さで切る。
 * T129: 画面に出る文は内部の名前を手の名前に置き換え、英字の id が残る物は出さない（plainWords）
 */
export function readingOf(answer: FreeAnswer, key: PseudonymKey): FreeReading {
  const raw = plainWords(oneLine(answer.text)) ?? "";
  const text = raw && !WORDS_DANGER.test(raw) ? cleanWords(raw, key, FREE_WORDS_MAX) : null;
  const safeText = raw && !WORDS_DANGER.test(raw) ? safeWords(raw, key, FREE_WORDS_MAX) : null;
  const reason = plainWords(Array.from(restoreText(oneLine(answer.reason), key)).slice(0, FREE_REASON_MAX).join(""));
  const outRaw = plainWords(oneLine(answer.outcome)) ?? "";
  // 起きたことは本人役・監督が次の区切りで読む（手の返事の文）ので、町名の入らない物だけ
  const outcome = outRaw && !OUTCOME_DANGER.test(outRaw) ? safeWords(outRaw, key, FREE_OUTCOME_MAX) : null;
  const whyRaw = plainWords(oneLine(answer.whyNot)) ?? "";
  const whyNot = whyRaw ? safeWords(whyRaw, key, FREE_WHY_NOT_MAX) : null;
  const altRaw = plainWords(oneLine(answer.alt)) ?? "";
  const alt = altRaw && !OUTCOME_DANGER.test(altRaw) && !altBanned(altRaw) ? safeWords(altRaw, key, FREE_ALT_MAX) : null;
  const way = oneLine(answer.way);
  const effect = oneLine(answer.effect);
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
    ...(answer.alt !== undefined ? { alt } : {}),
    ...(answer.effect !== undefined ? { effect: isOwnEffect(effect) ? effect : null } : {}),
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

/** 伏せた文に仮名が出る参加者（T129。本人を選ばずに名前を書いた文の対象を決める） */
function aliasedIn(masked: string, key: PseudonymKey, participants: ReadonlyArray<string>): string[] {
  return key.people
    .filter((p) => participants.includes(p.personId))
    .filter((p) => new RegExp(`(?<![A-Za-z])${p.alias.replace(" さん", "")}[ 　]?さん`).test(masked))
    .map((p) => p.personId);
}

/**
 * 自由対応の読み替えの口（1 要求ごと）。参加者を先に、事業所のほかの本人も並べて伏せる（文に誰の名前が書かれても伏せる）。
 * 伏せきれない文は PseudonymLeakError（断る）。台帳が読めない・仮名化の前の台帳に漏れがある・Claude の失敗は読み替えなし（変化なし）。
 * T129: 本人を選ばずに打った文に参加者の仮名が 1 人だけ出れば、その人を対象に候補と状況を作り直してから頼む
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
    // 手の記録の文はケアマネが打った文のまま（T129。伏せて戻した文は、名の書き方が台帳と違うと（氏名）の跡が残る）
    const stored = ask.text;
    let person = ask.person;
    let prepared: Pick<FreeAsk, "choices" | "facts" | "callees"> = { choices: ask.choices, facts: ask.facts, callees: ask.callees ?? [] };
    if (person === null && ask.forPerson) {
      const hit = [...new Set(aliasedIn(masked.text, key, ask.participants))];
      if (hit.length === 1) {
        try {
          prepared = await ask.forPerson(hit[0]);
          person = hit[0];
        } catch (e) {
          console.error("自由対応の対象の連絡先に失敗", e instanceof Error ? e.name : typeof e);
        }
      }
    }
    const who = person !== ask.person && person !== null ? { person } : {};
    let facts: { text: string } | null = null;
    try {
      const alias = person ? (key.people.find((p) => p.personId === person)?.alias ?? null) : null;
      const sealedFacts = pseudonymizeText([`対象の本人: ${alias ?? "なし（全体の対応）"}`, prepared.facts].join("\n"), key);
      facts = sealedFacts;
      const r = await askJson(buildFreeRequest({ 文: masked, 手: choicesCatalog(prepared.choices, prepared.callees ?? []), 事実: sealedFacts }), deps.ai);
      return { stored, reading: readingOf(r.value, key), masked: masked.text, facts: sealedFacts.text, ...who };
    } catch (e) {
      if (!isPersonaFailure(e) && !(e instanceof PseudonymLeakError)) console.error("自由対応の読み替えに失敗", e instanceof Error ? e.name : typeof e);
      return { stored, reading: null, masked: masked.text, ...(facts ? { facts: facts.text } : {}), ...who };
    }
  };
}

/** 訓練の手の route が使う自由対応の口。鍵があり、ケアマネの役（審査員のケアマネの役も）なら作る。無ければ undefined（変化なし） */
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

/** 自由対応の元（訓練の状態の要る所。手の可否の決まりと今の状況の文） */
export type FreeSource = SituationSource & { participants: ReadonlyArray<string> };

/** 自由対応の入力。contactsOf は本人を選ばずに名前を書いた文の対象の連絡先を読む口（T129。無ければ対象を決めない） */
export type FreeIn = {
  text: string;
  person: string | null;
  contacts: ReadonlyArray<ActTarget>;
  contactsOf?: (person: string) => Promise<ReadonlyArray<ActTarget>>;
};

/** 読み替えの結果。called は Claude の口を呼んだか（counts.free に数える） */
export type FreeOutcome = FreeResolved & {
  /** 手の記録の text（ケアマネが打った文。サーバーの中だけ） */
  stored: string;
  /** 画面の 1 文（Claude の現場の言い方、AI の印）。無ければ固定の文 */
  words: string | null;
  /** 読み替えの理由（サーバーの中だけ） */
  reason: string | null;
  called: boolean;
  /** 対象の本人（選んだ本人か、名前を書いた文で決めた人。T129） */
  person: string | null;
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

/** その本人の手の可否と所要（決まりの表。決まりを選ばない訓練も表の分で返す） */
const termOf = (s: FreeSource, person: string | null): ChoiceTerm => {
  const facts = termFactsOf(s, person);
  const on = s.options?.terms === true;
  return (id) => actionTerm(id, facts, { on });
};

/** 候補・状況・相手（その本人で） */
function prepareFor(s: FreeSource, person: string | null, contacts: ReadonlyArray<ActTarget>): Pick<FreeAsk, "choices" | "facts" | "callees"> {
  return { choices: freeChoices(person, contacts, termOf(s, person)), facts: situationText(s, person), callees: ownCallees(person, contacts) };
}

/**
 * 自由対応を表の手に読み替える。口が無い・上限なら読み替えずに（119 に当たる文だけはコードで 119勧奨に、ほかは変化なし）。
 * 伏せきれない文は口が PseudonymLeakError を投げ、そのまま上へ（手を断る）
 */
export async function readFree(s: FreeSource, input: FreeIn, hook: FreeHook | undefined): Promise<FreeOutcome> {
  const text = freeText(input.text);
  const base = { text, person: input.person, contacts: input.contacts };
  if (!hook || !text || !canReadFree(s.world as WorldState)) {
    return { ...resolveFree(null, base), stored: text, words: null, reason: null, called: false, person: input.person };
  }
  let picked: ReadonlyArray<ActTarget> = input.contacts;
  const forPerson = input.contactsOf
    ? async (p: string) => {
        picked = await input.contactsOf!(p);
        return prepareFor(s, p, picked);
      }
    : undefined;
  const r = await hook({ text, person: input.person, participants: s.participants, ...prepareFor(s, input.person, input.contacts), ...(forPerson ? { forPerson } : {}) });
  const person = r.person ?? input.person;
  const contacts = r.person ? picked : input.contacts;
  const resolved = resolveFree(r.reading, { text, person, contacts });
  const idle = resolved.as === null && resolved.own.idle === true;
  return {
    ...resolved,
    stored: r.stored,
    // 変化なしに落ちたときは Claude の 1 文を使わない（読み替えた手と文が食い違わないように）。
    // 画面に出る文は、口が何であってもここで内部の名前を置き換える（T129。読み替えの口の readingOf と同じ）
    words: idle && !IDLE_KINDS.has(r.reading?.kind ?? "") ? null : plainWords(r.reading?.text),
    reason: plainWords(r.reading?.reason),
    called: true,
    person,
    reading: r.reading,
    ...(r.masked !== undefined ? { masked: r.masked } : {}),
    ...(r.facts !== undefined ? { facts: r.facts } : {}),
  };
}

/** 固定の相手の決まりの区分（決まりの表の fixed） */
const termCallee = (target: ActTarget | null, fixed: boolean): TermCallee | null => (target ? target.kind : fixed ? "fixed" : null);

/**
 * 今できないときの、決まりの言葉の別の道（T129。AI が別の道を返さなかったとき。医療の助言にしない）。
 * その本人の家にいるときは、その場でできること（近くの人に頼む）を先に
 */
export function fallbackAlt(block: string, where: CmWhere, person: string | null, s: Pick<FreeSource, "world">): string | null {
  const here = atHomeOf(where, person);
  const roadOpen = person !== null && !s.world.roads.some((r) => r.person === person && !r.open);
  switch (block) {
    case FREE_LABELS.noPerson:
      return "対象の本人を選ぶ";
    case FREE_LABELS.noCallee:
      return "台帳の連絡先を確かめる";
    case TERM_LABELS.noCall:
      if (here) return "その場で近所の人に消防署・役所へ知らせに走ってもらう";
      return roadOpen ? "訪問して直接様子を確かめる" : "近くの人に様子を見てもらう";
    // 通信の段（T125）: 携帯の電波不通・携帯なしは、固定電話・メッセージ・人が行く道
    case TERM_LABELS.noRadio:
      if (here) return "その場で近所の人に消防署・役所へ知らせに走ってもらう";
      return roadOpen ? "訪問して直接様子を確かめる" : "職員に訪問を頼む";
    case TERM_LABELS.noMobile:
      return "固定電話か訪問で確かめる";
    case TERM_LABELS.evac:
      return "避難先から電話で確かめる";
    case TERM_LABELS.road:
      return s.world.phone === "down" ? "近くの人に様子を見てもらう" : "電話で様子を確かめる";
    case TERM_LABELS.noStaff:
      return "応援依頼・自分で訪問";
    case TERM_LABELS.nurse:
      return "介護事業所に訪問を頼む";
    case TERM_LABELS.closed:
      return "ほかの透析先を探す";
    default:
      return null;
  }
}

/**
 * そのままの手の効き目を決まりで絞る（T129）。本人がいなければ無し。届いた（reach）は、その本人の家にいる・訪問・本人と家族と支援者への電話のときだけ。
 * 人が向かう（arrival）は、本人がいて、誰かに頼める手（電話・訪問・その場）のときだけ
 */
function allowedEffect(effect: OwnEffect | undefined, ctx: { person: string | null; here: boolean; way: FreeWay; callee: ContactKind | null }): OwnEffect | null {
  if (!effect || !ctx.person || !(OWN_EFFECTS as readonly string[]).includes(effect)) return null;
  if (effect === "reach") {
    if (ctx.here || ctx.way === "visit") return effect;
    return ctx.way === "phone" && (ctx.callee === "self" || ctx.callee === "family" || ctx.callee === "supporter") ? effect : null;
  }
  return ctx.here || ctx.way !== "desk" ? effect : null;
}

/**
 * 自由対応の読み替えから、打つ前に見せる物と打つときに使う物（FreePlan）を作る（T110）。
 * 表の手に当たれば、その手の決まりの表の所要と押せない理由（T129: 対象なし・相手なしも）。そのままの手は AI の所要（下限と上限の中）に、
 * やり方の決まりの足し分と押せない理由。AI ができないと答えたら押せない（理由は AI の言葉、AI の印）。決まりの表の理由が先。
 * 押せないときは今できる別の道（AI の言葉か、決まりの言葉）
 */
export async function planFree(s: FreeSource, input: FreeIn, hook: FreeHook | undefined): Promise<FreePlan> {
  const r = await readFree(s, input, hook);
  const person = r.person;
  const facts = termFactsOf(s, person);
  const on = s.options?.terms === true;
  const reading = r.reading ?? null;
  const where = whereOf(s.actions ?? []);
  const here = atHomeOf(where, person);
  let plan: Omit<FreePlan, "judge" | "alt" | "altAi">;
  if (r.as !== null) {
    const row = actionRow(r.as);
    const fixedLabel = !r.target && row.fixed ? FIXED_CALLEE_LABELS[row.fixed] : null;
    const callee = r.as === "call_person" ? "self" : (r.target?.kind ?? null);
    const term = actionTerm(r.as, facts, { on });
    const block = r.block ?? blockOf(term, r.as === "call_person" ? "self" : termCallee(r.target, row.fixed !== null));
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
      person,
      effect: null,
      idle: false,
    };
  } else {
    const own = r.own;
    const term = actionTerm("free", facts, { on, way: own.way, minutes: own.minutes });
    // 通信の段（T125）: 相手の区分を決めない電話（近所の人など）と家族・支援者の電話は携帯として、全域の電波不通で届かない。
    // 本人の家への電話は、固定電話も携帯も使えない家で届かない（決まりの表と世界の返事 actions.ts の decideOwn と同じ）
    const toMobile = own.way === "phone" && own.fixed === null && (own.callee === null || own.callee === "family" || own.callee === "supporter" || own.callee === "welfare_commissioner");
    const commsBlock =
      own.way !== "phone" || !on
        ? null
        : own.callee === "self" && facts.selfLine !== "ok"
          ? facts.selfLine === "noRadio"
            ? TERM_LABELS.noRadio
            : TERM_LABELS.noCall
          : toMobile && facts.radioAll
            ? TERM_LABELS.noRadio
            : null;
    const codeBlock = own.idle ? null : (blockOf(term, termCallee(r.target, own.fixed !== null)) ?? commsBlock);
    const aiBlock = !own.idle && reading?.can === false ? (plainWords(reading.whyNot) ?? FREE_BLOCK_WORD) : null;
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
      words: own.idle ? null : plainWords(reading?.safeText),
      outcome: own.idle ? null : plainWords(reading?.outcome),
      reason: r.reason,
      stored: r.stored,
      called: r.called,
      person,
      effect: own.idle ? null : allowedEffect(own.effect, { person, here, way: own.way, callee: own.callee }),
      idle: own.idle === true,
    };
  }
  // 押せないときの別の道: AI の言葉（掃除済み）が先、無ければ決まりの言葉
  const aiAlt = plan.block ? plainWords(reading?.alt) : null;
  const alt = plan.block ? (aiAlt ?? fallbackAlt(plan.block, where, person, s)) : null;
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
          alt: reading.alt ?? null,
          effect: reading.effect ?? null,
        }
      : null,
    decided: {
      as: plan.as,
      way: plan.way,
      minutes: plan.minutes,
      block: plan.block,
      person,
      effect: plan.effect ?? null,
      idle: plan.idle === true,
    },
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
  const altGated = gate(alt);
  return { ...plan, words, outcome, reason, block, alt: altGated, altAi: aiAlt !== null && altGated !== null, judge, ...(gated.length > 0 ? { gated } : {}) };
}

/** AI ができないと答えて理由が無いときの言葉 */
const FREE_BLOCK_WORD = "不可";

/** そのままの手のやり方の一覧（画面と検査） */
export { FREE_WAYS };
