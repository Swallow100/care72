// 声のテスト。本物の API は呼ばない（偽の client を渡す）。
import { describe, expect, it } from "vitest";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { d1UsageStore, type AiContext } from "../claude/usage.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured } from "../claude/errors.ts";
import type { AiCallRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { pseudonymize, pseudonymizeText, PseudonymLeakError, type PseudonymInput } from "../pseudonym/index.ts";
import {
  createTtsClient,
  DEFAULT_VOICE,
  speak,
  toSpokenText,
  TTS_MODEL,
  type SpeakContext,
  type TtsClient,
  type TtsParams,
  type TtsReply,
} from "./tts.ts";

const kobayashi = SEED_PEOPLE[1];
const kobayashiInput: PseudonymInput = {
  person: kobayashi.person,
  ledger: kobayashi.ledger,
  contacts: kobayashi.contacts,
  clocks: kobayashi.clocks,
  consents: seedConsents(kobayashi),
};
const { key } = pseudonymize([kobayashiInput], { on: "2026-11-02" });
const surname = kobayashi.person.name.split(" ")[0];

// "RIFF" の 4 バイト
const WAV_B64 = btoa("RIFF");

function fake(answer: (p: TtsParams) => TtsReply | Promise<TtsReply> = () => ({
  output_audio: { data: WAV_B64, mime_type: "audio/wav" },
  usage: { total_input_tokens: 12, total_output_tokens: 300 },
})) {
  const calls: Array<{ params: TtsParams; options: unknown }> = [];
  const tts: TtsClient = {
    interactions: {
      create: async (params, options) => {
        calls.push({ params, options });
        return answer(params);
      },
    },
  };
  return { tts, calls };
}

function setup(env: AiContext["env"] = { GEMINI_API_KEY: "dummy" }) {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  const ctx = (tts?: TtsClient): SpeakContext => ({
    env,
    usage: d1UsageStore(d1FromSqlite(db)),
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-02T03:00:00.000Z"),
    tts,
  });
  const rows = () => db.prepare("SELECT * FROM ai_calls").all() as unknown as AiCallRow[];
  return { ctx, rows };
}

describe("読み上げる文", () => {
  it("仮名は「あなた」、伏せた所の印はふつうの言葉", () => {
    expect(toSpokenText("A さん、けがはありますか")).toBe("あなた、けがはありますか");
    expect(toSpokenText("AB さんの呼吸器")).toBe("あなたの呼吸器");
    expect(toSpokenText("（氏名）が来た。（町名）の（電話）")).toBe("その方が来た。近くの電話番号");
  });
});

describe("speak", () => {
  it("仮名の文を「あなた」で読ませ、WAV と「AI」の印を返す。氏名は渡らない", async () => {
    const { ctx, rows } = setup();
    const { tts, calls } = fake();
    const text = pseudonymizeText(`${surname}さん、呼吸器の電池はあと何時間ですか`, key);
    const r = await speak({ text, key }, ctx(tts));
    expect(r).toMatchObject({ ai: true, model: TTS_MODEL, purpose: "voice", voice: DEFAULT_VOICE, mimeType: "audio/wav" });
    expect(new TextDecoder().decode(r.audio)).toBe("RIFF");

    expect(calls[0].params).toEqual({
      model: TTS_MODEL,
      input: "あなた、呼吸器の電池はあと何時間ですか",
      response_format: { type: "audio", mime_type: "audio/wav" },
      generation_config: { speech_config: [{ voice: DEFAULT_VOICE }] },
    });
    expect(calls[0].params.input).not.toContain(surname);
    expect(calls[0].options).toEqual({ timeout_ms: 60_000 });
    expect(rows()).toMatchObject([
      { purpose: "voice", model: TTS_MODEL, status: "ok", input_tokens: 12, output_tokens: 300 },
    ]);
  });

  it("声を選べる", async () => {
    const { ctx } = setup();
    const { tts, calls } = fake();
    await speak({ text: pseudonymizeText("妻の呼吸器が止まりそうです", key), voice: "Charon" }, ctx(tts));
    expect(calls[0].params.generation_config.speech_config).toEqual([{ voice: "Charon" }]);
  });

  it("鍵が無ければ AiNotConfigured。上限は減らさない", async () => {
    const { ctx, rows } = setup({});
    await expect(speak({ text: pseudonymizeText("こんにちは", key) }, ctx())).rejects.toBeInstanceOf(AiNotConfigured);
    expect(rows()).toHaveLength(0);
    expect(() => createTtsClient({ GEMINI_API_KEY: " " })).toThrow(AiNotConfigured);
  });

  it("鍵があれば本物の client を作る（ここでは呼ばない）", () => {
    expect(typeof createTtsClient({ GEMINI_API_KEY: "dummy" }).interactions.create).toBe("function");
  });

  it("Claude と同じ 1 日の上限に数える", async () => {
    const { ctx } = setup({ GEMINI_API_KEY: "dummy", AI_DAILY_LIMIT: "1" });
    const { tts, calls } = fake();
    await speak({ text: pseudonymizeText("こんにちは", key) }, ctx(tts));
    await expect(speak({ text: pseudonymizeText("こんにちは", key) }, ctx(tts))).rejects.toBeInstanceOf(AiLimitReached);
    expect(calls).toHaveLength(1);
  });

  it("仮名化の層を通っていない文は、型で通らず、実行しても止まる", async () => {
    const { ctx } = setup();
    const { tts, calls } = fake();
    // @ts-expect-error 素の文は渡せない
    await expect(speak({ text: { text: kobayashi.person.name } }, ctx(tts))).rejects.toThrow("lib/pseudonym");
    expect(calls).toHaveLength(0);
  });

  it("key を渡せば、読み上げる文に元の情報が残っていないかを確かめる", async () => {
    const { ctx } = setup();
    const { tts, calls } = fake();
    // 仮名化の層は台帳に無い並びを伏せきれないことがある。ここでは別の本人の key で作った文を、小林さんの key で確かめる
    const other = pseudonymize([{ ...kobayashiInput, person: { ...kobayashiInput.person, id: "x", name: "架空 太郎", kana: "カクウ タロウ" } }], {
      on: "2026-11-02",
    });
    const text = pseudonymizeText(`${kobayashi.person.name}さんに伝えて`, other.key);
    await expect(speak({ text, key }, ctx(tts))).rejects.toBeInstanceOf(PseudonymLeakError);
    expect(calls).toHaveLength(0);
  });

  it("API の失敗と、音声の無い返事は失敗", async () => {
    const { ctx, rows } = setup();
    const { tts } = fake(() => Promise.reject(new Error("つながらない")));
    await expect(speak({ text: pseudonymizeText("こんにちは", key) }, ctx(tts))).rejects.toBeInstanceOf(AiCallFailed);
    const { tts: t2 } = fake(() => ({ output_audio: {} }));
    await expect(speak({ text: pseudonymizeText("こんにちは", key) }, ctx(t2))).rejects.toMatchObject({
      name: "AiBadOutput",
      reason: "no_audio",
    });
    const { tts: t3 } = fake(() => ({ output_audio: { data: WAV_B64, mime_type: "audio/l16" } }));
    await expect(speak({ text: pseudonymizeText("こんにちは", key) }, ctx(t3))).rejects.toBeInstanceOf(AiBadOutput);
    expect(rows().map((r) => r.error)).toEqual(["api_error", "bad_output", "bad_output"]);
  });
});
