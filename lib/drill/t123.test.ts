// T123 評価の 2 回目で残った訓練の AI の問題の直し（docs/tasks/T123.md）のテスト。
// 本物の API は呼ばない（AI を使わない訓練か、偽の client が決まった JSON を返す）。手元の D1 は node:sqlite と種の 10 人。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillScenario } from "../db/types.ts";
import { CLOCK_END_LABEL } from "./action-terms.ts";
import { DRILL_END_MINUTE } from "./clock.ts";
import { drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { aiAtOf, drillEnded, lastCutOf, type DrillState } from "./engine.ts";
import { actionPost, freePost, stepPost } from "./http.ts";
import { talkPost } from "./talk.ts";
import { loadDrillScreen } from "./view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

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
const P = careManager();
const SCOPE = drillScope(P)!;
/** 日本の 10 時に発災 */
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t123";

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

async function body(r: Response): Promise<Record<string, unknown>> {
  return (await r.json()) as Record<string, unknown>;
}

/** 進める（連続の時計は進め方を付ける） */
async function step(to: Record<string, unknown> = {}): Promise<Response> {
  const s = await stored();
  return stepPost(db, P, ID, { step: s.step, ...to }, START);
}

/** 手を打つ（出る電話になる roll） */
async function actOn(kind: string, person: string | null, roll = 0): Promise<Response> {
  const s = await stored();
  return actionPost(db, P, ID, { step: s.step, actions: s.actions.length, kind, person, target: null }, START, { roll: () => roll });
}

/** 最後の手で往復を 1 つ（決まった問い） */
async function talkOnce(): Promise<Response> {
  const s = await stored();
  const a = s.actions.at(-1)!;
  return talkPost(db, P, ID, { step: s.step, actions: s.actions.length, action: a.id, ask: "where" });
}

/** 3 時間ずつ進めて、ケアマネの時計を at（分）の手前まで */
async function advanceUntil(at: number) {
  for (let i = 0; i < 40; i++) {
    const s = await stored();
    if (s.minute + 180 > at) return;
    const r = await step({ minutes: 180 });
    expect(r.status).toBe(200);
  }
}

describe("72 時間の終わり（#1）", () => {
  it("手と通話の往復で時計が 72 時間に着いたあと、進めると終わる（評価の 2 回目の大雨の回の形）", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID, { clock: true })).toEqual({ ok: true, id: ID });
    await advanceUntil(DRILL_END_MINUTE - 30);
    // 72 時間の 30 分前まで 30 分ずつ
    while ((await stored()).minute < DRILL_END_MINUTE - 30) expect((await step({ minutes: 30 })).status).toBe(200);
    // 記録（2 分）で 72 時間の 7 分前まで
    while ((await stored()).minute < DRILL_END_MINUTE - 7) expect((await actOn("note", null)).status).toBe(200);
    const before = await stored();
    expect(before.minute).toBe(DRILL_END_MINUTE - 6);
    const person = before.participants[0];
    // 電話の手（所要 5 分）で 72 時間の 1 分前、往復（2 分）で 72 時間を越える所まで
    expect((await actOn("call_person", person)).status).toBe(200);
    expect((await stored()).minute).toBe(DRILL_END_MINUTE - 1);
    expect((await talkOnce()).status).toBe(200);
    const s = await stored();
    // 時計は 72 時間で止まる。往復をもう 1 つは足せない（終話）
    expect(s.minute).toBe(DRILL_END_MINUTE);
    expect((await talkOnce()).status).toBe(409);
    expect(lastCutOf(s)).toBeLessThan(DRILL_END_MINUTE);
    expect(drillEnded(s)).toBe(false);
    // 72 時間に着いた後の手は打てない（理由の言葉）
    const late = await actOn("call_person", person);
    expect(late.status).toBe(409);
    expect(await body(late)).toMatchObject({ error: "blocked", label: CLOCK_END_LABEL });
    // 進めると 72 時間の区切りで終わる
    const r = await step({ minutes: 180 });
    expect(r.status).toBe(200);
    expect(await body(r)).toMatchObject({ ok: true, status: "finished" });
    const end = await stored();
    expect(end.status).toBe("finished");
    expect(lastCutOf(end)).toBe(DRILL_END_MINUTE);
    expect(end.minute).toBe(DRILL_END_MINUTE);
  });
});

// ---------- どの想定・進め方でも終わる ----------

/** 決まった乱数（mulberry32） */
function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pace = { minutes: 30 | 60 | 180 } | { next: true } | { acts: true };
const PACES: ReadonlyArray<[string, Pace]> = [
  ["30 分", { minutes: 30 }],
  ["1 時間", { minutes: 60 }],
  ["3 時間", { minutes: 180 }],
  ["次まで", { next: true }],
  ["手の分", { acts: true }],
];

/**
 * 終わるまで回す。手（電話と往復・訪問・記録）を乱数で打ち、進め方で進める。どの要求も例外を投げず、200 か決まった断り（409・手の分の 400）。
 * 回数の上限の中で 72 時間の区切りに着いて finished になることを返す
 */
