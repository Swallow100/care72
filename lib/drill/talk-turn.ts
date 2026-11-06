// 通話の往復の 1 回の作り方（docs/tasks/T155.md の 3・4）。外へ掛けた電話（lib/drill/talk.ts、T93）と掛かってきた電話
// （lib/drill/incoming-talk.ts、T127）の両方がここを呼ぶ。D1 も Claude も使わない（本人役の口の返事を受け取って行と世界を作るだけ）。
//
// - ケアマネの行: 決まった問いの言葉か、口が伏せて名前に戻した自由の文。声で入れた文は voice の印（T155。色と順には使わない）
// - 相手の行: 本人役の言葉を想定の門（T125 の gateWords）に通し、全部落ちたら固定の言葉（AI の印なし）。落とした数は世界の gated に
// - 頼み事は world.asks に積み、Claude を呼んだら counts.call に 1 つ足す（1 訓練の上限。1 日の上限は askJson の ai_calls）
// - 時計: 1 往復は文の長さで 1〜3 分（talkMinutesOf）。前の 1 往復 2 分の決まりから替えた
// 本人ごとの帳面（T130 の言われた事）は、外へ掛けた電話は手の記録から、掛かってきた電話は world.told から本人役が読む（呼ぶ側が積む）。

import { ZERO_COUNTS } from "./clock.ts";
import { pushAsks, TALK_ASK_WORDS, TALK_FIXED_SPEECH, type TalkAsk, type TalkLine, type TalkReply } from "./dialogue.ts";
import type { FitProfile } from "./fit.ts";
import { gateWords, tallyGate } from "./gate.ts";
import type { WorldState } from "./scenarios.ts";

// ---------- 時計 ----------

/** 1 往復の時計の下限と上限（分） */
export const TALK_MINUTES_MIN = 1;
export const TALK_MINUTES_MAX = 3;
/** 1 往復の字数（自分の言葉と相手の言葉の合計）の境目。これ以下は 1 分、次の境目以下は 2 分、超えれば 3 分 */
export const TALK_SHORT_CHARS = 40;
export const TALK_LONG_CHARS = 90;

/** 1 往復で進む時計（分）。自分の言葉と相手の言葉の字数の合計で 1〜3 分（空白は数えない） */
export function talkMinutesOf(said: string, reply: string): number {
  const n = [...`${said}${reply}`.replace(/\s+/g, "")].length;
  if (n <= TALK_SHORT_CHARS) return TALK_MINUTES_MIN;
  if (n <= TALK_LONG_CHARS) return 2;
  return TALK_MINUTES_MAX;
}

// ---------- 1 往復 ----------

export type TalkRoundInput = {
  world: WorldState;
  person: string;
  /** ケアマネが言った時刻（発災からの分） */
  at: number;
  ask?: TalkAsk;
  /** 自由の文（伏せる前。口が無いときはこのまま行に残す） */
  text?: string;
  /** 声で入れた文（T155。自由の文のときだけ） */
  voice?: boolean;
  /** 本人役の口の返事。口が無い（鍵なし）・上限なら null */
  reply: TalkReply | null;
  /** 想定の表（T125）。未決は null */
  fit: FitProfile | null;
};

export type TalkRound = { cm: TalkLine; them: TalkLine; world: WorldState; replyAt: number; minutes: number };

/** 往復を 1 つ作る（行 2 つと、頼み事・数え・門の数えを足した世界） */
export function talkRound(i: TalkRoundInput): TalkRound {
  const said = i.reply?.said ?? (i.ask ? TALK_ASK_WORDS[i.ask] : (i.text?.trim() ?? ""));
  const ai = i.reply?.speech != null && i.reply.ai;
  let world = i.world;
  // 想定の門（T125。合わない文と内部の名前の残る文を落とす。全部落ちたら固定の言葉）
  const gated = ai ? gateWords(i.reply?.speech ?? null, i.fit, world) : null;
  if (gated && gated.dropped.length > 0) world = tallyGate(world, "persona", gated.dropped);
  const themAi = ai && gated?.text != null;
  const themText = (themAi ? gated?.text : null) ?? TALK_FIXED_SPEECH;
  const minutes = talkMinutesOf(said, themText);
  const replyAt = i.at + minutes;
  const cm: TalkLine = {
    who: "cm",
    text: said,
    ai: false,
    minute: i.at,
    ...(i.ask ? { ask: i.ask } : {}),
    ...(!i.ask && i.voice ? { voice: true } : {}),
  };
  const asks = themAi && i.reply ? i.reply.asks : [];
  const them: TalkLine = { who: "them", text: themText, ai: themAi, minute: replyAt, ...(asks.length > 0 ? { asks: [...asks] } : {}) };
  world = pushAsks(world, i.person, asks, replyAt);
  if (i.reply?.called) {
    const c = { ...ZERO_COUNTS, ...(world.counts ?? {}) };
    world = { ...world, counts: { ...c, call: c.call + 1 } };
  }
  return { cm, them, world, replyAt, minutes };
}
