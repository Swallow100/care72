// 訓練を本物の事業所で（docs/tasks/T70.md）のテスト。本物の API は呼ばない（偽の hooks）。
// - 想定の表の配役: デモ事業所は前と同じ（配役なし）、新しい事業所の 5 人に行が当たる、本人役の入力に行が渡る、再開・再生でも同じ
// - 方言の行を外す
// - 押せる人なし・上限の見込み（開始の設定）、上限に当たった刻みの停止の印
// - 進行中をケアマネごと、24 時間で自動中断
// - 仮想モードの街を台帳から（デモは架空の街のまま、部屋に町名を渡さない）

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Situation } from "../../components/drill/Situation.tsx";
import { StartButtons } from "../../components/drill/StartButtons.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { findLeaks, pseudonymizeText } from "../pseudonym/index.ts";
import { AREA_TOWNS, areaOf, DEMO_AREA, geographyText } from "./area.ts";
import type { DrillScenario, Ledger } from "../db/types.ts";
import { castScenario, matchesPick, needsCast, type CastFacts } from "./cast.ts";
import { castFactsMap } from "./cast-facts.ts";
import {
  abandonDrill,
  advanceDrill,
  autoAbandonEventId,
  caseloadForDrill,
  drillScope,
  expireStaleDrills,
  listDrills,
  loadDrillRow,
  loadTicks,
  participantsOf,
  replayState,
  runningDrillId,
  startDrill,
  stateOfRow,
} from "./db.ts";
import { aiStoppedOf, stopIncidents, stopLog, type PersonaInput, type WorldInput } from "./engine.ts";
import { estimateDrillCalls, overLimit } from "./estimate.ts";
import { drillHooks } from "./hooks.ts";
import { listGet } from "./http.ts";
import { loadOutcomeSources } from "./outcome.ts";
import { CALL_SYSTEM, fixedTurns, loadPersonaSources, PERSONA_SYSTEM, PERSONA_VIRTUAL } from "./persona.ts";
import { applyEvent, EMPTY_WORLD, SCENARIO_ORDER, SCENARIOS } from "./scenarios.ts";
import { worldIncidents, type WorldStep } from "./world-apply.ts";
import { buildCast, openingText, worldNow } from "./world-oneshot.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const START = "2026-11-05T01:00:00.000Z";
const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const NEW = { id: "office-t70", name: "架空の事業所", kind: "regular" as const };
const CM_A = "acct-t70-a";
const CM_B = "acct-t70-b";

const careManager = (office: typeof DEMO | typeof NEW, accountId: string, p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: false,
  accountId,
  displayName: accountId,
  office,
  caseloadOf: accountId,
  personId: null,
  contactId: null,
  ...p,
});

// ---------- 新しい事業所の架空の 5 人 ----------

type NewPerson = {
  id: string;
  kana: string;
  ledger: Partial<Ledger>;
  contacts: Array<{ kind: string; relation: string; smartphone: 0 | 1 | null }>;
  clocks: Array<{ category: string; label: string; value: number; unit: string; starts: string; depends?: string }>;
};

const ledger = (l: Partial<Ledger>): Ledger => ({
  basic: {},
  care: {},
  medical: { devices: [], medications: [] },
  evacuation: { hazards: [] },
  notes: [],
  pending: [],
  ...l,
});

/** 呼吸器・透析・独居・スマホなし・ハザードなし（よみの順） */
const FIVE: NewPerson[] = [
  {
    id: "n-1",
    kana: "アオキ イチ",
    ledger: {
      basic: { address: { city: "架空市", town: "あおば町" }, household: "with_spouse", contactMeans: { landline: true, smartphone: "none" } },
      medical: { devices: [{ kind: "ventilator" }], medications: [] },
      evacuation: { hazards: [{ kind: "flood", depthM: 3 }] },
    },
    contacts: [{ kind: "family", relation: "妻", smartphone: 1 }],
    clocks: [{ category: "ventilator", label: "人工呼吸器の電池", value: 3, unit: "hour", starts: "outage" }],
  },
  {
    id: "n-2",
    kana: "イシイ ニ",
    ledger: {
      basic: { address: { city: "架空市", town: "しらさぎ町" }, household: "with_spouse", contactMeans: { landline: true, smartphone: "none" } },
      medical: { devices: [{ kind: "dialysis", schedule: "月水金" }], medications: [] },
      evacuation: { hazards: [] },
    },
    contacts: [{ kind: "family", relation: "夫", smartphone: 1 }],
    clocks: [{ category: "dialysis", label: "透析", value: 2, unit: "day", starts: "disaster", depends: "dialysis_center" }],
  },
  {
    id: "n-3",
    kana: "ウエノ サン",
    ledger: {
      basic: { address: { city: "架空市", town: "しらさぎ町" }, household: "alone", contactMeans: { mobile: true, smartphone: "uses" } },
      evacuation: { hazards: [{ kind: "flood", depthM: 0.5 }] },
    },
    contacts: [],
    clocks: [],
  },
  {
    id: "n-4",
    kana: "エンドウ シ",
    ledger: {
      basic: { address: { city: "架空市", town: "もみじ台" }, household: "with_child", contactMeans: { landline: true, smartphone: "none" } },
      care: { dementia: true },
    },
    contacts: [
      { kind: "family", relation: "息子", smartphone: 0 },
      { kind: "welfare_commissioner", relation: "民生委員", smartphone: null },
    ],
    clocks: [],
  },
  {
    id: "n-5",
    kana: "オオタ ゴ",
    ledger: { basic: { household: "with_family", contactMeans: { landline: true, smartphone: "none" } } },
    contacts: [{ kind: "family", relation: "娘", smartphone: 1 }],
    clocks: [],
  },
];
const FIVE_IDS = FIVE.map((p) => p.id);

