// 定型文の声（赤を押して 20 秒操作が無いときに流す。docs/tasks/T10.md）。
// 声にするのは決まった 1 文（VOICE_PROMPT_TEXT）だけで、名前・住所・本人の言葉を入れない。Claude は呼ばない。
//
// Gemini TTS の鍵があれば 1 回だけ作って R2（voice/…）に置き、次からはそれを返す（文が同じなので作り直さない）。
// 作るときは事業所の 1 日の上限に数える（用途 voice）。本人の役は ai を持たないが、ここは本人の言葉を送らない定型文で、
// 作るのは鍵ごと・声ごとに 1 回だけなので、録音（recording）を持つ役が開けるようにした。
// 鍵が無い・上限・失敗のときは null（端末はブラウザの speechSynthesis で同じ文を読む）。

import { hasGeminiKey } from "../claude/client.ts";
import { pseudonymizeText, type PseudonymKey } from "../pseudonym/index.ts";
import { DEFAULT_VOICE, speak, TTS_MODEL, type SpeakContext } from "../gemini/tts.ts";
import { VOICE_PROMPT_TEXT } from "./phrases.ts";
import { BUTTON_QUESTIONS, buttonLine, closingOf, fillerText, TALK_ENDS, TALK_FILLERS, TALK_ITEMS, talkVoicePath, type TalkFiller } from "./talk.ts";

/** 文の版。文を変えたら上げる（R2 の古い声を使わない） */
export const VOICE_PROMPT_VERSION = 2;

/** 人の入らない文を仮名化の層に通すための空の鍵 */
const NO_PEOPLE: PseudonymKey = { people: [], contacts: [], rules: [], secrets: [] };

export function voicePromptKey(model = TTS_MODEL, voice = DEFAULT_VOICE): string {
  return `voice/${model}/${voice}/prompt-${VOICE_PROMPT_VERSION}.wav`;
}

/** R2 のうち声の置き場で使う所（配信は env.RECORDINGS、テストは偽物） */
export type VoiceBucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
};

