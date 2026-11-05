// 訓練の骨組み（docs/tasks/T17.md）のテスト: 想定の表の形（12 刻み・10 分版・2 本）、刻みの進み、
// D1（node:sqlite に種の 10 人）での保存と再開・再生、訓練の安否が本番の読み方に混ざらないこと、役と事業所の壁。
// 色は lib/triage の色の名前（red・yellow・gray・green）で比べ、画面の言葉を書かない（言葉は別の作業で変わる）。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { loadClassView } from "../classify/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode, saveDisasterInfo } from "../disaster/db.ts";
import { personDisaster } from "../disaster/person.ts";
import { disasterScope } from "../disaster/scope.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { loadPersonPage } from "../person.ts";
import {
  abandonDrill,
  advanceDrill,
  drillScope,
  listDrills,
  loadDrillRow,
  loadTicks,
  participantsOf,
  replayState,
  runningDrillId,
  startDrill,
  stateOfRow,
} from "./db.ts";
import { DrillEnded, drillSituation, initialState, outageTownsOf, simAt, step, type DirectorEvent, type DrillState } from "./engine.ts";
import { abandonPost, listGet, replayGet, startPost, stepPost } from "./http.ts";
import { elapsedLabel, progressLabel, WATER_LABELS } from "./labels.ts";
import { DRILL_HOURS, SCENARIOS, SHORT_HOURS, applyEvents, EMPTY_WORLD, type InjectKind, type Scenario } from "./scenarios.ts";
import { bandsOf, loadDrillScreen } from "./view.ts";

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
/** 審査員のケアマネの役（山本の担当一覧、書き手は審査員） */
const judge = (): Principal => careManager({ judge: true, admin: false, accountId: "acct-judge", displayName: "山本" });
const other = (role: Principal["role"]): Principal => careManager({ role, caseloadOf: null, accountId: null });

/** 訓練を始める時刻（2026-11-05 10:00 JST）。想定の h 時間は T(h) */
const START = "2026-11-05T01:00:00.000Z";
const T = (h: number) => simAt(START, h);
const SCOPE = drillScope(careManager())!;
const IDS = SEED_PEOPLE.map((p) => p.person.id);

// ---------- 想定の表の形 ----------

function allTurns(s: Scenario) {
  return s.ticks.flatMap((t) => t.turns);
}
function allEvents(s: Scenario) {
  return s.ticks.flatMap((t) => t.events);
}

