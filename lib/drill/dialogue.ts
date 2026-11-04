// 本人役の通話の往復と訪問の様子（docs/tasks/T93.md）の言葉・形・上限。D1 も Claude も使わない所。
// 往復の Claude の呼び口は lib/drill/persona.ts（personaTalkReply）、保存は lib/drill/talk.ts、画面は components/drill/TalkBox.tsx。
//
// 線:
// - ケアマネの言葉は決まった問い（TALK_ASKS、閉じた一覧）か自由の 1 文（60 字まで）。自由の文は仮名化の門を通し、伏せきれなければ断る
// - 本人役が返すのは言葉と頼み事（AskKind の閉じた一覧）だけ。色・4 問・聞いた安否は変えない（聞いた安否は手の所がコードで決める）
// - 頼み事は world.asks に積む。済ませるのは T91 の手（ask_done）で、色と連絡順には届かない
// - 訪問の様子は見て分かる事だけ。体の具合の言い切り・人の生き死にの語は捨てる

import type { ContactKind } from "../db/types.ts";
import type { ActionResult, HeardSignal } from "./action-types.ts";
import type { DrillIncident } from "./incident-types.ts";
import type { PersonState } from "./persona-types.ts";
import { ASK_KINDS, type AskKind, type WorldState } from "./scenarios.ts";

// ---------- 上限 ----------

/** 1 つの電話で続けられる往復の数 */
export const TALK_MAX = 3;
/** 自由の 1 文の長さ（字） */
export const TALK_TEXT_MAX = 60;
/** 1 往復で進む時計（分） */
export const TALK_MINUTES = 2;
/** 1 往復の返事の頼み事の数 */
export const TALK_ASKS_MAX = 2;
/** 訪問の頼み事の数 */
export const VISIT_ASKS_MAX = 3;
/** 訪問の様子の長さ（字） */
export const VISIT_CONDITION_MAX = 30;

// ---------- 形 ----------

/** ケアマネの決まった問い（閉じた一覧） */
export const TALK_ASKS = ["where", "injured", "device_medicine", "can_evacuate", "contact_family", "advise_119", "will_call_back"] as const;
export type TalkAsk = (typeof TALK_ASKS)[number];

export const isTalkAsk = (v: unknown): v is TalkAsk => typeof v === "string" && (TALK_ASKS as readonly string[]).includes(v);
export const isAskKind = (v: unknown): v is AskKind => typeof v === "string" && (ASK_KINDS as readonly string[]).includes(v);

/**
 * 往復の 1 行。cm はケアマネ（決まった問いなら ask、自由の文は伏せたあと名前に戻した文）、them は電話に出た人（本人役）。
 * minute はその行の時刻（発災からの分）。asks は them の行が言った頼み事（world.asks に積んだ物）
 */
export type TalkLine = {
  who: "cm" | "them";
  text: string;
  /** 本人役（Haiku）の言葉。ケアマネの行と固定の言葉は false */
  ai: boolean;
  minute: number;
  ask?: TalkAsk;
  asks?: AskKind[];
};

/** 訪問で着いたときの様子（本人役 Haiku × 1 回）。色・4 問・聞いた安否は変えない */
export type VisitReport = {
  /** 見て分かる事（30 字まで）。使えなければ null */
  condition: string | null;
  asks: AskKind[];
  /** 本人か家族の言う事（1〜2 文）。使えなければ null */
  speech: string | null;
  ai: boolean;
};

// ---------- 呼び口（lib/drill/hooks.ts が作る） ----------

/**
 * 往復の 1 回に渡す物（talk.ts が作る）。callee は電話の相手の区分と連絡先の id（本人電話は本人の連絡先）。
 * text は自由の文（仮名化の前。口の中で伏せ、伏せきれなければ PseudonymLeakError を投げる）
 */
export type TalkTurn = {
  person: string;
  callee: { kind: ContactKind; id: string | null };
  /** この往復の時刻（発災からの分。ケアマネが言った時刻） */
  minute: number;
  world: WorldState;
  state: PersonState | null;
  /** 電話で伝える様子（手の返事の聞いた安否）。言葉が食い違わないように渡す */
  tell: HeardSignal | null;
  night?: boolean;
  /** 最初の言葉（手の返事の吹き出し） */
  first: string | null;
  lines: ReadonlyArray<TalkLine>;
  ask?: TalkAsk;
  text?: string;
};

