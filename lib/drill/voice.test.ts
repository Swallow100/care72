// 訓練の声（docs/tasks/T21.md）のテスト。本物の API は呼ばない（偽の TTS の client と、Map の偽の R2）。
// TTS に氏名・住所・電話が渡らない、役割ごとに声が違う（夫・本人・娘）、R2 に訓練ごとに置き 2 度目は呼ばない、
// Gemini の鍵が無ければ声を作らない（画面は文字だけ）、上限、対象なし、GET の壁。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { AiEnv } from "../claude/client.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { DEFAULT_VOICE, type TtsClient, type TtsParams } from "../gemini/tts.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { actDrill, advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import {
  drillVoice,
  parseVoiceQuery,
  VOICES,
  voiceEnabled,
  voiceGet,
  voiceHref,
  voiceKey,
  voiceOf,
  type VoiceBucket,
  type VoiceClip,
  type VoiceDeps,
} from "./voice.ts";

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;

/** 種の 10 人の氏名・カナ・家族と支援者の名前・電話・町名・生年月日（どれも TTS に渡らない） */
const PERSONAL: string[] = SEED_PEOPLE.flatMap((p) => [
  p.person.name,
  p.person.name.replace(/\s/g, ""),
  p.person.kana,
  ...(p.person.birth_date ? [p.person.birth_date] : []),
  ...(p.ledger.basic.address?.town ? [p.ledger.basic.address.town] : []),
  ...p.contacts.flatMap((c) => [c.name, c.name?.replace(/\s/g, ""), c.phone].filter((x): x is string => typeof x === "string" && x !== "")),
]);

function expectNoPersonalData(text: string) {
  expect(findLeaks(text, ALL_KEY)).toEqual([]);
  for (const v of PERSONAL) expect(text, v).not.toContain(v);
  expect(text).not.toMatch(/090-?0000/);
}

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };
const careManager = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t21";

async function start() {
  expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID)).toEqual({ ok: true, id: ID });
}

async function advanceTo(stepIndex: number) {
  for (;;) {
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    if (row.step >= stepIndex) return;
    expect((await advanceDrill(db, SCOPE, ID, row.step, START)).ok).toBe(true);
  }
}

/** 訓練の安否の id（本人・出どころで探す） */
function signalOf(person: string, source: string): { id: string; transcript: string | null } {
  const row = sqlite
    .prepare("SELECT id, transcript FROM signals WHERE drill_id = ? AND person_id = ? AND source = ? ORDER BY occurred_at, id")
    .all(ID, person, source)
    .at(-1) as { id: string; transcript: string | null } | undefined;
  expect(row, `${person} ${source}`).toBeDefined();
  return row!;
}

// ---------- 偽の TTS と R2 ----------

// "RIFF" の 4 バイト
const WAV_B64 = btoa("RIFF");

function fakeTts() {
  const calls: TtsParams[] = [];
  const tts: TtsClient = {
    interactions: {
      create: async (params) => {
        calls.push(params);
        return { output_audio: { data: WAV_B64, mime_type: "audio/wav" }, usage: { total_input_tokens: 10, total_output_tokens: 200 } };
      },
    },
  };
  return { tts, calls };
}

function fakeBucket() {
  const store = new Map<string, { data: Uint8Array; contentType: string }>();
  const bucket: VoiceBucket = {
    get: async (key) => {
      const o = store.get(key);
      return o ? { arrayBuffer: async () => o.data.slice().buffer } : null;
    },
    put: async (key, value, options) => {
      store.set(key, { data: value.slice(), contentType: options.httpMetadata.contentType });
    },
  };
  return { bucket, store };
}

const KEYED: AiEnv = { GEMINI_API_KEY: "dummy" };

function deps(env: AiEnv = KEYED) {
  const { tts, calls } = fakeTts();
  const { bucket, store } = fakeBucket();
  const d: VoiceDeps = { db, bucket, env, tts, now: () => new Date(START) };
  return { d, calls, store };
}

const voiceRows = () => sqlite.prepare("SELECT purpose, status FROM ai_calls WHERE purpose = 'voice'").all();

// ---------- 声の選び方 ----------

