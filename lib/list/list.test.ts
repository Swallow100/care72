// 担当一覧の発災時（docs/tasks/T13.md）を D1（node:sqlite に種の 10 人）で: ケアマネの上書き（保存の壁・並びに効く・
// 本人のページと様式 9 も同じ色・切れる・前の災害モードを持ち越さない）、電話の記録、録音の再生（役の壁と Range）、
// 行の詳細（信号の答え・録音・文字起こし・連絡先・時計・避難先・支援者）。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { saveDisasterInfo, switchDisasterMode } from "../disaster/db.ts";
import { latestOverrides, parseOverridePayload } from "../disaster/override.ts";
import { personDisaster } from "../disaster/person.ts";
import { disasterScope } from "../disaster/scope.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { NO_ANSWERS, type SignalBody } from "../signals/body.ts";
import { attachRecording, saveSignal, signalScope } from "../signals/save.ts";
import { callLogBody, callTargetText } from "./calls.ts";
import { callPost, overridePost } from "./http.ts";
import { overrideLogBody } from "./override.ts";
import { parseRange, recordingGet, recordingHref, type ByteRange, type RecordingReader } from "./recording.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

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

/** 審査員の本人のスマホ（山田 ハナ） */
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

/** 浸水と停電の時刻（2026-11-05 18:00 JST）。発災は -2 時間（heavy-rain の筋と同じ） */
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };
const TODAY = "2026-11-05";

