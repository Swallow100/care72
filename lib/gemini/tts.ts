// 声（Gemini TTS）。読むだけで、考える所には使わない（docs/SPEC.md「構成」）。
//
// - 読ませる文は lib/pseudonym の印付きの物だけ（pseudonymizeText の戻り）。氏名・住所・電話を渡さない。
// - 仮名（A さん）は「あなた」と読む。伏せた所の印（（氏名）など）は印のまま読ませず、ふつうの言葉にする。
//   家族役の言葉で本人を指すときは、仮名でなく続柄（妻・母）で書く（仮名だと「あなた」になる）。
// - 鍵は Cloudflare の env.GEMINI_API_KEY（手元は .dev.vars）。無ければ AiNotConfigured。
// - 呼ぶ前に Claude と同じ事業所の 1 日の上限を確かめ、ai_calls に用途 voice で 1 行残す。
// - SDK は fetch だけで動く web の入口を使う（Workers で google-auth-library を持ち込まないため）。
//   呼び方は Gemini API の音声生成の案内（Interactions API）のとおり。返る音声は WAV（16 bit・mono・24 kHz）。

import { GoogleGenAI } from "@google/genai/web";
import { keyOf, type AiEnv } from "../claude/client.ts";
import { AiBadOutput, AiCallFailed, AiNotConfigured } from "../claude/errors.ts";
import { beginCall, type AiContext } from "../claude/usage.ts";
import {
  assertForClaude,
  findLeaks,
  PseudonymLeakError,
  type ForClaude,
  type PseudonymKey,
} from "../pseudonym/index.ts";

export const TTS_MODEL = "gemini-3.8-flash-tts";
/** 既定の声。役ごとに声を分けるのは呼ぶ側（T21） */
export const DEFAULT_VOICE = "Kore";
export const TTS_TIMEOUT_MS = 60_000;

export type TtsParams = {
  model: string;
  input: string;
  response_format: { type: "audio"; mime_type: "audio/wav" };
  generation_config: { speech_config: Array<{ voice: string }> };
};

export type TtsReply = {
  output_audio?: { data?: string; mime_type?: string };
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
};

/** speak が使う所だけの形。テストはこれを満たす偽物を渡す（本物の API を呼ばない） */
export interface TtsClient {
  interactions: {
    create(params: TtsParams, options?: { timeout_ms?: number }): Promise<TtsReply>;
  };
}

export function createTtsClient(env: Pick<AiEnv, "GEMINI_API_KEY">): TtsClient {
  const apiKey = keyOf(env.GEMINI_API_KEY);
  if (!apiKey) throw new AiNotConfigured("gemini");
  const ai = new GoogleGenAI({ apiKey });
  return {
    interactions: {
      create: async (params, options) => {
        const r = await ai.interactions.create(params, options);
        return { output_audio: r.output_audio, usage: r.usage };
      },
    },
  };
}

// 仮名: lib/pseudonym の aliasFor の形（A さん・AB さん）
const ALIAS = /(?<![A-Za-z])[A-Z]{1,3}[ 　]?さん/g;

/** 読み上げる文にする。仮名は「あなた」、伏せた所の印はふつうの言葉に */
export function toSpokenText(text: string): string {
  return text
    .replace(ALIAS, "あなた")
    .replaceAll("（氏名）", "その方")
    .replaceAll("（町名）", "近く")
    .replaceAll("（電話）", "電話番号");
}

export type SpeakRequest = {
  text: ForClaude<{ text: string }>;
  voice?: string;
  /** あれば、読み上げる文に元の氏名・電話などが残っていないかを確かめる */
  key?: PseudonymKey;
};

export type SpeakResult = {
  readonly ai: true;
  readonly model: string;
  readonly purpose: "voice";
  readonly voice: string;
  readonly mimeType: "audio/wav";
  readonly audio: Uint8Array;
};

export type SpeakContext = AiContext & {
  /** 差し替え口（テスト）。無ければ env の鍵で作る */
  tts?: TtsClient;
};

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 仮名の文を声にする。
 * 失敗: AiNotConfigured（鍵なし）・AiLimitReached（上限）・PseudonymLeakError（元の情報が残る）・AiCallFailed・AiBadOutput。
 */
export async function speak(req: SpeakRequest, ctx: SpeakContext): Promise<SpeakResult> {
  assertForClaude(req.text);
  const spoken = toSpokenText(req.text.text);
  if (req.key) {
    const leaks = findLeaks(spoken, req.key);
    if (leaks.length > 0) throw new PseudonymLeakError(leaks);
  }
  const voice = req.voice ?? DEFAULT_VOICE;
  const tts = ctx.tts ?? createTtsClient(ctx.env);
  const params: TtsParams = {
    model: TTS_MODEL,
    input: spoken,
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice }] },
  };

  const ticket = await beginCall(ctx, "voice", TTS_MODEL);
  let reply: TtsReply;
  try {
    reply = await tts.interactions.create(params, { timeout_ms: TTS_TIMEOUT_MS });
  } catch (e) {
    await ticket.fail("api_error");
    throw new AiCallFailed("api_error", e);
  }
  const used = {
    model: TTS_MODEL,
    inputTokens: reply.usage?.total_input_tokens ?? null,
    outputTokens: reply.usage?.total_output_tokens ?? null,
  };
  const data = reply.output_audio?.data;
  const mime = reply.output_audio?.mime_type;
  if (!data || (mime && mime !== "audio/wav")) {
    await ticket.fail("bad_output", used);
    throw new AiBadOutput(data ? "format" : "no_audio");
  }
  await ticket.ok(used);
  return { ai: true, model: TTS_MODEL, purpose: "voice", voice, mimeType: "audio/wav", audio: fromBase64(data) };
}
