// T91 ケアマネの手の表 v2（docs/tasks/T91.md）のテスト。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 18 の手の表（時間・相手・効き目）、手配型・受入型・記録型の返事、効き目（arrivals・checks・advised・応援の職員・頼み事）、
// 透析調整で左の表の「透析先 未確認」が消える（lib/triage は触らない）、自由対応（読み替え・記録・119・伏字不可・10 回）、保存と作り直し。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionPanel } from "../../components/drill/ActionPanel.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { DRILL_ACTIONS, type DrillScenario } from "../db/types.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import {
  ACTION_CATALOG,
  ACTION_GROUP_LABELS,
  ACTION_GROUPS,
  actionRow,
  actionWords,
  CATALOG_WORDS,
  effectiveKind,
  FREE_MAX,
  FREE_TEXT_MAX,
} from "./action-catalog.ts";
import { act, applyResult, BACKUP_PERSON, settleAsks, type ActTarget, type ActionHooks } from "./actions.ts";
import { actDrill, drillScope, loadDrillRow, loadTicks, participantsOf, replayState, startDrill, stateOfRow } from "./db.ts";
import { initialState, step, withoutMemo, type DrillState } from "./engine.ts";
import { createFreeHook, drillFreeHook, FREE_SYSTEM, freeChoices, resolveFree, type FreeHook } from "./free-action.ts";
import { actionPost } from "./http.ts";
import { ACTION_LABELS } from "./labels.ts";
import { loadPersonaSources } from "./persona.ts";
import {
  applyEvent,
  ARRIVAL_SUPPLIES,
  CLEARED_ON_ARRIVAL,
  EMPTY_WORLD,
  injectChange,
  SCENARIOS,
  settleWorld,
  type WorldState,
} from "./scenarios.ts";
import { loadDrillScreen } from "./view.ts";
import { drillClocks } from "./world-clocks.ts";
import { decideWorldReply, WORLD_ODDS } from "./world-reply.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown, model: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(answer(params), OPUS);
        },
      },
    },
  };
  return { client, calls };
}

const systemOf = (p: Params) => (p.system as Array<{ text: string }>).map((b) => b.text).join("\n");

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const seedOf = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

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
const ID = "drill-t91";

async function start(scenario: DrillScenario = "heavy_rain") {
  expect(await startDrill(db, SCOPE, scenario, START, {}, () => ID)).toEqual({ ok: true, id: ID });
}

async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}

async function triageOf(person: string) {
  const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
  return s.rows.find((r) => r.id === person)?.triage ?? null;
}

const body = (over: Record<string, unknown>) => ({ step: 0, actions: 0, target: null, ...over });

async function stateAt(n: number, scenario: DrillScenario = "heavy_rain"): Promise<DrillState> {
  let s = initialState(scenario, PARTICIPANTS, START);
  for (let i = 0; i < n; i++) s = (await step(s)).state;
  return s;
}

/** 決まった順の値を返す（足りなければ最後の値） */
const seq =
  (...xs: number[]) =>
  () =>
    xs.length > 1 ? xs.shift()! : xs[0];

const target = (id: string, kind: ActTarget["kind"], label: string, hasPhone = true): ActTarget => ({ id, kind, label, hasPhone });
const DAUGHTER_01 = target("c-01-1", "family", "家族 娘");
const SELF_01 = target("c-01-0", "self", "本人");
const SUPPORTER_01 = target("c-01-2", "supporter", "支援者");
const OXYGEN_02 = target("c-02-3", "oxygen_supplier", "酸素業者");
const DIALYSIS_03 = target("c-03-4", "dialysis_center", "透析施設");
const HOSPITAL_03 = target("c-03-5", "hospital", "病院");

// ---------- 1. 手の表 ----------