async function heavyRain(version = 0) {
  const scope = disasterScope(careManager())!;
  expect(await switchDisasterMode(db, scope, { kind: "heavy_rain", version, at: at(-2) })).toEqual({ ok: true, changed: true });
  expect(
    await saveDisasterInfo(db, scope, {
      version: version + 1,
      at: at(0),
      info: { startedAt: at(-2), outage: { scope: "office", towns: [], startedAt: at(0) }, alertLevel: 4, water: null, road: null },
    }),
  ).toEqual({ ok: true, changed: true });
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const red = (answers: Partial<SignalBody["answers"]>, time: string): SignalBody => ({
  id: uuid(),
  color: "red",
  whereNow: null,
  answers: { ...NO_ANSWERS, ...answers },
  occurredAt: time,
  sentAt: time,
});

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;

async function board(h: number) {
  const data = await loadCaseload(db, SCOPE, TODAY, at(h));
  return data!.rows;
}

async function post(fn: typeof overridePost, p: Principal | null, body: unknown, h: number) {
  const res = await fn(db, p, body, at(h));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("ケアマネの上書き", () => {
  it("上げると担当一覧の色と並びが変わり、経過に「順番変更」。本人のページと様式 9 も同じ色", async () => {
    await heavyRain();
    const before = await board(1);
    expect(before.find((r) => r.id === "p-09")!.triage!.color).toBe("gray");

    const r = await post(overridePost, careManager(), { person: "p-09", to: "red", reason: "近所で土砂" }, 1);
    expect(r).toEqual({ status: 200, json: { ok: true, from: "gray", to: "red" } });

    const after = await board(1.1);
    const p9 = after.find((x) => x.id === "p-09")!;
    expect(p9.triage).toMatchObject({ color: "red", baseColor: "gray", override: { to: "red", reason: "近所で土砂", byName: "山本" } });
    expect(p9.rank).toBeLessThan(before.find((x) => x.id === "p-09")!.rank!);
    expect(p9.detail!.override).toMatchObject({ toLabel: "至急", baseLabel: "不明", reason: "近所で土砂", byName: "山本", expired: false });

    // 本人のページ・様式 9 も同じ色
    const page = await loadPersonPage(db, careManager(), "p-09");
    expect((await personDisaster(db, page!, at(1.1))).triage!.color).toBe("red");
    const form9 = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: (await personDisaster(db, page!, at(1.1))).situation });
    expect(JSON.stringify(form9!.sheet)).toBeTruthy();
    const item = timelineItems(page!).find((t) => t.kind === "順番変更")!;
    expect(item).toMatchObject({ body: "不明→至急 近所で土砂", who: "ケアマネ 山本", tone: "check" });
  });

  it("下げた上書きは、表の色が悪くなったら失効（小林: 要確認→不明、電池を超えたら至急）", async () => {
    await heavyRain();
    expect((await board(2.5)).find((r) => r.id === "p-02")!.triage!.color).toBe("yellow");
    const r = await post(overridePost, careManager(), { person: "p-02", to: "gray", reason: "夫が電話に出た" }, 2.5);
    expect(r.status).toBe(200);
    expect((await board(2.6)).find((x) => x.id === "p-02")!.triage).toMatchObject({ color: "gray", override: { expired: false } });
    const later = (await board(6)).find((x) => x.id === "p-02")!;
    expect(later.triage).toMatchObject({ color: "red", override: { expired: true } });
    expect(later.detail!.override!.expired).toBe(true);
  });

  it("解除で表の色に戻る。経過に「解除」", async () => {
    await heavyRain();
    await post(overridePost, careManager(), { person: "p-09", to: "yellow", reason: "隣人と連絡つかず" }, 1);
    expect((await board(1.1)).find((x) => x.id === "p-09")!.triage!.color).toBe("yellow");
    const r = await post(overridePost, careManager(), { person: "p-09", to: null, reason: "" }, 1.2);
    expect(r).toEqual({ status: 200, json: { ok: true, from: "yellow", to: "gray" } });
    const p9 = (await board(1.3)).find((x) => x.id === "p-09")!;
    expect(p9.triage!.color).toBe("gray");
    expect(p9.triage!.override).toBeUndefined();
    expect(rows("SELECT body FROM timeline_entries WHERE kind = 'override' ORDER BY occurred_at").map((x) => x.body)).toEqual([
      "不明→要確認 隣人と連絡つかず",
      "解除 要確認→不明",
    ]);
  });

  it("断る: ログインなし 401、ケアマネでない 403、形が違う・理由なし 400、範囲の外 404、平時 409、同じ色 409、上書きなしの解除 409", async () => {
    expect((await post(overridePost, null, { person: "p-09", to: "red", reason: "x" }, 1)).status).toBe(401);
    expect((await post(overridePost, self(), { person: "p-01", to: "red", reason: "x" }, 1)).status).toBe(403);
    expect((await post(overridePost, careManager({ role: "medical" }), { person: "p-01", to: "red", reason: "x" }, 1)).status).toBe(403);
    // 平時
    expect((await post(overridePost, careManager(), { person: "p-09", to: "red", reason: "x" }, 1)).json).toMatchObject({ error: "normal" });
    await heavyRain();
    expect((await post(overridePost, careManager(), { person: "p-09", to: "red", reason: "  " }, 1)).status).toBe(400);
    expect((await post(overridePost, careManager(), { person: "p-09", to: "pink", reason: "x" }, 1)).status).toBe(400);
    expect((await post(overridePost, careManager(), { person: "p-09", to: "red", reason: "x".repeat(201) }, 1)).status).toBe(400);
    expect((await post(overridePost, careManager(), { person: "p-404", to: "red", reason: "x" }, 1)).status).toBe(404);
    // 別の事業所のケアマネ
    const other = careManager({ office: { id: "office-partner", name: "協力事業所", kind: "regular" } });
    expect((await post(overridePost, other, { person: "p-09", to: "red", reason: "x" }, 1)).status).toBe(404);
    expect((await post(overridePost, careManager(), { person: "p-09", to: "gray", reason: "x" }, 1)).json).toMatchObject({ error: "same" });
    expect((await post(overridePost, careManager(), { person: "p-09", to: null, reason: "" }, 1)).json).toMatchObject({ error: "same" });
    expect(rows("SELECT * FROM timeline_entries WHERE kind = 'override'")).toEqual([]);
  });

  it("前の災害モードの上書きは持ち越さない", async () => {
    await heavyRain();
    await post(overridePost, careManager(), { person: "p-09", to: "red", reason: "近所で土砂" }, 1);
    const scope = disasterScope(careManager())!;
    expect(await switchDisasterMode(db, scope, { kind: "normal", version: 2, at: at(2) })).toMatchObject({ ok: true });
    expect(await switchDisasterMode(db, scope, { kind: "earthquake", version: 3, at: at(3) })).toMatchObject({ ok: true });
    expect((await board(4)).find((x) => x.id === "p-09")!.triage!.override).toBeUndefined();
  });

  it("経過の行の読み方: 読めない・理由のない行は飛ばす。発災より前の行は使わない", () => {
    expect(parseOverridePayload("{")).toBeNull();
    expect(parseOverridePayload(JSON.stringify({ source: "override", to: "red", baseAtOverride: "gray", reason: " " }))).toBeNull();
    expect(parseOverridePayload(JSON.stringify({ source: "intake", to: "red", baseAtOverride: "gray", reason: "x" }))).toBeNull();
    const row = (payload: unknown, h: number) => ({
      person_id: "p-09",
      author_id: "acct-yamamoto",
      author_name: "山本",
      payload: JSON.stringify(payload),
      occurred_at: at(h),
    });
    const s = { disasterAt: at(0), now: at(5) };
    const got = latestOverrides(
      [
        row({ source: "override", to: "green", baseAtOverride: "gray", reason: "前の災害" }, -1),
        row({ source: "override", to: "red", baseAtOverride: "gray", reason: "土砂" }, 1),
        row({ source: "override", to: "yellow", baseAtOverride: "gray", reason: "先の時刻" }, 6),
      ],
      s,
    );
    expect(got.get("p-09")).toMatchObject({ to: "red", reason: "土砂", byName: "山本" });
    expect(overrideLogBody("gray", "red", " 土砂 ", false)).toBe("不明→至急 土砂");
    expect(overrideLogBody("red", "gray", "", true)).toBe("解除 至急→不明");
  });
});

