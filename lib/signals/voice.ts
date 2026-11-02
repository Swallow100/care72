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

/** 文の版。文を変えたら上げる（R2 の古い声を使わない） */
export const VOICE_PROMPT_VERSION = 1;

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