describe("想定の表", () => {
  it("大雨と地震は 12 刻み（0・1・3・6・9・12・18・24・36・48・60・72 時間）、10 分版は 4 刻み", () => {
    expect(DRILL_HOURS).toEqual([0, 1, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72]);
    for (const id of ["heavy_rain", "earthquake"] as const) {
      const s = SCENARIOS[id];
      expect(s.hours).toEqual(DRILL_HOURS);
      expect(s.ticks.map((t) => t.hour)).toEqual([...DRILL_HOURS]);
      expect(s.kind).toBe(id);
    }
    const short = SCENARIOS.short;
    expect(short.hours).toEqual(SHORT_HOURS);
    expect(short.ticks).toHaveLength(4);
    expect(short.ticks.map((t) => t.hour)).toEqual([...SHORT_HOURS]);
    expect(SHORT_HOURS.every((h) => (DRILL_HOURS as readonly number[]).includes(h))).toBe(true);
    expect(short.kind).toBe("heavy_rain");
  });

  it("10 分版は大雨の出来事と安否を全部持ち、元の時刻のまま次の刻みに寄せる", () => {
    const rain = SCENARIOS.heavy_rain;
    const short = SCENARIOS.short;
    expect(allEvents(short).map((e) => e.text)).toEqual(allEvents(rain).map((e) => e.text));
    expect(allTurns(short).map((t) => t.person)).toEqual(allTurns(rain).map((t) => t.person));
    for (const tick of short.ticks) {
      for (const x of [...tick.events, ...tick.turns]) {
        expect(x.at).toBeLessThanOrEqual(tick.hour);
      }
    }
    // 最後の世界は同じ
    const fold = (s: Scenario) => s.ticks.reduce((w, t) => applyEvents(w, t.events, t.hour), EMPTY_WORLD);
    expect(fold(short)).toEqual(fold(rain));
  });

  it("本人は種の id で指し、表の文に氏名・町名・電話・連絡先の名前・避難先の名前を書かない", () => {
    const words = new Set<string>();
    for (const p of SEED_PEOPLE) {
      for (const part of p.person.name.split(" ")) words.add(part);
      if (p.ledger.basic.address?.town) words.add(p.ledger.basic.address.town);
      if (p.ledger.evacuation.destination1) words.add(p.ledger.evacuation.destination1);
      for (const c of p.contacts) if (c.name) for (const part of c.name.split(" ")) words.add(part);
    }
    for (const s of Object.values(SCENARIOS)) {
      for (const t of allTurns(s)) expect(IDS).toContain(t.person);
      for (const e of allEvents(s)) if (e.person) expect(IDS).toContain(e.person);
      const texts = [
        ...allEvents(s).map((e) => e.text),
        ...allTurns(s).flatMap((t) => [t.saying ?? "", t.doing ?? ""]),
        ...allEvents(s).flatMap((e) => ("label" in e.change ? [e.change.label] : [])),
      ];
      for (const text of texts) {
        for (const w of words) expect(text, `${s.id}: ${text}`).not.toContain(w);
        expect(text).not.toMatch(/\d{2,4}-\d{2,4}-\d{2,4}/);
      }
    }
  });

  it("経過の言い方: 上の大きな字は「経過 6 時間」、訓練記録の一覧は「経過 6 / 72 時間」", () => {
    expect(elapsedLabel(6)).toBe("経過 6 時間");
    expect(progressLabel(6, 72)).toBe("経過 6 / 72 時間");
  });

  it("大雨: 警戒レベル 3 → 4 → 浸水 3 m の地区、1 山田・2 小林・3 田中の透析先・5 伊藤の道路", () => {
    const s = SCENARIOS.heavy_rain;
    const levels = allEvents(s).flatMap((e) => (e.change.kind === "alert" ? [e.change.level] : []));
    expect(levels.slice(0, 2)).toEqual([3, 4]);
    expect(allEvents(s).some((e) => e.change.kind === "outage" && e.change.area.scope === "hazard" && e.change.area.minDepthM === 3)).toBe(true);
    expect(allTurns(s).some((t) => t.person === "p-01" && t.color === "red")).toBe(true);
    expect(allEvents(s).some((e) => e.change.kind === "facility" && e.person === "p-03")).toBe(true);
    expect(allEvents(s).some((e) => e.change.kind === "road" && e.person === "p-05")).toBe(true);
  });

  it("地震: 震度 6強・沿岸の津波・停電 2 日（全域）、8 井上が主役", () => {
    const s = SCENARIOS.earthquake;
    const world = s.ticks.reduce((w, t) => applyEvents(w, t.events, t.hour), EMPTY_WORLD);
    expect(world.quake).toBe("6強");
    expect(allEvents(s).some((e) => e.change.kind === "tsunami" && e.change.state === "evacuate")).toBe(true);
    expect(world.outage).toEqual({ area: { scope: "office" }, since: 0, restoredAt: 48 });
    // 断水は なし → 断水中（18 時間）→ 解消（72 時間）
    const waterAt = (h: number) =>
      s.ticks.filter((t) => t.hour <= h).reduce((w, t) => applyEvents(w, t.events, t.hour), EMPTY_WORLD).water;
    expect([waterAt(12), waterAt(18), waterAt(60), waterAt(72)]).toEqual(["none", "out", "out", "restored"]);
    expect([WATER_LABELS.none, WATER_LABELS.out, WATER_LABELS.restored]).toEqual(["なし", "断水中", "解消"]);
    expect(allTurns(s).filter((t) => t.person === "p-08").length).toBeGreaterThanOrEqual(3);
  });
});