function addNewOffice(): void {
  sqlite.exec(`INSERT INTO offices (id, name, kind, city) VALUES ('${NEW.id}', '${NEW.name}', 'regular', '架空市')`);
  for (const [id, name] of [
    [CM_A, "ケアマネ甲"],
    [CM_B, "ケアマネ乙"],
  ]) {
    sqlite.exec(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('${id}', '${NEW.id}', 'care_manager', '${name}')`);
  }
  const person = sqlite.prepare("INSERT INTO people (id, office_id, care_manager_id, name, kana, ledger) VALUES (?, ?, ?, ?, ?, ?)");
  const contact = sqlite.prepare("INSERT INTO contacts (id, person_id, kind, relation, phone, has_smartphone, sort) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const clock = sqlite.prepare(
    "INSERT INTO clocks (id, person_id, kind, category, label, value, unit, starts_on, depends_on, depends_check) VALUES (?, ?, 'device', ?, ?, ?, ?, ?, ?, ?)",
  );
  FIVE.forEach((p, i) => {
    person.run(p.id, NEW.id, CM_A, `架空 ${p.kana}`, p.kana, JSON.stringify(ledger(p.ledger)));
    p.contacts.forEach((c, j) => contact.run(`${p.id}-c${j}`, p.id, c.kind, c.relation, `090-0000-00${i}${j}`, c.smartphone, j));
    p.clocks.forEach((k, j) =>
      clock.run(`${p.id}-k${j}`, p.id, k.category, k.label, k.value, k.unit, k.starts, k.depends ?? null, k.depends ? "unconfirmed" : null),
    );
  });
}

async function newFacts(): Promise<Map<string, CastFacts>> {
  return castFactsMap(await loadPersonaSources(db, NEW.id));
}

const scopeA = () => drillScope(careManager(NEW, CM_A))!;

async function runAll(scenario: DrillScenario, id: string, hooks = {}) {
  const scope = scopeA();
  expect(await startDrill(db, scope, scenario, START, hooks, () => id)).toEqual({ ok: true, id });
  for (let s = 0; s < SCENARIOS[scenario].hours.length - 1; s++) {
    expect((await advanceDrill(db, scope, id, s, START, hooks)).ok).toBe(true);
  }
  return (await loadDrillRow(db, NEW.id, id))!;
}

const signalsOf = (id: string) =>
  sqlite
    .prepare("SELECT person_id, color, source, transcript, occurred_at, injured FROM signals WHERE drill_id = ? ORDER BY occurred_at, id")
    .all(id) as Array<{ person_id: string; color: string; source: string; transcript: string | null; occurred_at: string; injured: number | null }>;
const incidentsOf = (id: string) =>
  (sqlite.prepare("SELECT person_id, payload FROM drill_events WHERE drill_id = ? AND kind = 'incident' ORDER BY seq").all(id) as Array<{
    person_id: string | null;
    payload: string;
  }>).map((r) => ({ person: r.person_id, ...(JSON.parse(r.payload) as { change: { kind: string; id?: string }; text: string; inject?: string }) }));

// ---------- 1 想定の表の配役 ----------

describe("想定の表の配役（T70 の 1）", () => {
  it("デモ事業所は配役なし（参加者を絞っても、事業所にいる人の行は捨てるだけ）。保存の JSON に cast の鍵が無い", async () => {
    const facts = castFactsMap(await loadPersonaSources(db, DEMO.id));
    const all = SEED_PEOPLE.map((p) => p.person.id);
    for (const s of ["heavy_rain", "earthquake", "short", "virtual"] as DrillScenario[]) {
      expect(castScenario(SCENARIOS[s], all, facts)).toEqual({});
      expect(castScenario(SCENARIOS[s], ["p-01", "p-09"], facts)).toEqual({});
    }
    expect(needsCast(SCENARIOS.heavy_rain, all)).toBe(false);
    expect(needsCast(SCENARIOS.virtual, ["p-01"])).toBe(false);
    const scope = drillScope(careManager(DEMO, "acct-yamamoto"))!;
    expect(await startDrill(db, scope, "short", START, {}, () => "demo", { participants: ["p-01", "p-09"] })).toEqual({ ok: true, id: "demo" });
    const w = JSON.parse((await loadDrillRow(db, DEMO.id, "demo"))!.world) as Record<string, unknown>;
    expect("cast" in w).toBe(false);
  });

  it("who の合い方: 機器と時計は両方を見る・ハザードの深さ・独居・押せる人なし・誰でも", async () => {
    addNewOffice();
    const f = await newFacts();
    expect(matchesPick(f.get("n-1")!, { device: "ventilator" })).toBe(true);
    expect(matchesPick(f.get("n-2")!, { clock: "dialysis" })).toBe(true);
    expect(matchesPick(f.get("n-2")!, { device: "dialysis" })).toBe(true);
    expect(matchesPick(f.get("n-1")!, { hazard: "flood", minDepthM: 3 })).toBe(true);
    expect(matchesPick(f.get("n-3")!, { hazard: "flood", minDepthM: 3 })).toBe(false);
    expect(matchesPick(f.get("n-3")!, { household: "alone" })).toBe(true);
    expect(f.get("n-4")!.canPress).toBe(false);
    expect(matchesPick(f.get("n-4")!, { smartphone: "none" })).toBe(true);
    expect(matchesPick(f.get("n-3")!, { smartphone: "none" })).toBe(false);
    expect(matchesPick(f.get("n-5")!, { any: true })).toBe(true);
  });

  it("新しい事業所の 5 人: 同じ人の行は 1 人に、合う人の少ない行から、誰でもよい行は最後", async () => {
    addNewOffice();
    const f = await newFacts();
    const cast = castScenario(SCENARIOS.heavy_rain, FIVE_IDS, f);
    const byOriginal = (orig: string) => {
      const keys = SCENARIOS.heavy_rain.ticks.flatMap((t) => [
        ...t.events.flatMap((e, i) => (e.person === orig ? [`${t.hour}:e${i}`] : [])),
        ...t.turns.flatMap((x, i) => (x.person === orig ? [`${t.hour}:t${i}`] : [])),
      ]);
      return [...new Set(keys.map((k) => cast[k] ?? null))];
    };
    expect(byOriginal("p-02")).toEqual(["n-1"]); // 呼吸器
    expect(byOriginal("p-03")).toEqual(["n-2"]); // 透析（0・12・18・48 時間が 1 人）
    expect(byOriginal("p-01")).toEqual(["n-3"]); // 独居・けが
    expect(byOriginal("p-04")).toEqual(["n-4"]); // 押せる人なし
    expect(byOriginal("p-10")).toEqual(["n-5"]); // 誰でも
    // 合う人のいない行（経管栄養・インスリン・土砂）と、合う人が配り終わった行（浸水）は捨てる
    expect(byOriginal("p-06")).toEqual([null]);
    expect(byOriginal("p-08")).toEqual([null]);
    expect(byOriginal("p-07")).toEqual([null]);
    expect(byOriginal("p-05")).toEqual([null]);
    // 参加者を絞ると、残りの人に配る（決まった順）
    const two = castScenario(SCENARIOS.heavy_rain, ["n-3", "n-5"], f);
    expect(new Set(Object.values(two))).toEqual(new Set(["n-3", "n-5"]));
  });

  it("大雨の 72 時間を hooks なしで最後まで。行が台帳の中身に当たり、差し込みの施設の id も代わりの人", async () => {
    addNewOffice();
    const row = await runAll("heavy_rain", "rain");
    expect(row.status).toBe("finished");
    const state = stateOfRow(row);
    expect(state.participants).toEqual(FIVE_IDS);
    expect(Object.keys(state.cast ?? {}).length).toBeGreaterThan(0);
    const sig = signalsOf("rain");
    const of = (p: string) => sig.filter((s) => s.person_id === p);
    // 透析の人: 家族の緑（0・18 時間）→ 48 時間に家族の赤
    expect(of("n-2").map((s) => [s.color, s.source])).toEqual([
      ["green", "family"],
      ["green", "family"],
      ["red", "family"],
    ]);
    expect(of("n-2")[2].transcript).toBe("透析に行けていない。次が決まらない");
    // 呼吸器の人: 1 時間に家族の緑（停電と電池）
    expect(of("n-1").map((s) => s.transcript)).toEqual(["停電した。呼吸器が電池に切り替わった。3 時間しかもたない"]);
    // 独居の人: 3 時間に本人の赤（けが）
    expect(of("n-3")).toMatchObject([{ color: "red", source: "agent", injured: 1 }]);
    // 押せる人なし: 6 時間に支援者の緑（見に行った）
    expect(of("n-4")).toMatchObject([{ color: "green", source: "supporter" }]);
    expect(of("n-5").map((s) => s.color)).toEqual(["green", "green"]);
    // 差し込み（透析施設 浸水で休止）は代わりの人の施設
    const inj = incidentsOf("rain").find((e) => e.inject === "dialysis_flooded")!;
    expect(inj.person).toBe("n-2");
    expect(inj.change).toMatchObject({ kind: "facility", id: "fc-n-2" });
    // 表の選び方（who）は保存しない
    expect(incidentsOf("rain").every((e) => !("who" in e))).toBe(true);
  });

  it("地震・10 分版も当たる。本人役の入力（fixed）に代わりの人の行が渡る", async () => {
    addNewOffice();
    const seen: PersonaInput[] = [];
    const persona = async (input: PersonaInput) => {
      seen.push(input);
      return fixedTurns(input);
    };
    await runAll("earthquake", "quake", { persona });
    const quake = signalsOf("quake");
    expect(quake.filter((s) => s.person_id === "n-1").map((s) => s.transcript)).toEqual(["呼吸器は予備のバッテリーに替えた。残りが心配"]);
    expect(quake.some((s) => s.person_id === "n-2")).toBe(true);
    const at1 = seen.find((x) => x.person === "n-2" && x.hour === 1)!;
    expect(at1.fixed).toHaveLength(1);
    expect(at1.fixed[0]).toMatchObject({ person: "n-2", color: "green", source: "family" });
    // 行の無い刻みの人は fixed が空（本人役が自分で決める）
    expect(seen.find((x) => x.person === "n-3" && x.hour === 3)!.fixed).toEqual([]);

    await runAll("short", "short");
    const short = signalsOf("short");
    expect(new Set(short.map((s) => s.person_id))).toEqual(new Set(FIVE_IDS));
  });

  it("再開（drills.world の写し）と再生（保存した刻み）で同じ配役", async () => {
    addNewOffice();
    const scope = scopeA();
    expect(await startDrill(db, scope, "heavy_rain", START, {}, () => "r")).toEqual({ ok: true, id: "r" });
    const first = stateOfRow((await loadDrillRow(db, NEW.id, "r"))!);
    for (let s = 0; s < 3; s++) await advanceDrill(db, scope, "r", s, START);
    const row = (await loadDrillRow(db, NEW.id, "r"))!;
    expect(stateOfRow(row).cast).toEqual(first.cast);
    const replayed = replayState(row, participantsOf(row), await loadTicks(db, "r", SCENARIOS.heavy_rain.hours, row.step), row.step).state;
    expect(replayed.cast).toEqual(first.cast);
    expect(replayed.people).toEqual(stateOfRow(row).people);
  });
});

// ---------- 3 方言の行を外す ----------

describe("本人役の指示に方言を書かない（T70 の 3）", () => {
  it("PERSONA_SYSTEM・CALL_SYSTEM・PERSONA_VIRTUAL に地域の言い方が無く、決まり 6・7 は残る", () => {
    for (const text of [PERSONA_SYSTEM, CALL_SYSTEM, PERSONA_VIRTUAL]) {
      expect(text).not.toMatch(/松山|方言|行かん|けん」|じゃ」/);
    }
    expect(PERSONA_SYSTEM).toContain("4. 本人の言葉はやさしい短い話し言葉で 1〜2 文。認知症の本人は話が噛み合わないことがある。");
    expect(PERSONA_SYSTEM).toContain("6. 名前・住所・電話番号を言わない。");
    expect(PERSONA_SYSTEM).toContain("7. 「診断」「判定」「重症」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。");
    expect(CALL_SYSTEM).toContain("名前・住所・電話番号を言わない。");
  });
});

// ---------- 2 押せる人なし・5 上限の見込みと停止の印 ----------

function fakeClaude() {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [{ type: "text", text: "{}", citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Message;
        },
      },
    },
  };
  return { client, calls };
}

const demoCm = () => careManager(DEMO, "acct-yamamoto");
const demoHooks = (limit: string, extra: Record<string, string> = {}) =>
  drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: limit, ...extra }, demoCm(), {
    claude: fakeClaude().client,
    now: () => new Date(START),
  })!;

describe("押せる人なしと見込み（T70 の 2・5）", () => {
  it("担当一覧の人に押せる人の有無と、本人役を呼びうる想定（デモの 10 人は全員押せる人がいる）", async () => {
    const demo = await caseloadForDrill(db, drillScope(demoCm())!);
    expect(demo.map((p) => p.id).sort()).toEqual(SEED_PEOPLE.map((p) => p.person.id).sort());
    expect(demo.every((p) => p.canPress)).toBe(true);
    addNewOffice();
    const five = await caseloadForDrill(db, scopeA());
    expect(five.map((p) => [p.id, p.canPress])).toEqual([
      ["n-1", true],
      ["n-2", true],
      ["n-3", true],
      ["n-4", false],
      ["n-5", true],
    ]);
    // 押せる人のいない人は、表の行が当たりうる想定だけ（仮想は表が無いので呼ばない）
    expect(five.find((p) => p.id === "n-4")!.callable).toEqual(["heavy_rain", "earthquake", "short"]);
    expect(five.find((p) => p.id === "n-1")!.callable).toEqual(["heavy_rain", "earthquake", "short", "virtual"]);
  });

  it("見込み = 刻み ×（監督 1 + 本人役）+ 講評 1 + 声（本人役 × 刻み の半分）。残りを超えたら上限不足", () => {
    const ten = SEED_PEOPLE.map((p) => ({ id: p.person.id }));
    expect(estimateDrillCalls("short", ten)).toBe(4 * 11 + 1 + 20);
    expect(estimateDrillCalls("heavy_rain", ten)).toBe(12 * 11 + 1 + 60);
    // 本人役を呼ばない人（押せる人なし・行なし）は監督の分だけ
    expect(estimateDrillCalls("virtual", [{ id: "x", callable: ["short"] }])).toBe(12 + 1);
    expect(overLimit(65, 64)).toBe(true);
    expect(overLimit(65, 65)).toBe(false);
    expect(overLimit(65, null)).toBe(false);
  });

  it("開始の設定: 押せる人なしは灰の文字と本人のページへの名前、見込みと残り、超える想定に上限不足（開始は止めない）", () => {
    const people = [
      { id: "n-1", name: "架空 一", canPress: true, callable: ["heavy_rain", "earthquake", "short", "virtual"] as DrillScenario[] },
      { id: "n-4", name: "架空 四", canPress: false, callable: ["heavy_rain", "earthquake", "short"] as DrillScenario[] },
    ];
    const html = renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people, remaining: 30 }));
    expect(html).toContain('data-no-presser-count="1"');
    expect(html).toContain("押せる人なし 1 人");
    // 10 分版: 4 ×（1 + 2）+ 1 + 4 = 17。大雨: 12 × 3 + 1 + 12 = 49 は残り 30 を超える
    expect(html).toContain('data-estimate-scenario="short" data-estimate-calls="17"');
    expect(html).toMatch(/data-estimate-scenario="heavy_rain" data-estimate-calls="49" data-over=""/);
    expect(html).toContain("上限不足");
    expect(html).toContain('data-estimate-remaining="30"');
    expect(html).not.toMatch(/data-scenario="heavy_rain"[^>]*disabled/);
    const unknown = renderToStaticMarkup(createElement(StartButtons, { scenarios: SCENARIO_ORDER, disabled: false, people, remaining: null }));
    expect(unknown).not.toContain("data-estimate-remaining");
    expect(unknown).not.toContain("上限不足");
  });
});

describe("上限に当たった刻みに停止の印（T70 の 5）", () => {
  it("上限 0 の日: 本人役・監督が落ちた刻みに「停止」の印。表の安否は届き、訓練は最後まで進む。再生でも同じ", async () => {
    const hooks = demoHooks("0");
    const scope = drillScope(demoCm())!;
    expect(await startDrill(db, scope, "heavy_rain", START, hooks, () => "lim")).toEqual({ ok: true, id: "lim" });
    for (let s = 0; s < 11; s++) expect((await advanceDrill(db, scope, "lim", s, START, hooks)).ok).toBe(true);
    const row = (await loadDrillRow(db, DEMO.id, "lim"))!;
    expect(row.status).toBe("finished");
    const ticks = await loadTicks(db, "lim", SCENARIOS.heavy_rain.hours, row.step);
    const stops = ticks.map((t) => aiStoppedOf(t));
    expect(stops[0]).toContain("persona");
    expect(stops.some((x) => x.includes("director"))).toBe(true);
    expect(stops.every((x) => !x.includes("world"))).toBe(true);
    // 表の行の安否はそのまま届く（3 時間の山田の赤）
    expect(sqlite.prepare("SELECT color FROM signals WHERE drill_id = 'lim' AND person_id = 'p-01' ORDER BY occurred_at").all()).toEqual([
      { color: "red" },
    ]);
    // 刻みの見出しに灰の文字の印、状況の行には出さない
    const html = renderToStaticMarkup(createElement(Situation, { ticks: ticks.slice(0, 1), names: {}, startedAt: START }));
    expect(html).toContain('data-ai-stopped="persona"');
    expect(html).toContain("本人役 停止");
    expect(html).not.toContain('data-incident="ai_stop"');
    // 再生（状態の作り直し）は印で世界を変えない
    const replayed = replayState(row, participantsOf(row), ticks, row.step).state;
    expect(replayed.world).toEqual(stateOfRow(row).world);
  });

  it("上限の内なら印なし（AI の形の違いは停止でない）", async () => {
    const hooks = demoHooks("2000");
    const scope = drillScope(demoCm())!;
    expect(await startDrill(db, scope, "short", START, hooks, () => "ok")).toEqual({ ok: true, id: "ok" });
    expect((await advanceDrill(db, scope, "ok", 0, START, hooks)).ok).toBe(true);
    const ticks = await loadTicks(db, "ok", SCENARIOS.short.hours, 1);
    expect(ticks.flatMap((t) => aiStoppedOf(t))).toEqual([]);
  });

  it("仮想（1 回呼び）: 上限で世界が止まった刻みに「世界 停止」", async () => {
    const hooks = demoHooks("0", { DRILL_WORLD: "messages" });
    const scope = drillScope(demoCm())!;
    expect(await startDrill(db, scope, "virtual", START, hooks, () => "v")).toEqual({ ok: true, id: "v" });
    const ticks = await loadTicks(db, "v", SCENARIOS.virtual.hours, 0);
    expect(aiStoppedOf(ticks[0])).toEqual(["persona", "world"]);
  });

  it("停止の記録は刻みごと（前の刻みの分を持ち越さない）", () => {
    const log = stopLog();
    log.hit("director");
    log.hit("persona");
    log.hit("persona");
    expect(log.take()).toEqual(["persona", "director"]);
    expect(log.take()).toEqual([]);
    expect(stopIncidents([], 3)).toEqual([]);
    expect(stopIncidents(["world"], 3)[0]).toMatchObject({ change: { kind: "ai_stop", stopped: ["world"] }, text: "世界 停止", ai: false });
  });
});

// ---------- 6 進行中をケアマネごと・24 時間で自動中断 ----------

const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.parse(START) + h * HOUR).toISOString();

function addCmB(): void {
  sqlite.exec(
    `INSERT INTO people (id, office_id, care_manager_id, name, kana, ledger) VALUES ('n-6', '${NEW.id}', '${CM_B}', '架空 六', 'カクウ ロク', '{}')`,
  );
}

describe("進行中をケアマネごと・24 時間で自動中断（T70 の 6）", () => {
  it("同じ事業所の 2 人のケアマネが同時に進行中を持てる。同じケアマネの 2 つ目は断る", async () => {
    addNewOffice();
    addCmB();
    const scopeB = drillScope(careManager(NEW, CM_B))!;
    expect(await startDrill(db, scopeA(), "short", START, {}, () => "a1")).toEqual({ ok: true, id: "a1" });
    expect(await startDrill(db, scopeB, "short", START, {}, () => "b1")).toEqual({ ok: true, id: "b1" });
    expect(await startDrill(db, scopeA(), "earthquake", START, {}, () => "a2")).toEqual({ ok: false, error: "running" });
    expect(await runningDrillId(db, NEW.id, { scope: scopeA() })).toBe("a1");
    expect(await runningDrillId(db, NEW.id, { scope: scopeB })).toBe("b1");
    const list = await listDrills(db, NEW.id);
    expect(list.map((d) => [d.id, d.status, d.started_by]).sort()).toEqual([
      ["a1", "running", CM_A],
      ["b1", "running", CM_B],
    ]);
  });

  it("審査員どうし・審査員と山本は山本の担当一覧で 1 つを共有する（今までどおり）", async () => {
    const judge = drillScope(careManager(DEMO, "acct-judge", { judge: true, caseloadOf: "acct-yamamoto" }))!;
    expect(await startDrill(db, judge, "short", START, {}, () => "j1")).toEqual({ ok: true, id: "j1" });
    expect(await startDrill(db, judge, "short", START, {}, () => "j2")).toEqual({ ok: false, error: "running" });
    expect(await startDrill(db, drillScope(demoCm())!, "short", START, {}, () => "y1")).toEqual({ ok: false, error: "running" });
  });

  it("24 時間たった進行中は、開始のときに中断（理由 24 時間・経過に 1 行）になり、新しく始められる。23 時間なら断る", async () => {
    addNewOffice();
    expect(await startDrill(db, scopeA(), "heavy_rain", START, {}, () => "old")).toEqual({ ok: true, id: "old" });
    await advanceDrill(db, scopeA(), "old", 0, START);
    expect(await startDrill(db, scopeA(), "short", at(23), {}, () => "early")).toEqual({ ok: false, error: "running" });
    expect(await startDrill(db, scopeA(), "short", at(24), {}, () => "new")).toEqual({ ok: true, id: "new" });
    const old = (await loadDrillRow(db, NEW.id, "old"))!;
    expect(old.status).toBe("abandoned");
    expect(old.finished_at).toBe(at(24));
    expect(JSON.parse(old.world).abandoned).toEqual({ reason: "24h", at: at(24) });
    // 経過に 1 行（今の刻みに、状況「自動中断 24 時間」）。再生は世界を変えない
    const ticks = await loadTicks(db, "old", SCENARIOS.heavy_rain.hours, old.step);
    const note = ticks[old.step].incidents.find((e) => e.change.kind === "auto_abandon")!;
    expect(note).toMatchObject({ text: "自動中断 24 時間", actor: "world", ai: false, at: 1 });
    expect(replayState(old, participantsOf(old), ticks, old.step).state.world).toEqual(stateOfRow(old).world);
    // 一覧の状態は「中断」のまま、行の詳細に 24 時間
    const list = await listDrills(db, NEW.id);
    expect(list.find((d) => d.id === "old")).toMatchObject({ status: "abandoned", abandon_reason: "24h" });
    expect(list.find((d) => d.id === "new")).toMatchObject({ status: "running", abandon_reason: null });
    // 2 度読んでも経過は 1 行（48 時間で new も中断）
    expect(await expireStaleDrills(db, NEW.id, at(48))).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drill_events WHERE id = ?").get(autoAbandonEventId("old"))).toEqual({ n: 1 });
  });

  it("一覧は now を渡すと先に自動中断、渡さなければ読むだけ。手で中断した訓練は理由なし", async () => {
    addNewOffice();
    addCmB();
    const scopeB = drillScope(careManager(NEW, CM_B))!;
    expect(await startDrill(db, scopeA(), "short", START, {}, () => "a")).toEqual({ ok: true, id: "a" });
    expect(await startDrill(db, scopeB, "short", START, {}, () => "b")).toEqual({ ok: true, id: "b" });
    expect(await abandonDrill(db, scopeB, "b", at(1))).toEqual({ ok: true });
    expect((await listDrills(db, NEW.id)).find((d) => d.id === "a")!.status).toBe("running");
    expect(await runningDrillId(db, NEW.id, { scope: scopeA(), now: at(10) })).toBe("a");
    const list = await listDrills(db, NEW.id, 50, at(30));
    expect(list.find((d) => d.id === "a")).toMatchObject({ status: "abandoned", abandon_reason: "24h" });
    expect(list.find((d) => d.id === "b")).toMatchObject({ status: "abandoned", abandon_reason: null });
    const res = await listGet(db, careManager(NEW, CM_A), at(30));
    const body = (await res.json()) as { drills: Array<{ id: string; abandonReason?: string }> };
    expect(body.drills.find((d) => d.id === "a")!.abandonReason).toBe("24h");
    expect(body.drills.find((d) => d.id === "b")!.abandonReason).toBeUndefined();
  });
});

// ---------- 4 仮想モードの街を台帳から ----------

/** 偽の Claude: 1 回呼び（Opus）は決まった世界の 1 刻み、本人役（Haiku）は形の違い（連絡なし） */
function fakeWorld(step: WorldStep) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const text = params.model === OPUS ? JSON.stringify(step) : "{}";
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [{ type: "text", text, citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Message;
        },
      },
    },
  };
  return { client, calls };
}

const NEW_TOWNS = ["あおば町", "しらさぎ町", "もみじ台"];

async function newCast() {
  return buildCast(FIVE_IDS, await loadPersonaSources(db, NEW.id), await loadOutcomeSources(db, NEW.id), "2026-11-05", NEW.id);
}

describe("仮想モードの街を台帳から（T70 の 4）", () => {
  it("デモ事業所は架空の 8 町のまま（地理の文も同じ）", () => {
    expect(areaOf(DEMO.id, [])).toBe(DEMO_AREA);
    expect(DEMO_AREA.towns).toBe(AREA_TOWNS);
    expect(geographyText(DEMO_AREA)).toBe(geographyText());
    expect(geographyText()).toContain("地区（8）。白波川が街を東から海へ流れる:");
  });

  it("新しい事業所: 台帳の町名ごとに別名・地形・送電、町名なしの町、架空の高台に避難所と頼る人のいる施設", async () => {
    addNewOffice();
    const cast = await newCast();
    const a = cast.area;
    expect(a.towns.map((t) => [t.town, t.alias, t.terrain, t.grid])).toEqual([
      ["あおば町", "甲地区", "浸水 3 m の想定の低い土地", "A 系統"],
      ["しらさぎ町", "乙地区", "浸水 0.5 m の想定の低い土地", "A 系統"],
      ["もみじ台", "丙地区", "想定なし", "A 系統"],
      ["町名なし", "丁地区", "想定なし", "B 系統"],
      ["高台", "戊地区", "高台の住宅地", "B 系統"],
    ]);
    expect(a.roads.map((r) => [r.name, r.towns])).toEqual([
      ["甲地区の道", ["あおば町"]],
      ["乙地区の道", ["しらさぎ町"]],
      ["丙地区の道", ["もみじ台"]],
      ["丁地区の道", ["町名なし"]],
      ["高台への坂道", ["高台"]],
    ]);
    expect(a.shelters.map((s) => [s.name, s.town, s.welfare])).toEqual([
      ["高台の避難所", "高台", false],
      ["福祉避難所", "高台", true],
    ]);
    // 透析先に頼る人（n-2）がいるので透析施設だけ。冷蔵・配達・訪問看護は頼る人がいないので置かない
    expect(a.facilities.map((f) => [f.name, f.depends])).toEqual([["透析施設", "dialysis_center"]]);
    // 本人の町（コードだけが持つ）
    expect(cast.facts.get("n-1")!.town).toBe("あおば町");
    expect(cast.facts.get("n-5")!.town).toBe("町名なし");
  });

  it("部屋への文（地理・本人たち・刻み）に町名・氏名が出ない（別名だけ）", async () => {
    addNewOffice();
    const cast = await newCast();
    const geo = geographyText(cast.area);
    for (const t of NEW_TOWNS) expect(geo).not.toContain(t);
    expect(geo).toContain("甲地区: 浸水 3 m の想定の低い土地。洪水 3 m の想定。送電 A 系統");
    const input: WorldInput = {
      scenario: "virtual",
      step: 0,
      hour: 0,
      world: EMPTY_WORLD,
      incidents: [],
      participants: FIVE_IDS,
      people: {},
      actions: [],
      hints: { reached: [], clocks: [] },
      session: null,
      minute: 0,
    };
    const opening = pseudonymizeText(openingText(input, cast, 72), cast.key).text;
    expect(findLeaks(opening, cast.key)).toEqual([]);
    for (const t of NEW_TOWNS) expect(opening).not.toContain(t);
    for (const p of FIVE) expect(opening).not.toContain(`架空 ${p.kana}`);
  });

  it("別名の出来事を台帳の町の人に当てる。画面の文は町名に戻す", async () => {
    addNewOffice();
    const cast = await newCast();
    const ctx = { key: cast.key, facts: cast.facts, ended: new Set<string>(), hour: 6, via: "oneshot" as const, area: cast.area };
    const out = worldIncidents(
      {
        narration: "甲地区で川があふれた",
        events: [
          { kind: "flood", town: "甲地区", target: "", name: "", value: "" },
          { kind: "road", town: "", target: "", name: "乙地区の道", value: "closed" },
          { kind: "facility", town: "", target: "", name: "透析施設", value: "closed" },
          { kind: "flood", town: "庚地区", target: "", name: "", value: "1" },
        ],
        farewells: [],
      },
      ctx,
    );
    expect(out[0]).toMatchObject({ change: { kind: "narration", room: "甲地区で川があふれた" }, text: "あおば町で川があふれた" });
    expect(out[1].change).toEqual({ kind: "town_flood", town: "あおば町", depthM: 3, persons: ["n-1"] });
    expect(out[2]).toMatchObject({ change: { kind: "town_road", label: "乙地区の道", open: false, persons: ["n-2", "n-3"] }, text: "しらさぎ町の道 通行止" });
    expect(out[3].change).toMatchObject({ kind: "town_facility", label: "透析施設", open: false, persons: ["n-2"] });
    // 地理に無い別名は捨てる
    expect(out).toHaveLength(4);
    // 今の街の文（部屋へ）は別名の道のまま
    const w = out.reduce((x, e) => applyEvent(x, e, 6), EMPTY_WORLD);
    expect(worldNow(w, cast.area)).toContain("乙地区の道 通行止");
  });

  it("新しい事業所の仮想の訓練: 世界（1 回呼び）に別名の地理が届き、出来事が台帳の町の人に当たる。hooks なしでも最後まで", async () => {
    addNewOffice();
    const { client, calls } = fakeWorld({
      narration: "甲地区で川が増水している",
      events: [{ kind: "flood", town: "甲地区", target: "", name: "", value: "2" }],
      farewells: [],
    });
    const hooks = drillHooks({ DB: db, ANTHROPIC_API_KEY: "dummy", DRILL_WORLD: "messages" }, careManager(NEW, CM_A), {
      claude: client,
      now: () => new Date(START),
    })!;
    expect(await startDrill(db, scopeA(), "virtual", START, hooks, () => "vn")).toEqual({ ok: true, id: "vn" });
    const world = calls.find((c) => c.model === OPUS)!;
    const sent = JSON.stringify(world.messages);
    expect(sent).toContain("甲地区");
    for (const t of NEW_TOWNS) expect(sent).not.toContain(t);
    const state = stateOfRow((await loadDrillRow(db, NEW.id, "vn"))!);
    expect(state.world.marks["n-1"]?.flooded).toBe(0);
    expect(state.world.floods?.["n-1"]).toBe(2);
    // hooks なし（鍵なし）でも 12 刻みを最後まで
    expect(await abandonDrill(db, scopeA(), "vn", START)).toEqual({ ok: true });
    const row = await runAll("virtual", "vq");
    expect(row.status).toBe("finished");
  });
});
