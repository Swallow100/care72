// 訓練を本物の事業所で（docs/tasks/T70.md）のテスト。本物の API は呼ばない（偽の hooks）。
// - 想定の表の配役: デモ事業所は前と同じ（配役なし）、新しい事業所の 5 人に行が当たる、本人役の入力に行が渡る、再開・再生でも同じ

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillScenario, Ledger } from "../db/types.ts";
import { castScenario, matchesPick, needsCast, type CastFacts } from "./cast.ts";
import { castFactsMap } from "./cast-facts.ts";
import { advanceDrill, drillScope, loadDrillRow, loadTicks, participantsOf, replayState, startDrill, stateOfRow } from "./db.ts";
import type { PersonaInput } from "./engine.ts";
import { CALL_SYSTEM, fixedTurns, loadPersonaSources, PERSONA_SYSTEM, PERSONA_VIRTUAL } from "./persona.ts";
import { SCENARIOS } from "./scenarios.ts";

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
