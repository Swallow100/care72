// 本人のスマホの信号と録音の保存（docs/tasks/T10.md）: 信号の保存の形と出どころ、経過の 1 行、役の壁、平時は断る、
// 送り直しで重ねない、録音の鍵（R2）と文字起こし、保存のあとに担当一覧の色が変わる。D1 は node:sqlite に種の 10 人。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { easy, kanjiWithoutRuby, plainText } from "../forms/easy-words.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { newSignalId, NO_ANSWERS, occurredAtOnServer, SignalBodySchema, type SignalBody } from "./body.ts";
import { recordingPost, signalPost } from "./http.ts";
import { recordingLogBody, signalLogBody } from "./labels.ts";
import { AI_NOTICE_TEXT, AI_NOTICE_VOICE, allPhoneWords, emergencyWords, VOICE_PROMPT_TEXT } from "./phrases.ts";
import { attachRecording, audioTypeOf, recordingKey, saveSignal, signalScope } from "./save.ts";
import { promptVoice, voicePromptKey } from "./voice.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

/** 審査員の「本人のスマホ」（山田 ハナ）。書き手は審査員のアカウント */
const self = (p: Partial<Principal> = {}): Principal => ({
  role: "self",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: "山田 ハナ",
  office: DEMO,
  caseloadOf: null,
  personId: "p-01",
  contactId: null,
  ...p,
});

const careManager: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};

/** 地震（停電なし）の発災 2026-11-04 10:00 JST。h 時間あとは at(h) */
const QUAKE = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();

async function earthquake() {
  const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
  expect(r).toEqual({ ok: true, changed: true });
}

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const red = (answers: Partial<SignalBody["answers"]> = {}, time = at(1)): SignalBody => ({
  id: id(),
  color: "red",
  whereNow: null,
  answers: { ...NO_ANSWERS, ...answers },
  occurredAt: time,
  sentAt: time,
});
const green = (whereNow: SignalBody["whereNow"] = "home", time = at(1)): SignalBody => ({
  id: id(),
  color: "green",
  whereNow,
  answers: { ...NO_ANSWERS },
  occurredAt: time,
  sentAt: time,
});

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

class FakeBucket {
  objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();
  async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType });
    return null as never;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? ({ arrayBuffer: async () => o.bytes.buffer } as never) : null;
  }
}

function recordingForm(fields: Record<string, string>, audio?: Blob): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (audio) f.set("audio", audio, "recording");
  return f;
}

const caseloadScope = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

describe("決まった言葉", () => {
  it("本人の画面の言葉の漢字には全部ふりがな。119 の 1 行は本人の 1 枚と同じ", () => {
    expect(kanjiWithoutRuby(allPhoneWords())).toEqual([]);
    expect(plainText(emergencyWords())).toBe("いのちの 危険が あるときは 119");
  });

  it("定型文の声に名前を入れない（決まった 1 文だけ）。頭に AI の告知（T48）", () => {
    expect(VOICE_PROMPT_TEXT).toBe(
      "これはAI、人ではないしくみが聞いています。こたえはケアマネジャーにとどきます。大丈夫ですか。状況を説明してください",
    );
    expect(VOICE_PROMPT_TEXT.startsWith(AI_NOTICE_VOICE)).toBe(true);
    // 画面の告知と声の告知は同じ 1 か所の文から
    expect(plainText(easy(AI_NOTICE_TEXT)).replace(/ /g, "")).toBe(AI_NOTICE_VOICE.replace("、", "（").replace("が聞", "）が聞"));
  });
});