describe("手の表（18 の手）", () => {
  it("表の行は DRILL_ACTIONS と同じ 18。区分は 5 つ（見出し 2 字）、ボタンの言葉は 2〜5 字、使わない語を含まない", () => {
    expect(ACTION_CATALOG.map((r) => r.id).sort()).toEqual([...DRILL_ACTIONS].sort());
    expect(ACTION_CATALOG).toHaveLength(18);
    for (const g of ACTION_GROUPS) {
      expect(Array.from(ACTION_GROUP_LABELS[g])).toHaveLength(2);
      expect(ACTION_CATALOG.some((r) => r.group === g)).toBe(true);
    }
    for (const r of ACTION_CATALOG) {
      expect(ACTION_LABELS[r.id]).toBe(r.label);
      expect(Array.from(r.label).length).toBeGreaterThanOrEqual(2);
      expect(Array.from(r.label).length).toBeLessThanOrEqual(5);
      expect(r.label).not.toMatch(/診断|判定|重症|緊急度|札|購入|服用|mg/);
      expect(r.words).not.toMatch(/診断|判定|重症|緊急度|死亡|購入|服用|mg/);
      expect([0, 1]).toContain(r.staff);
    }
  });

  // 表の行ごとに: 区分・分・相手・効き目の種類・その人への手（docs/tasks/T91.md の表）
  const ROWS: Array<[string, string, number, string[], boolean, string[], boolean]> = [
    ["call_person", "contact", 5, ["self"], false, ["heard", "reach"], true],
    ["call_contact", "contact", 5, ["family", "supporter", "welfare_commissioner", "visiting_nurse", "care_service", "home_doctor", "pharmacy", "dialysis_center", "city_office"], true, ["heard", "reach"], true],
    ["advise_119", "contact", 5, ["self", "family", "supporter"], true, ["advise", "reach"], true],
    ["ask_check", "contact", 5, ["family", "supporter", "welfare_commissioner", "other"], true, ["arrival", "reach"], true],
    ["visit", "visit", 40, [], false, ["heard", "clearMarks", "reach"], true],
    ["dispatch", "visit", 10, ["visiting_nurse", "care_service"], false, ["staff", "arrival", "reach"], true],
    ["request_backup", "visit", 10, [], false, ["staff"], false],
    ["arrange_medicine", "arrange", 10, ["pharmacy", "home_doctor"], true, ["check", "arrival", "supply", "ask_done", "reach"], true],
    ["arrange_dialysis", "arrange", 15, ["dialysis_center", "hospital"], true, ["check", "reach"], true],
    ["request_welfare_shelter", "arrange", 15, [], false, ["clearMarks", "reach"], true],
    ["request_hospital", "arrange", 15, ["hospital", "home_doctor"], true, ["arrival", "reach"], true],
    ["arrange_transport", "arrange", 15, ["care_service", "city_office", "other"], false, ["arrival", "ask_done", "reach"], true],
    ["arrange_power", "arrange", 15, ["power_company", "city_office", "oxygen_supplier"], false, ["arrival", "supply", "ask_done", "reach"], true],
    ["call_vendor", "arrange", 5, ["oxygen_supplier", "power_company", "hospital", "other"], true, ["arrival", "supply", "reach"], true],
    ["report_city", "report", 10, ["city_office"], false, ["none"], false],
    ["note", "record", 2, [], false, ["none"], false],
    ["evacuate_self", "record", 30, [], false, ["none"], false],
    ["free", "record", 0, [], false, ["none"], false],
  ];
  it.each(ROWS)("%s: 区分 %s・%i 分・相手・効き目", (id, group, minutes, targets, needsTarget, effects, toward) => {
    const r = actionRow(id as (typeof DRILL_ACTIONS)[number]);
    expect(r.group).toBe(group);
    expect(r.minutes).toBe(minutes);
    expect([...r.targetKinds]).toEqual(targets);
    expect(r.needsTarget).toBe(needsTarget);
    expect(r.effects.map((e) => e.kind)).toEqual(effects);
    expect(r.towardPerson).toBe(toward);
  });

  it("表の並びは画面の段の順（区分ごとにまとまる）。効き目の印・届く物は scenarios.ts と同じ", () => {
    const groups = ACTION_CATALOG.map((r) => r.group);
    expect(groups.filter((g, i) => i === 0 || groups[i - 1] !== g)).toEqual([...ACTION_GROUPS]);
    for (const r of ACTION_CATALOG) {
      for (const e of r.effects) {
        if (e.kind === "clearMarks") expect([...e.keys]).toEqual([...CLEARED_ON_ARRIVAL]);
        if (e.kind === "supply") {
          const arrival = r.effects.find((x) => x.kind === "arrival");
          expect(arrival && arrival.kind === "arrival" && arrival.role !== "callee" ? ARRIVAL_SUPPLIES[arrival.role] : null).toBe(e.supply);
        }
      }
    }
    // 届いたに数える状態は返事の状態（採点 T94 が読む）
    expect(actionRow("arrange_medicine").reach).toEqual({ statuses: ["dispatched"], at: "arrival" });
    expect(actionRow("visit").reach).toEqual({ statuses: ["arrived"], at: "end" });
  });

  it("言い方は 1 つの表（本人役・監督・世界が同じ物を読む）。自由対応は読み替えた手の言い方", () => {
    expect(CATALOG_WORDS.call_person).toBe("本人に電話した");
    expect(actionWords({ kind: "free", as: "arrange_medicine" })).toBe(CATALOG_WORDS.arrange_medicine);
    expect(actionWords({ kind: "free" })).toBe(CATALOG_WORDS.free);
    expect(effectiveKind({ kind: "free", as: "note" })).toBe("note");
    expect(effectiveKind({ kind: "visit", as: "note" })).toBe("visit");
  });
});

// ---------- 2. 結果の決め方 ----------