describe("電話の記録", () => {
  it("押すと「電話 本人」、不通は「電話 家族 娘 不通」。名前と番号は経過の文に書かない。行の詳細に記録と最後の電話", async () => {
    await heavyRain();
    const contacts = rows("SELECT id, kind, relation, name, phone FROM contacts WHERE person_id = 'p-01' ORDER BY sort");
    const selfC = contacts.find((c) => c.kind === "self")!;
    const family = contacts.find((c) => c.kind === "family")!;
    expect((await post(callPost, careManager(), { person: "p-01", contact: selfC.id, result: "dialed" }, 1)).status).toBe(200);
    expect((await post(callPost, careManager(), { person: "p-01", contact: family.id, result: "no_answer" }, 1.1)).status).toBe(200);

    const logged = rows("SELECT kind, author_role, body, payload FROM timeline_entries WHERE kind = 'called' ORDER BY occurred_at");
    expect(logged.map((x) => x.body)).toEqual(["本人", `家族 ${family.relation} 不通`]);
    for (const x of logged) {
      expect(String(x.body)).not.toContain(String(family.name));
      expect(String(x.body)).not.toContain("090");
    }
    const page = await loadPersonPage(db, careManager(), "p-01");
    expect(timelineItems(page!).filter((t) => t.kind === "電話").map((t) => t.body)).toEqual(["本人", `家族 ${family.relation} 不通`]);

    const detail = (await board(1.2)).find((r) => r.id === "p-01")!.detail!;
    expect(detail.calls.map((c) => c.result)).toEqual(["no_answer", "dialed"]);
    expect(detail.contacts[0]).toMatchObject({ kind: "self", lastCall: { result: "dialed" } });
    expect(detail.contacts.find((c) => c.id === family.id)!.lastCall).toMatchObject({ result: "no_answer" });
    expect(callTargetText({ kind: "self", relation: "本人" })).toBe("本人");
    expect(callLogBody({ kind: "visiting_nurse", relation: null }, "no_answer")).toBe("訪問看護 不通");
  });

  it("断る: ケアマネでない 403、ほかの本人の連絡先 404、形が違う 400", async () => {
    const other = rows("SELECT id FROM contacts WHERE person_id = 'p-02' LIMIT 1")[0];
    expect((await post(callPost, self(), { person: "p-01", contact: other.id, result: "dialed" }, 1)).status).toBe(403);
    expect((await post(callPost, careManager(), { person: "p-01", contact: other.id, result: "dialed" }, 1)).status).toBe(404);
    expect((await post(callPost, careManager(), { person: "p-01", contact: other.id, result: "connected" }, 1)).status).toBe(400);
    expect((await post(callPost, null, { person: "p-01", contact: other.id, result: "dialed" }, 1)).status).toBe(401);
    expect(rows("SELECT * FROM timeline_entries WHERE kind = 'called'")).toEqual([]);
  });
});

