// 訓練の幅（docs/tasks/T59.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返すか、呼ばない）。
// - 開始の前の選択: 選ばなければ今と同じ・参加者の絞り・外の id と 0 人を断る・職員の上書き・夜間発災の 1 行
// - 早送りの間
// - 手の取消: 戻る・刻みを越えた手は断る・最後でない手は断る・終わった訓練は断る・競合・聞いた安否が消える
// - 手のメモ: 保存・再生・長さ、講評・監督・世界・本人役の入力に無い

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction, DrillScenario } from "../db/types.ts";
import {
  abandonDrill,
  actDrill,
  advanceDrill,
  drillScope,
  loadDrillRow,
  loadTicks,
  participantsOf,
  pickParticipants,
  replayState,
  startDrill,
  stateOfRow,
  undoableAct,
  undoDrill,
  type StartOptions,
} from "./db.ts";
import { sceneText } from "./director.ts";
import { initialState, lastStep, step, withoutMemo, type ActionRecord, type DirectorInput, type DrillState, type PersonaInput } from "./engine.ts";
import { drillHooks } from "./hooks.ts";
import { actionPost, parseStartOptions, startPost, undoPost } from "./http.ts";
import { nightClock, nightLine } from "./night.ts";
import { tickText as personaTickText, callText } from "./persona.ts";
import { loadDrillRecord, reviewContextOf } from "./record.ts";
import { reviewText } from "./review.ts";
import { SCENARIOS, EMPTY_WORLD } from "./scenarios.ts";
import { DEFAULT_FAST_MS, FAST_INTERVALS, parseInterval } from "./speed.ts";
import { loadDrillScreen } from "./view.ts";
import { tickText as worldTickText } from "./world-oneshot.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude（何を渡されたかを残すだけ。返事は空の JSON で、層は失敗として固定の物に落ちる） ----------

function reply(model: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: "{}", citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake() {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(params.model);
        },
      },
    },
  };
  return { client, calls };
}

// ---------- 種の 10 人と D1 ----------

const KANA_ORDER = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);

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
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t59";
const MEMO = "停電の地区から先に回す判断メモ";

async function start(scenario: DrillScenario = "heavy_rain", options: StartOptions = {}, hooks = {}) {
  const r = await startDrill(db, SCOPE, scenario, START, hooks, () => ID, options);
  expect(r).toEqual({ ok: true, id: ID });
  return ID;
}

const row = async () => (await loadDrillRow(db, DEMO.id, ID))!;
const stored = async (): Promise<DrillState> => stateOfRow(await row());
const rawWorld = async () => JSON.parse((await row()).world) as Record<string, unknown>;

async function advance(hooks = {}) {
  const r = await row();
  return advanceDrill(db, SCOPE, ID, r.step, START, hooks);
}

async function doAct(kind: DrillAction, person: string | null, opts: { memo?: string; roll?: () => number; hooks?: object } = {}) {
  const r = await row();
  const n = stateOfRow(r).actions.length;
  return actDrill(
    db,
    SCOPE,
    ID,
    { step: r.step, actions: n },
    { kind, person, target: null, ...(opts.memo !== undefined ? { memo: opts.memo } : {}) },
    START,
    { roll: opts.roll ?? (() => 0), ...(opts.hooks ? { hooks: opts.hooks } : {}) },
  );
}

async function undo() {
  const r = await row();
  return undoDrill(db, SCOPE, ID, { step: r.step, actions: stateOfRow(r).actions.length });
}

const eventIds = () =>
  (sqlite.prepare(`SELECT id, kind FROM drill_events WHERE drill_id = ? ORDER BY seq`).all(ID) as Array<{ id: string; kind: string }>);
const heardRows = () =>
  sqlite.prepare(`SELECT id, person_id, color FROM signals WHERE drill_id = ? AND source = 'care_manager'`).all(ID) as Array<{
    id: string;
    person_id: string;
    color: string;
  }>;


// ---------- 開始の前の選択 ----------