describe("声の選び方", () => {
  it("役割ごとに声を分ける（娘・夫・本人 女・本人 男・支援者）。分からない続柄は既定の声", () => {
    expect(voiceOf({ kind: "family", relation: "娘", sex: null })).toBe(VOICES.familyFemale);
    expect(voiceOf({ kind: "family", relation: "長女", sex: null })).toBe(VOICES.familyFemale);
    expect(voiceOf({ kind: "family", relation: "妻", sex: null })).toBe(VOICES.familyFemale);
    expect(voiceOf({ kind: "family", relation: "孫娘", sex: null })).toBe(VOICES.familyFemale);
    expect(voiceOf({ kind: "family", relation: "夫", sex: null })).toBe(VOICES.familyMale);
    expect(voiceOf({ kind: "family", relation: "長男", sex: null })).toBe(VOICES.familyMale);
    expect(voiceOf({ kind: "family", relation: "息子", sex: null })).toBe(VOICES.familyMale);
    expect(voiceOf({ kind: "family", relation: "甥", sex: null })).toBe(VOICES.familyMale);
    expect(voiceOf({ kind: "family", relation: "娘婿", sex: null })).toBe(VOICES.familyMale);
    expect(voiceOf({ kind: "self", relation: null, sex: "female" })).toBe(VOICES.selfFemale);
    expect(voiceOf({ kind: "self", relation: null, sex: "male" })).toBe(VOICES.selfMale);
    expect(voiceOf({ kind: "supporter", relation: "隣人", sex: null })).toBe(VOICES.supporter);
    expect(voiceOf({ kind: "family", relation: "同居人", sex: null })).toBe(DEFAULT_VOICE);
    expect(voiceOf({ kind: "family", relation: null, sex: null })).toBe(DEFAULT_VOICE);
    expect(voiceOf({ kind: "self", relation: null, sex: null })).toBe(DEFAULT_VOICE);
    // 娘・夫・本人は別の声
    expect(new Set([VOICES.familyFemale, VOICES.familyMale, VOICES.selfFemale, VOICES.selfMale]).size).toBe(4);
  });

  it("鍵の有無（空白だけは無い）、行き先と R2 の鍵の形（id だけ）", () => {
    expect(voiceEnabled({})).toBe(false);
    expect(voiceEnabled({ GEMINI_API_KEY: "  " })).toBe(false);
    expect(voiceEnabled(KEYED)).toBe(true);
    // 配信の Secret は GEMINI_TTS の名前で入っている（lib/claude/client.ts の geminiKeyOf と同じく読む）
    expect(voiceEnabled({ GEMINI_TTS: "k" })).toBe(true);
    expect(voiceEnabled({ GEMINI_TTS: "  " })).toBe(false);
    expect(voiceHref(ID, { signal: `${ID}-1-s0` })).toBe(`/api/drill/voice?drill=${ID}&signal=${ID}-1-s0`);
    expect(voiceHref(ID, { act: "a3" })).toBe(`/api/drill/voice?drill=${ID}&act=a3`);
    expect(voiceKey(ID, { signal: `${ID}-1-s0` })).toBe(`drill/${ID}/${ID}-1-s0.wav`);
    expect(voiceKey(ID, { act: "a3" })).toBe(`drill/${ID}/act-a3.wav`);
  });
});

// ---------- 作る・読む ----------