// ---------- 刻みの進み（D1 を使わない） ----------

describe("刻みの進み", () => {
  it("始める前から 1 刻みずつ、最後の刻みで終了。終わった訓練は進めない", async () => {
    let s: DrillState = initialState("heavy_rain", IDS, START);
    const hours: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await step(s);
      s = r.state;
      hours.push(s.hour);
      expect(s.step).toBe(i);
      expect(r.tick.finished).toBe(i === 11);
      expect(s.status).toBe(i === 11 ? "finished" : "running");
    }
    expect(hours).toEqual([...DRILL_HOURS]);
    await expect(step(s)).rejects.toBeInstanceOf(DrillEnded);
  });

  it("世界の状態: 大雨は 1 時間で警戒レベル 4 と浸水 3 m の地区の停電。停電の地区の町名は台帳から引く", async () => {
    let s = initialState("heavy_rain", IDS, START);
    s = (await step(s)).state;
    s = (await step(s)).state;
    expect(s.world.alertLevel).toBe(4);
    expect(s.world.outage).toMatchObject({ since: 1, restoredAt: null });
    const ledgers = SEED_PEOPLE.map((p) => p.ledger);
    const sit = drillSituation(s, ledgers);
    expect(sit).toMatchObject({ now: T(1), disasterAt: START, outageAt: T(1) });
    // 浸水 3 m の人（1 山田・2 小林）の町だけ
    const deep = SEED_PEOPLE.filter((p) => p.ledger.evacuation.hazards.some((h) => h.kind === "flood" && (h.depthM ?? 0) >= 3));
    expect(deep.map((p) => p.person.id)).toEqual(["p-01", "p-02"]);
    expect(sit.outageTowns).toEqual([...new Set(deep.map((p) => p.ledger.basic.address!.town))]);
    expect(outageTownsOf({ scope: "office" }, ledgers)).toBeNull();
  });

  it("本人の 1 刻みは表の固定の安否（出ない本人の物は外す）", async () => {
    const { tick } = await step(initialState("heavy_rain", ["p-03", "p-10"], START));
    expect(tick.turns.map((t) => [t.person, t.color, t.source, t.whereNow, t.ai])).toEqual([
      ["p-03", "green", "family", "home", false],
      ["p-10", "green", "family", "home", false],
    ]);
  });

  it("T18・T19 の呼び口: ペルソナがあれば表の代わりに使い、投げたら連絡なし。監督の差し込みは表の種類だけ 2 つまで世界に当てる", async () => {
    const seen: string[] = [];
    const r = await step(initialState("heavy_rain", ["p-01", "p-02"], START), {
      persona: async (x) => {
        seen.push(`${x.person}:${x.fixed.length}:${x.world.alertLevel}:${x.world.roads.length}`);
        if (x.person === "p-02") throw new Error("失敗");
        return [{ ...x.fixed[0], person: x.person, color: "red", source: "agent", whereNow: null, injured: null, atHome: null, canMove: false, hasMedicine: null, saying: "うごけない", doing: null, ai: true, at: x.hour }];
      },
      director: async (): Promise<DirectorEvent[]> => [
        // 表の外の種類（断水を起こす）は捨てる
        { inject: "water_out" as unknown as InjectKind, person: "p-01", text: "断水", ai: true },
        { inject: "road_blocked", person: "p-01", text: "家の前の道 冠水", reason: "支援者の道", ai: true },
        // 参加者でない本人は捨てる
        { inject: "line_down", person: "p-09", text: "家の電話 不通", ai: true },
        { inject: "nurse_away", person: "p-02", text: "訪問看護 来られない", ai: true },
        // 3 つ目は当てない
        { inject: "line_down", person: "p-02", text: "家の電話 不通", ai: true },
      ],
    });
    // 本人役は監督の差し込みのあとの世界を読む
    expect(seen).toEqual(["p-01:0:3:1", "p-02:0:3:1"]);
    expect(r.tick.turns.map((t) => [t.person, t.color, t.ai])).toEqual([["p-01", "red", true]]);
    const director = r.tick.incidents.filter((e) => e.actor === "director");
    expect(director.map((e) => [e.inject, e.person, e.change.kind, e.ai])).toEqual([
      ["road_blocked", "p-01", "road", true],
      ["nurse_away", "p-02", "nurse_away", true],
    ]);
    expect(r.state.world.roads.map((x) => [x.id, x.open, x.person])).toEqual([["rd-p-01", false, "p-01"]]);
    expect(r.state.world.marks["p-02"]).toEqual({ nurseAway: 0 });
    expect(r.state.world.water).toBe("none");
    expect(r.state.world.phone).toBe("ok");
  });

  it("帯: 停電・断水・電話の不通は始まりから終わり（続いていれば終わりなし）", async () => {
    let s = initialState("earthquake", IDS, START);
    const ticks = [];
    for (let i = 0; i < 12; i++) {
      const r = await step(s);
      s = r.state;
      ticks.push(r.tick);
    }
    expect(bandsOf(ticks.slice(0, 7))).toEqual([
      { kind: "outage", from: 0, to: null },
      { kind: "phone", from: 0, to: null },
      { kind: "water", from: 18, to: null },
    ]);
    expect(bandsOf(ticks)).toEqual([
      { kind: "outage", from: 0, to: 48 },
      { kind: "phone", from: 0, to: 72 },
      { kind: "water", from: 18, to: 72 },
    ]);
  });
});