describe("送る形", () => {
  it("緑は 1 問（どこに いますか）だけ、赤は 4 問。色と答えが合わない物は断る", () => {
    expect(SignalBodySchema.safeParse(green()).success).toBe(true);
    expect(SignalBodySchema.safeParse(red({ injured: true })).success).toBe(true);
    expect(SignalBodySchema.safeParse({ ...green(), whereNow: null }).success).toBe(false);
    expect(SignalBodySchema.safeParse({ ...green(), answers: { ...NO_ANSWERS, injured: true } }).success).toBe(false);
    expect(SignalBodySchema.safeParse({ ...red(), whereNow: "home" }).success).toBe(false);
    expect(SignalBodySchema.safeParse({ ...red(), color: "unknown" }).success).toBe(false);
    expect(SignalBodySchema.safeParse({ ...red(), id: "s-1" }).success).toBe(false);
    expect(SignalBodySchema.safeParse({ ...red(), occurredAt: "きのう" }).success).toBe(false);
  });

  it("起きた時刻はサーバーの時計から送るまでの遅れを引く（端末の時計のずれを使わない）", () => {
    // 端末の時計が 5 分進んでいて、押してから 10 秒で送った
    const body = { occurredAt: "2026-11-04T01:05:00.000Z", sentAt: "2026-11-04T01:05:10.000Z" };
    expect(occurredAtOnServer(body, "2026-11-04T01:00:10.000Z")).toBe("2026-11-04T01:00:00.000Z");
    // 端末の時計が戻った（遅れが負）なら 0、72 時間を超える遅れは 72 時間
    expect(occurredAtOnServer({ occurredAt: at(2), sentAt: at(1) }, at(5))).toBe(at(5));
    expect(occurredAtOnServer({ occurredAt: at(0), sentAt: at(100) }, at(100))).toBe(at(28));
  });

  it("信号の id は UUID（crypto.randomUUID が無い端末でも）", () => {
    const fallback = newSignalId({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => a });
    expect(fallback).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(SignalBodySchema.safeParse({ ...red(), id: newSignalId() }).success).toBe(true);
  });
});