/** R2 の偽物（get の range と head） */
class FakeReader implements RecordingReader {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, value: ArrayBuffer | Uint8Array, opts: { httpMetadata: { contentType: string } }) {
    this.objects.set(key, { bytes: new Uint8Array(value), contentType: opts.httpMetadata.contentType });
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.bytes.length, httpMetadata: { contentType: o.contentType } } : null;
  }
  async get(key: string, options?: { range?: ByteRange }) {
    const o = this.objects.get(key);
    if (!o) return null;
    let bytes = o.bytes;
    const r = options?.range;
    if (r && "suffix" in r) bytes = bytes.slice(bytes.length - r.suffix);
    else if (r) bytes = bytes.slice(r.offset, r.length === undefined ? undefined : r.offset + r.length);
    return { body: bytes, size: o.bytes.length, httpMetadata: { contentType: o.contentType } };
  }
}

async function recorded(bucket: FakeReader) {
  await heavyRain();
  const body = red({ injured: true }, at(0.5));
  await saveSignal(db, signalScope(self())!, body, at(0.5));
  const r = await attachRecording(
    db,
    bucket,
    signalScope(self(), "recording")!,
    {
      signalId: body.id,
      audio: { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), type: "audio/webm;codecs=opus" },
      transcript: " いたい うごけない ",
      durationSec: 30,
      recordedAt: at(0.51),
      sentAt: at(0.51),
    },
    at(0.51),
  );
  expect(r).toMatchObject({ ok: true });
  return body.id;
}