async function runToEnd(scenario: DrillScenario, pace: Pace | null, seed: number, opts: { terms?: boolean; from?: number } = {}) {
  const clock = pace !== null;
  const started = await startDrill(db, SCOPE, scenario, START, {}, () => ID, { ...(clock ? { clock: true } : {}), ...(opts.terms ? { terms: true } : {}) });
  expect(started).toEqual({ ok: true, id: ID });
  const rand = rngOf(seed);
  const statuses: number[] = [];
  // 始めの所まで 3 時間ずつ（時間を縮める。終わりの前の形を見るため）
  if (clock && opts.from) await advanceUntil(opts.from);
  for (let i = 0; i < 600; i++) {
    let s = await stored();
    if (drillEnded(s)) break;
    // 手（0〜3 本）。電話は出る roll で、往復を 0〜3 回（72 時間をまたぐ形を作る）
    const n = Math.floor(rand() * 4);
    for (let k = 0; k < n && !drillEnded(s); k++) {
      const live = s.participants.filter((p) => !s.world.ended?.[p]);
      const person = live[Math.floor(rand() * live.length)] ?? null;
      const x = rand();
      const kind = x < 0.55 ? "call_person" : x < 0.7 ? "visit" : x < 0.85 ? "note" : "report_city";
      const r = await actOn(kind, kind === "note" || kind === "report_city" ? null : person, rand() < 0.8 ? 0 : 0.99);
      statuses.push(r.status);
      expect([200, 409]).toContain(r.status);
      if (r.status === 409) expect(["blocked", "ended"]).toContain((await body(r)).error);
      s = await stored();
      if (r.status === 200 && kind === "call_person" && !drillEnded(s)) {
        const rounds = Math.floor(rand() * 4);
        for (let t = 0; t < rounds; t++) {
          const tr = await talkOnce();
          expect([200, 409]).toContain(tr.status);
        }
        s = await stored();
      }
    }
    if (drillEnded(s)) break;
    // 手の分は使った時間が無ければ断られる（400）。そのときは記録を 1 つ打ってから（72 時間に着いていれば手は打てない）
    if (pace && "acts" in pace && Math.round(s.minute) <= aiAtOf(s)) {
      const r = await actOn("note", null);
      expect([200, 409]).toContain(r.status);
      s = await stored();
      if (drillEnded(s)) break;
    }
    const r = await stepPost(db, P, ID, { step: s.step, ...(pace ?? {}) }, START);
    statuses.push(r.status);
    expect(r.status).toBe(200);
  }
  const end = await stored();
  return { end, statuses };
}

describe("どの想定・進め方でも 72 時間で終わる（#1）", () => {
  for (const scenario of ["heavy_rain", "earthquake", "virtual"] as const) {
    for (const [label, pace] of PACES) {
      for (const terms of [false, true]) {
        it(`${scenario}・${label}${terms ? "・決まり" : ""}`, async () => {
          const seed = [...`${scenario}${label}${terms}`].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
          // 手の分だけは時計を手で進めるので、終わりの前から
          const { end } = await runToEnd(scenario, pace, seed, { terms, from: "acts" in pace ? DRILL_END_MINUTE - 600 : DRILL_END_MINUTE - 1440 });
          expect(end.status).toBe("finished");
          expect(lastCutOf(end)).toBe(DRILL_END_MINUTE);
          expect(end.minute).toBe(DRILL_END_MINUTE);
        });
      }
    }
  }

  it("10 分版も手と往復を重ねて終わる（刻みの道のまま）", async () => {
    const { end } = await runToEnd("short", null, 11);
    expect(end.status).toBe("finished");
    expect(end.step).toBe(3);
  });

  it("72 時間の手前で 72 時間をまたぐ手（訪問 40 分）を打つと、その手で終わる（時計は 72 時間）", async () => {
    expect(await startDrill(db, SCOPE, "earthquake", START, {}, () => ID, { clock: true })).toEqual({ ok: true, id: ID });
    await advanceUntil(DRILL_END_MINUTE - 30);
    while ((await stored()).minute < DRILL_END_MINUTE - 30) expect((await step({ minutes: 30 })).status).toBe(200);
    const s = await stored();
    expect(s.minute).toBe(DRILL_END_MINUTE - 30);
    const r = await actOn("visit", s.participants[0]);
    expect(r.status).toBe(200);
    expect(await body(r)).toMatchObject({ status: "finished", minute: DRILL_END_MINUTE });
    const end = await stored();
    expect(end.status).toBe("finished");
    expect(end.actions.at(-1)!.endMinute).toBe(DRILL_END_MINUTE + 10);
  });

  it("72 時間に着いた後は手の分でも終わり、自由対応の読替は Claude を呼ばずに断る", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID, { clock: true, terms: true })).toEqual({ ok: true, id: ID });
    await advanceUntil(DRILL_END_MINUTE - 30);
    while ((await stored()).minute < DRILL_END_MINUTE - 30) expect((await step({ minutes: 30 })).status).toBe(200);
    while ((await stored()).minute < DRILL_END_MINUTE - 7) expect((await actOn("note", null)).status).toBe(200);
    const person = (await stored()).participants[0];
    expect((await actOn("call_person", person)).status).toBe(200);
    expect((await talkOnce()).status).toBe(200);
    const s = await stored();
    expect(s.minute).toBe(DRILL_END_MINUTE);
    // 画面の対応の欄: どの手も押せない（理由「時間満了」）
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(Object.values(screen.terms![person]).every((t) => t.block === CLOCK_END_LABEL)).toBe(true);
    // 読替の口は Claude を呼ばずに断る（鍵が無くても同じ所で断る）
    const free = await freePost(db, P, ID, { step: s.step, actions: s.actions.length, person, text: "様子を見に行く" }, async () => {
      throw new Error("読み替えを呼んだ");
    });
    expect(free.status).toBe(409);
    expect(await body(free)).toMatchObject({ error: "blocked", label: CLOCK_END_LABEL });
    const r = await step({ acts: true });
    expect(r.status).toBe(200);
    expect(await body(r)).toMatchObject({ status: "finished" });
  });
});