describe("役の壁", () => {
  it("書けるのは本人のスマホの役だけ（ケアマネ・医療班・行政・役未選択は書けない。家族は T11 の family.test.ts）", () => {
    const scope = { officeId: "office-demo", personId: "p-01", authorId: "acct-judge", writer: { kind: "self" } };
    expect(signalScope(self())).toEqual(scope);
    expect(signalScope(self(), "recording")).toEqual(scope);
    for (const role of ["care_manager", "government", "medical", "unselected"] as const) {
      expect(signalScope(self({ role })), role).toBeNull();
    }
    // 家族は連絡先の行が無ければ書けない。録音は家族も書けない
    expect(signalScope(self({ role: "family" }))).toBeNull();
    expect(signalScope(self({ role: "family", contactId: "c-01-1" }), "recording")).toBeNull();
    expect(signalScope(self({ personId: null }))).toBeNull();
    expect(signalScope(self({ office: null }))).toBeNull();
    expect(signalScope(null)).toBeNull();
  });

  it("POST: ログインなしは 401、ケアマネ（save を持つ）は 403。表に何も入らない", async () => {
    await earthquake();
    expect((await signalPost(db, null, red(), at(1))).status).toBe(401);
    expect((await signalPost(db, careManager, red(), at(1))).status).toBe(403);
    expect((await signalPost(db, self({ role: "medical", personId: null }), red(), at(1))).status).toBe(403);
    expect((await signalPost(db, self({ role: "family", contactId: null }), red(), at(1))).status).toBe(403);
    expect(count("signals")).toBe(0);
    expect(count("timeline_entries")).toBe(0);
  });

  it("本人は自分の信号しか送れない: 送った物の中の本人の id（p-02）は読まず、ログインの本人（p-01）に入る", async () => {
    await earthquake();
    const res = await signalPost(db, self(), { ...red({ injured: true }), personId: "p-02", source: "care_manager" }, at(1));
    expect(res.status).toBe(200);
    expect(rows("SELECT person_id, source FROM signals")).toEqual([{ person_id: "p-01", source: "self" }]);
  });

  it("ほかの事業所の本人を指すセッション（本人が事業所に無い）は 404", async () => {
    await earthquake();
    const res = await signalPost(db, self({ personId: "p-99" }), red(), at(1));
    expect(res.status).toBe(404);
    expect(count("signals")).toBe(0);
  });

  it("録音の POST も本人のスマホの役だけ。自分の信号でなければ 404", async () => {
    await earthquake();
    const bucket = new FakeBucket();
    sqlite.exec(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('00000000-0000-4000-8000-0000000000aa', 'p-02', 'red', 'self', '${at(1)}')`);
    const form = () =>
      recordingForm({ signal: "00000000-0000-4000-8000-0000000000aa", transcript: "あし", recordedAt: at(1), sentAt: at(1) });
    expect((await recordingPost(db, bucket, null, form(), at(1))).status).toBe(401);
    expect((await recordingPost(db, bucket, careManager, form(), at(1))).status).toBe(403);
    expect((await recordingPost(db, bucket, self(), form(), at(1))).status).toBe(404);
    expect(rows("SELECT transcript FROM signals")).toEqual([{ transcript: null }]);
  });
});

describe("信号の保存", () => {
  it("平時は断る（409）。表に入らない", async () => {
    const res = await signalPost(db, self(), red(), at(1));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "normal" });
    expect(count("signals")).toBe(0);
  });

  it("赤: 色・4 問の答え・時刻・出どころ「本人」を信号の表に。分類は空。経過に「信号」の 1 行", async () => {
    await earthquake();
    const body = red({ injured: true, atHome: true, canMove: false });
    const r = await saveSignal(db, signalScope(self())!, body, at(1));
    expect(r).toEqual({ ok: true, id: body.id, duplicate: false, occurredAt: at(1) });
    expect(rows("SELECT * FROM signals")).toEqual([
      expect.objectContaining({
        id: body.id,
        person_id: "p-01",
        drill_id: null,
        color: "red",
        source: "self",
        where_now: null,
        injured: 1,
        at_home: 1,
        can_move: 0,
        has_medicine: null,
        recording_key: null,
        transcript: null,
        classes: null,
        classified_by: null,
        occurred_at: at(1),
      }),
    ]);
    expect(rows("SELECT person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at FROM timeline_entries")).toEqual([
      {
        person_id: "p-01",
        author_id: "acct-judge",
        author_role: "self",
        kind: "signal",
        body: "無事じゃない けが あり・自宅・動けない・未回答 1",
        payload: '{"source":"phone"}',
        signal_id: body.id,
        occurred_at: at(1),
      },
    ]);
  });

  it("緑: どこに いますか の答えだけ", async () => {
    await earthquake();
    await saveSignal(db, signalScope(self())!, green("shelter"), at(1));
    expect(rows("SELECT color, where_now, injured, at_home, can_move, has_medicine FROM signals")).toEqual([
      { color: "green", where_now: "shelter", injured: null, at_home: null, can_move: null, has_medicine: null },
    ]);
    expect(rows("SELECT body FROM timeline_entries")).toEqual([{ body: "無事 避難所" }]);
  });

  it("送り直し（同じ id）は重ねない。同じ id が別の人の信号なら競合", async () => {
    await earthquake();
    const body = red({ injured: false });
    expect(await saveSignal(db, signalScope(self())!, body, at(1))).toMatchObject({ ok: true, duplicate: false });
    expect(await saveSignal(db, signalScope(self())!, { ...body, sentAt: at(2) }, at(2))).toMatchObject({ ok: true, duplicate: true });
    expect(count("signals")).toBe(1);
    expect(count("timeline_entries")).toBe(1);

    sqlite.exec(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('00000000-0000-4000-8000-0000000000bb', 'p-02', 'green', 'self', '${at(1)}')`);
    const other = { ...red(), id: "00000000-0000-4000-8000-0000000000bb" };
    expect(await saveSignal(db, signalScope(self())!, other, at(1))).toEqual({ ok: false, error: "conflict" });
    expect(count("timeline_entries")).toBe(1);
  });

  it("経過の 1 行の言葉: 答えをそのまま並べ、答えていない問いは未回答の数", () => {
    expect(signalLogBody({ color: "green", whereNow: "home", answers: NO_ANSWERS })).toBe("無事 自宅");
    expect(signalLogBody({ color: "red", whereNow: null, answers: NO_ANSWERS })).toBe("無事じゃない 未回答 4");
    expect(
      signalLogBody({ color: "red", whereNow: null, answers: { injured: false, atHome: false, canMove: true, hasMedicine: false } }),
    ).toBe("無事じゃない けが なし・自宅外・動ける・薬 なし");
  });

  it("本人のページの経過に「安否」（赤の色）と本人の書き手で出る", async () => {
    await earthquake();
    await saveSignal(db, signalScope(self())!, red({ canMove: false }), at(1));
    const page = await loadPersonPage(db, careManager, "p-01");
    const item = timelineItems(page!).find((t) => t.kind === "安否")!;
    expect(item).toMatchObject({ tone: "urgent", body: "無事じゃない 動けない・未回答 3", who: "本人 審査員" });
  });
});