describe("世界の返事（手配型・受入型・記録型）", () => {
  const w = (over: Partial<WorldState> = {}): WorldState => ({ ...EMPTY_WORLD, staff: 2, ...over });
  const ask = (action: (typeof DRILL_ACTIONS)[number], callee: ActTarget["kind"] | null, world = w(), hour = 3, person: string | null = "p-03") => ({
    action,
    person,
    callee,
    world,
    hour,
  });

  it("手配: 電話の様子ごとの確率。不通なら不通、家へ向かう手配は通行止なら届かない", () => {
    expect(decideWorldReply(ask("arrange_medicine", "pharmacy"), WORLD_ODDS.arrange.ok - 0.01)).toMatchObject({ ok: true, status: "dispatched" });
    expect(decideWorldReply(ask("arrange_medicine", "pharmacy"), WORLD_ODDS.arrange.ok)).toMatchObject({ ok: false, status: "noDispatch" });
    expect(decideWorldReply(ask("arrange_medicine", "pharmacy", w({ phone: "down" })), 0)).toMatchObject({ status: "noLine", because: "電話 通話不可" });
    const road = w({ roads: [{ id: "r", label: "川沿いの市道", open: false, person: "p-03" }] });
    expect(decideWorldReply(ask("arrange_power", null, road), 0)).toMatchObject({ status: "blocked", because: "川沿いの市道 通行止" });
    // 透析調整は家へ向かわないので通行止でも調整できる
    expect(decideWorldReply(ask("arrange_dialysis", "hospital", road), 0)).toMatchObject({ ok: true, status: "accepted" });
    expect(decideWorldReply(ask("call_vendor", "oxygen_supplier", w({ phone: "busy" })), 0.39)).toMatchObject({ ok: true });
    expect(decideWorldReply(ask("call_vendor", "oxygen_supplier", w({ phone: "busy" })), 0.4)).toMatchObject({ ok: false });
    expect(decideWorldReply(ask("request_backup", null, w(), 3, null), 0.59)).toMatchObject({ ok: true, status: "dispatched" });
    expect(decideWorldReply(ask("request_backup", null, w(), 3, null), 0.6)).toMatchObject({ ok: false, status: "noDispatch" });
  });

  it("透析調整: 休止中の透析施設へは「休止」、病院かほかの施設なら受入の確率", () => {
    const closed = w({ facilities: [{ id: "f", label: "透析施設", open: false, person: "p-03", depends: "dialysis_center" }] });
    expect(decideWorldReply(ask("arrange_dialysis", "dialysis_center", closed), 0)).toMatchObject({ status: "closed", because: "透析施設 休止" });
    expect(decideWorldReply(ask("arrange_dialysis", "hospital", closed), 0)).toMatchObject({ ok: true, status: "accepted" });
    expect(decideWorldReply(ask("arrange_dialysis", "hospital", closed), 0.9)).toMatchObject({ ok: false, status: "refused" });
  });

  it("病院受入は受入依頼と同じ時間ごとの確率。119勧奨・見守依頼は電話型（本人・家族は呼出）。記録はいつも記録済", () => {
    expect(decideWorldReply(ask("request_hospital", "hospital", w(), 3), 0.29).status).toBe("accepted");
    expect(decideWorldReply(ask("request_hospital", "hospital", w(), 3), 0.3).status).toBe("refused");
    expect(decideWorldReply(ask("request_hospital", "hospital", w(), 48), 0.79).status).toBe("accepted");
    expect(decideWorldReply(ask("advise_119", "self"), 0.99).status).toBe("ringing");
    expect(decideWorldReply(ask("ask_check", "family"), 0.99).status).toBe("ringing");
    expect(decideWorldReply(ask("ask_check", "other", w({ phone: "busy" })), 0.6).status).toBe("noLine");
    expect(decideWorldReply(ask("note", null), 0.99)).toMatchObject({ ok: true, status: "noted" });
  });
});

// ---------- 3. 効き目 ----------