describe("開始の前の選択（選ばなければ今と同じ）", () => {
  it("options を渡さない開始は前と同じ JSON（options・undone・undo の鍵が無い）", async () => {
    await start();
    const w = await rawWorld();
    expect(Object.keys(w).sort()).toEqual(["actions", "minute", "participants", "people", "v", "world"]);
    expect(participantsOf(await row())).toEqual(KANA_ORDER);
    const s = await stored();
    expect(s.options).toBeUndefined();
    expect(s.undone).toBeUndefined();
    expect(s.world.staff).toBe(SCENARIOS.heavy_rain.staff);
  });

  it("initialState は options を渡さなければ前と同じ形（鍵が増えない）", () => {
    const a = initialState("short", ["p-01"], START);
    const b = initialState("short", ["p-01"], START, {});
    const c = initialState("short", ["p-01"], START, { staff: undefined, night: false });
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect("options" in a).toBe(false);
  });

  it("参加者を絞る: 担当一覧の順（よみ）に並べ、絞った人だけ画面に出る", async () => {
    const picked = [KANA_ORDER[3], KANA_ORDER[0], KANA_ORDER[7]];
    await start("short", { participants: picked });
    expect(participantsOf(await row())).toEqual([KANA_ORDER[0], KANA_ORDER[3], KANA_ORDER[7]]);
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.rows.map((r) => r.id).sort()).toEqual([...picked].sort());
  });

  it("外の id・重なり・0 人は断る", async () => {
    expect(pickParticipants(KANA_ORDER, undefined)).toEqual(KANA_ORDER);
    expect(pickParticipants(KANA_ORDER, [])).toBeNull();
    expect(pickParticipants(KANA_ORDER, ["p-01", "p-01"])).toBeNull();
    expect(pickParticipants(KANA_ORDER, ["p-01", "p-99"])).toBeNull();
    expect(await startDrill(db, SCOPE, "short", START, {}, () => ID, { participants: ["p-99"] })).toEqual({ ok: false, error: "invalid" });
    expect(await startDrill(db, SCOPE, "short", START, {}, () => ID, { participants: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await startDrill(db, SCOPE, "short", START, {}, () => ID, { staff: 10 })).toEqual({ ok: false, error: "invalid" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drills").get()).toEqual({ n: 0 });
  });

  it("ほかのケアマネの担当の人は外の id（担当一覧の中だけ）", async () => {
    const other = sqlite.prepare("SELECT id FROM people WHERE care_manager_id <> 'acct-yamamoto' LIMIT 1").get() as { id: string } | undefined;
    if (!other) return;
    expect(await startDrill(db, SCOPE, "short", START, {}, () => ID, { participants: [other.id] })).toEqual({ ok: false, error: "invalid" });
  });

  it("職員の上書き: 0 人で始めると世界の空きが 0（今の状態も再生も）", async () => {
    await start("heavy_rain", { staff: 0 });
    expect((await stored()).world.staff).toBe(0);
    expect((await stored()).options).toEqual({ staff: 0 });
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.state.world.staff).toBe(0);
    // 事業所の職員に出向いてもらう手は空きが無いので手配できない
    const r = await doAct("dispatch", KANA_ORDER[0]);
    expect(r).toMatchObject({ ok: true, record: { result: { ok: false } } });
  });

  it("職員 9 人・夜間発災を残し、再生の状態と今の状態が同じ", async () => {
    await start("heavy_rain", { staff: 9, night: true });
    await doAct("call_person", "p-01", { memo: MEMO });
    await advance();
    const r = await row();
    const live = stateOfRow(r);
    const replayed = replayState(r, participantsOf(r), await loadTicks(db, ID, SCENARIOS.heavy_rain.hours, r.step), r.step).state;
    expect(live.options).toEqual({ staff: 9, night: true });
    expect(replayed.options).toEqual(live.options);
    expect(replayed.world.staff).toBe(live.world.staff);
    expect(replayed.actions.map((a) => a.memo)).toEqual([MEMO]);
  });

  it("startPost の options の形: 外れた形は 400、担当一覧の外は 400、選ばなければ今と同じ", async () => {
    expect(parseStartOptions(undefined)).toEqual({});
    expect(parseStartOptions({ participants: ["p-01"], staff: 2, night: true })).toEqual({ participants: ["p-01"], staff: 2, night: true });
    expect(parseStartOptions({ night: false })).toEqual({});
    expect(parseStartOptions({ participants: [] })).toBeNull();
    expect(parseStartOptions({ participants: "p-01" })).toBeNull();
    expect(parseStartOptions({ staff: -1 })).toBeNull();
    expect(parseStartOptions({ staff: 1.5 })).toBeNull();
    expect(parseStartOptions({ night: "yes" })).toBeNull();
    expect(parseStartOptions([1])).toBeNull();

    const p = careManager();
    expect((await startPost(db, p, { scenario: "short", options: { participants: [] } }, START)).status).toBe(400);
    expect((await startPost(db, p, { scenario: "short", options: { participants: ["p-99"] } }, START)).status).toBe(400);
    expect((await startPost(db, p, { scenario: "short", options: { staff: 10 } }, START)).status).toBe(400);
    const ok = await startPost(db, p, { scenario: "short", options: { participants: [KANA_ORDER[1]], staff: 1, night: true } }, START);
    expect(ok.status).toBe(200);
    const { id } = (await ok.json()) as { id: string };
    const s = stateOfRow((await loadDrillRow(db, DEMO.id, id))!);
    expect(s.participants).toEqual([KANA_ORDER[1]]);
    expect(s.options).toEqual({ staff: 1, night: true });
    expect(s.world.staff).toBe(1);
  });
});

// ---------- 夜間発災 ----------

describe("夜間発災", () => {
  it("発災を 2 時として時刻を出す（24 時で回る）", () => {
    expect(nightClock(0)).toBe(2);
    expect(nightClock(3)).toBe(5);
    expect(nightClock(1.9)).toBe(3);
    expect(nightClock(22)).toBe(0);
    expect(nightClock(72)).toBe(2);
    expect(nightLine(6)).toBe("発災は深夜 2 時ごろ。今は 8 時ごろ");
  });

  it("本人役・監督の入力に night が渡るのは選んだ訓練だけ（startedAt はずらさない）", async () => {
    const seen: { persona: PersonaInput[]; director: DirectorInput[] } = { persona: [], director: [] };
    const hooks = {
      persona: async (x: PersonaInput) => (seen.persona.push(x), []),
      director: async (x: DirectorInput) => (seen.director.push(x), []),
    };
    const night = initialState("short", ["p-01", "p-02"], START, { night: true });
    const r = await step(night, hooks);
    expect(r.state.startedAt).toBe(START);
    expect(seen.director.every((x) => x.night === true)).toBe(true);
    expect(seen.persona.length).toBeGreaterThan(0);
    expect(seen.persona.every((x) => x.night === true)).toBe(true);

    seen.persona = [];
    seen.director = [];
    await step(initialState("short", ["p-01", "p-02"], START), hooks);
    expect(seen.director.every((x) => !("night" in x))).toBe(true);
    expect(seen.persona.every((x) => !("night" in x))).toBe(true);
  });

  it("文に時刻の 1 行（本人役・電話・監督・世界）。選ばなければ無い", () => {
    const persona = { profile: {}, key: { people: [] }, reporters: [], roles: new Map(), hazards: [] } as never;
    const base: PersonaInput = { step: 1, hour: 3, person: "p-01", world: EMPTY_WORLD, incidents: [], state: null, lastAction: null, fixed: [] };
    expect(personaTickText({ ...base, night: true }, persona)).toContain("発災は深夜 2 時ごろ。今は 5 時ごろ");
    expect(personaTickText(base, persona)).not.toContain("深夜");
    const call = { person: "p-01", hour: 6, world: EMPTY_WORLD, incidents: [], state: null, callee: "本人" };
    expect(callText({ ...call, night: true }, persona)).toContain("今は 8 時ごろ");
    expect(callText(call, persona)).not.toContain("深夜");

    const dir: DirectorInput = { scenario: "heavy_rain", step: 2, hour: 3, world: EMPTY_WORLD, incidents: [], participants: [], people: {}, actions: [] };
    expect(sceneText({ ...dir, night: true }, new Map(), 72)).toContain("今は 5 時ごろ");
    expect(sceneText(dir, new Map(), 72)).not.toContain("深夜");

    const w = { ...dir, scenario: "virtual" as const, hints: { reached: [], clocks: [] }, session: null, minute: 180 };
    expect(worldTickText({ ...w, night: true }, { key: { people: [] } } as never, 1, 72)).toContain("今は 5 時ごろ");
    expect(worldTickText(w, { key: { people: [] } } as never, 1, 72)).not.toContain("深夜");
  });

  it("鍵のある道（偽の Claude）: 夜間発災の訓練は監督・本人役・電話の要求に時刻の 1 行。昼の訓練には無い", async () => {
    const { client, calls } = fake();
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2000" }, careManager(), { claude: client, now: () => new Date(START) })!;
    await start("heavy_rain", { night: true }, hooks);
    await doAct("call_person", "p-01", { hooks });
    await advance(hooks);
    const texts = calls.map((c) => JSON.stringify(c.messages));
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t.includes("発災は深夜 2 時ごろ"))).toBe(true);

    calls.length = 0;
    sqlite.exec("UPDATE drills SET status = 'abandoned'");
    expect(await startDrill(db, SCOPE, "heavy_rain", START, hooks, () => "day")).toEqual({ ok: true, id: "day" });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => JSON.stringify(c.messages).includes("深夜"))).toBe(false);
  });
});