// ---------- D1 ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
let seq = 0;
const ids = () => `drill-${++seq}`;

async function start(scenario: "heavy_rain" | "earthquake" | "short" = "heavy_rain"): Promise<string> {
  const r = await startDrill(db, SCOPE, scenario, START, {}, ids);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

async function colorsAt(id: string, want: number | null = null) {
  const s = await loadDrillScreen(db, SCOPE, id, want);
  return Object.fromEntries(s!.rows.map((r) => [r.id, r.triage!.color]));
}

describe("保存と再開", () => {
  it("開始で 0 時間の刻みまで保存（安否は drill_id 付き、本人の経過には書かない）", async () => {
    const timeline = count("SELECT count(*) AS n FROM timeline_entries");
    const id = await start();
    const row = await loadDrillRow(db, "office-demo", id);
    expect(row).toMatchObject({ scenario: "heavy_rain", status: "running", step: 0, sim_hour: 0, started_by: "acct-yamamoto", started_by_name: "山本" });
    expect(participantsOf(row!)).toEqual(
      [...SEED_PEOPLE].sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1)).map((p) => p.person.id),
    );
    expect(count(`SELECT count(*) AS n FROM signals WHERE drill_id = '${id}'`)).toBe(3);
    expect(count("SELECT count(*) AS n FROM signals WHERE drill_id IS NULL")).toBe(0);
    expect(count(`SELECT count(*) AS n FROM drill_events WHERE drill_id = '${id}' AND kind = 'incident'`)).toBe(2);
    expect(count(`SELECT count(*) AS n FROM drill_events WHERE drill_id = '${id}' AND kind = 'persona_turn'`)).toBe(3);
    expect(count("SELECT count(*) AS n FROM timeline_entries")).toBe(timeline);
    // 安否の時刻は訓練の時計
    expect(sqlite.prepare(`SELECT occurred_at AS t, transcript FROM signals WHERE drill_id = '${id}' AND person_id = 'p-03'`).get()).toEqual({
      t: T(0),
      transcript: "2 階にいます",
    });
  });

  it("大雨: 進めると左の表の色が変わる（山田は 3 時間で最上位の赤、小林は電池で 3 時間に黄・6 時間に赤）", async () => {
    const id = await start();
    let c = await colorsAt(id);
    expect([c["p-01"], c["p-02"], c["p-03"], c["p-06"], c["p-10"]]).toEqual(["gray", "gray", "yellow", "green", "green"]);

    expect(await advanceDrill(db, SCOPE, id, 0, T(0))).toEqual({ ok: true, step: 1, hour: 1, status: "running" });
    expect(await advanceDrill(db, SCOPE, id, 1, T(0))).toEqual({ ok: true, step: 2, hour: 3, status: "running" });
    const s = await loadDrillScreen(db, SCOPE, id, null);
    const top = [...s!.rows].sort((a, b) => a.rank! - b.rank!)[0];
    expect(top).toMatchObject({ id: "p-01", rank: 1, triage: { color: "red", group: 0 } });
    c = await colorsAt(id);
    expect(c["p-02"]).toBe("yellow");
    expect(s!.rows.find((r) => r.id === "p-02")!.triage!.reason).toContain("人工呼吸器 内蔵電池 残り 1 時間");

    await advanceDrill(db, SCOPE, id, 2, T(0));
    c = await colorsAt(id);
    expect(c["p-02"]).toBe("red");
    expect(c["p-04"]).toBe("green");
  });

  it("途中から再開: 保存した今の状態と、刻みから作り直した状態が同じ。読んだ刻みが古ければ競合", async () => {
    const id = await start("earthquake");
    for (let i = 0; i < 5; i++) await advanceDrill(db, SCOPE, id, i, T(0));
    const row = (await loadDrillRow(db, "office-demo", id))!;
    expect(row.step).toBe(5);
    const stored = stateOfRow(row);
    const replayed = replayState(row, participantsOf(row), await loadTicks(db, id, SCENARIOS.earthquake.hours, row.step), row.step).state;
    expect(replayed).toEqual(stored);
    // 古い刻み（二度押し・早送りの重なり）
    expect(await advanceDrill(db, SCOPE, id, 4, T(0))).toEqual({ ok: false, error: "conflict" });
    expect((await loadDrillRow(db, "office-demo", id))!.step).toBe(5);
    // 続きから進められる
    expect(await advanceDrill(db, SCOPE, id, 5, T(0))).toMatchObject({ ok: true, step: 6, hour: 18 });
  });

  it("同じ刻みを 2 回書こうとしても取引ごと戻り、安否は重ならない", async () => {
    const id = await start();
    // 刻みを 0 に戻して同じ 1 刻みを書かせる（先に書いた要求があった形）
    await advanceDrill(db, SCOPE, id, 0, T(0));
    const before = count(`SELECT count(*) AS n FROM signals WHERE drill_id = '${id}'`);
    sqlite.exec(`UPDATE drills SET step = 0, sim_hour = 0 WHERE id = '${id}'`);
    const dup = await advanceDrill(db, SCOPE, id, 0, T(0));
    expect(dup).toEqual({ ok: false, error: "conflict" });
    expect(count(`SELECT count(*) AS n FROM signals WHERE drill_id = '${id}'`)).toBe(before);
    expect((await loadDrillRow(db, "office-demo", id))!.step).toBe(0);
  });

  it("最後まで進めると終了。10 分版は 4 刻みで終わる。終わった訓練は進めない", async () => {
    const id = await start("short");
    for (let i = 0; i < 3; i++) await advanceDrill(db, SCOPE, id, i, T(0));
    const row = (await loadDrillRow(db, "office-demo", id))!;
    expect(row).toMatchObject({ status: "finished", step: 3, sim_hour: 72 });
    expect(row.finished_at).not.toBeNull();
    expect(await advanceDrill(db, SCOPE, id, 3, T(0))).toEqual({ ok: false, error: "ended" });
    // 終われば次を始められる
    expect((await startDrill(db, SCOPE, "heavy_rain", T(1), {}, ids)).ok).toBe(true);
  });

  it("事業所に進行中があれば開始を断る。中断すると記録は残り、進めない", async () => {
    const id = await start();
    expect(await startDrill(db, SCOPE, "earthquake", START, {}, ids)).toEqual({ ok: false, error: "running" });
    expect(await runningDrillId(db, "office-demo")).toBe(id);
    expect(await abandonDrill(db, SCOPE, id, T(0))).toEqual({ ok: true });
    expect(await abandonDrill(db, SCOPE, id, T(0))).toEqual({ ok: false, error: "ended" });
    expect(await advanceDrill(db, SCOPE, id, 0, T(0))).toEqual({ ok: false, error: "ended" });
    expect(await runningDrillId(db, "office-demo")).toBeNull();
    expect((await listDrills(db, "office-demo")).map((d) => [d.id, d.status])).toEqual([[id, "abandoned"]]);
    expect(await colorsAt(id, 0)).toMatchObject({ "p-03": "yellow" });
  });
});