describe("drillVoice", () => {
  it("大雨 1 時間: 小林の夫の言う事を夫の声に。TTS に名前・電話・町名が渡らず、R2 に置き、ai_calls に voice。2 度目は R2 から", async () => {
    await start();
    await advanceTo(1);
    const s = signalOf("p-02", "family");
    expect(s.transcript).toBe("停電した。呼吸器が電池に切り替わった。3 時間しかもたない");

    const { d, calls, store } = deps();
    const clip: VoiceClip = { signal: s.id };
    const r = await drillVoice(d, { office: DEMO }, ID, clip);
    expect(r).toMatchObject({ ok: true, voice: VOICES.familyMale, cached: false });
    if (r.ok) expect(new TextDecoder().decode(r.audio)).toBe("RIFF");
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("停電した。呼吸器が電池に切り替わった。3 時間しかもたない");
    expect(calls[0].generation_config.speech_config).toEqual([{ voice: VOICES.familyMale }]);
    expectNoPersonalData(JSON.stringify(calls[0]));
    expect(store.get(`drill/${ID}/${s.id}.wav`)).toMatchObject({ contentType: "audio/wav" });
    expect([...store.keys()].join()).not.toMatch(/小林|090/);
    expect(voiceRows()).toEqual([{ purpose: "voice", status: "ok" }]);

    // 同じ物は R2 から（TTS を呼ばない・数えない）
    const again = await drillVoice(d, { office: DEMO }, ID, clip);
    expect(again).toMatchObject({ ok: true, voice: VOICES.familyMale, cached: true });
    if (again.ok) expect(new TextDecoder().decode(again.audio)).toBe("RIFF");
    expect(calls).toHaveLength(1);
    expect(voiceRows()).toHaveLength(1);
  });

  it("文に名前・電話・町名が混ざっても、TTS には伏せた形で渡る（仮名は「あなた」、伏せた所はふつうの言葉）", async () => {
    await start();
    const p02 = SEED_PEOPLE.find((p) => p.person.id === "p-02")!;
    const husband = p02.contacts.find((c) => c.kind === "family")!;
    const town = p02.ledger.basic.address!.town!;
    sqlite
      .prepare(
        `INSERT INTO signals (id, person_id, drill_id, color, source, transcript, occurred_at)
         VALUES (?, 'p-02', ?, 'green', 'family', ?, ?)`,
      )
      .run(`${ID}-0-s9`, ID, `${husband.name}です。${p02.person.name}は家にいます。${town}、${husband.phone}`, START);
    const { d, calls } = deps();
    const r = await drillVoice(d, { office: DEMO }, ID, { signal: `${ID}-0-s9` });
    expect(r).toMatchObject({ ok: true, voice: VOICES.familyMale });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("夫です。あなたは家にいます。近く、電話番号");
    expectNoPersonalData(JSON.stringify(calls[0]));
  });

  it("本人役の言葉にほかの人の町名・地理の架空の町名があっても TTS に渡らない（画面は地区の別名を町名に戻した文。T88）", async () => {
    await start();
    sqlite
      .prepare(
        `INSERT INTO signals (id, person_id, drill_id, color, source, transcript, occurred_at)
         VALUES (?, 'p-02', ?, 'green', 'family', ?, ?)`,
      )
      .run(`${ID}-0-s8`, ID, "みずほし町としおかぜ町が停電、かわなぎ町も", START);
    const { d, calls } = deps();
    const r = await drillVoice(d, { office: DEMO }, ID, { signal: `${ID}-0-s8` });
    expect(r).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    for (const t of ["みずほし", "しおかぜ", "かわなぎ"]) expect(calls[0].input, t).not.toContain(t);
    expectNoPersonalData(JSON.stringify(calls[0]));
  });

  it("役ごとに声が違う: 小林の夫・山田の本人（3 時間の赤の録音）・山田の娘（連絡先電話に出た言葉）", async () => {
    await start();
    // 0 時間: 連絡先電話 → 山田の娘（出る。roll を 0 に固定）
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    const acted = await actDrill(
      db,
      SCOPE,
      ID,
      { step: row.step, actions: stateOfRow(row).actions.length },
      { kind: "call_contact", person: "p-01", target: "c-01-1" },
      START,
      { roll: () => 0 },
    );
    expect(acted).toMatchObject({ ok: true, record: { id: "a1", result: { status: "connected" } } });
    if (!acted.ok) return;
    expect(acted.record.result?.speech).toBeTruthy();

    await advanceTo(2); // 3 時間
    const { d, calls } = deps();
    const husband = await drillVoice(d, { office: DEMO }, ID, { signal: signalOf("p-02", "family").id });
    const yamada = signalOf("p-01", "agent");
    expect(yamada.transcript).toBe("いたい、うごけない");
    const self = await drillVoice(d, { office: DEMO }, ID, { signal: yamada.id });
    const daughter = await drillVoice(d, { office: DEMO }, ID, { act: "a1" });
    expect(husband).toMatchObject({ ok: true, voice: VOICES.familyMale });
    expect(self).toMatchObject({ ok: true, voice: VOICES.selfFemale });
    expect(daughter).toMatchObject({ ok: true, voice: VOICES.familyFemale });
    expect(calls.map((c) => c.generation_config.speech_config[0].voice)).toEqual([
      VOICES.familyMale,
      VOICES.selfFemale,
      VOICES.familyFemale,
    ]);
    expect(calls[1].input).toBe("いたい、うごけない");
    for (const c of calls) expectNoPersonalData(JSON.stringify(c));
  });

  it("Gemini の鍵が無ければ声を作らない（TTS を呼ばず、画面は文字だけ）。R2 にあればそれを返す", async () => {
    await start();
    await advanceTo(1);
    const clip: VoiceClip = { signal: signalOf("p-02", "family").id };
    const none = deps({});
    expect(await drillVoice(none.d, { office: DEMO }, ID, clip)).toEqual({ ok: false, reason: "not_configured" });
    const blank = deps({ GEMINI_API_KEY: " " });
    expect(await drillVoice(blank.d, { office: DEMO }, ID, clip)).toEqual({ ok: false, reason: "not_configured" });
    expect(none.calls).toHaveLength(0);
    expect(blank.calls).toHaveLength(0);
    expect(voiceRows()).toEqual([]);

    // 前に作った声は鍵が無くても返す
    const keyed = deps();
    await drillVoice(keyed.d, { office: DEMO }, ID, clip);
    const later: VoiceDeps = { ...keyed.d, env: {} };
    expect(await drillVoice(later, { office: DEMO }, ID, clip)).toMatchObject({ ok: true, cached: true });
  });

  it("上限 0 の日は limit（TTS を呼ばない）", async () => {
    await start();
    await advanceTo(1);
    const { d, calls } = deps({ GEMINI_API_KEY: "dummy", AI_DAILY_LIMIT: "0" });
    expect(await drillVoice(d, { office: DEMO }, ID, { signal: signalOf("p-02", "family").id })).toEqual({ ok: false, reason: "limit" });
    expect(calls).toHaveLength(0);
  });

  it("TTS が失敗したら failed（R2 に置かない）", async () => {
    await start();
    await advanceTo(1);
    const { d, store } = deps();
    const broken: VoiceDeps = {
      ...d,
      tts: {
        interactions: {
          create: async () => {
            throw new Error("つながらない");
          },
        },
      },
    };
    expect(await drillVoice(broken, { office: DEMO }, ID, { signal: signalOf("p-02", "family").id })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(store.size).toBe(0);
  });

  it("対象なし: 知らない安否・ほかの訓練の形・ほかの事業所・ケアマネの信号・言葉の無い安否・知らない手", async () => {
    await start();
    await advanceTo(1);
    const { d, calls } = deps();
    const s = signalOf("p-02", "family");
    expect(await drillVoice(d, { office: DEMO }, ID, { signal: `${ID}-1-s99` })).toEqual({ ok: false, reason: "not_found" });
    expect(await drillVoice(d, { office: DEMO }, ID, { signal: `other-1-s0` })).toEqual({ ok: false, reason: "not_found" });
    expect(await drillVoice(d, { office: PARTNER }, ID, { signal: s.id })).toEqual({ ok: false, reason: "not_found" });
    expect(await drillVoice(d, { office: DEMO }, "drill-none", { signal: "drill-none-1-s0" })).toEqual({ ok: false, reason: "not_found" });
    sqlite
      .prepare(
        `INSERT INTO signals (id, person_id, drill_id, color, source, transcript, occurred_at)
         VALUES (?, 'p-02', ?, 'green', 'care_manager', 'はい', ?)`,
      )
      .run(`${ID}-1-s8`, ID, START);
    expect(await drillVoice(d, { office: DEMO }, ID, { signal: `${ID}-1-s8` })).toEqual({ ok: false, reason: "not_found" });
    // 言葉の無い安否（1 時間の井上は言う事なし）
    expect(await drillVoice(d, { office: DEMO }, ID, { signal: signalOf("p-08", "agent").id })).toEqual({ ok: false, reason: "not_found" });
    expect(await drillVoice(d, { office: DEMO }, ID, { act: "a1" })).toEqual({ ok: false, reason: "not_found" });
    expect(calls).toHaveLength(0);
  });
});

// ---------- GET の壁 ----------

describe("GET /api/drill/voice", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("問いの形: drill と、signal か act のどちらか 1 つ", () => {
    expect(parseVoiceQuery(q(`drill=${ID}&signal=${ID}-1-s0`))).toEqual({ drillId: ID, clip: { signal: `${ID}-1-s0` } });
    expect(parseVoiceQuery(q(`drill=${ID}&act=a3`))).toEqual({ drillId: ID, clip: { act: "a3" } });
    expect(parseVoiceQuery(q(`drill=${ID}`))).toBeNull();
    expect(parseVoiceQuery(q(`drill=${ID}&signal=${ID}-1-s0&act=a3`))).toBeNull();
    expect(parseVoiceQuery(q(`drill=${ID}&signal=x-1-s0`))).toBeNull();
    expect(parseVoiceQuery(q(`drill=${ID}&act=../a3`))).toBeNull();
    expect(parseVoiceQuery(q(`drill=..%2Fx&act=a3`))).toBeNull();
    expect(parseVoiceQuery(q(`act=a3`))).toBeNull();
  });

  it("ログインなし 401・ほかの役 403・形が違う 400・対象なし 404・未設定 503・声は audio/wav", async () => {
    await start();
    await advanceTo(1);
    const s = signalOf("p-02", "family");
    const { d } = deps();
    const ok = `drill=${ID}&signal=${s.id}`;
    expect((await voiceGet(d, null, q(ok))).status).toBe(401);
    expect((await voiceGet(d, careManager({ role: "medical" }), q(ok))).status).toBe(403);
    expect((await voiceGet(d, careManager(), q(`drill=${ID}`))).status).toBe(400);
    expect((await voiceGet(d, careManager(), q(`drill=${ID}&signal=${ID}-1-s99`))).status).toBe(404);
    expect((await voiceGet(d, careManager({ office: PARTNER }), q(ok))).status).toBe(404);

    const off = await voiceGet({ ...d, env: {} }, careManager(), q(ok));
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ ok: false, label: "未設定" });

    const res = await voiceGet(d, careManager(), q(ok));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("RIFF");

    const limited = await voiceGet(
      { ...deps({ GEMINI_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }).d },
      careManager(),
      q(`drill=${ID}&signal=${signalOf("p-07", "agent").id}`),
    );
    expect(limited.status).toBe(429);
  });
});