// ---------- 早送りの間 ----------

describe("早送りの間", () => {
  it("1・2.5・5 秒。既定は今までと同じ 2.5 秒、表の外は既定", () => {
    expect(FAST_INTERVALS).toEqual([1000, 2500, 5000]);
    expect(DEFAULT_FAST_MS).toBe(2500);
    expect(parseInterval("1000")).toBe(1000);
    expect(parseInterval("5000")).toBe(5000);
    expect(parseInterval("300")).toBe(2500);
    expect(parseInterval(null)).toBe(2500);
  });
});

// ---------- 手の取消 ----------

describe("手の取消（1 手戻す）", () => {
  it("刻みを越えなかった手を戻す: 状態は手の前、手の記録と聞いた安否が消え、取消を数える。次の手は番号を使い直さない", async () => {
    await start();
    const before = await stored();
    const beforeEvents = eventIds();
    const screenBefore = (await loadDrillScreen(db, SCOPE, ID, null))!;
    // 訪問で着く → 確認済（聞いた安否）
    expect(await doAct("visit", "p-04", { memo: MEMO })).toMatchObject({ ok: true, record: { id: "a1", result: { status: "arrived", crossed: [] } } });
    expect(heardRows()).toHaveLength(1);
    expect(undoableAct(await row())).toBe("a1");

    expect(await undo()).toEqual({ ok: true, id: "a1", step: before.step, hour: before.hour, minute: before.minute });
    const after = await stored();
    expect(after.actions).toEqual([]);
    expect(after.minute).toBe(before.minute);
    expect(after.world).toEqual(before.world);
    expect(after.people).toEqual(before.people);
    expect(after.undone).toBe(1);
    expect(eventIds()).toEqual(beforeEvents);
    expect(heardRows()).toEqual([]);
    expect((await rawWorld()).undo).toBeUndefined();

    // 画面（再生の道）も手の前と同じ色。取消の数は画面の状態にも
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.rows.map((r) => [r.id, r.triage?.color, r.rank])).toEqual(screenBefore.rows.map((r) => [r.id, r.triage?.color, r.rank]));
    expect(screen.state.undone).toBe(1);
    expect(screen.state.actions).toEqual([]);

    // 次の手は a2（声の鍵・drill_events の id が前の手と重ならない）
    expect(await doAct("visit", "p-04")).toMatchObject({ ok: true, record: { id: "a2" } });
    expect(heardRows().map((r) => r.id)).toEqual([`${ID}-a2-h`]);
  });

  it("最後でない手は断る（戻せるのは最後の 1 手だけ。2 回目は取消不可）", async () => {
    await start();
    await doAct("call_person", "p-01");
    await doAct("call_person", "p-02");
    expect(undoableAct(await row())).toBe("a2");
    expect(await undo()).toMatchObject({ ok: true, id: "a2" });
    expect(undoableAct(await row())).toBeNull();
    expect(await undo()).toEqual({ ok: false, error: "locked" });
    expect((await stored()).actions.map((a) => a.id)).toEqual(["a1"]);
  });

  it("刻みを越えた手は断る（取消不可）。何も消さない", async () => {
    await start();
    await doAct("call_person", "p-01"); // 0:00 → 0:05
    await doAct("visit", "p-03"); // 0:05 → 0:45
    const crossed = await doAct("visit", "p-05"); // 0:45 → 1:25 で 1 時間を越える
    expect(crossed).toMatchObject({ ok: true, step: 1, record: { id: "a3", result: { crossed: [1] } } });
    expect(undoableAct(await row())).toBeNull();
    const n = eventIds().length;
    expect(await undo()).toEqual({ ok: false, error: "locked" });
    expect(eventIds()).toHaveLength(n);
    expect((await stored()).actions).toHaveLength(3);
  });

  it("進めると戻せない（写しが消える）", async () => {
    await start();
    await doAct("call_person", "p-01");
    expect((await rawWorld()).undo).toBeDefined();
    expect(await advance()).toMatchObject({ ok: true });
    expect((await rawWorld()).undo).toBeUndefined();
    expect(await undo()).toEqual({ ok: false, error: "locked" });
  });

  it("手が無ければ断る。終わった・中断した訓練は断る", async () => {
    await start();
    expect(await undo()).toEqual({ ok: false, error: "invalid" });
    await doAct("call_person", "p-01");
    expect((await abandonDrill(db, SCOPE, ID, START)).ok).toBe(true);
    expect(await undo()).toEqual({ ok: false, error: "ended" });
  });

  it("終わった訓練（最後の刻みまで）は断る", async () => {
    await start("short");
    while ((await row()).step < lastStep("short")) await advance();
    expect(await undo()).toEqual({ ok: false, error: "ended" });
  });

  it("読んだ刻み・手の数と違えば競合。何も消さない", async () => {
    await start();
    await doAct("visit", "p-04");
    const r = await row();
    expect(await undoDrill(db, SCOPE, ID, { step: r.step, actions: 0 })).toEqual({ ok: false, error: "conflict" });
    expect(await undoDrill(db, SCOPE, ID, { step: r.step + 1, actions: 1 })).toEqual({ ok: false, error: "conflict" });
    expect(heardRows()).toHaveLength(1);
    expect((await stored()).actions).toHaveLength(1);
  });

  it("読んだあとにほかの要求が書いた（world が変わった）なら、消す文も戻す文も効かない", async () => {
    await start();
    await doAct("visit", "p-04");
    const r = await row();
    // 読んだあと・書く前に、ほかの要求が同じ刻み・同じ手の数のまま world を書いた
    const racing = new Proxy(db, {
      get(target, key, recv) {
        if (key === "batch") {
          return async (stmts: Parameters<typeof db.batch>[0]) => {
            sqlite.prepare("UPDATE drills SET world = json_set(world, '$.minute', 41) WHERE id = ?").run(ID);
            return target.batch(stmts);
          };
        }
        const v = Reflect.get(target, key, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    expect(await undoDrill(racing, SCOPE, ID, { step: r.step, actions: 1 })).toEqual({ ok: false, error: "conflict" });
    expect(heardRows()).toHaveLength(1);
    expect(eventIds().map((e) => e.id)).toContain(`${ID}-a1`);
    expect(eventIds().map((e) => e.id)).toContain(`${ID}-a1-r`);
    expect((await stored()).actions).toHaveLength(1);
  });

  it("API: 形が違えば 400、ログインなし 401、ケアマネでなければ 403、取消不可 409", async () => {
    await start();
    await doAct("call_person", "p-01");
    expect((await undoPost(db, null, ID, { step: 0, actions: 1 })).status).toBe(401);
    expect((await undoPost(db, careManager({ role: "city" as never }), ID, { step: 0, actions: 1 })).status).toBe(403);
    expect((await undoPost(db, careManager(), ID, { step: "0", actions: 1 })).status).toBe(400);
    expect((await undoPost(db, careManager(), "../x", { step: 0, actions: 1 })).status).toBe(400);
    expect((await undoPost(db, careManager(), ID, { step: 0, actions: 9 })).status).toBe(409);
    const ok = await undoPost(db, careManager(), ID, { step: 0, actions: 1 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, id: "a1" });
    await doAct("call_person", "p-01");
    await advance();
    const locked = await undoPost(db, careManager(), ID, { step: 1, actions: 1 });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: "locked", label: "取消不可" });
  });
});

// ---------- 手のメモ ----------

describe("手のメモ", () => {
  it("手と一緒に残し（今の状態・drill_events・再生）、空白だけは残さない", async () => {
    await start();
    await doAct("call_person", "p-01", { memo: `  ${MEMO}  ` });
    await doAct("call_person", "p-02", { memo: "   " });
    const s = await stored();
    expect(s.actions.map((a) => a.memo)).toEqual([MEMO, undefined]);
    expect("memo" in s.actions[1]).toBe(false);
    const payload = sqlite.prepare("SELECT payload FROM drill_events WHERE id = ?").get(`${ID}-a1`) as { payload: string };
    expect(JSON.parse(payload.payload).memo).toBe(MEMO);
    const screen = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(screen.state.actions.map((a) => a.memo)).toEqual([MEMO, undefined]);
  });

  it("100 字まで（101 字は断る）。API の形", async () => {
    await start();
    const ok = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "call_person", person: "p-01", target: null, memo: "あ".repeat(100) }, START, { roll: () => 0 });
    expect(ok.status).toBe(200);
    const long = await actionPost(db, careManager(), ID, { step: 0, actions: 1, kind: "call_person", person: "p-01", target: null, memo: "あ".repeat(101) }, START, { roll: () => 0 });
    expect(long.status).toBe(400);
    const bad = await actionPost(db, careManager(), ID, { step: 0, actions: 1, kind: "call_person", person: "p-01", target: null, memo: 3 }, START, { roll: () => 0 });
    expect(bad.status).toBe(400);
    expect((await stored()).actions.map((a) => a.memo)).toEqual(["あ".repeat(100)]);
  });

  it("withoutMemo はメモだけ落とす（ほかは同じ）", () => {
    const a = { id: "a1", memo: MEMO, kind: "visit" } as unknown as ActionRecord;
    const b = { id: "a2", kind: "visit" } as unknown as ActionRecord;
    const out = withoutMemo([a, b]);
    expect(out).toEqual([{ id: "a1", kind: "visit" }, b]);
    expect(out[1]).toBe(b);
  });

  it("監督・本人役の hooks の入力にメモが無い", async () => {
    const seen: unknown[] = [];
    const hooks = {
      persona: async (x: PersonaInput) => (seen.push(x), []),
      director: async (x: DirectorInput) => (seen.push(x), []),
    };
    await start("heavy_rain");
    await doAct("call_person", "p-01", { memo: MEMO });
    await advance(hooks);
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toContain(MEMO);
    expect(JSON.stringify(seen)).toContain("call_person");
  });

  it("鍵のある道（偽の Claude）: 監督・本人役・電話の要求にメモが無い", async () => {
    const { client, calls } = fake();
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2000" }, careManager(), { claude: client, now: () => new Date(START) })!;
    await start("heavy_rain", {}, hooks);
    await doAct("call_person", "p-01", { memo: MEMO, hooks });
    await doAct("visit", "p-03", { memo: MEMO, hooks });
    await doAct("visit", "p-05", { memo: MEMO, hooks }); // 刻みを越える（手の中で監督・本人役）
    await advance(hooks);
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).not.toContain(MEMO);
  });

  it("仮想モードの世界（1 回呼び、偽の Claude）の要求にメモが無い。夜間発災の 1 行はある", async () => {
    const { client, calls } = fake();
    const hooks = drillHooks(
      { DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "2000", DRILL_WORLD: "messages" },
      careManager(),
      { claude: client, now: () => new Date(START) },
    )!;
    await start("virtual", { night: true }, hooks);
    await doAct("call_person", "p-01", { memo: MEMO, hooks });
    await advance(hooks);
    const world = calls.filter((c) => JSON.stringify(c.messages).includes("この刻み"));
    expect(world.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).not.toContain(MEMO);
    expect(world.every((c) => JSON.stringify(c.messages).includes("発災は深夜 2 時ごろ"))).toBe(true);
  });

  it("講評の入力（訓練記録の手の履歴）にメモが無い。訓練記録の状態には残る", async () => {
    await start("short");
    await doAct("call_person", "p-01", { memo: MEMO });
    while ((await row()).step < lastStep("short")) await advance();
    const rec = await loadDrillRecord(db, SCOPE, ID, "2026-11-05T02:00:00.000Z");
    if (rec === null || rec === "running") throw new Error("記録が無い");
    expect(rec.screen.state.actions[0].memo).toBe(MEMO);
    const ctx = reviewContextOf(rec);
    expect(ctx.actions.every((a) => !("memo" in a))).toBe(true);
    expect(reviewText(ctx, new Map())).not.toContain(MEMO);
  });
});