describe("再生", () => {
  it("終わった訓練を刻みごとに見ると、進めていたときと同じ色と順", async () => {
    const id = await start();
    const live: Array<Array<[string, string, number | null]>> = [];
    const snap = async () => {
      const s = await loadDrillScreen(db, SCOPE, id, null);
      live.push(s!.rows.map((r) => [r.id, r.triage!.color, r.rank]));
    };
    await snap();
    for (let i = 0; i < 11; i++) {
      await advanceDrill(db, SCOPE, id, i, T(0));
      await snap();
    }
    for (let k = 0; k < 12; k++) {
      const s = await loadDrillScreen(db, SCOPE, id, k);
      expect(s!.shown).toBe(k);
      expect(s!.state.hour).toBe(DRILL_HOURS[k]);
      expect(s!.rows.map((r) => [r.id, r.triage!.color, r.rank])).toEqual(live[k]);
      // 先の状況は出さない
      expect(s!.ticks.map((t) => t.step)).toEqual(Array.from({ length: k + 1 }, (_, i) => i));
    }
    // 72 時間: 田中は家族の赤、高橋は栄養剤、伊藤はステロイドで黄
    const end = await colorsAt(id, 11);
    expect([end["p-03"], end["p-06"], end["p-05"]]).toEqual(["red", "yellow", "yellow"]);
    // 今より先の刻みは今に丸める
    expect((await loadDrillScreen(db, SCOPE, id, 99))!.shown).toBe(11);
  });
});

