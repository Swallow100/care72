// 発災時の声の聞き取りの会話（docs/tasks/T137.md）。本人のスマホが 20 秒押さない人に、短い会話で状況を聞く。
// ここは決まり（コード）だけで、画面・音・通信・Claude に触らない。端末（lib/signals/phone.ts）とサーバー（talk-http.ts）が
// 同じ関数で次の手を決める。訓練（lib/drill）の本人役の答えも同じ形（TalkLog）で通せる。
//
//   最初の問い（定型文。AI の告知から）→ 聞く → 答えを見る（planTalk）
//   ├ 命に関わる言葉（火・水・息・挟まれ・血）→ 決まった文（119 の文と「すぐ しらせます」）で締める。AI の言葉は使わない
//   ├ 本人が終えたい（「もういい」など）→ 決まった文で締める
//   ├ 聞き取れない（無音・うめき声・短すぎる）が 2 回続いた → ボタンの答え方（はいなら緑、いいえなら赤）。応答不明瞭の印
//   ├ 上限（10 往復・5 分）に近づいた → 決まった文で締めて「また あとで ききます」
//   └ ほか → 次の 1 文。Claude（Haiku）が話題と言い方を決め、門（gateLine）で確かめる。外れた・呼べない時は話題の決まった問い
//
// - 話題は決まった範囲だけ（TALK_TOPICS）。言い方は AI が相手に合わせて易しく短く。表が読む 2 問（けが・動けるか）を聞くまでは
//   AI が「つかめた」と言っても終えない（その問いを決まった文で聞く）
// - 答えを表の入力（4 つの列）にするのは、決まった問いのまま聞いた時だけ（言葉の一致。T49 と同じで Claude は使わない）。
//   AI が言い換えた問いの答えは表に渡さない（「けがは ないですか」の「はい」を取り違えないため）
// - 応答不明瞭は事実（無音・うめき声・短すぎる が続いた）からコードが付ける。AI は付けない。色と順に使わない
// - 締めの文はどれも 119 の文で終わる（出し分けない）。命に関わる言葉のときは、それを先に言うだけ

import { EMERGENCY_TEXT } from "../forms/own-sheet.ts";
import { easy, plainText } from "../forms/easy-words.ts";
import { TALK_PHRASES, VOICE_PROMPT_TEXT } from "./phrases.ts";
import { answeredOutside, matchVoiceAnswer, questionOf, type Answers, type QuestionId } from "./questions.ts";

// ---------- 上限（案。docs/DECISIONS.md「声の聞き取りの会話」） ----------

/** 1 回の会話で聞く問いの数の上限（最初の問いを含む）。これに着いたら締める */
export const TALK_MAX_TURNS = 10;
/** 1 回の会話の長さの上限（ミリ秒）。残りが 1 往復ぶんを切ったら締める */
export const TALK_MAX_MS = 300_000;
/** 1 往復に見込む長さ（読む・聞く・考える）。残りがこれを切ったら次を聞かずに締める */
export const TALK_TURN_RESERVE_MS = 30_000;
/** 1 回の会話で Claude を呼ぶ回数の上限（事業所の 1 日の上限 200 を 1 人で使い切らないため）。超えたら決まった問いで続ける */
export const TALK_MAX_AI = 6;
/** 聞き取れない（無音・うめき声・短すぎる）がこれだけ続いたらボタンの答え方へ */
export const TALK_UNCLEAR_MAX = 2;
/** 同じ話題を聞く回数の上限（言い換えて 1 回聞き直すまで） */
export const TALK_TOPIC_MAX_ASKS = 2;

// ---------- 話題 ----------

/** 聞く話題（決まった範囲）。今いる所・けが・動けるか・水・火やガス・機器や電気・薬・そばの人・連絡してほしい人 */
export const TALK_TOPICS = ["injured", "canMove", "place", "water", "fireGas", "device", "hasMedicine", "nearby", "callee"] as const;
export type TalkTopic = (typeof TALK_TOPICS)[number];

/** 表が読む 2 問（けが・動けるか）。これを聞くまでは「つかめた」で終えない */
export const TALK_REQUIRED: readonly TalkTopic[] = ["injured", "canMove"];

export type TopicSpec = {
  /** 問いの表の問い（決まった問いの文と、答えを取る言葉の一致）。無ければ決まった文だけで、答えは取らない */
  question: QuestionId | null;
  /** 読む文（ふりがなを落とした文） */
  text: string;
  /** 画面の文（やさしい日本語、{漢字|よみ}） */
  easy: string;
  /** ケアマネの画面の話題の名前 */
  label: string;
  /** 台帳に機器がある人だけ */
  needsDevice?: true;
};

const fromQuestion = (id: QuestionId, label: string, extra: Partial<TopicSpec> = {}): TopicSpec => {
  const q = questionOf(id);
  return { question: id, text: q.voice, easy: q.easy, label, ...extra };
};

export const TALK_TOPIC_SPECS: Readonly<Record<TalkTopic, TopicSpec>> = {
  injured: fromQuestion("injured", "けが"),
  canMove: fromQuestion("canMove", "動けるか"),
  place: fromQuestion("atHome", "場所"),
  water: fromQuestion("water", "水"),
  fireGas: fromQuestion("fireGas", "火・ガス"),
  device: fromQuestion("device", "機器", { needsDevice: true }),
  hasMedicine: fromQuestion("hasMedicine", "薬"),
  nearby: fromQuestion("nearby", "そばの人"),
  callee: { question: null, text: voiceOf(TALK_PHRASES.callee), easy: TALK_PHRASES.callee, label: "連絡先" },
};