describe("手の効き目", () => {
  it("薬手配: 配達の確認が確認済、薬が 120 分後に届く（届いた物・頼み事の薬が済む）。時計の写しの配達が確認済に", async () => {
    let s = await stateAt(1);
    s = { ...s, world: { ...s.world, asks: { "p-06": [{ kind: "medicine", at: 0, done: null }, { kind: "water", at: 0, done: null }] } } };
    s = { ...s, world: applyEvent(s.world, { change: injectChange("supply_left", "p-06"), text: "", person: "p-06" }, 0) };
    const clock = { person_id: "p-06", category: "tube_feeding" as const, depends_on: null, depends_check: null };
    expect(drillClocks([clock], s.world)[0]).toMatchObject({ depends_on: "delivery", depends_check: "unconfirmed" });

    const r = await act(s, { kind: "arrange_medicine", person: "p-06", target: target("x-ph", "pharmacy", "薬局") }, {}, () => 0);
    expect(r.record).toMatchObject({ kind: "arrange_medicine", minutes: 10, callee: "pharmacy", calleeLabel: "薬局" });
    expect(r.record.result).toMatchObject({ ok: true, status: "dispatched", arriveAt: 130, heard: null, staff: 0 });
    expect(r.state.world.checks).toEqual({ "p-06": { delivery: "confirmed" } });
    expect(r.state.world.arrivals).toEqual([{ person: "p-06", role: "medicine", arrive: 130, back: null, arrived: false, from: "a1" }]);
    expect(drillClocks([clock], r.state.world)[0]).toMatchObject({ depends_on: "delivery", depends_check: "confirmed" });

    // 着く前は届いていない。着いたら（settleWorld）薬が届き、栄養剤の持ち出し忘れの印が消え、次の手で頼み事の薬が済む（水は残る）
    expect(r.state.world.supplies).toBeUndefined();
    let t = (await step(r.state)).state; // 1 時間（60 分）: まだ着かない
    expect(t.world.supplies).toBeUndefined();
    t = (await step(t)).state; // 3 時間（180 分）
    expect(t.world.supplies).toEqual({ "p-06": { medicine: 130 } });
    expect(t.world.marks["p-06"]?.supplyLeft).toBeUndefined();
    t = (await act(t, { kind: "note", person: null, target: null }, {}, () => 0)).state;
    expect(t.world.asks!["p-06"]).toEqual([
      { kind: "medicine", at: 0, done: 130 },
      { kind: "water", at: 0, done: null },
    ]);
    // 同じ所を何度通っても同じ
    expect(settleAsks(t.world, t.actions)).toBe(t.world);
  });

  it("透析調整: 透析先の確認が確認済（左の表の入力の写し）。休止の書き換えより後に当たる", async () => {
    let s = await stateAt(1);
    s = { ...s, world: applyEvent(s.world, { change: injectChange("dialysis_flooded", "p-03"), text: "", person: "p-03" }, 0) };
    const clock = { person_id: "p-03", category: "dialysis" as const, depends_on: "dialysis_center" as const, depends_check: "unconfirmed" as const };
    const closed = await act(s, { kind: "arrange_dialysis", person: "p-03", target: DIALYSIS_03 }, {}, () => 0);
    expect(closed.record.result).toMatchObject({ ok: false, status: "closed" });
    expect(closed.state.world.checks).toBeUndefined();
    const ok = await act(s, { kind: "arrange_dialysis", person: "p-03", target: HOSPITAL_03 }, {}, () => 0);
    expect(ok.record.result).toMatchObject({ ok: true, status: "accepted" });
    expect(ok.state.world.checks).toEqual({ "p-03": { dialysis_center: "confirmed" } });
    expect(drillClocks([clock], ok.state.world)[0].depends_check).toBe("confirmed");
  });

  it("見守依頼: 家族が出たら 30〜60 分後に家族が着く（聞いた安否にはしない）。119勧奨: 勧めた時刻だけで、救急は作らない", async () => {
    const s = await stateAt(1);
    // roll: 世界 0 → 出る 0 → 着く分 0（30 分）
    const r = await act(s, { kind: "ask_check", person: "p-01", target: DAUGHTER_01 }, {}, seq(0, 0, 0));
    expect(r.record.result).toMatchObject({ ok: true, status: "connected", heard: null, arriveAt: 35 });
    expect(r.state.world.arrivals).toEqual([{ person: "p-01", role: "family", arrive: 35, back: null, arrived: false, from: "a1" }]);
    const late = await act(s, { kind: "ask_check", person: "p-01", target: SUPPORTER_01 }, {}, seq(0, 0, 0.999));
    expect(late.state.world.arrivals).toEqual([{ person: "p-01", role: "supporter", arrive: 65, back: null, arrived: false, from: "a1" }]);
    const no = await act(s, { kind: "ask_check", person: "p-01", target: DAUGHTER_01 }, {}, seq(0, 0.99));
    expect(no.record.result).toMatchObject({ ok: false, status: "noAnswer" });
    expect(no.state.world.arrivals).toBeUndefined();

    const a = await act(s, { kind: "advise_119", person: "p-01", target: SELF_01 }, {}, () => 0);
    expect(a.record.result).toMatchObject({ ok: true, status: "connected", heard: null });
    expect(a.state.world.advised).toEqual({ "p-01": 5 });
    expect(a.state.world.arrivals).toBeUndefined();
    expect(a.state.world.dispatched).toEqual([]);
  });

  it("応援依頼: 90 分後に職員の空き +1（本人の所へ向かう人ではない）。業者連絡: 120〜240 分後に酸素が届く", async () => {
    const s = await stateAt(1);
    const before = s.world.staff;
    const r = await act(s, { kind: "request_backup", person: null, target: null }, {}, () => 0);
    expect(r.record).toMatchObject({ kind: "request_backup", calleeLabel: "他事業所", minutes: 10 });
    expect(r.record.result).toMatchObject({ ok: true, status: "dispatched", arriveAt: 100 });
    expect(r.state.world.staff).toBe(before);
    expect(r.state.world.arrivals).toEqual([{ person: BACKUP_PERSON, role: "staff", arrive: 100, back: 100, arrived: false, from: "a1" }]);
    expect(settleWorld(r.state.world, 99).staff).toBe(before);
    expect(settleWorld(r.state.world, 100).staff).toBe(before + 1);

    const v = await act(s, { kind: "call_vendor", person: "p-02", target: OXYGEN_02 }, {}, seq(0, 0.5));
    expect(v.record.result).toMatchObject({ ok: true, status: "dispatched", arriveAt: 5 + 180 });
    expect(settleWorld(v.state.world, 185).supplies).toEqual({ "p-02": { oxygen: 185 } });
  });

  it("電源手配・移送手配は相手を選ばなければ市役所。移送が着いたら帰宅希望の印が消え、頼み事の移送が済む", async () => {
    let s = await stateAt(1);
    s = { ...s, world: applyEvent(s.world, { change: injectChange("going_home", "p-05"), text: "", person: "p-05" }, 0) };
    s = { ...s, world: { ...s.world, asks: { "p-05": [{ kind: "transport", at: 10, done: null }] } } };
    const p = await act(s, { kind: "arrange_power", person: "p-05", target: null }, {}, () => 0);
    expect(p.record).toMatchObject({ calleeLabel: "市役所", callee: null });
    expect(p.state.world.arrivals).toEqual([{ person: "p-05", role: "power", arrive: 135, back: null, arrived: false, from: "a1" }]);
    const t = await act(s, { kind: "arrange_transport", person: "p-05", target: null }, {}, () => 0);
    expect(t.state.world.arrivals![0]).toMatchObject({ role: "transport", arrive: 75 });
    const later = (await act({ ...t.state, minute: 80 }, { kind: "note", person: null, target: null }, {}, () => 0)).state;
    expect(later.world.marks["p-05"]?.goingHome).toBeUndefined();
    expect(later.world.asks!["p-05"]).toEqual([{ kind: "transport", at: 10, done: 75 }]);
  });

  it("病院受入: 受けてもらえたら 60 分後に移送が着く。記録: 世界を変えず 2 分", async () => {
    const s = await stateAt(1);
    const h = await act(s, { kind: "request_hospital", person: "p-03", target: HOSPITAL_03 }, {}, () => 0);
    expect(h.record.result).toMatchObject({ ok: true, status: "accepted", arriveAt: 75 });
    expect(h.state.world.arrivals).toEqual([{ person: "p-03", role: "transport", arrive: 75, back: null, arrived: false, from: "a1" }]);
    const n = await act(s, { kind: "note", person: "p-03", target: null, memo: "透析先を明日確かめる" }, {}, () => 0.99);
    expect(n.record).toMatchObject({ minutes: 2, memo: "透析先を明日確かめる" });
    expect(n.record.result).toMatchObject({ ok: true, status: "noted", text: "記録した" });
    expect(n.state.world).toEqual(s.world);
    expect(n.state.minute).toBe(2);
  });
});