/** said はケアマネの行に残す文（決まった問いの言葉か、伏せて名前に戻した自由の文）。called は Claude を呼んだか（counts.call に数える） */
export type TalkReply = { said: string; speech: string | null; asks: AskKind[]; ai: boolean; called: boolean };
export type TalkHook = (t: TalkTurn) => Promise<TalkReply>;

/** 訪問で着いたときに渡す物（手の所が作る）。hour は着いた時刻（発災からの時間） */
export type VisitTurn = {
  person: string;
  hour: number;
  world: WorldState;
  incidents: ReadonlyArray<DrillIncident>;
  state: PersonState | null;
  night?: boolean;
};
export type VisitHook = (v: VisitTurn) => Promise<VisitReport | null>;

// ---------- 画面の言葉（2〜4 字） ----------

/** 往復の固定の言葉（鍵が無い・上限・本人役の失敗のとき。AI の印なし） */
export const TALK_FIXED_SPEECH = "はい、分かりました";

/** 決まった問いのボタン */
export const TALK_LABELS: Readonly<Record<TalkAsk, string>> = {
  where: "所在",
  injured: "けが",
  device_medicine: "機器薬",
  can_evacuate: "避難可否",
  contact_family: "家族連絡",
  advise_119: "119勧奨",
  will_call_back: "後で連絡",
};

/** 頼み事の印 */
export const ASK_LABELS: Readonly<Record<AskKind, string>> = {
  medicine: "薬",
  water: "水",
  food: "食事",
  power: "電源",
  transport: "移送",
  family_contact: "家族",
  battery: "電池",
  toilet: "便所",
  warmth: "保温",
};

/** 往復の欄のほかの言葉 */
export const TALK_UI = {
  talk: "通話",
  rounds: "往復",
  free: "自由",
  send: "送信",
  hangUp: "切る",
  ended: "終話",
  left: "残り",
  sending: "送信中",
  asks: "頼み事",
  open: "未対応",
  done: "済",
  condition: "様子",
  visit: "訪問",
  /** 訪問の言う事の話し手（本人か家族） */
  visitee: "訪問先",
  /** ケアマネの吹き出しの話し手 */
  me: "自分",
} as const;

// ---------- Claude に渡す言い方（画面の言葉ではない） ----------

/** 決まった問いを、ケアマネが電話で言う言葉に */
export const TALK_ASK_WORDS: Readonly<Record<TalkAsk, string>> = {
  where: "今どこにいますか",
  injured: "けがはありませんか",
  device_medicine: "医療機器や薬は大丈夫ですか",
  can_evacuate: "避難できそうですか",
  contact_family: "ご家族と連絡は取れていますか",
  advise_119: "具合が悪いなら 119 に電話してください",
  will_call_back: "また後で電話します",
};

/** 頼み事の種類の意味（返事の asks の説明） */
export const ASK_MEANINGS: Readonly<Record<AskKind, string>> = {
  medicine: "薬",
  water: "水",
  food: "食べ物",
  power: "電源（停電で機器が使えない）",
  transport: "移動の手段（避難の車など）",
  family_contact: "家族への連絡",
  battery: "電池（機器の予備の電池）",
  toilet: "トイレ",
  warmth: "寒さ・暑さの対策",
};

// ---------- 返事を確かめる ----------

/** 頼み事の値を閉じた一覧に絞る（外の値は捨てる、重なりは 1 つ、max まで） */
export function asksOf(raw: unknown, max: number): AskKind[] {
  if (!Array.isArray(raw)) return [];
  const out: AskKind[] = [];
  for (const v of raw) {
    const k = typeof v === "string" ? v.trim() : v;
    if (isAskKind(k) && !out.includes(k)) out.push(k);
  }
  return out.slice(0, max);
}

/**
 * 訪問の様子に書かせない語（体の具合の言い切り・病名の言い切り・人の生き死に・救急の結果）。当たれば様子ごと捨てる。
 * 見て分かる事（「顔色が悪い」「床に座り込んでいる」）は残す
 */
export const CONDITION_BANNED =
  /診断|判定|重症|緊急度|病気がわかる|病気が分かる|死亡|亡くな|死ん|心肺停止|意識が(?:ない|無い)|危篤|搬送|救急車|骨折|脱水|肺炎|梗塞|出血|発作|低体温|熱中症|低血糖|感染/;