export function isTalkTopic(v: unknown): v is TalkTopic {
  return typeof v === "string" && (TALK_TOPICS as readonly string[]).includes(v);
}

/** この人に聞ける話題（機器は台帳に機器がある人だけ） */
export function topicsFor(hasDevice: boolean): TalkTopic[] {
  return TALK_TOPICS.filter((t) => hasDevice || !TALK_TOPIC_SPECS[t].needsDevice);
}

// ---------- 問いの表（T137b。話題ごとの最初の問いと、答えに合わせて 1 段深く聞く問い） ----------
//
// 決まった言い方の表。AI はこの中から問いを選び、言い換えるだけ（新しい問いを作らない）。最初の問いの id は話題と同じ。
// 1 段深く聞く問いは、元の問い（parents）を聞いたあとだけ聞ける。Claude が呼べない時（決まった問いで続ける時）は、
// 取れた答え（when）で深く聞くかを決める。聞くのは事実だけで、はい・いいえで答えられる形を中心に（言葉の出にくい人でも進む）。
// 診断・重さ・点数は聞かない。

export type TalkItem = {
  /** 問いの id（最初の問いは話題と同じ） */
  id: string;
  topic: TalkTopic;
  /** 1 段深く聞く問いの元（どれかを聞いたあとに聞ける）。最初の問いは空 */
  parents: readonly string[];
  /** 決まった問いで続けるとき、取れた答えからこの問いを聞くか（1 段深く聞く問いだけ） */
  when?: (answers: Answers) => boolean;
} & TopicSpec;

const said = (a: Answers, id: QuestionId, ...choices: string[]) => {
  const c = a[id]?.choice;
  return c !== undefined && choices.includes(c);
};

/** 1 段深く聞く問い。question があれば問いの表の文（答えを言葉の一致で取る）、無ければ markup が決まった文 */
function follow(
  id: string,
  topic: TalkTopic,
  parents: readonly string[],
  when: TalkItem["when"],
  label: string,
  from: { question: QuestionId } | { markup: string },
  extra: Partial<TopicSpec> = {},
): TalkItem {
  const spec: TopicSpec =
    "question" in from ? fromQuestion(from.question, label, extra) : { question: null, text: voiceOf(from.markup), easy: from.markup, label, ...extra };
  return { id, topic, parents, ...(when ? { when } : {}), ...spec };
}

export const TALK_ITEMS: readonly TalkItem[] = [
  ...TALK_TOPICS.map((t): TalkItem => ({ id: t, topic: t, parents: [], ...TALK_TOPIC_SPECS[t] })),
  // けが ある → どこか・血が出ているか・動かせるか
  follow("injuryPart", "injured", ["injured"], (a) => said(a, "injured", "yes"), "部位", { question: "injuryPart" }),
  follow("bleeding", "injured", ["injured"], (a) => said(a, "injured", "yes"), "出血", { question: "bleeding" }),
  follow("injuryMove", "injured", ["injured"], (a) => said(a, "injured", "yes"), "動かせるか", { markup: TALK_PHRASES.injuryMove }),
  // 動けない → 何かに挟まれているか・誰か呼べるか。動ける → 外に出られるか
  follow("pinned", "canMove", ["canMove"], (a) => said(a, "canMove", "no"), "挟まれ", { markup: TALK_PHRASES.pinned }),
  follow("callHelp", "nearby", ["canMove", "nearby"], (a) => said(a, "canMove", "no") || said(a, "nearby", "alone"), "呼べるか", {
    markup: TALK_PHRASES.callHelp,
  }),
  follow("exit", "canMove", ["canMove"], (a) => said(a, "canMove", "yes") && !answeredOutside(a), "外へ", { question: "exit" }),
  // 家 → 家のどこ。家でない → どこ
  follow("floor", "place", ["place"], (a) => said(a, "atHome", "yes"), "階", { question: "floor" }),
  follow("where", "place", ["place"], (a) => said(a, "atHome", "no"), "場所", { question: "place" }),
  // 機器 → 電池の残り・予備
  follow("battery", "device", ["device"], (a) => a.device !== undefined, "電池", { markup: TALK_PHRASES.battery }, { needsDevice: true }),
  follow("spare", "device", ["device"], (a) => said(a, "device", "stopped"), "予備", { markup: TALK_PHRASES.spare }, { needsDevice: true }),
  // 薬 ある → 何日分か（はい・いいえで）
  follow("medDays", "hasMedicine", ["hasMedicine"], (a) => said(a, "hasMedicine", "yes"), "日数", { markup: TALK_PHRASES.medDays }),
  // 連絡してほしい人 → 家族か
  follow("calleeFamily", "callee", ["callee"], undefined, "家族へ", { markup: TALK_PHRASES.calleeFamily }),
];

const ITEMS = new Map(TALK_ITEMS.map((i) => [i.id, i]));
export const TALK_ITEM_IDS = TALK_ITEMS.map((i) => i.id) as [string, ...string[]];