// ---------- 4. 左の表に届く道（lib/triage は触らない） ----------

describe("左の表", () => {
  it("透析調整で田中の「透析先 未確認」が消える（時計の確認の写し）。保存と作り直しで同じ", async () => {
    await start();
    expect((await triageOf("p-03"))?.reason).toContain("透析先");
    const n = (await stored()).actions.length;
    const r = await actDrill(db, SCOPE, ID, { step: 0, actions: n }, { kind: "arrange_dialysis", person: "p-03", target: "c-03-5" }, START, {
      roll: () => 0,
    });
    expect(r).toMatchObject({ ok: true, record: { kind: "arrange_dialysis", result: { status: "accepted" } } });
    expect((await triageOf("p-03"))?.reason ?? "").not.toContain("透析先");

    // 自由対応（鍵なし → 変化なし。T129 で記録から）と応援依頼も打って、作り直しと比べる
    await actDrill(db, SCOPE, ID, { step: 0, actions: 1 }, { kind: "free", person: "p-03", target: null, text: "家族に連絡がつくか試す" }, START, {
      roll: () => 0,
    });
    await actDrill(db, SCOPE, ID, { step: 0, actions: 2 }, { kind: "request_backup", person: null, target: null }, START, { roll: () => 0 });
    await actDrill(db, SCOPE, ID, { step: 0, actions: 3 }, { kind: "ask_check", person: "p-01", target: "c-01-1" }, START, { roll: () => 0 });
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    const live = stateOfRow(row);
    expect(live.actions.map((a) => [a.kind, a.as ?? null, a.result?.status])).toEqual([
      ["arrange_dialysis", null, "accepted"],
      ["free", null, "unchanged"],
      ["request_backup", null, "dispatched"],
      ["ask_check", null, "connected"],
    ]);
    const replayed = replayState(row, participantsOf(row), await loadTicks(db, ID, SCENARIOS.heavy_rain.hours, row.step), row.step).state;
    expect(replayed).toEqual(live);
  });
});

// ---------- 5. 自由対応 ----------

/** 自由対応の読み替えの偽の答え */
const FREE_ANSWER = (kind: string, callee = "", text = "病院へ透析の振替を頼む", reason = "透析先が休止したので") => ({ kind, callee, text, reason });

