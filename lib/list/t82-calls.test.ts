// T82（朝の見直し 11/4 の「正しさ」高 1・中 2・低 6）を D1（node:sqlite に種の 10 人）で。
// 高 1: 押した時刻を受けた時刻 now に丸めるのは未来の物だけ。24 時間より古い・発災より前の押下は押した時刻のまま経過に書き、
//       安否の信号は作らない（表はいちばん新しい信号で決まるので、古い「無事」が新しい赤を上書きしない）
// 中 2: 平時・至急維持で断るのは安否の信号だけで、電話の経過の行は書く（409 に logged）。至急維持は押した時刻までの信号で当てる。
//       端末の保留は、信号だけ断られても経過が書けたら送り済みとして消す
// 低 6: INSERT OR IGNORE をやめ ON CONFLICT(id) DO NOTHING に（CHECK の違反を黙って捨てない）

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { createCallQueue, fetchCallTransport, type StorageLike } from "../offline/queue.ts";
import { CALL_PRESSED_MAX_AGE_MS, callLogsOf, callOccurredAt, parseCallPayload, type CallEntryRow } from "./calls.ts";
import { callPost } from "./http.ts";

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

/** 日本の時刻（11 月）を ISO に。jst(5, 10) は 11/5 10:00 JST */
const jst = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour - 9, minute)).toISOString();

async function heavyRainAt(at: string) {
  expect(await switchDisasterMode(db, disasterScope(careManager())!, { kind: "heavy_rain", version: 0, at })).toEqual({ ok: true, changed: true });
}

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const familyContact = (person: string) =>
  (rows(`SELECT id, relation FROM contacts WHERE person_id = '${person}' AND kind = 'family' ORDER BY sort LIMIT 1`)[0] as {
    id: string;
    relation: string;
  });
/** 本人の赤（答えなし）を表に直に入れる */
const selfRed = (person: string, at: string, extra: { can_move?: 0; injured?: 1 } = {}) =>
  sqlite.exec(
    `INSERT INTO signals (id, person_id, color, source, injured, can_move, occurred_at)
     VALUES ('self-${person}-${at}', '${person}', 'red', 'self', ${extra.injured ?? "NULL"}, ${extra.can_move ?? "NULL"}, '${at}')`,
  );