export function itemOf(id: string): TalkItem | undefined {
  return ITEMS.get(id);
}

export function isTalkItem(v: unknown): v is string {
  return typeof v === "string" && ITEMS.has(v);
}

/** この人に聞ける問い（機器は台帳に機器がある人だけ） */
export function itemsFor(hasDevice: boolean): TalkItem[] {
  return TALK_ITEMS.filter((i) => hasDevice || !i.needsDevice);
}

// ---------- 会話の記録の形 ----------

/**
 * 1 回の答えの聞こえ方。text 言葉がある・unclear うめき声・言いよどみだけ・短すぎる・silent 1 字も取れない、
 * press ボタンで答えた・skip ボタンで とばした（ボタンの答え方のとき）
 */
export const TALK_HEARD = ["text", "unclear", "silent", "press", "skip"] as const;
export type TalkHeard = (typeof TALK_HEARD)[number];

/** 終わり方。grasped つかめた・wants_end 本人が終えたい・send「送る」を押した・unclear 聞き取れずボタンで答え終えた・cap 上限・danger 命に関わる言葉 */
export const TALK_ENDS = ["grasped", "wants_end", "send", "unclear", "cap", "danger"] as const;
export type TalkEnd = (typeof TALK_ENDS)[number];

/** 命に関わる言葉の種類 */
export const DANGER_KINDS = ["fire", "water", "breath", "trapped", "bleeding"] as const;
export type DangerKind = (typeof DANGER_KINDS)[number];

/** 誰が問いの文を作ったか。ai は Claude（AI の印）、fixed は決まった文 */
export type TalkBy = "ai" | "fixed";

/** 問いの 1 往復 */
export type TalkTurn = {
  /** 読んだ文の全部（前置き＋問い） */
  ask: string;
  by: TalkBy;
  /** 話題。open は最初の問い（定型文） */
  topic: TalkTopic | "open";
  /** 問いの表の id（T137b。1 段深く聞く問い。無ければ話題の最初の問い） */
  item?: string;
  /** 本人の言葉（その回の文字起こし、言い換えない）。無ければ null */
  reply: string | null;
  heard: TalkHeard;
  /** 決まった問いのまま聞いて、言葉の一致（かボタン）で取れた答え。問いの表の id と選択肢 */
  answer?: { id: QuestionId; choice: string };
  /** 聞き始めた時刻（ISO 8601、端末の時計） */
  at: string;
};

/** 1 回の会話の記録。端末が持ち、聞くたびにサーバーへ送る（後勝ち）。録音を添えるときにも送る */
export type TalkLog = {
  v: 1;
  /** 会話を始めた時刻（ISO 8601、端末の時計） */
  startedAt: string;
  turns: TalkTurn[];
  /** 応答不明瞭（聞き取れないが続いてボタンの答え方に替えた）。コードが付ける */
  unclear: boolean;
  danger: DangerKind | null;
  end: TalkEnd | null;
  /** 締めに読んだ文。締めていなければ null */
  closing: string | null;
  /** Claude を呼んだ回数（門で外れた回も数える） */
  aiCalls: number;
};

export function newTalkLog(startedAt: string): TalkLog {
  return { v: 1, startedAt, turns: [], unclear: false, danger: null, end: null, closing: null, aiCalls: 0 };
}

// ---------- 読む文 ----------

/** 1 回に読む文 */
export type TalkLine = {
  /** 読む文の全部（前置き＋問い。ふりがなを落とした文） */
  text: string;
  /** 問いの部分（決まった問いのままかを見る） */
  question: string;
  /** 画面の文（決まった文は {漢字|よみ}。AI の文は null で、画面は yomi でふりがなを付ける） */
  easy: string | null;
  by: TalkBy;
  topic: TalkTopic | "open";
  /** 問いの表の id（T137b）。無ければ話題の最初の問い */
  item?: string;
  /** 声の URL（Gemini TTS。app/api/signals/voice）。無ければ端末の読み上げ。最初の問いは定型文の声（playPrompt） */
  voice?: string | null;
};

/** 端末が読む声の URL（app/api/signals/voice）。決まった文は id（文はサーバーの表から引く）、AI の文は hash */
export const talkFixedVoicePath = (id: string) => `/api/signals/voice?fixed=${encodeURIComponent(id)}`;
export const talkVoicePath = (hash: string) => `/api/signals/voice?talk=${hash}`;
/** 声の URL として受ける形（サーバーの返事の確かめ） */
export const TALK_VOICE_PATH = /^\/api\/signals\/voice\?(fixed=(topic|button|close|filler)-[A-Za-z_]{1,24}|talk=[0-9a-f]{32})$/;

function voiceOf(markup: string): string {
  return plainText(easy(markup)).replace(/ /g, "");
}

/** 最初の問い（定型文。AI の告知から） */
export const TALK_OPENING: TalkLine = { text: VOICE_PROMPT_TEXT, question: VOICE_PROMPT_TEXT, easy: null, by: "fixed", topic: "open" };

/** 問いの表の決まった問い（話題の最初の問いは話題の id） */
export function fixedLine(id: string): TalkLine {
  const s = itemOf(id);
  if (!s) throw new Error(`問いの表に無い: ${id}`);
  return { text: s.text, question: s.text, easy: s.easy, by: "fixed", topic: s.topic, item: s.id, voice: talkFixedVoicePath(`topic-${s.id}`) };
}