/** 定型文の声（WAV）。置いてあればそれを、無ければ作って置く。作れなければ null */
export async function promptVoice(bucket: VoiceBucket, ctx: SpeakContext): Promise<Uint8Array | null> {
  const key = voicePromptKey();
  const cached = await bucket.get(key);
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  if (!ctx.tts && !hasGeminiKey(ctx.env)) return null;
  try {
    const r = await speak({ text: pseudonymizeText(VOICE_PROMPT_TEXT, NO_PEOPLE) }, ctx);
    await bucket.put(key, r.audio, { httpMetadata: { contentType: r.mimeType } });
    return r.audio;
  } catch (e) {
    console.error("定型文の声を作れない", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

// ---------- 声の聞き取りの会話の 1 文（T137） ----------
//
// 会話の決まった文（問いの表の問い・ボタンの答え方の問い・締め・相づち）は id で頼まれ、文はここの表から引く（端末から文を受けない）。
// 置いてあればそれ、無ければ作って置く（定型文と同じ）。赤を押した時に全部を作り置く（warmTalkVoices。T137b、同じ声で流すため）。
// AI の 1 文は、サーバーが会話の API の中で作り、文の hash で置く。
// GET は hash の物を読むだけ（作らない）。名前・住所は入らない（AI の文は Claude に伏せた文しか見せていない。読む前に仮名化の門も通す）。

/** 会話の声の版。文の言い方を変えたら上げる */
export const TALK_VOICE_VERSION = 1;

/** 会話の決まった文の id と文（問いの表の問い・ボタンの答え方の問い・締め・相づち） */
export function talkFixedTexts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of TALK_ITEMS) out[`topic-${i.id}`] = i.text;
  for (const f of Object.keys(TALK_FILLERS) as TalkFiller[]) out[`filler-${f}`] = fillerText(f);
  for (const id of BUTTON_QUESTIONS) out[`button-${id}`] = buttonLine(id);
  for (const end of TALK_ENDS) out[`close-${end}`] = closingOf(end).text;
  return out;
}

const FIXED_ID = /^(topic|button|close|filler)-[A-Za-z_]{1,24}$/;
const HASH = /^[0-9a-f]{32}$/;

export const isTalkFixedId = (v: string) => FIXED_ID.test(v) && v in talkFixedTexts();
export const isTalkHash = (v: string) => HASH.test(v);

/** 文の hash（sha256 の頭 32 字） */
export async function talkTextHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function talkVoiceKey(hash: string, model = TTS_MODEL, voice = DEFAULT_VOICE): string {
  return `voice/${model}/${voice}/talk-${TALK_VOICE_VERSION}-${hash}.wav`;
}


async function makeVoice(bucket: VoiceBucket, key: string, text: string, ctx: SpeakContext, pkey: PseudonymKey): Promise<Uint8Array | null> {
  if (!ctx.tts && !hasGeminiKey(ctx.env)) return null;
  try {
    const r = await speak({ text: pseudonymizeText(text, pkey), key: pkey }, ctx);
    await bucket.put(key, r.audio, { httpMetadata: { contentType: r.mimeType } });
    return r.audio;
  } catch (e) {
    console.error("会話の声を作れない", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

/** 決まった文の声（GET ?fixed=id）。置いてあればそれ、無ければ作って置く。作れなければ null（端末は読み上げ） */
export async function talkFixedVoice(bucket: VoiceBucket, id: string, ctx: SpeakContext): Promise<Uint8Array | null> {
  const text = talkFixedTexts()[id];
  if (!text) return null;
  const hash = await talkTextHash(text);
  const cached = await bucket.get(talkVoiceKey(hash));
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  return makeVoice(bucket, talkVoiceKey(hash), text, ctx, NO_PEOPLE);
}

/** AI の文の声を読む（GET ?talk=hash）。作らない */
export async function talkVoiceByHash(bucket: VoiceBucket, hash: string): Promise<Uint8Array | null> {
  if (!isTalkHash(hash)) return null;
  const cached = await bucket.get(talkVoiceKey(hash));
  return cached ? new Uint8Array(await cached.arrayBuffer()) : null;
}

/**
 * 作り置きの決まった文の声を全部そろえる（T137b。赤を押した時に端末が 1 回頼む。応答のあとに waitUntil で走らせる）。
 * 置いてある物は作らない（R2 を見るだけ）。無い物を順に作って置く（1 つずつ。1 日の上限に数える。鍵が無ければ何もしない）。
 * 作った数を返す
 */
export async function warmTalkVoices(bucket: VoiceBucket, ctx: SpeakContext, opts: { max?: number; parallel?: number } = {}): Promise<number> {
  if (!ctx.tts && !hasGeminiKey(ctx.env)) return 0;
  const missing: Array<{ key: string; text: string }> = [];
  for (const text of Object.values(talkFixedTexts())) {
    const key = talkVoiceKey(await talkTextHash(text));
    if (!missing.some((m) => m.key === key) && !(await bucket.get(key))) missing.push({ key, text });
  }
  const todo = missing.slice(0, opts.max ?? missing.length);
  // waitUntil の 30 秒に多く収めるため、4 つずつ並べて作る（問いの表の順。先に要る物から）。1 つでも作れなければ止める（上限・鍵の失敗）
  const step = opts.parallel ?? 4;
  let made = 0;
  for (let i = 0; i < todo.length; i += step) {
    const done = await Promise.all(todo.slice(i, i + step).map((m) => makeVoice(bucket, m.key, m.text, ctx, NO_PEOPLE)));
    made += done.filter(Boolean).length;
    if (done.some((d) => !d)) break;
  }
  return made;
}

/**
 * AI の文の声を待つ上限（会話の API の中。T137b で 3 → 9 秒: 端末の読み上げに替えず同じ声で流すため。待つ間は端末が作り置きの相づちを流す）。
 * 過ぎたら端末の読み上げ。作るのは続けて置く
 */
export const TALK_VOICE_WAIT_MS = 9_000;

/**
 * AI の 1 文の声を用意して URL を返す（会話の API の中）。置いてあればすぐ。無ければ作り始め、TALK_VOICE_WAIT_MS で間に合えば URL、
 * 間に合わなければ null（端末の読み上げ）。作るのは keep（waitUntil）で続け、次に同じ文が来たら置いた物を使う。pkey は本人の鍵（読む文に名前が残っていないか）
 */
export async function talkLineVoice(
  bucket: VoiceBucket,
  text: string,
  ctx: SpeakContext,
  pkey: PseudonymKey,
  opts: { waitMs?: number; keep?: (p: Promise<unknown>) => void } = {},
): Promise<string | null> {
  const hash = await talkTextHash(text);
  if (await bucket.get(talkVoiceKey(hash))) return talkVoicePath(hash);
  if (!ctx.tts && !hasGeminiKey(ctx.env)) return null;
  const made = makeVoice(bucket, talkVoiceKey(hash), text, ctx, pkey);
  opts.keep?.(made);
  const r = await Promise.race([made, new Promise<"late">((res) => setTimeout(() => res("late"), opts.waitMs ?? TALK_VOICE_WAIT_MS))]);
  return r && r !== "late" ? talkVoicePath(hash) : null;
}