async function call(person: string, body: Record<string, unknown>, now: string, db_: D1Database = db) {
  const res = await callPost(db_, careManager(), { person, ...body }, now);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function caseloadRow(person: string, now: string) {
  const data = await loadCaseload(db, SCOPE, now.slice(0, 10), now);
  return data!.rows.find((r) => r.id === person)!;
}

const ID = "8a1f3c2e-4b5d-4e6f-9a70-0123456789ab";
const ID2 = "8a1f3c2e-4b5d-4e6f-9a70-0123456789ac";

describe("高 1: 古い押下は押した時刻のまま、信号を作らない", () => {
  it("callOccurredAt: 未来と読めない物だけ now、24 時間より古い・発災より前は押した時刻で old", () => {
    const now = jst(6, 11);
    expect(callOccurredAt(jst(6, 12), now, jst(5, 8))).toEqual({ at: now, old: false });
    expect(callOccurredAt("x", now, jst(5, 8))).toEqual({ at: now, old: false });
    expect(callOccurredAt(null, now, jst(5, 8))).toEqual({ at: now, old: false });
    // 24 時間ちょうどは使える、1 ミリ秒でも古ければ old
    const edge = new Date(Date.parse(now) - CALL_PRESSED_MAX_AGE_MS).toISOString();
    expect(callOccurredAt(edge, now, jst(5, 8))).toEqual({ at: edge, old: false });
    const older = new Date(Date.parse(now) - CALL_PRESSED_MAX_AGE_MS - 1).toISOString();
    expect(callOccurredAt(older, now, jst(5, 8))).toEqual({ at: older, old: true });
    // 発災より前
    expect(callOccurredAt(jst(6, 7), now, jst(6, 8))).toEqual({ at: jst(6, 7), old: true });
    expect(callOccurredAt(jst(6, 9), now, jst(6, 8))).toEqual({ at: jst(6, 9), old: false });
  });

  it("オフラインで 10 時に押した「無事」を翌 11 時に送っても、20 時の本人の赤が残る（経過は 10 時に 1 行、信号なし）", async () => {
    await heavyRainAt(jst(5, 8));
    selfRed("p-09", jst(5, 20));
    const c = familyContact("p-09");
    const sent = jst(6, 11);
    const r = await call("p-09", { contact: c.id, result: "connected", heard: { color: "green" }, memo: "大丈夫と", id: ID, at: jst(5, 10) }, sent);
    expect(r).toEqual({ status: 200, json: { ok: true, uncounted: "old" } });

    const t = rows("SELECT occurred_at, body, payload, signal_id FROM timeline_entries WHERE kind = 'called'");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ occurred_at: jst(5, 10), body: `家族 ${c.relation} 通話 無事`, signal_id: null });
    expect(parseCallPayload(String(t[0].payload))).toMatchObject({ heard: { color: "green" }, uncounted: "old", receivedAt: sent, memo: "大丈夫と" });
    expect(rows("SELECT COUNT(*) AS n FROM signals WHERE source = 'care_manager'")[0].n).toBe(0);

    const row = await caseloadRow("p-09", jst(6, 11, 5));
    expect(row.triage).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });
  });

  it("発災より前に押した物は押した時刻のまま経過に書き、信号は作らない（表は今の発災の信号だけで決まる）", async () => {
    await heavyRainAt(jst(5, 8));
    const c = familyContact("p-09");
    const r = await call("p-09", { contact: c.id, result: "connected", heard: { color: "green" }, id: ID, at: jst(5, 7) }, jst(5, 9));
    expect(r).toEqual({ status: 200, json: { ok: true, uncounted: "old" } });
    expect(rows("SELECT occurred_at, signal_id FROM timeline_entries WHERE kind = 'called'")).toEqual([
      { occurred_at: jst(5, 7), signal_id: null },
    ]);
    expect(rows("SELECT * FROM signals")).toEqual([]);
    expect((await caseloadRow("p-09", jst(5, 9, 5))).triage).toMatchObject({ color: "gray", rule: "unknown" });
  });

  it("安否のない古い記録（不通）は押した時刻で書くだけ（今までどおり ok）", async () => {
    await heavyRainAt(jst(5, 8));
    const r = await call("p-09", { contact: familyContact("p-09").id, result: "no_answer", id: ID, at: jst(5, 7) }, jst(5, 9));
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(rows("SELECT occurred_at FROM timeline_entries WHERE kind = 'called'")).toEqual([{ occurred_at: jst(5, 7) }]);
  });

  it("未来の押下（端末の時計が進んでいる）は受けた時刻に丸め、信号も受けた時刻", async () => {
    await heavyRainAt(jst(5, 8));
    const r = await call("p-09", { contact: familyContact("p-09").id, result: "connected", heard: { color: "green" }, id: ID, at: jst(5, 12) }, jst(5, 11));
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(rows("SELECT occurred_at FROM signals WHERE source = 'care_manager'")).toEqual([{ occurred_at: jst(5, 11) }]);
    expect((await caseloadRow("p-09", jst(5, 11, 5))).triage).toMatchObject({ color: "green", reason: "ケアマネが「無事」" });
  });
});