describe("訓練の安否は本番の読み方に混ざらない", () => {
  it("事業所が本番の災害モードでも、担当一覧・本人のページ・様式 9・分類は訓練の安否を読まない", async () => {
    const dscope = disasterScope(careManager())!;
    expect(await switchDisasterMode(db, dscope, { kind: "heavy_rain", version: 0, at: T(-2) })).toMatchObject({ ok: true });
    await saveDisasterInfo(db, dscope, {
      version: 1,
      at: T(-1),
      info: { startedAt: T(-2), outage: { scope: "office", towns: [], startedAt: T(-1) }, alertLevel: 4, water: null, road: null },
    });
    // 訓練の時刻を全部過ぎた所で読む（drill_id で外していなければ混ざる）
    const now = T(80);
    const read = async () => {
      const list = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, "2026-11-08", now);
      const page = await loadPersonPage(db, careManager(), "p-03");
      const person = await personDisaster(db, page!, now);
      const form9 = await loadForm9(db, { officeId: "office-demo" }, { today: "2026-11-08", situation: person.situation });
      return {
        list: list!.rows.map((r) => [r.id, r.triage?.color, r.triage?.reason, r.lastContact]),
        person: [person.triage?.color, person.triage?.reason],
        timeline: page!.timeline.length,
        form9: JSON.stringify(form9),
      };
    };
    const before = await read();
    const id = await start();
    for (let i = 0; i < 11; i++) await advanceDrill(db, SCOPE, id, i, T(0));
    expect(count(`SELECT count(*) AS n FROM signals WHERE drill_id = '${id}'`)).toBeGreaterThan(10);
    expect(await read()).toEqual(before);
    const drillSignal = (sqlite.prepare(`SELECT id FROM signals WHERE drill_id = '${id}' LIMIT 1`).get() as { id: string }).id;
    expect(await loadClassView(db, "office-demo", drillSignal)).toBeNull();
    // 事業所の災害モードは訓練で変わらない
    expect(sqlite.prepare("SELECT kind, version FROM disaster_state WHERE office_id = 'office-demo'").get()).toEqual({ kind: "heavy_rain", version: 2 });
  });
});