describe("録音の再生（GET /api/recordings/<信号>）", () => {
  it("ケアマネは自分の事業所の本人の録音を聞ける。形は保存した形、手元に残さない", async () => {
    const bucket = new FakeReader();
    const id = await recorded(bucket);
    const res = await recordingGet(db, bucket, careManager(), id, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/webm");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("Range で一部（206）、全体の外は 416", async () => {
    const bucket = new FakeReader();
    const id = await recorded(bucket);
    const part = await recordingGet(db, bucket, careManager(), id, "bytes=2-4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([3, 4, 5]));
    const open = await recordingGet(db, bucket, careManager(), id, "bytes=7-");
    expect(open.headers.get("content-range")).toBe("bytes 7-9/10");
    const tail = await recordingGet(db, bucket, careManager(), id, "bytes=-3");
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(new Uint8Array([8, 9, 10]));
    expect((await recordingGet(db, bucket, careManager(), id, "bytes=10-")).status).toBe(416);
    expect(parseRange("bytes=0-1,4-5")).toBeNull();
    expect(parseRange("items=0-1")).toBeNull();
  });

  it("役の壁: ログインなし 401、役未選択 403、別の事業所・別の本人・行政医療班（受け持ちまで）は 404。本人は自分の録音を聞ける", async () => {
    const bucket = new FakeReader();
    const id = await recorded(bucket);
    expect((await recordingGet(db, bucket, null, id, null)).status).toBe(401);
    expect((await recordingGet(db, bucket, careManager({ role: "unselected" }), id, null)).status).toBe(403);
    const otherOffice = careManager({ office: { id: "office-partner", name: "協力事業所", kind: "regular" } });
    expect((await recordingGet(db, bucket, otherOffice, id, null)).status).toBe(404);
    expect((await recordingGet(db, bucket, self({ personId: "p-02" }), id, null)).status).toBe(404);
    expect((await recordingGet(db, bucket, careManager({ role: "medical" }), id, null)).status).toBe(404);
    expect((await recordingGet(db, bucket, self(), id, null)).status).toBe(200);
    // 形の違う id・録音の無い信号・訓練の信号
    expect((await recordingGet(db, bucket, careManager(), "../x", null)).status).toBe(404);
    sqlite.exec(`UPDATE signals SET drill_id = NULL, recording_key = NULL WHERE id = '${id}'`);
    expect((await recordingGet(db, bucket, careManager(), id, null)).status).toBe(404);
  });
});

describe("行の詳細", () => {
  it("信号の答え・録音・文字起こし・最終連絡・連絡先（本人が先）・時計の残り・避難先・支援者", async () => {
    const bucket = new FakeReader();
    const id = await recorded(bucket);
    const row = (await board(1)).find((r) => r.id === "p-01")!;
    expect(row.triage).toMatchObject({ color: "red", rule: "red_injury", reason: "本人が「けが」" });
    const d = row.detail!;
    expect(d.signals).toHaveLength(1);
    expect(d.signals[0]).toMatchObject({
      id,
      source: "本人",
      color: "red",
      tone: "urgent",
      body: "無事じゃない けが あり・未回答 3",
      recording: recordingHref(id),
      transcript: "いたい うごけない",
      classes: [],
      classifiedBy: null,
    });
    expect(d.lastContact).toMatchObject({ source: "本人", color: "red", ago: "30 分" });
    expect(d.contacts[0].kind).toBe("self");
    expect(d.contacts.every((c) => c.tel.startsWith("090"))).toBe(true);
    const oxygen = d.clocks.find((k) => k.label === "酸素 内蔵電池")!;
    expect(oxygen).toMatchObject({ running: true, remaining: "残り 1 時間", tone: "urgent", start: "停電" });
    expect(d.destinations.first).toBeTruthy();
    expect(d.supporters.map((s) => s.order)).toEqual([1, 2]);
    expect(d.override).toBeNull();
  });

  it("けがの赤のあとの答えなしの赤（音声）でも、一覧の理由は「本人が「けが」」のまま", async () => {
    await heavyRain();
    await saveSignal(db, signalScope(self())!, red({ injured: true }, at(0.5)), at(0.5));
    await saveSignal(db, signalScope(self())!, red({}, at(0.6)), at(0.6));
    const row = (await board(1)).find((r) => r.id === "p-01")!;
    expect(row.triage).toMatchObject({ rule: "red_injury", group: 0, reason: "本人が「けが」" });
    expect(row.rank).toBe(1);
    // 行の詳細には信号を 2 つとも出す（新しい順）
    expect(row.detail!.signals.map((s) => s.body)).toEqual(["無事じゃない 未回答 4", "無事じゃない けが あり・未回答 3"]);
    const page = await loadPersonPage(db, careManager(), "p-01");
    expect((await personDisaster(db, page!, at(1))).triage!.reason).toBe("本人が「けが」");
  });

  it("平時は詳細・優先の番号・残り・最終連絡を作らない", async () => {
    const r = (await board(1))[0];
    expect(r).toMatchObject({ triage: null, rank: null, remain: null, lastContact: null, detail: null });
  });
});