describe("中 2: 断るのは安否の信号だけで、電話の経過は書く", () => {
  it("至急維持: 本人の「動けない」の人への「無事」は 409 に logged。経過の行（メモつき）は書き、信号は無い。色と順は変わらない", async () => {
    await heavyRainAt(jst(5, 8));
    selfRed("p-01", jst(5, 9), { can_move: 0 });
    const before = await caseloadRow("p-01", jst(5, 9, 30));
    expect(before.triage).toMatchObject({ rule: "red_injury", reason: "本人が「動けない」" });
    const c = familyContact("p-01");
    const r = await call("p-01", { contact: c.id, result: "connected", heard: { color: "green" }, memo: "本人は大丈夫と" }, jst(5, 9, 20));
    expect(r).toEqual({ status: 409, json: { ok: false, error: "injury", label: "無事 不可（本人が「動けない」）", logged: true } });

    const t = rows("SELECT occurred_at, body, payload, signal_id FROM timeline_entries WHERE kind = 'called'");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ occurred_at: jst(5, 9, 20), body: `家族 ${c.relation} 通話 無事`, signal_id: null });
    expect(parseCallPayload(String(t[0].payload))).toMatchObject({ heard: { color: "green" }, uncounted: "injury", memo: "本人は大丈夫と" });
    expect(rows("SELECT COUNT(*) AS n FROM signals WHERE source = 'care_manager'")[0].n).toBe(0);
    const after = await caseloadRow("p-01", jst(5, 9, 30));
    expect(after.triage).toMatchObject({ rule: "red_injury", reason: "本人が「動けない」" });
    expect(after.rank).toBe(before.rank);
    // 行の詳細の電話の記録には残る（信号にしなかった印つき。意味色で塗らない）
    expect(after.detail!.calls[0]).toMatchObject({ result: "connected", heard: { color: "green" }, uncounted: "injury", memo: "本人は大丈夫と" });
  });

  it("至急維持は押した時刻までの信号で当てる: 押したあとに来た本人の「動けない」では断らず、表はあとの赤のまま", async () => {
    await heavyRainAt(jst(5, 8));
    const c = familyContact("p-09");
    selfRed("p-09", jst(5, 10, 30), { can_move: 0 });
    // 10:00 に押し、通信なしで 10:45 に届いた「無事」。10:30 の本人の「動けない」より前
    const r = await call("p-09", { contact: c.id, result: "connected", heard: { color: "green" }, id: ID, at: jst(5, 10) }, jst(5, 10, 45));
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(rows("SELECT occurred_at FROM signals WHERE source = 'care_manager'")).toEqual([{ occurred_at: jst(5, 10) }]);
    // 表はいちばん新しい信号（本人の「動けない」）のまま
    expect((await caseloadRow("p-09", jst(5, 11))).triage).toMatchObject({ rule: "red_injury", reason: "本人が「動けない」" });
    // 押したのが本人の「動けない」のあとなら、前のとおり断る（経過は書く）
    const late = await call("p-09", { contact: c.id, result: "connected", heard: { color: "green" }, id: ID2, at: jst(5, 10, 40) }, jst(5, 10, 50));
    expect(late).toMatchObject({ status: 409, json: { error: "injury", logged: true } });
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(2);
    expect(rows("SELECT COUNT(*) AS n FROM signals WHERE source = 'care_manager'")[0].n).toBe(1);
  });

  it("平時の安否は 409 に logged（「無事 不可（平時）」）。経過の行は書き、信号は無い", async () => {
    const c = familyContact("p-09");
    const r = await call("p-09", { contact: c.id, result: "connected", heard: { color: "red", injured: true } }, jst(5, 9));
    expect(r).toEqual({ status: 409, json: { ok: false, error: "normal", label: "無事でない 不可（平時）", logged: true } });
    const t = rows("SELECT body, payload, signal_id FROM timeline_entries WHERE kind = 'called'");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ body: `家族 ${c.relation} 通話 無事でない けが`, signal_id: null });
    expect(parseCallPayload(String(t[0].payload))).toMatchObject({ uncounted: "normal" });
    expect(rows("SELECT * FROM signals")).toEqual([]);
  });

  it("経過を書いた 409 の 2 回目（同じ端末の id）は duplicate", async () => {
    await heavyRainAt(jst(5, 8));
    selfRed("p-01", jst(5, 9), { injured: 1 });
    const body = { contact: familyContact("p-01").id, result: "connected", heard: { color: "green" }, id: ID, at: jst(5, 9, 10) };
    expect((await call("p-01", body, jst(5, 9, 20))).status).toBe(409);
    expect(await call("p-01", body, jst(5, 9, 25))).toEqual({ status: 200, json: { ok: true, duplicate: true } });
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(1);
  });

  it("端末の保留: 通信なしで貯めた「無事」が至急維持で断られても、経過が書けたので送り済みとして消し、断りの言葉を返す", async () => {
    await heavyRainAt(jst(5, 8));
    selfRed("p-01", jst(5, 9), { can_move: 0 });
    const c = familyContact("p-01");
    const store = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    let online = false;
    // 送る道は本物の fetchCallTransport。fetch は callPost へ回す（通信なしの間は投げる）
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      if (!online) throw new TypeError("offline");
      return callPost(db, careManager(), JSON.parse(String(init.body)), jst(5, 9, 40));
    }) as unknown as typeof fetch;
    const q = createCallQueue({ storage, owner: "cm:acct-yamamoto", transport: fetchCallTransport(fakeFetch), now: () => new Date(jst(5, 9, 30)) });

    expect(await q.send({ person: "p-01", contact: c.id, result: "connected", heard: { color: "green" }, memo: "大丈夫と" })).toEqual({ kind: "queued" });
    expect(q.items()).toHaveLength(1);
    online = true;
    const report = await q.flush();
    expect(report.sent).toHaveLength(1);
    expect(report.dropped).toEqual([]);
    expect(report.notes).toEqual([{ id: report.sent[0], label: "無事 不可（本人が「動けない」）" }]);
    expect(q.items()).toEqual([]);
    expect(rows("SELECT occurred_at, signal_id FROM timeline_entries WHERE kind = 'called'")).toEqual([
      { occurred_at: jst(5, 9, 30), signal_id: null },
    ]);

    // その場で届いた物は sent に言葉を付けて返す
    expect(await q.send({ person: "p-01", contact: c.id, result: "connected", heard: { color: "red" } })).toEqual({
      kind: "sent",
      label: "無事でない 不可（本人が「動けない」）",
    });
  });

  it("送る道: 409 に logged があれば ok（言葉つき）、無ければ前のとおり捨てる", async () => {
    const res = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    const wire = { person: "p-01", contact: "c", result: "connected" as const, id: ID, at: jst(5, 9) };
    expect(await fetchCallTransport(res(409, { ok: false, error: "injury", label: "無事 不可（本人が「けが」）", logged: true }))(wire)).toEqual({
      outcome: "ok",
      label: "無事 不可（本人が「けが」）",
    });
    expect(await fetchCallTransport(res(409, { ok: false, error: "injury", label: "至急維持" }))(wire)).toEqual({ outcome: "drop", label: "至急維持" });
    expect(await fetchCallTransport(res(200, { ok: true }))(wire)).toEqual({ outcome: "ok" });
  });

  it("行の詳細の電話の記録: 信号にしなかった訳を持つ（前の行は null）", () => {
    const base: Omit<CallEntryRow, "payload"> = { person_id: "p-01", body: "家族 娘 通話 無事", occurred_at: jst(5, 9), author_name: "山本" };
    const payload = (extra: Record<string, unknown>) =>
      JSON.stringify({ source: "call", contactId: "c", contactKind: "family", result: "connected", heard: { color: "green" }, ...extra });
    const [a, b] = callLogsOf([
      { ...base, payload: payload({ uncounted: "injury" }) },
      { ...base, payload: payload({}) },
    ]).reverse();
    expect(a.uncounted).toBe("injury");
    expect(b.uncounted).toBeNull();
    // 形の違う訳は読まない
    expect(callLogsOf([{ ...base, payload: payload({ uncounted: "x" }) }])[0].uncounted).toBeNull();
  });
});