/** 次の 1 文を待つ間の相づち（T137b。作り置きの声）。heard は本人が話したあと、wait は聞き取れなかったあと */
export const TALK_FILLERS = { heard: TALK_PHRASES.fillerHeard, wait: TALK_PHRASES.fillerWait } as const;
export type TalkFiller = keyof typeof TALK_FILLERS;
export const fillerText = (f: TalkFiller) => voiceOf(TALK_FILLERS[f]);
export const fillerVoice = (f: TalkFiller) => talkFixedVoicePath(`filler-${f}`);

/** ボタンの答え方の 1 問（問いのあとに「はいなら みどり…」） */
export function buttonLine(id: QuestionId): string {
  return `${questionOf(id).voice}。${voiceOf(TALK_PHRASES.yesNoHint)}`;
}

/** ボタンの答え方の 1 問の声 */
export const buttonVoice = (id: QuestionId) => talkFixedVoicePath(`button-${id}`);
/** 締めの文の声 */
export const closingVoice = (end: TalkEnd) => talkFixedVoicePath(`close-${end}`);

/** 締めの文（画面の文と読む文）。どの締めも 119 の文で終わる。危ない言葉のときは 119 の文を先に */
export function closingOf(end: TalkEnd): { easy: string; text: string } {
  if (end === "danger") {
    return { easy: TALK_PHRASES.notify, text: `${EMERGENCY_TEXT}。${voiceOf(TALK_PHRASES.notify)}` };
  }
  const head = end === "cap" ? `${TALK_PHRASES.thanks}。${TALK_PHRASES.later}` : TALK_PHRASES.thanks;
  return { easy: head, text: `${voiceOf(head)}。${EMERGENCY_TEXT}` };
}

// ---------- 答えを見る ----------

/** 比べる形（空白・句読点を落とす） */
export const squashTalk = (s: string) => s.normalize("NFKC").replace(/[\s　、。,.!！?？「」]/g, "");

/** 短くても意味のある答え（うめき声と見分ける） */
const SHORT_ANSWERS = new Set(["はい", "うん", "ええ", "いいえ", "いえ", "ううん", "いや", "ない", "ある", "いい", "おう", "だめ", "まだ"]);
/** 言いよどみの言葉（落としてから残りを見る） */
const FILLER_WORDS = ["えーと", "えっと", "あのー", "あの", "そのー", "うーん", "んー"];
/** うめき声・言いよどみの字 */
const FILLER_CHARS = /[あぁいぃうぅえぇおぉんーっ〜～…・アァイィウゥエェオォンッ]/g;

/** 1 回の答えの聞こえ方（言葉だけで決める。Claude は使わない） */
export function heardOf(reply: string | null): Extract<TalkHeard, "text" | "unclear" | "silent"> {
  const s = squashTalk(reply ?? "");
  if (!s) return "silent";
  if (SHORT_ANSWERS.has(s)) return "text";
  let rest = s;
  for (const w of FILLER_WORDS) rest = rest.replaceAll(w, "");
  rest = rest.replace(FILLER_CHARS, "");
  if (!rest || s.length <= 1) return "unclear";
  return "text";
}

// ---------- 読んだ文の声の拾い（T137b。読む間も聞き続けるので、端末のマイクが自分の声を拾うことがある） ----------

const poolOf = (spoken: string) => {
  const pool = new Map<string, number>();
  for (const c of Array.from(squashTalk(spoken))) pool.set(c, (pool.get(c) ?? 0) + 1);
  return pool;
};

/** 拾った言葉の字のうち、読んだ文にある字の割合（字の数で。順は見ない） */
export function echoOverlap(heard: string, spoken: string): number {
  const h = Array.from(squashTalk(heard));
  if (h.length === 0) return 0;
  const pool = poolOf(spoken);
  let hit = 0;
  for (const c of h) {
    const n = pool.get(c) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(c, n - 1);
    }
  }
  return hit / h.length;
}

/** 読んだ文の声らしい（字の 75% 以上が読んだ文にある）。読む間の話し始めの見分けに使う（短い答えも含めて声を止めない側に倒す） */
export const echoLike = (heard: string, spoken: string) => echoOverlap(heard, spoken) >= 0.75;

/**
 * 答えから読んだ文の声の拾いを外す。区切り（改行）ごとに、頭から読んだ文の字で続く所が長い（5 字以上かつ読んだ文の半分以上）なら外し、
 * 漢字とかなの違いで続かなくても、区切り全体が読んだ文の声らしく長ければ外す。短い答え（「はい」「あります」）は残す
 */
export function stripEcho(text: string, spoken: string): string {
  const spokenLen = Array.from(squashTalk(spoken)).length;
  const min = Math.max(5, Math.ceil(spokenLen * 0.5));
  return text
    .split(/\n+/)
    .map((seg) => {
      const chars = Array.from(squashTalk(seg));
      const pool = poolOf(spoken);
      let p = 0;
      for (; p < chars.length; p++) {
        const n = pool.get(chars[p]) ?? 0;
        if (n === 0) break;
        pool.set(chars[p], n - 1);
      }
      if (p >= min) return chars.slice(p).join("");
      if (chars.length >= min && echoLike(seg, spoken)) return "";
      return seg.trim();
    })
    .filter(Boolean)
    .join("\n");
}