describe("役と事業所の壁（API）", () => {
  const post = (body: unknown) => body;
  const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

  it("ケアマネの役（審査員のケアマネの役も）だけ。ログインなし 401、ほかの役 403", async () => {
    expect((await startPost(db, null, post({ scenario: "heavy_rain" }), START)).status).toBe(401);
    for (const role of ["medical", "government", "self", "family", "unselected"] as const) {
      expect((await startPost(db, other(role), post({ scenario: "heavy_rain" }), START)).status).toBe(403);
      expect((await listGet(db, other(role))).status).toBe(403);
    }
    // 10 分版は T124 で外した（開始は 400。前からある記録は読める: lib/drill/t124.test.ts）
    expect((await startPost(db, judge(), post({ scenario: "short" }), START)).status).toBe(400);
    const started = await read(await startPost(db, judge(), post({ scenario: "heavy_rain" }), START));
    expect(started.status).toBe(200);
    const id = started.body.id as string;
    // 書き手は審査員
    expect((await loadDrillRow(db, "office-demo", id))!.started_by).toBe("acct-judge");
    expect((await stepPost(db, other("medical"), id, { step: 0 }, START)).status).toBe(403);
    expect((await stepPost(db, null, id, { step: 0 }, START)).status).toBe(401);
    expect((await read(await stepPost(db, careManager(), id, { step: 0 }, START))).body).toEqual({ ok: true, step: 1, hour: 1, status: "running" });
    expect((await stepPost(db, careManager(), id, { step: 0 }, START)).status).toBe(409);
    expect((await stepPost(db, careManager(), id, { step: "1" }, START)).status).toBe(400);
    expect((await startPost(db, careManager(), { scenario: "fire" }, START)).status).toBe(400);
    expect((await startPost(db, careManager(), { scenario: "earthquake" }, START)).status).toBe(409);
    const list = await read(await listGet(db, careManager()));
    expect(list.body.drills).toMatchObject([{ id, scenario: "heavy_rain", status: "running", step: 1, hour: 1, last: 72 }]);
    const replay = await read(await replayGet(db, careManager(), id, "0"));
    expect(replay.body).toMatchObject({ ok: true, shown: 0, hour: 0 });
    expect((await replayGet(db, careManager(), id, "x")).status).toBe(400);
    expect((await abandonPost(db, careManager(), id, START)).status).toBe(200);
    expect((await abandonPost(db, careManager(), id, START)).status).toBe(409);
  });

  it("ほかの事業所の訓練は見えず、進めも中断もできない（404）", async () => {
    const id = await start();
    const partner = careManager({ office: PARTNER, accountId: "acct-partner-cm", caseloadOf: "acct-partner-cm" });
    expect((await stepPost(db, partner, id, { step: 0 }, START)).status).toBe(404);
    expect((await abandonPost(db, partner, id, START)).status).toBe(404);
    expect((await replayGet(db, partner, id, null)).status).toBe(404);
    expect((await read(await listGet(db, partner))).body.drills).toEqual([]);
    expect(await loadDrillScreen(db, drillScope(partner)!, id, null)).toBeNull();
    // 協力事業所は担当がいないので始められない
    expect((await startPost(db, partner, { scenario: "heavy_rain" }, START)).status).toBe(404);
    // デモ事業所の訓練はそのまま
    expect((await loadDrillRow(db, "office-demo", id))!.status).toBe("running");
  });
});