describe("保存のあとに担当一覧が変わる（色はルールの表のまま）", () => {
  it("赤（けが）を送ると山田は赤、理由は本人の答え。緑（家）なら緑", async () => {
    await earthquake();
    const before = await loadCaseload(db, caseloadScope, "2026-11-04", at(1));
    expect(before!.rows.find((r) => r.id === "p-01")!.triage!.color).not.toBe("red");

    await signalPost(db, self(), red({ injured: true }, at(1)), at(1));
    const after = await loadCaseload(db, caseloadScope, "2026-11-04", at(1.1));
    expect(after!.rows.find((r) => r.id === "p-01")!.triage).toMatchObject({
      color: "red",
      rule: "red_injury",
      reason: "本人が「けが」",
    });

    await signalPost(db, self(), green("home", at(1.2)), at(1.2));
    const later = await loadCaseload(db, caseloadScope, "2026-11-04", at(1.3));
    expect(later!.rows.find((r) => r.id === "p-01")!.triage!.color).toBe("green");
  });

  it("20 秒で音声に替わった赤（答えなし）も赤", async () => {
    await earthquake();
    await signalPost(db, self(), red({}, at(1)), at(1));
    const data = await loadCaseload(db, caseloadScope, "2026-11-04", at(1.1));
    expect(data!.rows.find((r) => r.id === "p-01")!.triage).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });
  });
});