/** 命に関わる言葉（コードの一覧）。打ち消し（「ない」「ません」）が続く所は数えない */
export const DANGER_WORDS: Readonly<Record<DangerKind, readonly string[]>> = {
  fire: ["火事", "かじ", "火が", "ひがでて", "燃え", "もえて", "煙", "けむり", "ガス臭", "ガスくさ", "ガスのにおい", "ガスの匂い", "ガスの臭い"],
  water: ["水が来", "みずがき", "水が入", "みずがはい", "水が上が", "みずがあが", "浸水", "しんすい", "流され", "ながされ", "水につか", "みずにつか"],
  breath: ["息が苦し", "いきがくるし", "息苦し", "いきぐるし", "息ができ", "いきができ", "息がしにく", "いきがしにく"],
  trapped: ["下敷き", "したじき", "挟まれ", "はさまれ", "閉じ込め", "とじこめ"],
  bleeding: ["血が止まらない", "血がとまらない", "ちがとまらない"],
};

const NEGATION = /^.{0,5}?(ない|ません|ではな)/;

function hasWord(s: string, word: string): boolean {
  const w = squashTalk(word);
  for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) {
    if (!NEGATION.test(s.slice(i + w.length))) return true;
  }
  return false;
}

/**
 * 命に関わる言葉が出たか（本人の言葉か、決まった問いの答え）。言葉の一覧だけで決める（Claude は使わない）。
 * 水の問いで 床まで・ひざまで・腰より上、火やガスの問いで する、も同じに数える
 */
export function dangerOf(reply: string | null, answer?: TalkTurn["answer"], asked?: Pick<TalkTurn, "topic" | "by">): DangerKind | null {
  if (answer?.id === "water" && ["floor", "knee", "waist"].includes(answer.choice)) return "water";
  if (answer?.id === "fireGas" && answer.choice === "yes") return "fire";
  // 決まった水の問い（水は きて いますか）に「はい」: 選択肢に はい が無いので言葉の一致では取れないが、水が来ている
  if (asked?.topic === "water" && asked.by === "fixed" && YES_REPLY.test(squashTalk(reply ?? ""))) return "water";
  const s = squashTalk(reply ?? "");
  if (!s) return null;
  for (const kind of DANGER_KINDS) if (DANGER_WORDS[kind].some((w) => hasWord(s, w))) return kind;
  return null;
}

/** 「はい」の答え（決まった水の問いのあと） */
const YES_REPLY = /^(はい|うん|ええ|そう|きて(る|います|いる)|来て(る|います|いる))/;

/** 本人が終えたいと言った（コードの一覧） */
export const END_WORDS = ["もういい", "もうええ", "おわり", "終わり", "おしまい", "やめて", "もうやめ"] as const;

export function wantsEnd(reply: string | null): boolean {
  const s = squashTalk(reply ?? "");
  return s.length > 0 && END_WORDS.some((w) => s.includes(squashTalk(w)));
}

/**
 * 決まった問いのまま聞いた回の答え（言葉の一致。T49 の matchVoiceAnswer と同じで Claude は使わない）。
 * AI が言い換えた問い・問いの表に無い話題・最初の問いは取らない
 */
export function answerOf(line: Pick<TalkLine, "question" | "topic" | "item">, reply: string | null): TalkTurn["answer"] | undefined {
  if (line.topic === "open") return undefined;
  const spec = itemOf(line.item ?? line.topic);
  if (!spec) return undefined;
  if (!spec.question || squashTalk(line.question) !== squashTalk(spec.text)) return undefined;
  const choice = matchVoiceAnswer(reply, spec.question);
  return choice ? { id: spec.question, choice } : undefined;
}

/** 答えを足した 1 往復 */
export function heardTurn(line: TalkLine, reply: string | null, at: string): TalkTurn {
  const r = reply?.trim() || null;
  const answer = answerOf(line, r);
  const item = line.topic !== "open" && line.item && line.item !== line.topic ? { item: line.item } : {};
  return { ask: line.text, by: line.by, topic: line.topic, ...item, reply: r, heard: heardOf(r), ...(answer ? { answer } : {}), at };
}

// ---------- 次の手 ----------

export type TalkContext = {
  hasDevice: boolean;
  /** それまでに押した・声で取れた答え（押した物は聞き直さない） */
  answers: Answers;
  /** 今（ミリ秒） */
  now: number;
};

export type TalkPlan =
  | { kind: "danger"; danger: DangerKind }
  | { kind: "close"; end: TalkEnd }
  | { kind: "buttons" }
  /** 次の 1 文。items は聞ける問いの表の id（AI はこの中から選ぶ）、fallback は決まった問いで聞く問い */
  | { kind: "ask"; items: string[]; fallback: string };

/** 問いの数（最初の問いを含む。ボタンの答え方の回は数えない） */
export const askedTurns = (log: TalkLog) => log.turns.filter((t) => t.heard !== "press" && t.heard !== "skip").length;

const isUnclear = (t: TalkTurn) => t.heard === "unclear" || t.heard === "silent";

/** 終わりから数えた、聞き取れない回の続き */
export function unclearRun(log: TalkLog): number {
  let n = 0;
  for (let i = log.turns.length - 1; i >= 0 && isUnclear(log.turns[i]); i--) n++;
  return n;
}