describe("低 6: CHECK の違反を黙って捨てない（ON CONFLICT(id) DO NOTHING）", () => {
  /** 経過の行の payload だけを JSON でない値に替える D1（json_valid の CHECK に当たる） */
  function brokenPayload(d: D1Database): D1Database {
    return new Proxy(d, {
      get(target, key) {
        if (key !== "prepare") return Reflect.get(target, key);
        return (sql: string) => {
          const st = target.prepare(sql);
          if (!/INSERT INTO timeline_entries/.test(sql)) return st;
          return { bind: (...args: unknown[]) => st.bind(...args.map((v, i) => (i === 4 ? "{broken" : v))) };
        };
      },
    });
  }

  it("経過の行が CHECK に当たると投げ、信号も残らない（前は信号だけ書いて duplicate を返し、端末が記録を消していた）", async () => {
    await heavyRainAt(jst(5, 8));
    const body = { person: "p-09", contact: familyContact("p-09").id, result: "connected", heard: { color: "green" }, id: ID, at: jst(5, 9) };
    await expect(callPost(brokenPayload(db), careManager(), body, jst(5, 9, 5))).rejects.toThrow();
    expect(rows("SELECT * FROM signals")).toEqual([]);
    expect(rows("SELECT * FROM timeline_entries WHERE kind = 'called'")).toEqual([]);
    // 同じ id の送り直しは書ける（主キーの重なりだけを DO NOTHING にした）
    expect(await call("p-09", body, jst(5, 9, 10))).toEqual({ status: 200, json: { ok: true } });
  });

  it("同じ id が同時に 2 つ来ても 1 行（重なりだけは今までどおり黙って弾く）", async () => {
    await heavyRainAt(jst(5, 8));
    const body = { contact: familyContact("p-09").id, result: "connected", heard: { color: "green" }, id: ID, at: jst(5, 9) };
    const [a, b] = await Promise.all([call("p-09", body, jst(5, 9, 5)), call("p-09", body, jst(5, 9, 5))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.json.duplicate, b.json.duplicate].filter(Boolean)).toHaveLength(1);
    expect(rows("SELECT COUNT(*) AS n FROM signals")[0].n).toBe(1);
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(1);
  });
});