describe("録音", () => {
  it("鍵は recordings/<事業所>/<本人>/<時刻>.webm（Safari の mp4 は m4a）", () => {
    expect(recordingKey("office-demo", "p-01", "2026-11-04T01:23:45.678Z")).toBe("recordings/office-demo/p-01/20261104T012345678Z.webm");
    expect(audioTypeOf("audio/webm;codecs=opus")).toEqual({ contentType: "audio/webm", ext: "webm" });
    expect(audioTypeOf("audio/mp4")).toEqual({ contentType: "audio/mp4", ext: "m4a" });
    expect(audioTypeOf("video/mp4")).toBeNull();
  });

  it("録音を R2 に、鍵と文字起こしを信号に、経過に「録音 31 秒 文字起こし「…」」。分類は空のまま。2 回目は何もしない", async () => {
    await earthquake();
    const body = red({ injured: true }, at(1));
    await saveSignal(db, signalScope(self())!, body, at(1));
    const bucket = new FakeBucket();
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
    const form = recordingForm(
      { signal: body.id, transcript: " あしが いたい ", durationSec: "31", recordedAt: at(1.02), sentAt: at(1.02) },
      audio,
    );
    const res = await recordingPost(db, bucket, self(), form, at(1.02));
    expect(res.status).toBe(200);
    const key = `recordings/office-demo/p-01/${new Date(at(1)).toISOString().replace(/[-:.]/g, "")}.webm`;
    expect([...bucket.objects.keys()]).toEqual([key]);
    expect(bucket.objects.get(key)).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" });
    expect(rows("SELECT recording_key, transcript, classes, classified_by FROM signals")).toEqual([
      { recording_key: key, transcript: "あしが いたい", classes: null, classified_by: null },
    ]);
    expect(rows("SELECT body, payload, occurred_at FROM timeline_entries ORDER BY occurred_at")).toEqual([
      { body: "無事じゃない けが あり・未回答 3", payload: '{"source":"phone"}', occurred_at: at(1) },
      { body: "録音 31 秒 文字起こし「あしが いたい」", payload: '{"source":"recording","durationSec":31}', occurred_at: at(1.02) },
    ]);

    const again = await attachRecording(
      db,
      bucket,
      signalScope(self(), "recording")!,
      { signalId: body.id, audio: null, transcript: "べつ", durationSec: 5, recordedAt: at(2), sentAt: at(2) },
      at(2),
    );
    expect(again).toEqual({ ok: true, key, duplicate: true });
    expect(count("timeline_entries")).toBe(2);
  });

  it("音声が無く文字起こしだけでも添える。どちらも無い・受けない形は 400", async () => {
    await earthquake();
    const body = red({}, at(1));
    await saveSignal(db, signalScope(self())!, body, at(1));
    const bucket = new FakeBucket();
    const base = { signal: body.id, recordedAt: at(1), sentAt: at(1) };
    expect((await recordingPost(db, bucket, self(), recordingForm(base), at(1))).status).toBe(400);
    const video = new Blob([new Uint8Array([1])], { type: "video/mp4" });
    expect((await recordingPost(db, bucket, self(), recordingForm(base, video), at(1))).status).toBe(400);
    expect((await recordingPost(db, bucket, self(), recordingForm({ ...base, durationSec: "-1", transcript: "x" }), at(1))).status).toBe(400);
    expect((await recordingPost(db, bucket, self(), recordingForm({ ...base, transcript: "たすけて" }), at(1))).status).toBe(200);
    expect(bucket.objects.size).toBe(0);
    expect(rows("SELECT recording_key, transcript FROM signals")).toEqual([{ recording_key: null, transcript: "たすけて" }]);
    expect(recordingLogBody({ hasAudio: false, durationSec: null, transcript: "たすけて" })).toBe("録音なし 文字起こし「たすけて」");
  });
});

describe("定型文の声", () => {
  const ctx = (tts: { calls: number } & Record<string, unknown>) => ({
    env: {},
    usage: {
      reserve: async () => true,
      finish: async () => {},
      countDay: async () => 0,
    },
    office: { id: "office-demo", kind: "demo" as const },
    tts: {
      interactions: {
        create: async (params: { input: string }) => {
          tts.calls++;
          tts.input = params.input;
          return { output_audio: { data: btoa("RIFF"), mime_type: "audio/wav" } };
        },
      },
    },
  });

  it("鍵が無ければ作らない（null。端末は speechSynthesis）", async () => {
    const bucket = new FakeBucket();
    expect(await promptVoice(bucket, { env: {}, usage: ctx({ calls: 0 }).usage, office: { id: "office-demo", kind: "demo" } })).toBeNull();
    expect(bucket.objects.size).toBe(0);
  });

  it("1 回だけ作って R2 に置き、次からは置いた物。読ませるのは定型文だけ", async () => {
    const bucket = new FakeBucket();
    const seen = { calls: 0 } as { calls: number; input?: string };
    const first = await promptVoice(bucket, ctx(seen));
    const second = await promptVoice(bucket, ctx(seen));
    expect(seen.calls).toBe(1);
    expect(seen.input).toBe(VOICE_PROMPT_TEXT);
    expect(new TextDecoder().decode(first!)).toBe("RIFF");
    expect(new TextDecoder().decode(second!)).toBe("RIFF");
    expect([...bucket.objects.keys()]).toEqual([voicePromptKey()]);
  });
});