/** 往復の問いの id（1 段深く聞く問いは item、ほかは話題） */
export const turnItem = (t: Pick<TalkTurn, "topic" | "item">) => t.item ?? t.topic;

/** 問いを聞いた回数 */
const asksOf = (log: TalkLog, id: string) => log.turns.filter((t) => turnItem(t) === id).length;

/** 会話の中で取れた答えと押した答えを合わせた物（深く聞くかの when に使う） */
const knownAnswers = (log: TalkLog, answers: Answers): Answers => ({ ...talkAnswers(log), ...answers });

/**
 * 問いが済んだか: 押した答えがある・言葉で答えた・聞き直しても聞き取れなかった（TALK_TOPIC_MAX_ASKS）。
 * 決まった問いで取れた答え（answer）も済み
 */
export function itemDone(log: TalkLog, id: string, answers: Answers): boolean {
  const q = itemOf(id)?.question;
  if (q && answers[q]) return true;
  const turns = log.turns.filter((t) => turnItem(t) === id);
  return turns.some((t) => t.heard === "text" || t.answer !== undefined) || turns.length >= TALK_TOPIC_MAX_ASKS;
}

/** 話題の最初の問いが済んだか（前からの名前） */
export const topicDone = (log: TalkLog, topic: TalkTopic, answers: Answers) => itemDone(log, topic, answers);

/** 1 段深く聞く問いの元を聞いたか */
const parentAsked = (log: TalkLog, item: TalkItem) => item.parents.length === 0 || item.parents.some((p) => asksOf(log, p) > 0);

/**
 * まだ済んでいない問い。決まった問いで続けるときの順: 表の 2 問 → 取れた答えで深く聞く問い（when）→ ほかの話題の最初の問い。
 * 深く聞く問いは、元を聞いて when が当たる物だけ（Claude が呼べない時は答えで決める）
 */
export function openItems(log: TalkLog, ctx: Pick<TalkContext, "hasDevice" | "answers">): string[] {
  const known = knownAnswers(log, ctx.answers);
  const avail = itemsFor(ctx.hasDevice).filter((i) => !itemDone(log, i.id, ctx.answers));
  const tops = avail.filter((i) => i.parents.length === 0).map((i) => i.id);
  const deeper = avail.filter((i) => i.parents.length > 0 && parentAsked(log, i) && i.when?.(known)).map((i) => i.id);
  const required = tops.filter((t) => (TALK_REQUIRED as readonly string[]).includes(t));
  return [...required, ...deeper, ...tops.filter((t) => !required.includes(t))];
}

/** まだ済んでいない話題（前からの名前。話題の最初の問いだけ） */
export function openTopics(log: TalkLog, ctx: Pick<TalkContext, "hasDevice" | "answers">): TalkTopic[] {
  return openItems(log, ctx).filter((id): id is TalkTopic => isTalkTopic(id));
}

/** 表の 2 問で、まだ聞いていない（済んでいない）物 */
export function missingRequired(log: TalkLog, ctx: Pick<TalkContext, "hasDevice" | "answers">): TalkTopic[] {
  return TALK_REQUIRED.filter((t) => !itemDone(log, t, ctx.answers));
}

/**
 * 1 往復を聞いたあとの次の手（コードの決まり。順に当てる）:
 * 命に関わる言葉 → 本人が終えたい → 聞き取れないの続き → 上限 → 聞く話題が無い（つかめた）→ 次の 1 文
 */
export function planTalk(log: TalkLog, ctx: TalkContext): TalkPlan {
  const last = log.turns.at(-1);
  if (last) {
    const danger = dangerOf(last.reply, last.answer, last);
    if (danger) return { kind: "danger", danger };
    if (wantsEnd(last.reply)) return { kind: "close", end: "wants_end" };
  }
  if (unclearRun(log) >= TALK_UNCLEAR_MAX) return { kind: "buttons" };
  const elapsed = ctx.now - Date.parse(log.startedAt);
  if (askedTurns(log) >= TALK_MAX_TURNS || (Number.isFinite(elapsed) && elapsed >= TALK_MAX_MS - TALK_TURN_RESERVE_MS)) {
    return { kind: "close", end: "cap" };
  }
  const open = openItems(log, ctx);
  if (open.length === 0) return { kind: "close", end: "grasped" };
  // AI が選べる問い: 済んでいない話題の最初の問いと、元を聞いた深く聞く問い（答えに合わせて AI が選ぶ。ただし元の答えが言葉の一致・押した答えで
  // 分かっていて合わない物〔動けない のあとの 外に出られるか〕は外す）、言葉で答えたがもう 1 回聞き直せる問い（噛み合わない答えの言い換え）
  const known = knownAnswers(log, ctx.answers);
  const items = itemsFor(ctx.hasDevice)
    .filter((i) => parentAsked(log, i))
    .filter((i) => !(i.when && parentsAnswered(i, known) && !i.when(known)))
    .filter(
      (i) =>
        open.includes(i.id) ||
        (!itemDone(log, i.id, ctx.answers) && i.parents.length > 0) ||
        (asksOf(log, i.id) > 0 && asksOf(log, i.id) < TALK_TOPIC_MAX_ASKS && !answeredByPress(i, ctx.answers) && !answeredInTalk(log, i.id)),
    )
    .map((i) => i.id);
  return { kind: "ask", items, fallback: open[0] };
}