function freeHooks(answer: (p: Params) => unknown): { hooks: ActionHooks; calls: Params[] } {
  const { client, calls } = fake(answer);
  const free = drillFreeHook({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!;
  return { hooks: { free }, calls };
}

describe("自由対応", () => {
  it("偽の client で読み替え → 表の手として時間・結果・効き目をコードが決める。文は伏せて渡し、Claude の入力に戻さない", async () => {
    await start();
    const name = seedOf("p-03").person.name;
    const { hooks, calls } = freeHooks(() => FREE_ANSWER("arrange_dialysis", "hospital"));
    const res = await actionPost(
      db,
      careManager(),
      ID,
      body({ kind: "free", person: "p-03", text: `${name}さんの透析先を病院に振り替えてもらう` }),
      START,
      { hooks, roll: () => 0 },
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(systemOf(calls[0])).toContain(FREE_SYSTEM);
    expect(calls[0].model).toBe(OPUS);
    // Claude に渡ったのは伏せた文だけ（氏名・電話・生年月日が無い）。手の一覧は全部の手で、今できない手は理由つき（T129）
    const sent = JSON.stringify(calls[0].messages);
    expect(findLeaks(sent, ALL_KEY)).toEqual([]);
    expect(sent).not.toContain(name);
    expect(sent).toContain("arrange_dialysis");
    expect(sent).toMatch(/arrange_medicine[^}]*不可（相手なし）/); // 田中は薬局・かかりつけが台帳に無い

    const s = await stored();
    const rec = s.actions[0];
    expect(rec).toMatchObject({ kind: "free", as: "arrange_dialysis", minutes: 15, callee: "hospital", target: "c-03-5", reason: "透析先が休止したので" });
    expect(rec.text).toBe(`${name}さんの透析先を病院に振り替えてもらう`); // サーバーの中だけ（打った文のまま。T129）
    expect(rec.result).toMatchObject({ ok: true, status: "accepted", text: "病院へ透析の振替を頼む", ai: true });
    expect(s.world.checks).toEqual({ "p-03": { dialysis_center: "confirmed" } });
    expect(s.world.counts).toEqual({ director: 0, persona: 0, call: 0, free: 1 });
    expect((await triageOf("p-03"))?.reason ?? "").not.toContain("透析先");
    // 監督・世界・本人役・講評に渡る手（withoutMemo）には文と理由が無い。読み替えた手の id だけ
    const forClaude = withoutMemo(s.actions)[0];
    expect(forClaude.text).toBeUndefined();
    expect(forClaude.reason).toBeUndefined();
    expect(forClaude).toMatchObject({ kind: "free", as: "arrange_dialysis" });
  });

  it("表に無い手は変化なし、相手の無い手はその手のまま断る、相手の区分が違うだけなら台帳から（T129）。119 に当たる文は 119勧奨（救急は来ない）", async () => {
    await start();
    // 表に無い手（所要なし）は変化なし。前の形の自由（所要なし）はそのままの手で既定の所要
    const cases: Array<[unknown, string, { as?: string; idle?: true; way?: string; callee?: string }, string]> = [
      [FREE_ANSWER("teleport"), "p-03", { idle: true }, "unchanged"],
      [FREE_ANSWER("free"), "p-03", { way: "desk" }, "done"],
      [FREE_ANSWER("call_contact", "pharmacy"), "p-03", { as: "call_contact", callee: "family" }, "connected"], // 相手の区分が台帳に無い → 台帳の家族
      [FREE_ANSWER("call_contact", "hospital"), "p-03", { as: "call_contact", callee: "family" }, "connected"], // 連絡先電話の相手でない区分
    ];
    let n = 0;
    for (const [answer, person, want, status] of cases) {
      const { hooks } = freeHooks(() => answer);
      const res = await actionPost(db, careManager(), ID, body({ actions: n, kind: "free", person, text: "様子を見に行けるか考える" }), START, {
        hooks,
        roll: () => 0,
      });
      expect(res.status).toBe(200);
      n++;
      const rec = (await stored()).actions.at(-1)!;
      expect(rec).toMatchObject(want);
      if (!want.as) expect(rec.as).toBeUndefined();
      expect(rec.result?.status).toBe(status);
    }
    // 薬局が台帳に無い本人への薬手配は、記録に落とさずその手のまま「相手なし」で断る（手を打たない）
    {
      const { hooks } = freeHooks(() => FREE_ANSWER("arrange_medicine", "pharmacy"));
      const res = await actionPost(db, careManager(), ID, body({ actions: n, kind: "free", person: "p-03", text: "薬を届けてもらう" }), START, { hooks, roll: () => 0 });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ ok: false, error: "blocked", label: "相手なし" });
      expect((await stored()).actions).toHaveLength(n);
    }
    // 119: Claude が本人電話と答えても 119勧奨。相手は Claude の区分（娘）で、勧めた時刻だけ残る
    const { hooks } = freeHooks(() => FREE_ANSWER("call_person", "family", "娘さんに救急車を呼ぶよう伝えた"));
    const res = await actionPost(db, careManager(), ID, body({ actions: n, kind: "free", person: "p-01", text: "119 に電話するよう家族に伝える" }), START, {
      hooks,
      roll: () => 0,
    });
    expect(res.status).toBe(200);
    const s = await stored();
    const rec = s.actions.at(-1)!;
    expect(rec).toMatchObject({ as: "advise_119", callee: "family" });
    // 救急車の文は画面に出さない（固定の文）
    expect(rec.result).toMatchObject({ status: "connected", ai: false });
    expect(s.world.advised).toMatchObject({ "p-01": rec.endMinute });
    expect(s.world.arrivals ?? []).toEqual([]);
  });

  it("伏せきれない文は 400「伏字不可」で、Claude に送らず手も打たない", async () => {
    await start();
    const { hooks, calls } = freeHooks(() => FREE_ANSWER("note"));
    // 生年月日はどの書き方でも伏せる（T118）。伏せきれない物の例は電話の数字を含む長い数字の並び
    const digits = seedOf("p-03").contacts.find((c) => c.kind === "self")!.phone!.replace(/-/g, "");
    const res = await actionPost(db, careManager(), ID, body({ kind: "free", person: "p-03", text: `番号 ${digits}2345 の人の透析先` }), START, {
      hooks,
      roll: () => 0,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, label: "伏字不可" });
    expect(calls).toHaveLength(0);
    expect((await stored()).actions).toEqual([]);
  });

  it("文が無い・200 字を超える自由対応は 400（T110 で 120 字から）。鍵が無ければ読み替えずに変化なし（T129 で記録から）", async () => {
    await start();
    expect((await actionPost(db, careManager(), ID, body({ kind: "free", person: null }), START)).status).toBe(400);
    expect((await actionPost(db, careManager(), ID, body({ kind: "free", person: null, text: " " }), START)).status).toBe(400);
    expect((await actionPost(db, careManager(), ID, body({ kind: "free", person: null, text: "あ".repeat(FREE_TEXT_MAX + 1) }), START)).status).toBe(400);
    expect((await actionPost(db, careManager(), ID, body({ kind: "visit", person: "p-01", text: 3 }), START)).status).toBe(400);
    expect(drillFreeHook({ DB: db }, careManager())).toBeUndefined();
    const ok = await actionPost(db, careManager(), ID, body({ kind: "free", person: null, text: "事業所の発電機を確かめる" }), START, { roll: () => 0 });
    expect(ok.status).toBe(200);
    expect((await stored()).actions[0]).toMatchObject({ kind: "free", idle: true, minutes: 2, text: "事業所の発電機を確かめる", result: { status: "unchanged" } });
    expect((await stored()).actions[0].as).toBeUndefined();
  });

  it("1 訓練 10 回まで。超えたら読み替えずに変化なし（Claude を呼ばない）", async () => {
    let calls = 0;
    const spy: FreeHook = async (a) => {
      calls++;
      return { stored: a.text, reading: { kind: "visit", callee: "", text: null, reason: null } };
    };
    let s = await stateAt(1);
    s = { ...s, world: { ...s.world, counts: { director: 0, persona: 0, call: 0, free: FREE_MAX - 1 } } };
    const tenth = await act(s, { kind: "free", person: "p-01", target: null, text: "家へ行く", contacts: [] }, { free: spy }, () => 0);
    expect(tenth.record.as).toBe("visit");
    expect(tenth.state.world.counts?.free).toBe(FREE_MAX);
    const eleventh = await act(tenth.state, { kind: "free", person: "p-01", target: null, text: "家へ行く", contacts: [] }, { free: spy }, () => 0);
    expect(eleventh.record).toMatchObject({ kind: "free", idle: true });
    expect(eleventh.record.as).toBeUndefined();
    expect(calls).toBe(1);
    // 1 訓練の上限（T90 の 150）に達していても呼ばない
    const capped = { ...s, world: { ...s.world, counts: { director: 20, persona: 120, call: 10, free: 0 } } };
    expect((await act(capped, { kind: "free", person: "p-01", target: null, text: "家へ行く", contacts: [] }, { free: spy }, () => 0)).record.idle).toBe(true);
    expect(calls).toBe(1);
  });

  it("使える手の一覧と読み替えの決め（本人なし・相手の区分）", () => {
    const contacts = [SELF_01, DAUGHTER_01, SUPPORTER_01];
    // T129: 候補は全部の手（記録の手は外す）。今できない手は理由つき
    expect(freeChoices(null, []).filter((c) => c.why === null).map((c) => c.id)).toEqual(["request_backup", "report_city", "evacuate_self"]);
    const mine = freeChoices("p-01", contacts);
    expect(mine.find((c) => c.id === "ask_check")?.why).toBeNull();
    expect(mine.find((c) => c.id === "arrange_medicine")?.why).toBe("相手なし");
    expect(mine.find((c) => c.id === "advise_119")?.callees).toEqual(["self", "family", "supporter"]);
    const ctx = { text: "様子", person: "p-01", contacts };
    expect(resolveFree({ kind: "ask_check", callee: "supporter" }, ctx)).toEqual({ as: "ask_check", target: SUPPORTER_01 });
    // 相手の要る手で区分が無い・台帳に無い区分は、その手の相手の区分の順で台帳から（T129。前は記録）。本人電話は本人、固定の相手のある手は固定の相手
    expect(resolveFree({ kind: "ask_check", callee: "" }, ctx)).toEqual({ as: "ask_check", target: DAUGHTER_01 });
    expect(resolveFree({ kind: "ask_check", callee: "pharmacy" }, ctx)).toEqual({ as: "ask_check", target: DAUGHTER_01 });
    expect(resolveFree({ kind: "call_person", callee: "" }, ctx)).toEqual({ as: "call_person", target: SELF_01 });
    expect(resolveFree({ kind: "arrange_transport", callee: "" }, ctx)).toEqual({ as: "arrange_transport", target: null });
    expect(resolveFree({ kind: "evacuate_self", callee: "" }, ctx)).toEqual({ as: "evacuate_self", target: null });
    expect(resolveFree(null, ctx)).toMatchObject({ as: null, own: { idle: true } });
    // 119 は相手の区分が無ければ本人から
    expect(resolveFree({ kind: "note", callee: "" }, { ...ctx, text: "救急車を呼ぶ" })).toEqual({ as: "advise_119", target: SELF_01 });
    expect(resolveFree({ kind: "note", callee: "" }, { ...ctx, text: "救急隊の要請" })).toEqual({ as: "advise_119", target: SELF_01 });
    // 救急病院・救急外来は病院の手（119 にしない）
    expect(
      resolveFree({ kind: "request_hospital", callee: "hospital" }, { text: "救急病院に受け入れを頼む", person: "p-03", contacts: [HOSPITAL_03] }),
    ).toEqual({ as: "request_hospital", target: HOSPITAL_03 });
    // 本人を選ばない 119 は、記録に落とさず 119勧奨のまま「対象なし」（T129）
    expect(resolveFree(null, { text: "119", person: null, contacts: [] })).toEqual({ as: "advise_119", target: null, block: "対象なし" });
  });

  it("口の作り: 台帳を伏せる人は事業所の全員（参加者が先）。Claude の 1 文の仮名・救急は使わない", async () => {
    const { client, calls } = fake(() => FREE_ANSWER("visit", "", "A さんの家に救急車を回す"));
    const sources = await loadPersonaSources(db, DEMO.id);
    const hook = createFreeHook({
      load: async () => sources,
      ai: { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(db), office: { id: DEMO.id, kind: "demo" }, claude: client, now: () => new Date(START) },
    });
    const other = seedOf("p-10").person.name;
    const r = await hook({ text: `${other}さんにも声をかける`, person: "p-01", participants: ["p-01"], choices: freeChoices("p-01", [SELF_01]), facts: "時刻: 発災から 1 時間" });
    expect(JSON.stringify(calls[0].messages)).not.toContain(other);
    expect(r.stored).toContain(other);
    expect(r.reading).toMatchObject({ kind: "visit", text: null });
  });
});

