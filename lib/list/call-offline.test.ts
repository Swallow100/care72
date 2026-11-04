// 通信なしで貯めて送り直した通話の記録（T71 の続き）を D1（node:sqlite に種の 10 人）で。
// 2: 端末で押した時刻 at を経過と信号の時刻にする（未来の物は受けた時刻。発災より前・24 時間より古い物は押した時刻のまま信号を作らない、T82）。受けた時刻は payload に
// 3: 端末で作った id の 2 回目は書かない（応答が落ちて送り直した物）

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { saveDisasterInfo, switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { CALL_PRESSED_MAX_AGE_MS, callEntryId, callOccurredAt, callSignalId, parseCallPayload } from "./calls.ts";
import { callPost } from "./http.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

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

/** 浸水の時刻（2026-11-05 18:00 JST）。発災は -2 時間 */
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

async function heavyRain() {
  const scope = disasterScope(careManager())!;
  expect(await switchDisasterMode(db, scope, { kind: "heavy_rain", version: 0, at: at(-2) })).toEqual({ ok: true, changed: true });
  expect(
    await saveDisasterInfo(db, scope, {
      version: 1,
      at: at(0),
      info: { startedAt: at(-2), outage: { scope: "office", towns: [], startedAt: at(0) }, alertLevel: 4, water: null, road: null },
    }),
  ).toEqual({ ok: true, changed: true });
}

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const contactOf = (person: string) =>
  (rows(`SELECT id FROM contacts WHERE person_id = '${person}' AND kind = 'family' ORDER BY sort LIMIT 1`)[0] as { id: string }).id;
const ID = "5f0c2a9e-1b2c-4d3e-8f40-0123456789ab";

async function call(person: string, body: Record<string, unknown>, h: number) {
  const res = await callPost(db, careManager(), { person, ...body }, at(h));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("押した時刻の丸め（callOccurredAt）", () => {
  const now = at(1);
  it("24 時間の中の過去で発災のあとなら押した時刻", () => {
    expect(callOccurredAt(at(0.5), now, at(-2))).toEqual({ at: at(0.5), old: false });
    expect(callOccurredAt(at(-1.5), now, at(-2))).toEqual({ at: at(-1.5), old: false });
    const edge = new Date(FLOOD + 3_600_000 - CALL_PRESSED_MAX_AGE_MS).toISOString();
    expect(callOccurredAt(edge, now, null)).toEqual({ at: edge, old: false });
  });
  it("未来・読めない物は受けた時刻。発災より前・24 時間より古い物は押した時刻のまま old（T82。前は受けた時刻）", () => {
    expect(callOccurredAt(at(1.01), now, at(-2))).toEqual({ at: now, old: false });
    expect(callOccurredAt(at(-2.5), now, at(-2))).toEqual({ at: at(-2.5), old: true });
    const older = new Date(FLOOD + 3_600_000 - CALL_PRESSED_MAX_AGE_MS - 1).toISOString();
    expect(callOccurredAt(older, now, null)).toEqual({ at: older, old: true });
    expect(callOccurredAt("x", now, at(-2))).toEqual({ at: now, old: false });
    expect(callOccurredAt(null, now, at(-2))).toEqual({ at: now, old: false });
  });
  it("平時（発災の時刻なし）は未来と 24 時間だけ見る", () => {
    expect(callOccurredAt(at(-5), now, null)).toEqual({ at: at(-5), old: false });
  });
});

describe("貯めて送り直した記録の時刻", () => {
  it("経過と信号は押した時刻、受けた時刻と端末の id は payload に。行の詳細の電話も押した時刻", async () => {
    await heavyRain();
    const c = contactOf("p-01");
    const r = await call("p-01", { contact: c, result: "connected", heard: { color: "green" }, id: ID, at: at(0.25) }, 1);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    const t = rows("SELECT id, occurred_at, payload, signal_id FROM timeline_entries WHERE kind = 'called'");
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe(callEntryId(ID));
    expect(t[0].occurred_at).toBe(at(0.25));
    expect(t[0].signal_id).toBe(callSignalId(ID));
    expect(parseCallPayload(String(t[0].payload))).toMatchObject({ receivedAt: at(1), clientId: ID });
    expect(rows("SELECT id, occurred_at FROM signals")).toEqual([{ id: callSignalId(ID), occurred_at: at(0.25) }]);

    const data = await loadCaseload(db, SCOPE, "2026-11-05", at(1.1));
    const d = data!.rows.find((x) => x.id === "p-01")!.detail!;
    expect(d.calls[0].at).toBe(at(0.25));
  });

  it("発災より前に押した物は押した時刻のまま（T82。前は受けた時刻）。受けた時刻は payload に", async () => {
    await heavyRain();
    await call("p-01", { contact: contactOf("p-01"), result: "no_answer", id: ID, at: at(-3) }, 1);
    const t = rows("SELECT occurred_at, payload FROM timeline_entries WHERE kind = 'called'")[0];
    expect(t.occurred_at).toBe(at(-3));
    expect(parseCallPayload(String(t.payload))!.receivedAt).toBe(at(1));
  });

  it("id も at も無い記録（前の画面）は今までどおり受けた時刻で、id はサーバーが作る", async () => {
    await call("p-01", { contact: contactOf("p-01"), result: "dialed" }, 1);
    const t = rows("SELECT id, occurred_at, payload FROM timeline_entries WHERE kind = 'called'")[0];
    expect(t.occurred_at).toBe(at(1));
    expect(String(t.id)).not.toMatch(/^call-/);
    expect(parseCallPayload(String(t.payload))).not.toHaveProperty("clientId");
  });
});

describe("同じ端末の id の 2 回目", () => {
  it("2 回目は書かずに duplicate を返す（経過も信号も 1 行）", async () => {
    await heavyRain();
    const body = { contact: contactOf("p-02"), result: "connected", heard: { color: "red", injured: true }, id: ID, at: at(0.5) };
    expect(await call("p-02", body, 1)).toEqual({ status: 200, json: { ok: true } });
    expect(await call("p-02", body, 1.2)).toEqual({ status: 200, json: { ok: true, duplicate: true } });
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(1);
    expect(rows("SELECT COUNT(*) AS n FROM signals")[0].n).toBe(1);
  });

  it("前に届いた物は、今の表の状態で断り直さない（2 回目が「至急維持」に当たっても duplicate）", async () => {
    await heavyRain();
    const c = contactOf("p-01");
    expect((await call("p-01", { contact: c, result: "no_answer", id: ID, at: at(0.5) }, 1)).status).toBe(200);
    // 同じ id で中身が違っても（端末は同じ物しか送らない）2 回目は書かない
    expect(await call("p-01", { contact: c, result: "connected", heard: { color: "green" }, id: ID }, 1.1)).toEqual({
      status: 200,
      json: { ok: true, duplicate: true },
    });
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(1);
    expect(rows("SELECT COUNT(*) AS n FROM signals")[0].n).toBe(0);
  });

  it("同じ id が同時に 2 つ来ても 1 行（主キーで弾く）", async () => {
    await heavyRain();
    const body = { contact: contactOf("p-03"), result: "dialed", id: ID, at: at(0.5) };
    const [a, b] = await Promise.all([call("p-03", body, 1), call("p-03", body, 1)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.json.duplicate, b.json.duplicate].filter(Boolean)).toHaveLength(1);
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(1);
  });

  it("形の違う id・at は 400", async () => {
    const c = contactOf("p-01");
    for (const bad of [{ id: "x" }, { id: "a/b-0000000" }, { id: 12345678 }, { at: 1 }]) {
      expect((await call("p-01", { contact: c, result: "dialed", ...bad }, 1)).status).toBe(400);
    }
    expect(rows("SELECT COUNT(*) AS n FROM timeline_entries WHERE kind = 'called'")[0].n).toBe(0);
  });
});