/** 深く聞く問いの元の答えが全部分かっている（言葉の一致・押した答え） */
function parentsAnswered(i: TalkItem, known: Answers): boolean {
  return i.parents.every((p) => {
    const q = itemOf(p)?.question;
    return q !== null && q !== undefined && known[q] !== undefined;
  });
}

function answeredByPress(i: TalkItem, answers: Answers): boolean {
  return i.question !== null && answers[i.question] !== undefined;
}

function answeredInTalk(log: TalkLog, id: string): boolean {
  return log.turns.some((x) => turnItem(x) === id && x.answer !== undefined);
}

/** ボタンの答え方で聞く問い（表の 4 列の問い。押した・取れた答えのある物は聞かない） */
export const BUTTON_QUESTIONS: readonly QuestionId[] = ["injured", "canMove", "atHome", "hasMedicine"];

export function buttonQuestions(log: TalkLog, answers: Answers): QuestionId[] {
  const got = new Set<QuestionId>([
    ...(Object.keys(answers) as QuestionId[]),
    ...log.turns.flatMap((t) => (t.answer ? [t.answer.id] : [])),
  ]);
  return BUTTON_QUESTIONS.filter((id) => !got.has(id));
}

/** 問いの表の問いの話題（ボタンの答え方の回の記録に使う。BUTTON_QUESTIONS はどれも話題にある）。話題に無い問いは投げる */
export function topicOfQuestion(id: QuestionId): TalkTopic {
  const t = TALK_TOPICS.find((x) => TALK_TOPIC_SPECS[x].question === id);
  if (!t) throw new Error(`会話の話題に無い問い: ${id}`);
  return t;
}

/** ボタンの答え方の選択肢: はい（緑）・いいえ（赤）を問いの表の yes・no の選択肢に引く */
export function yesNoChoice(id: QuestionId, yes: boolean): string | null {
  const c = questionOf(id).choices.find((x) => (yes ? x.yes : x.no));
  return c?.id ?? null;
}

/** 会話から取れた答え（決まった問いの言葉の一致とボタン）。answers に足して送る */
export function talkAnswers(log: TalkLog): Answers {
  const out: Answers = {};
  for (const t of log.turns) {
    if (t.answer) out[t.answer.id] = { choice: t.answer.choice, via: t.heard === "press" ? "press" : "voice" };
  }
  return out;
}

// ---------- AI の 1 文の門 ----------

/** 前置きの長さの上限（字） */
export const TALK_PREFACE_MAX = 20;
/** 問いの長さの上限（字） */
export const TALK_QUESTION_MAX = 40;

/** 言わない事（AI の 1 文に出たら決まった問いに戻す）。id は評価の台とテストで数える名前 */
export const TALK_BANNED: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "diagnosis", re: /診断|病名|病気|症状|重症|軽症|重傷|軽傷|緊急度|判定|骨折|脳卒中|心筋梗塞|梗塞|熱中症|脱水|低体温|感染|発作/ },
  { id: "dose", re: /[0-9０-９]|mg|ミリ|錠|粒|単位|シーシー|cc/i },
  {
    id: "advice",
    re: /飲んで|のんで|飲ま|服用|冷やし|ひやし|温め|あたため|止血|押さえ|おさえ|横にな|よこにな|安静|あんせい|動かないで|うごかないで|動かさないで|うごかさないで|避難して|ひなんして|逃げて|にげて|移動して|いどうして|ください|下さい|ましょう|なさい|すべき|したほうが|した方が/,
  },
  { id: "reassure", re: /(大丈夫|だいじょうぶ)(です|だ|でしょう)(?!か)|心配(いりません|ない|ありません)|しんぱい(いりません|ない|ありません)|安心|あんしん|助かります|たすかります|すぐ(行|い)きます|向かいます|むかいます|助けに|たすけに/ },
  { id: "emergency", re: /119|救急|きゅうきゅう|消防|しょうぼう|警察|けいさつ|病院|びょういん/ },
  { id: "personal", re: /名前|なまえ|住所|じゅうしょ|電話番号|でんわばんごう|生年月日|（氏名）|（町名）|（電話）/ },
  { id: "latin", re: /[A-Za-zＡ-Ｚａ-ｚ]/ },
];

export type GateResult = { ok: true; preface: string; question: string; text: string } | { ok: false; reason: string };

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * AI の 1 文を確かめる（コードの門）。前置き 20 字・問い 40 字まで、問いは「か」「？」で終わる 1 つ、言わない事が無い、改行が無い。
 * 外れたら理由を返す（呼ぶ側は話題の決まった問いに戻す）
 */