/** 往復と訪問の言葉に書かせない語（人の生き死に・救急の結果。本人役の決まり 9: 救急が来た先の事は言わない）。当たれば言葉ごと捨てる */
export const SPEECH_DANGER = /死亡|亡くな|死ん|心肺停止|危篤|搬送された|運ばれた|救急車が来/;

// ---------- 往復の数・時刻 ----------

/** 往復の数（ケアマネの行の数） */
export function talkRounds(r: Pick<ActionResult, "talk"> | null | undefined): number {
  return (r?.talk ?? []).filter((l) => l.who === "cm").length;
}

/** 往復の最後の時刻（発災からの分）。往復が無ければ 0 */
export function talkEnd(r: Pick<ActionResult, "talk"> | null | undefined): number {
  return Math.max(0, ...(r?.talk ?? []).map((l) => l.minute));
}

/** まだ往復を続けられるか（電話に出て言葉があり、3 往復に届かず、切っていない） */
export function canTalk(r: ActionResult | null | undefined): boolean {
  if (!r || r.status !== "connected" || r.speech === null) return false;
  return r.talkEnd === undefined && talkRounds(r) < TALK_MAX;
}

// ---------- 頼み事を世界に積む ----------

/**
 * 頼み事を world.asks に積む（at は頼まれた時刻、発災からの分）。同じ種類の未対応があれば積まない（同じ頼みを重ねない）。
 * 済んだ物は残す（済んだあとにまた頼まれたら新しく積む）
 */
export function pushAsks(world: WorldState, person: string, kinds: ReadonlyArray<AskKind>, at: number): WorldState {
  if (kinds.length === 0) return world;
  const own = [...(world.asks?.[person] ?? [])];
  let changed = false;
  for (const kind of kinds) {
    if (own.some((a) => a.kind === kind && a.done === null)) continue;
    own.push({ kind, at, done: null });
    changed = true;
  }
  return changed ? { ...world, asks: { ...(world.asks ?? {}), [person]: own } } : world;
}

/**
 * 返事に載った頼み事（往復の them の行と訪問）を世界に積む。手を打った要求でも、保存した物からの作り直しでも同じ所を通す
 * （lib/drill/actions.ts の applyResult）
 */
export function withResultAsks(world: WorldState, person: string | null, r: ActionResult): WorldState {
  if (!person) return world;
  let w = world;
  if (r.visit) w = pushAsks(w, person, r.visit.asks, r.atMinute);
  for (const l of r.talk ?? []) if (l.who === "them" && l.asks) w = pushAsks(w, person, l.asks, l.minute);
  return w;
}

// ---------- 保存した物を読む（lib/drill/db.ts の asResult） ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function lineOf(v: unknown): TalkLine | null {
  if (!v || typeof v !== "object") return null;
  const l = v as Partial<TalkLine>;
  if ((l.who !== "cm" && l.who !== "them") || typeof l.text !== "string" || !isNum(l.minute)) return null;
  const asks = asksOf(l.asks, TALK_ASKS_MAX);
  return {
    who: l.who,
    text: l.text,
    ai: l.ai === true,
    minute: l.minute,
    ...(isTalkAsk(l.ask) ? { ask: l.ask } : {}),
    ...(l.who === "them" && asks.length > 0 ? { asks } : {}),
  };
}

function visitOf(v: unknown): VisitReport | null {
  if (!v || typeof v !== "object") return null;
  const x = v as Partial<VisitReport>;
  const str = (s: unknown) => (typeof s === "string" && s.trim() ? s : null);
  return { condition: str(x.condition), asks: asksOf(x.asks, VISIT_ASKS_MAX), speech: str(x.speech), ai: x.ai === true };
}

/** 返事の payload の往復・切った時刻・訪問の様子（形が違えば無し）。保存の形を読む所が 1 行で足せるように */
export function dialogueFields(p: { talk?: unknown; talkEnd?: unknown; visit?: unknown }): Pick<ActionResult, "talk" | "talkEnd" | "visit"> {
  const talk = Array.isArray(p.talk) ? p.talk.map(lineOf).filter((l): l is TalkLine => l !== null) : [];
  const visit = visitOf(p.visit);
  return {
    ...(talk.length > 0 ? { talk } : {}),
    ...(isNum(p.talkEnd) ? { talkEnd: p.talkEnd } : {}),
    ...(visit ? { visit } : {}),
  };
}