// ---------- 6. 画面（対応の欄） ----------

describe("対応の欄", () => {
  it("18 の手を区分の 5 段（連絡・訪問・手配・報告・記録）で並べる。10 分版も同じ部品。本人を選ぶまで本人の要る手は押せない", () => {
    const html = renderToStaticMarkup(createElement(ActionPanel, { drillId: ID, step: 0, actions: 0, people: [], contacts: {} }));
    expect(html.match(/data-act-group="/g)).toHaveLength(5);
    for (const g of ACTION_GROUPS) expect(html).toContain(`>${ACTION_GROUP_LABELS[g]}</h3>`);
    const kinds = [...html.matchAll(/data-act-kind="([a-z_0-9]+)"/g)].map((m) => m[1]);
    // 記録（note）は T126 で手の一覧から外した（表の行と保存の形は残る）
    expect(kinds).toEqual(ACTION_CATALOG.map((r) => r.id).filter((k) => k !== "note"));
    // 本人なしで押せるのは応援依頼・行政報告・退避・自由対応だけ
    const enabled = html
      .split("<button")
      .map((tag) => tag.slice(0, tag.indexOf(">")))
      .filter((tag) => tag.includes("data-act-kind=") && !tag.includes(' disabled=""'))
      .map((tag) => /data-act-kind="([a-z_0-9]+)"/.exec(tag)![1]);
    expect(enabled.sort()).toEqual(["evacuate_self", "free", "report_city", "request_backup"]);
    // 自由対応は分を出さない（読み替えた手の分）。文の欄は選ぶまで出さない
    expect(html).not.toContain("data-act-free-input");
    expect(html).not.toMatch(/ピル|rounded-full|tracking-/);
  });
});