export function gateLine(x: { preface: string; question: string }): GateResult {
  let preface = tidy(x.preface ?? "");
  let question = tidy(x.question ?? "");
  // 問いを 2 つ以上並べた（「けがは ありますか。うごけますか」）
  if (question.split(/[。．]/).filter((x) => /(か|[？?])$/.test(x.trim())).length > 1) return { ok: false, reason: "many" };
  // 問いの欄に受け止めの一言が入っていたら（「わかりました。けがは ありますか」）、最後の句点で前置きと問いに分ける
  const cut = question.replace(/[。．]$/, "").lastIndexOf("。");
  if (!preface && cut > 0) {
    preface = question.slice(0, cut).trim();
    question = question.slice(cut + 1).trim();
  }
  if (!question) return { ok: false, reason: "empty" };
  if (Array.from(preface).length > TALK_PREFACE_MAX || Array.from(question).length > TALK_QUESTION_MAX) {
    return { ok: false, reason: "long" };
  }
  if (!/(か|か[？?]|[？?])$/.test(question)) return { ok: false, reason: "not_question" };
  if ((question.match(/[？?]/g) ?? []).length > 1 || /[。．]/.test(question.replace(/[。．]$/, ""))) return { ok: false, reason: "many" };
  const all = `${preface}${question}`;
  for (const b of TALK_BANNED) if (b.re.test(all) || b.re.test(squashTalk(all))) return { ok: false, reason: b.id };
  const text = preface ? `${preface.replace(/[。．]$/, "")}。${question}` : question;
  return { ok: true, preface, question, text };
}

// ---------- 送る形の確かめ ----------

/** 1 往復の文の長さの上限（送られた物の確かめ） */
export const TALK_TEXT_MAX = 400;
/** 往復の数の上限（ボタンの答え方の回を含む） */
export const TALK_TURNS_MAX = TALK_MAX_TURNS + BUTTON_QUESTIONS.length + 2;

const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const shortText = (v: unknown, max = TALK_TEXT_MAX): v is string => typeof v === "string" && v.length <= max;

/** 送られた会話の記録を確かめる。形の違い・知らない値・長すぎる物は null */
export function parseTalkLog(v: unknown): TalkLog | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || !isIso(o.startedAt) || !Array.isArray(o.turns) || o.turns.length > TALK_TURNS_MAX) return null;
  if (typeof o.unclear !== "boolean" || typeof o.aiCalls !== "number" || !Number.isInteger(o.aiCalls) || o.aiCalls < 0 || o.aiCalls > 100) {
    return null;
  }
  if (o.danger !== null && !(DANGER_KINDS as readonly unknown[]).includes(o.danger)) return null;
  if (o.end !== null && !(TALK_ENDS as readonly unknown[]).includes(o.end)) return null;
  if (o.closing !== null && !shortText(o.closing)) return null;
  const turns: TalkTurn[] = [];
  for (const raw of o.turns) {
    if (!raw || typeof raw !== "object") return null;
    const t = raw as Record<string, unknown>;
    if (!shortText(t.ask) || (t.by !== "ai" && t.by !== "fixed")) return null;
    if (t.topic !== "open" && !isTalkTopic(t.topic)) return null;
    if (t.item !== undefined && (!isTalkItem(t.item) || itemOf(t.item)?.topic !== t.topic)) return null;
    if (t.reply !== null && !shortText(t.reply)) return null;
    if (!(TALK_HEARD as readonly unknown[]).includes(t.heard) || !isIso(t.at)) return null;
    let answer: TalkTurn["answer"];
    if (t.answer !== undefined) {
      const a = t.answer as { id?: unknown; choice?: unknown } | null;
      if (!a || typeof a.id !== "string" || typeof a.choice !== "string") return null;
      const q = (() => {
        try {
          return questionOf(a.id as QuestionId);
        } catch {
          return null;
        }
      })();
      if (!q || !q.choices.some((c) => c.id === a.choice)) return null;
      answer = { id: q.id, choice: a.choice };
    }
    turns.push({
      ask: t.ask,
      by: t.by,
      topic: t.topic as TalkTurn["topic"],
      ...(typeof t.item === "string" ? { item: t.item } : {}),
      reply: (t.reply as string | null) ?? null,
      heard: t.heard as TalkHeard,
      ...(answer ? { answer } : {}),
      at: t.at,
    });
  }
  return {
    v: 1,
    startedAt: o.startedAt,
    turns,
    unclear: o.unclear,
    danger: (o.danger as DangerKind | null) ?? null,
    end: (o.end as TalkEnd | null) ?? null,
    closing: (o.closing as string | null) ?? null,
    aiCalls: o.aiCalls,
  };
}

/** 表に書いた会話を読む（壊れていれば null） */
export function readTalkLog(text: string | null | undefined): TalkLog | null {
  if (!text) return null;
  try {
    return parseTalkLog(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 本人の言葉だけを改行でつないだ文（録音の文字起こしと分類の元。問いの文は入れない） */
export function talkReplies(log: TalkLog): string | null {
  const r = log.turns.flatMap((t) => (t.reply ? [t.reply] : []));
  return r.length > 0 ? r.join("\n") : null;
}

/** 問いと答えの文（分類の手がかり。仮名化の門を通してから渡す）。「問: …／答: …（無音）」の行 */
export function talkDialogText(log: TalkLog): string {
  return log.turns
    .map((t) => {
      const a = t.reply ?? (t.heard === "silent" ? "（無音）" : t.heard === "unclear" ? "（不明瞭）" : t.heard === "skip" ? "（とばした）" : "（なし）");
      const pressed = t.heard === "press" && t.answer ? `（ボタン: ${questionOf(t.answer.id).choices.find((c) => c.id === t.answer!.choice)?.label ?? ""}）` : "";
      return `問: ${t.ask}\n答: ${t.heard === "press" ? pressed : a}`;
    })
    .join("\n");
}
