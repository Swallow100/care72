// T92 出来事の表 v2 のテスト（docs/tasks/T92.md）。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 表の行ごとに当てはまる人・当てはまらない人・世界の変化・固定の文・根拠、監督の返事の捨て方（全体・何時間後・差し込める数・同じ人・生き死に）、
// 予定と到着、時計の頼り先（drillClocks → lib/triage は触らない）、仮想の街の新しい種類、画面の印と被害状況の行、本人役への言葉。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DamagePanel } from "../../components/drill/DamagePanel.tsx";
import { Situation } from "../../components/drill/Situation.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { aliasFor, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { isSourceId } from "../sources/index.ts";
import { NO_BASIS } from "../sources/prompt.ts";
import { triage, type TriageClock } from "../triage/index.ts";
import {
  basisOf,
  budgetOf,
  createDirectorHook,
  DIRECTOR_SOURCES,
  DIRECTOR_SYSTEM,
  directorEvents,
  drillClocks,
  eligibleKinds,
  weaknessText,
  type DirectorAnswer,
} from "./director.ts";
import { initialState, step, type DirectorEvent, type DirectorInput, type PersonState, type Tick } from "./engine.ts";
import {
  aftershockIntensity,
  EVENT_CATALOG,
  EVENT_LABELS,
  eligibleAreaKinds,
  extraWorldWords,
  incidentLabel,
  incidentTouches,
  INJECT_KINDS,
  INJECT_TEXTS,
  injectChange,
  markLabels,
  NURSE_STATION_ID,
  WELFARE_SHELTER_ID,
  type EventSource,
  type InjectKind,
} from "./event-catalog.ts";
import { directorIncidents, DIRECTOR_MAX } from "./incident-types.ts";
import { MARK_LABELS } from "./labels.ts";
import { buildPersona, tickText } from "./persona.ts";
import { fireScheduled } from "./schedule.ts";
import { applyEvent, applyEvents, EMPTY_WORLD, SCENARIOS, settleWorld, type WorldEvent, type WorldState } from "./scenarios.ts";
import { worldIncidents, type ApplyContext, type PersonFacts, type WorldStep } from "./world-apply.ts";
import { WORLD_STEP_JSON_SCHEMA, WORLD_SYSTEM } from "./world-oneshot.ts";
import { WORLD_AGENT_VERSION } from "./world-room.ts";

// ---------- 種の 10 人 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const SEED = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)]));
const input = (id: string) => SEED.get(id)!;
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const aliasOf = (id: string) => aliasFor(PARTICIPANTS.indexOf(id));
const W: WorldState = { ...EMPTY_WORLD, staff: 3 };
const at = (where: PersonState["whereNow"]): PersonState => ({ color: "green", source: "family", whereNow: where, at: 3, saying: null, doing: null });
const NEW_KINDS = INJECT_KINDS.slice(6);
const ok = (kind: InjectKind, id: string, world: WorldState = W, state: PersonState | null = null) =>
  EVENT_CATALOG[kind].eligible(input(id), id, world, state);
const apply = (world: WorldState, kind: InjectKind, person: string | null, hour: number, after: number | null = null): WorldState => {
  const parts = EVENT_CATALOG[kind].build({ person }, hour, after);
  return applyEvents(
    world,
    parts.map((p): WorldEvent => ({ change: p.change, text: p.text, ...(p.person ? { person: p.person } : {}), at: hour })),
    hour,
  );
};
const BANNED = /診断|判定|重症|緊急度|札|死亡|亡くな/;

// ---------- 表の形 ----------

describe("出来事の表の形", () => {
  it("前からの 6 つは同じ並び・同じ文・同じ変化。T92 の 20 を足して 26（T104 の自分の 4 つを足して 30）", () => {
    expect(INJECT_KINDS.slice(0, 6)).toEqual(["supply_left", "dialysis_flooded", "road_blocked", "line_down", "nurse_away", "going_home"]);
    expect(INJECT_KINDS).toHaveLength(30);
    expect(new Set(INJECT_KINDS).size).toBe(30);
    expect(INJECT_KINDS.slice(26)).toEqual(["self_outage", "self_family", "self_late", "self_battery"]);
    expect(INJECT_TEXTS).toMatchObject({
      supply_left: "家族が栄養剤を持ち出し忘れた",
      dialysis_flooded: "透析施設 浸水で休止",
      road_blocked: "家の前の道 通行止め",
      line_down: "家の電話 通話不可",
      nurse_away: "訪問看護 来られない",
      going_home: "本人が家に帰ろうとする",
    });
    expect(injectChange("supply_left", "p-06")).toEqual({ kind: "supply_left" });
    expect(injectChange("dialysis_flooded", "p-03")).toEqual({ kind: "facility", id: "fc-p-03", label: "透析施設", open: false, depends: "dialysis_center" });
    expect(injectChange("road_blocked", "p-05")).toEqual({ kind: "road", id: "rd-p-05", label: "家の前の道", open: false });
    expect(injectChange("line_down", "p-01")).toEqual({ kind: "line_down" });
    expect(injectChange("nurse_away", "p-02")).toEqual({ kind: "nurse_away" });
    expect(injectChange("going_home", "p-06")).toEqual({ kind: "going_home" });
  });

  it("想定の表の固定の差し込み（大雨 6 時間・12 時間）は前と同じ変化", () => {
    const fixed = SCENARIOS.heavy_rain.ticks.flatMap((t) => t.events.filter((e) => e.by === "director"));
    expect(fixed.map((e) => [e.inject, e.person, e.change, e.text])).toEqual([
      ["supply_left", "p-06", { kind: "supply_left" }, "家族が栄養剤を持ち出し忘れた"],
      ["dialysis_flooded", "p-03", { kind: "facility", id: "fc-p-03", label: "透析施設", open: false, depends: "dialysis_center" }, "透析施設 浸水で休止"],
    ]);
  });

  it("行ごとに印・指示の中身・固定の文があり、使わない語が無い。印は 2〜5 字", () => {
    for (const k of INJECT_KINDS) {
      const r = EVENT_CATALOG[k];
      expect(r.kind).toBe(k);
      const n = Array.from(r.label).length;
      expect(n, k).toBeGreaterThanOrEqual(2);
      expect(n, k).toBeLessThanOrEqual(5);
      expect(r.words.length, k).toBeGreaterThan(0);
      for (const t of [r.label, r.words, INJECT_TEXTS[k]]) expect(t, k).not.toMatch(BANNED);
      expect(Array.from(INJECT_TEXTS[k]).length, k).toBeLessThanOrEqual(30);
    }
    for (const v of Object.values(markLabels)) expect(v).not.toMatch(BANNED);
    // 被害状況の「個別」の印は表から（前の 6 つと T92 の 5 つ）
    expect(MARK_LABELS).toBe(markLabels);
    expect(Object.keys(MARK_LABELS)).toHaveLength(11);
  });

  it("根拠は登録簿の id だけ。監督が選ぶ種類は DIRECTOR_SOURCES の中だけで、DIRECTOR_SOURCES は前からの 5 つと T104 の時間の目安の 5 つ", () => {
    expect([...DIRECTOR_SOURCES]).toEqual([
      "cao-shishin-2021",
      "mhlw-bcp-2020",
      "nanbyo-shishin-2017",
      "jadp-dialysis-2023",
      "mhlw-dementia-2018",
      "soumu-iburi-2019",
      "soumu-tsushin-2026",
      "mhlw-water-2016",
      "cao-hinanjo-2016",
      "cao-fukushi-2021",
    ]);
    for (const k of INJECT_KINDS) {
      const b = EVENT_CATALOG[k].basis;
      for (const id of b.ids) expect(isSourceId(id), `${k} ${id}`).toBe(true);
      if (b.by === "director") for (const id of b.ids) expect(DIRECTOR_SOURCES as readonly string[], k).toContain(id);
    }
    // 健康の助言の要旨を持つ文書は監督の指示に入れない（コードが付けるだけ）
    for (const id of ["jadec-insulin-2023", "jrs-respiratory-2012", "jsth-pe-2020", "mhlw-ecs-2018"]) expect(DIRECTOR_SYSTEM).not.toContain(id);
    // 表の根拠の列
    expect(EVENT_CATALOG.welfare_shelter_open.basis.ids).toEqual(["cao-shishin-2021"]);
    expect(EVENT_CATALOG.no_fridge.basis.ids).toEqual(["jadec-insulin-2023"]);
    expect(EVENT_CATALOG.car_sleep.basis.ids).toEqual(["mhlw-ecs-2018", "jsth-pe-2020"]);
    expect(EVENT_CATALOG.wandering.basis.ids).toEqual(["mhlw-dementia-2018"]);
    for (const k of ["road_reopen", "family_stranded", "info_confusion", "aftershock", "landslide_warn"] as const) {
      expect(EVENT_CATALOG[k].basis.ids, k).toEqual([]);
    }
    // T104: 停電の広がり・携帯・給水所は時間の目安の文書を監督が選べる（コードは付けない）
    expect(EVENT_CATALOG.outage_spread.basis).toEqual({ by: "director", ids: ["soumu-iburi-2019"] });
    expect(EVENT_CATALOG.mobile_down.basis).toEqual({ by: "director", ids: ["soumu-iburi-2019", "soumu-tsushin-2026"] });
    expect(EVENT_CATALOG.water_station.basis).toEqual({ by: "director", ids: ["mhlw-water-2016"] });
  });

  it("根拠の付け方: コードの種類は監督の値を見ない、本人で変わる物は台帳から、表に無い根拠は捨てる", () => {
    expect(basisOf("welfare_shelter_open", "mhlw-bcp-2020")).toBe("cao-shishin-2021");
    expect(basisOf("no_fridge", NO_BASIS, input("p-08"))).toBe("jadec-insulin-2023");
    expect(basisOf("car_sleep", NO_BASIS, input("p-06"))).toBe("mhlw-ecs-2018");
    expect(basisOf("hospital_closed", NO_BASIS, input("p-03"))).toBe("jadp-dialysis-2023");
    expect(basisOf("vendor_round", NO_BASIS, input("p-01"))).toBe("jrs-respiratory-2012");
    expect(basisOf("vendor_round", NO_BASIS, input("p-02"))).toBe("nanbyo-shishin-2017");
    // 冷やす薬の無い人の薬局の休止は根拠なし
    expect(basisOf("pharmacy_closed", NO_BASIS, input("p-05"))).toBeNull();
    expect(basisOf("pharmacy_closed", NO_BASIS, input("p-08"))).toBe("jadec-insulin-2023");
    // 監督が選ぶ種類: 表の一覧と DIRECTOR_SOURCES の両方にある物だけ
    expect(basisOf("outage_eta", "mhlw-bcp-2020")).toBe("mhlw-bcp-2020");
    expect(basisOf("outage_eta", "cao-shishin-2021")).toBeNull();
    expect(basisOf("outage_eta", NO_BASIS)).toBeNull();
    // 根拠の無い種類は監督の値を捨てる
    expect(basisOf("aftershock", "mhlw-bcp-2020")).toBeNull();
    // 前からの 6 つは今までどおり DIRECTOR_SOURCES の 5 つから
    expect(basisOf("supply_left", "nanbyo-shishin-2017")).toBe("nanbyo-shishin-2017");
    expect(basisOf("dialysis_flooded", "jcs-disaster-2014")).toBeNull();
  });
});

// ---------- 表の行ごと（当てはまる人・当てはまらない人・世界の変化） ----------

describe("表の行（種の 10 人）", () => {
  it("outage_eta: 停電中だけ。復旧を N 時間後に予定し、時刻が来たら停電 復旧", () => {
    expect(ok("outage_eta", "p-01")).toBe(false);
    const w = applyEvent(W, { change: { kind: "outage", area: { scope: "hazard", hazard: "flood", minDepthM: 3 } }, text: "" }, 1);
    expect(ok("outage_eta", "p-01", w)).toBe(true);
    const parts = EVENT_CATALOG.outage_eta.build({ person: null }, 6, 4);
    expect(parts).toEqual([
      {
        change: { kind: "schedule", at: 600, by: "director", then: { kind: "event", change: { kind: "outage_restored" }, text: "停電 復旧" } },
        text: "停電 復旧見込 4 時間後",
      },
    ]);
    const planned = applyEvent(w, { change: parts[0].change, text: parts[0].text, basis: "mhlw-bcp-2020" }, 6);
    expect(planned.scheduled).toEqual([{ at: 600, change: { kind: "outage_restored" }, text: "停電 復旧", basis: "mhlw-bcp-2020", by: "director" }]);
    // 予定が積まれたら同じ見込みは差し込めない
    expect(ok("outage_eta", "p-01", planned)).toBe(false);
    // 予定の時刻の前は起きない。時刻が来たら状況になり、当てると停電 復旧
    expect(fireScheduled(planned, 599).incidents).toEqual([]);
    const fired = fireScheduled(planned, 600);
    expect(fired.incidents).toEqual([
      { change: { kind: "outage_restored" }, text: "停電 復旧", basis: "mhlw-bcp-2020", actor: "director", at: 10, ai: false },
    ]);
    expect(fired.world.scheduled).toEqual([]);
    const restored = fired.incidents.reduce((x, e) => applyEvent(x, e, e.at), fired.world);
    expect(restored.outage?.restoredAt).toBe(10);
  });

  it("outage_spread: 地区の停電を全域に。停電の始まりは最初の時刻のまま（ルールの表の停電の始まりがずれない）", () => {
    const w = applyEvent(W, { change: { kind: "outage", area: { scope: "hazard", hazard: "flood", minDepthM: 3 } }, text: "" }, 1);
    expect(ok("outage_spread", "p-01", w)).toBe(true);
    const spread = apply(w, "outage_spread", null, 9);
    expect(spread.outage).toEqual({ area: { scope: "office" }, since: 1, restoredAt: null });
    expect(ok("outage_spread", "p-01", spread)).toBe(false);
    // 停電の無い世界・全域の停電には当たらない
    expect(ok("outage_spread", "p-01")).toBe(false);
    // 復旧したあとの新しい停電は今までどおり今の時刻から
    const again = applyEvent(applyEvent(spread, { change: { kind: "outage_restored" }, text: "" }, 20), { change: { kind: "outage", area: { scope: "office" } }, text: "" }, 30);
    expect(again.outage).toEqual({ area: { scope: "office" }, since: 30, restoredAt: null });
  });

  it("mobile_down: 電話が通じている間だけ。不通と、N 時間後に一部回復の予定の 2 行", () => {
    expect(ok("mobile_down", "p-01")).toBe(true);
    expect(ok("mobile_down", "p-01", { ...W, phone: "down" })).toBe(false);
    const parts = EVENT_CATALOG.mobile_down.build({ person: null }, 12, 2);
    expect(parts.map((p) => p.text)).toEqual(["携帯電話も通話不可", "電話 一部回復見込 2 時間後"]);
    const w = apply(W, "mobile_down", null, 12, 2);
    expect(w.phone).toBe("down");
    expect(w.scheduled).toEqual([{ at: 840, change: { kind: "phone", state: "busy" }, text: "電話 一部回復", by: "director" }]);
  });

  it("road_reopen: 家の前の道が通行止めの人だけ。通れるように", () => {
    expect(ok("road_reopen", "p-05")).toBe(false);
    const blocked = applyEvent(W, { change: injectChange("road_blocked", "p-05"), text: "", person: "p-05" }, 3);
    expect(ok("road_reopen", "p-05", blocked)).toBe(true);
    expect(ok("road_reopen", "p-01", blocked)).toBe(false);
    const open = apply(blocked, "road_reopen", "p-05", 9);
    expect(open.roads).toEqual([{ id: "rd-p-05", label: "家の前の道", open: true, person: "p-05" }]);
    expect(ok("road_reopen", "p-05", open)).toBe(false);
  });

  it("welfare_shelter_open・shelter_full: 福祉避難所はまだ無いときだけ開く。満員は開いている避難所（混雑を先に）", () => {
    expect(ok("welfare_shelter_open", "p-01")).toBe(true);
    const w = apply(W, "welfare_shelter_open", null, 24);
    expect(w.shelters).toEqual([{ id: WELFARE_SHELTER_ID, label: "福祉避難所", state: "open", person: null }]);
    expect(ok("welfare_shelter_open", "p-01", w)).toBe(false);
    expect(ok("shelter_full", "p-01")).toBe(false);
    const two = applyEvents(
      W,
      [
        { change: { kind: "shelter", id: "sh-1", label: "指定避難所", state: "crowded" }, text: "" },
        { change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "open" }, text: "" },
      ],
      6,
    );
    expect(EVENT_CATALOG.shelter_full.place!(two)).toEqual({ id: "sh-1", label: "指定避難所" });
    const full = EVENT_CATALOG.shelter_full.build({ person: null, place: { id: "sh-1", label: "指定避難所" } }, 9, null);
    expect(full).toEqual([{ change: { kind: "shelter", id: "sh-1", label: "指定避難所", state: "full" }, text: "指定避難所 満員" }]);
    // 場所が無ければ組まない
    expect(EVENT_CATALOG.shelter_full.build({ person: null }, 9, null)).toEqual([]);
  });

  it("water_station・info_confusion: 世界の様子を変えない（note）。同じ話題は 2 度当たらない。断水の印は消さない", () => {
    expect(ok("water_station", "p-01")).toBe(false);
    const out = applyEvent(W, { change: { kind: "water", out: true }, text: "" }, 18);
    expect(ok("water_station", "p-01", out)).toBe(true);
    const w = apply(out, "water_station", null, 20);
    expect(w.water).toBe("out");
    expect(w.notes).toEqual({ water_station: 20 });
    expect(ok("water_station", "p-01", w)).toBe(false);
    expect(ok("info_confusion", "p-01", w)).toBe(true);
    const w2 = apply(w, "info_confusion", null, 21);
    expect(ok("info_confusion", "p-01", w2)).toBe(false);
    // note の当て方は世界の様子を変えない（話題の時刻だけ）
    const { notes: _n, ...rest } = w2;
    const { notes: _m, ...base } = out;
    expect(rest).toEqual(base);
  });

  it("pharmacy_closed: 薬のある人だけ。かかりつけ薬局の休止で、配達に頼る時計が未確認（左の表が黄。lib/triage は触らない）", () => {
    expect(ok("pharmacy_closed", "p-05")).toBe(true);
    expect(ok("pharmacy_closed", "p-08")).toBe(true);
    expect(ok("pharmacy_closed", "p-10")).toBe(false);
    expect(ok("pharmacy_closed", "p-06")).toBe(false);
    const w = apply(W, "pharmacy_closed", "p-05", 12);
    expect(w.facilities).toEqual([{ id: "fc-ph-p-05", label: "かかりつけ薬局", open: false, person: "p-05", depends: "delivery" }]);
    expect(ok("pharmacy_closed", "p-05", w)).toBe(false);
    // 透析施設の差し込みは薬局の休止で止まらない（透析の頼り先の休止だけを見る）
    const p03 = apply(W, "pharmacy_closed", "p-03", 12);
    expect(eligibleKinds(input("p-03"), "p-03", p03, null)).toContain("dialysis_flooded");
    // 配達に頼る時計（合成）: 未確認になり、ルールの表の「外の物に頼る時計の確認が未確認」で黄
    const clock = { person_id: "p-05", category: "steroid" as const, depends_on: "delivery" as const, depends_check: "confirmed" as const };
    const [after] = drillClocks([clock], w);
    expect(after.depends_check).toBe("unconfirmed");
    const triageClock: TriageClock = { kind: "medication", category: "steroid", label: "ステロイド", value: 14, unit: "day", starts_on: "disaster" };
    const person = (dc: "confirmed" | "unconfirmed") => ({
      id: "p-05",
      clocks: [{ ...triageClock, depends_on: "delivery" as const, depends_check: dc }],
      livesAlone: false,
      bedridden: false,
      hasSupporter: true,
      dementia: false,
      selfReportUnreliable: false,
    });
    const s = { now: "2026-11-05T13:00:00.000Z", disasterAt: "2026-11-05T01:00:00.000Z", outageAt: null };
    const green = { color: "green" as const, source: "agent" as const, at: "2026-11-05T02:00:00.000Z" };
    expect(triage({ person: person("confirmed"), signals: [green] }, s).color).toBe("green");
    expect(triage({ person: person(after.depends_check), signals: [green] }, s).color).toBe("yellow");
  });

  it("helper_closed: 介護事業所の連絡先のある人だけ（種の 10 人にはいない）。介護休止の印", () => {
    for (const id of PARTICIPANTS) expect(ok("helper_closed", id)).toBe(false);
    const src: EventSource = { ...input("p-09"), contacts: [...input("p-09").contacts, { ...input("p-09").contacts[0], kind: "care_service" }] };
    expect(EVENT_CATALOG.helper_closed.eligible(src, "p-09", W, null)).toBe(true);
    const w = apply(W, "helper_closed", "p-09", 6);
    expect(w.marks["p-09"]).toEqual({ helperAway: 6 });
    expect(EVENT_CATALOG.helper_closed.eligible(src, "p-09", w, null)).toBe(false);
  });

  it("nurse_station_closed: 全体の 1 つで、訪問看護を使う人の全員に「訪問不可」", () => {
    const area = eligibleAreaKinds(PARTICIPANTS.map((p) => ({ person: p, source: input(p), state: null })), W);
    expect(area.get("nurse_station_closed")).toEqual(["p-02"]);
    const parts = EVENT_CATALOG.nurse_station_closed.build({ person: null, persons: ["p-02"] }, 6, null);
    expect(parts).toEqual([
      { change: { kind: "facility", id: NURSE_STATION_ID, label: "訪問看護ステーション", open: false }, text: "訪問看護ステーション 休止" },
      { change: { kind: "nurse_away" }, text: "訪問看護 来られない", person: "p-02" },
    ]);
  });

  it("hospital_closed: 病院・透析施設の連絡先のある人だけ。透析の人は透析先が未確認", () => {
    expect(ok("hospital_closed", "p-03")).toBe(true);
    expect(ok("hospital_closed", "p-01")).toBe(false);
    expect(EVENT_CATALOG.hospital_closed.factsFor!(input("p-03"))).toEqual({ dialysis: true });
    const parts = EVENT_CATALOG.hospital_closed.build({ person: "p-03", facts: { dialysis: true } }, 12, null);
    const w = applyEvent(W, { change: parts[0].change, text: parts[0].text, person: "p-03" }, 12);
    expect(w.facilities).toEqual([{ id: "fc-hp-p-03", label: "透析の病院", open: false, person: "p-03", depends: "dialysis_center" }]);
    const clock = { person_id: "p-03", category: "dialysis" as const, depends_on: "dialysis_center" as const, depends_check: "confirmed" as const };
    expect(drillClocks([clock], w)[0].depends_check).toBe("unconfirmed");
    // 透析の人でなければ頼り先なし
    expect(EVENT_CATALOG.hospital_closed.build({ person: "p-09" }, 12, null)[0].change).toEqual({
      kind: "facility",
      id: "fc-hp-p-09",
      label: "かかりつけ病院",
      open: false,
    });
  });

  it("vendor_round: 酸素・呼吸器の人だけ。業者が N 時間後に着き、着いたら届いた物に酸素", () => {
    expect(ok("vendor_round", "p-01")).toBe(true);
    expect(ok("vendor_round", "p-02")).toBe(true);
    expect(ok("vendor_round", "p-05")).toBe(false);
    const w = apply(W, "vendor_round", "p-01", 12, 3);
    expect(w.arrivals).toEqual([{ person: "p-01", role: "vendor", arrive: 900, back: null, arrived: false, from: "director" }]);
    expect(ok("vendor_round", "p-01", w)).toBe(false);
    expect(settleWorld(w, 899).supplies).toBeUndefined();
    const got = settleWorld(w, 900);
    expect(got.supplies).toEqual({ "p-01": { oxygen: 900 } });
    expect(got.arrivals?.[0].arrived).toBe(true);
    expect(EVENT_CATALOG.vendor_round.text(3)).toBe("酸素業者 巡回予定 3 時間後");
  });

  it("family_stranded・car_sleep・neighbor_help・wandering: 印を付ける。当てはまる人だけ", () => {
    expect(ok("family_stranded", "p-01")).toBe(true);
    expect(ok("family_stranded", "p-10")).toBe(false);
    expect(ok("car_sleep", "p-06", W, at("shelter"))).toBe(true);
    expect(ok("car_sleep", "p-06", W, at("home"))).toBe(false);
    expect(ok("car_sleep", "p-06")).toBe(false);
    expect(ok("neighbor_help", "p-05")).toBe(true);
    expect(ok("neighbor_help", "p-01")).toBe(false);
    expect(ok("wandering", "p-04")).toBe(true);
    expect(ok("wandering", "p-04", W, at("shelter"))).toBe(false);
    expect(ok("wandering", "p-01")).toBe(false);
    let w = apply(W, "family_stranded", "p-01", 6);
    w = apply(w, "car_sleep", "p-06", 9);
    w = apply(w, "neighbor_help", "p-05", 9);
    w = apply(w, "wandering", "p-04", 12);
    expect(w.marks).toEqual({ "p-01": { familyAway: 6 }, "p-06": { carSleep: 9 }, "p-05": { neighborWatch: 9 }, "p-04": { wandering: 12 } });
    expect(ok("family_stranded", "p-01", w)).toBe(false);
    expect(ok("wandering", "p-04", w)).toBe(false);
    // 印は時計の頼り先を変えない（色の道は確認の写しだけ）
    const clock = { person_id: "p-01", category: "oxygen" as const, depends_on: null, depends_check: null };
    expect(drillClocks([clock], w)).toEqual([clock]);
  });

  it("no_fridge: 冷やす薬のある人で避難所にいる人だけ。冷蔵・保管の確認が未確認（どちらも表の入力の外なので色は変わらない）", () => {
    expect(ok("no_fridge", "p-08", W, at("shelter"))).toBe(true);
    expect(ok("no_fridge", "p-08", W, at("home"))).toBe(false);
    expect(ok("no_fridge", "p-01", W, at("shelter"))).toBe(false);
    const w = apply(W, "no_fridge", "p-08", 24);
    expect(w.checks).toEqual({ "p-08": { refrigeration: "unconfirmed", storage: "unconfirmed" } });
    expect(ok("no_fridge", "p-08", w, at("shelter"))).toBe(false);
    const clocks = [
      { person_id: "p-08", category: "insulin" as const, depends_on: "refrigeration" as const, depends_check: "confirmed" as const },
      { person_id: "p-08", category: "insulin" as const, depends_on: "storage" as const, depends_check: "confirmed" as const },
    ];
    expect(drillClocks(clocks, w).map((k) => k.depends_check)).toEqual(["unconfirmed", "unconfirmed"]);
  });

  it("aftershock: 地震が起きている世界だけ。震度はコードが決める（1 日は 5弱、そのあと 4）", () => {
    expect(ok("aftershock", "p-01")).toBe(false);
    const quake = applyEvent(W, { change: { kind: "quake", intensity: "6強" }, text: "" }, 0);
    expect(ok("aftershock", "p-01", quake)).toBe(true);
    expect(aftershockIntensity(6)).toBe("5弱");
    expect(aftershockIntensity(30)).toBe("4");
    expect(EVENT_CATALOG.aftershock.build({ person: null }, 30, null)).toEqual([{ change: { kind: "quake", intensity: "4" }, text: "余震 震度 4" }]);
  });

  it("landslide_warn: 土砂のハザードの人だけ。警戒（note）と山側の道の通行止めの 2 行", () => {
    expect(ok("landslide_warn", "p-04")).toBe(true);
    expect(ok("landslide_warn", "p-07")).toBe(true);
    expect(ok("landslide_warn", "p-01")).toBe(false);
    const w = apply(W, "landslide_warn", "p-04", 9);
    expect(w.roads).toEqual([{ id: "rd-ls-p-04", label: "山側の道", open: false, person: "p-04" }]);
    expect(w.notes).toEqual({ landslide_warn: 9 });
    expect(ok("landslide_warn", "p-04", w)).toBe(false);
    // 道が通行止めになったので、家の前の道の差し込みも当たらない
    expect(eligibleKinds(input("p-04"), "p-04", w, null)).not.toContain("road_blocked");
  });

  it("本人役を呼ぶ人（T90 の touched が読む）: 本人の種類は相手、全体は種類ごと", () => {
    expect(incidentTouches({ inject: "car_sleep", person: "p-06" }, PARTICIPANTS)).toEqual(["p-06"]);
    expect(incidentTouches({ inject: "aftershock" }, PARTICIPANTS)).toEqual(PARTICIPANTS);
    expect(incidentTouches({ inject: "outage_eta" }, PARTICIPANTS)).toEqual([]);
    expect(incidentTouches({ inject: "nurse_station_closed", person: "p-02" }, PARTICIPANTS)).toEqual(["p-02"]);
    expect(incidentTouches({ inject: "nurse_station_closed" }, PARTICIPANTS)).toEqual([]);
    expect(incidentTouches({ person: "p-03" }, PARTICIPANTS)).toEqual(["p-03"]);
  });
});

// ---------- 監督の返事 → 差し込み ----------

describe("監督の返事（directorEvents・directorIncidents）", () => {
  const { key } = pseudonymize(PARTICIPANTS.map(input), { on: "2026-11-05" });
  const quake = applyEvents(
    W,
    [
      { change: { kind: "quake", intensity: "6強" }, text: "" },
      { change: { kind: "outage", area: { scope: "office" } }, text: "" },
      { change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "crowded" }, text: "" },
    ],
    0,
  );
  const people: Record<string, PersonState> = { "p-08": at("shelter") };
  const ctxFor = (world: WorldState, max?: number) => ({
    key,
    eligible: new Map(PARTICIPANTS.map((p) => [p, eligibleKinds(input(p), p, world, people[p] ?? null)])),
    area: eligibleAreaKinds(PARTICIPANTS.map((p) => ({ person: p, source: input(p), state: people[p] ?? null })), world),
    sources: SEED as ReadonlyMap<string, EventSource>,
    world,
    ...(max !== undefined ? { max } : {}),
  });
  const ev = (target: string, kind: string, extra: Partial<DirectorAnswer["events"][number]> = {}) => ({
    target,
    kind,
    text: "家族が困っている",
    reason: "支援者なし",
    basis: NO_BASIS,
    ...extra,
  });

  it("全体の種類は target「全体」で、1 区切りに 1 つ。何時間後は範囲の外を捨て、無ければ既定。文と根拠はコードが付ける物がある", () => {
    const events = directorEvents(
      {
        events: [
          ev("全体", "outage_eta", { after: 20 }), // 範囲の外
          ev("全体", "outage_eta", { after: 8, basis: "mhlw-bcp-2020", text: "停電 3 時間後に復旧" }),
          ev("全体", "aftershock"), // 全体の 2 つ目
          ev(aliasOf("p-08"), "no_fridge", { basis: "mhlw-bcp-2020" }),
        ],
      },
      ctxFor(quake, 3),
    );
    expect(events).toEqual([
      { inject: "outage_eta", text: "停電 復旧見込 8 時間後", reason: "支援者なし", basis: "mhlw-bcp-2020", ai: true, after: 8 },
      { inject: "no_fridge", person: "p-08", text: "家族が困っている", reason: "支援者なし", basis: "jadec-insulin-2023", ai: true },
    ]);
    // 何時間後を書かなければ表の既定（6 時間）
    const dflt = directorEvents({ events: [ev("全体", "outage_eta")] }, ctxFor(quake));
    expect(dflt[0]).toMatchObject({ after: 6, text: "停電 復旧見込 6 時間後" });
    // 全体に差し込めない種類（福祉避難所はもうある・停電の無い世界の見込み）は捨てる
    const noOutage = directorEvents({ events: [ev("全体", "outage_eta")] }, ctxFor(W));
    expect(noOutage).toEqual([]);
  });

  it("差し込める数（budget）で切る。無ければ 2。同じ人の 2 つ目と人の生き死にの文は捨てる", () => {
    const answer: DirectorAnswer = {
      events: [
        ev(aliasOf("p-04"), "wandering"),
        ev(aliasOf("p-04"), "landslide_warn"), // 同じ人
        ev(aliasOf("p-05"), "neighbor_help", { text: "近所の人が来たが亡くなっていた" }), // 生き死に
        ev(aliasOf("p-01"), "family_stranded"),
        ev(aliasOf("p-07"), "landslide_warn"),
      ],
    };
    expect(directorEvents(answer, ctxFor(quake)).map((e) => [e.inject, e.person])).toEqual([
      ["wandering", "p-04"],
      ["family_stranded", "p-01"],
    ]);
    expect(directorEvents(answer, ctxFor(quake, 1)).map((e) => e.inject)).toEqual(["wandering"]);
    expect(directorEvents(answer, ctxFor(quake, 3)).map((e) => e.inject)).toEqual(["wandering", "family_stranded", "landslide_warn"]);
    expect(budgetOf({})).toBe(DIRECTOR_MAX);
    expect(budgetOf({ budget: 3 })).toBe(3);
    expect(budgetOf({ budget: 9 })).toBe(3);
    expect(budgetOf({ budget: 0 })).toBe(0);
  });

  it("満員は世界の避難所をコードが選び、病院の休止は透析の人かをコードが付ける。訪問看護ステーションは印の付く人を持つ", () => {
    const events = directorEvents(
      { events: [ev("全体", "shelter_full", { text: "どこかの避難所が満員" }), ev(aliasOf("p-03"), "hospital_closed")] },
      ctxFor(quake),
    );
    expect(events).toEqual([
      { inject: "shelter_full", text: "避難所 満員", reason: "支援者なし", basis: "mhlw-bcp-2020", ai: true, place: { id: "sh-2", label: "高台の集会所" } },
      { inject: "hospital_closed", person: "p-03", text: "家族が困っている", reason: "支援者なし", basis: "jadp-dialysis-2023", ai: true, facts: { dialysis: true } },
    ]);
    const nurse = directorEvents({ events: [ev("全体", "nurse_station_closed")] }, ctxFor(W));
    expect(nurse[0]).toMatchObject({ inject: "nurse_station_closed", persons: ["p-02"] });
  });

  it("directorIncidents: 全体は person なし、2 行以上の種類は理由と根拠を最初の行にだけ。参加者でない人・範囲の外・場所の形の違いは捨てる", () => {
    const members = new Set(PARTICIPANTS.filter((p) => p !== "p-10"));
    const events: DirectorEvent[] = [
      { inject: "nurse_station_closed", text: "訪問看護ステーション 休止", reason: "訪問看護だけが頼り", basis: "mhlw-bcp-2020", ai: true, persons: ["p-02", "p-10"] },
      { inject: "mobile_down", text: "携帯も", ai: true, after: 2 }, // 全体の 2 つ目
      { inject: "vendor_round", person: "p-01", text: "x", ai: true, after: 30 }, // 範囲の外
      { inject: "landslide_warn", person: "p-07", text: "裏山に土砂の警戒", ai: true },
    ];
    const out = directorIncidents(events, members, 9);
    expect(out.map((e) => [e.change.kind, e.person ?? null, e.text, e.inject, e.reason ?? null, e.basis ?? null, e.at, e.ai])).toEqual([
      ["facility", null, "訪問看護ステーション 休止", "nurse_station_closed", "訪問看護だけが頼り", "mhlw-bcp-2020", 9, true],
      ["nurse_away", "p-02", "訪問看護 来られない", "nurse_station_closed", null, null, 9, true],
      ["note", "p-07", "裏山に土砂の警戒", "landslide_warn", null, null, 9, true],
      ["road", "p-07", "山側の道 土砂警戒で通行止め", "landslide_warn", null, null, 9, true],
    ]);
    // 差し込める数は差し込みの数で数える（行の数でない）。省略は 2
    expect(new Set(out.map((e) => e.inject)).size).toBe(2);
    // 場所の形の違う満員は捨て、合う物は組む
    expect(directorIncidents([{ inject: "shelter_full", text: "x", ai: true, place: { id: "rd-1", label: "道" } }], members, 9)).toEqual([]);
    expect(directorIncidents([{ inject: "shelter_full", text: "x", ai: true, place: { id: "sh-2", label: "高台の集会所" } }], members, 9)[0]).toMatchObject({
      change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "full" },
      text: "高台の集会所 満員",
    });
    // 予定の種類の文はコードの文（何時間後と食い違わない）
    expect(directorIncidents([{ inject: "outage_eta", text: "すぐ復旧", ai: true, after: 3 }], members, 9)[0].text).toBe("停電 復旧見込 3 時間後");
    // 4 つ目の引数で差し込める数を広げる（T90 の budget）
    const three: DirectorEvent[] = ["p-01", "p-04", "p-05"].map((p) => ({ inject: "line_down", person: p, text: "家の電話 不通", ai: true }));
    expect(directorIncidents(three, members, 9)).toHaveLength(2);
    expect(directorIncidents(three, members, 9, 3)).toHaveLength(3);
  });

  it("指示の文: 種類の一覧は表から（全体・本人、何時間後の範囲）、全体の target は「全体」、決まり 3 はそのまま", () => {
    for (const k of INJECT_KINDS) expect(DIRECTOR_SYSTEM).toContain(`- ${k}（`);
    expect(DIRECTOR_SYSTEM).toContain("- outage_eta（全体）");
    expect(DIRECTOR_SYSTEM).toContain("after 2〜12 時間");
    expect(DIRECTOR_SYSTEM).toContain("- car_sleep（本人）");
    expect(DIRECTOR_SYSTEM).toContain("「全体」");
    expect(DIRECTOR_SYSTEM).toContain(`この ${INJECT_KINDS.length} だけ`);
    expect(DIRECTOR_SYSTEM).toContain("人の生き死にを決める状況（亡くなる・意識がない・火事）を作らない");
    expect(DIRECTOR_SYSTEM).toContain("「差し込める数」まで");
  });
});

// ---------- 監督を通しで（偽の Opus） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}
function fake(answer: (p: Params) => Message) {
  const calls: Params[] = [];
  const client: ClaudeClient = { beta: { messages: { create: async (params) => (calls.push(params), answer(params)) } } };
  return { client, calls };
}
const START = "2026-11-05T01:00:00.000Z";
const aiCtx = (claude: ClaudeClient): AskJsonContext => ({
  env: { ANTHROPIC_API_KEY: "dummy" },
  usage: d1UsageStore(db),
  office: { id: "office-demo", kind: "demo" },
  now: () => new Date(START),
  claude,
});
const seedLoad = async () => SEED as ReadonlyMap<string, PseudonymInput>;

describe("監督を通しで（偽の Opus・地震想定）", () => {
  it("全体と予定の出来事が状況になり、世界に予定が積まれる。弱点に全体の種類と差し込める数", async () => {
    const { client, calls } = fake(() =>
      reply({
        events: [
          { target: "全体", kind: "outage_eta", text: "復旧の見込み", reason: "停電が続く", basis: "mhlw-bcp-2020", after: 5 },
          // T130: 業者の巡回は手か計画（台帳の業者の連絡先）がある人だけ。p-02 は医療機器業者の連絡先がある（p-01 には無いので差し込めない）
          { target: aliasOf("p-02"), kind: "vendor_round", text: "業者", reason: "電池の残り", basis: NO_BASIS, after: 2 },
          { target: aliasOf("p-04"), kind: "wandering", text: "本人が外へ", reason: "認知症", basis: NO_BASIS },
        ],
      }),
    );
    const hook = createDirectorHook({ load: seedLoad, ai: aiCtx(client), on: "2026-11-05" });
    let s = initialState("earthquake", PARTICIPANTS, START);
    const ticks: Tick[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await step(s, { director: hook });
      s = r.state;
      ticks.push(r.tick);
    }
    // 0 時間の刻み（全域の停電の直後）: 差し込める数 2（engine は今の 3 引数）で、全体 1 つ・本人 1 つ。3 つ目は次の刻みへ。
    // T123: この道（step）も変わり方の決まりで見る。地震想定の表はこのあと停電を復旧するので、監督の復旧の見込みは使われない（表が先）
    const ai = (i: number) => ticks[i].incidents.filter((e) => e.ai);
    expect(ai(0).map((e) => [e.inject, e.person ?? null, e.change.kind, e.text])).toEqual([["vendor_round", "p-02", "schedule", "医療機器業者 巡回予定 2 時間後"]]);
    expect(ai(0)[0].basis).toBe("nanbyo-shishin-2017");
    // 1 時間の刻み: 業者は向かっているので当たらない。外へ出た本人も、表の 9 時間の行が「家にいる」と決めるので当たらない（T123 の表が先）
    expect(ai(1)).toEqual([]);
    expect(s.world.scheduled ?? []).toEqual([]);
    expect(s.world.arrivals).toEqual([{ person: "p-02", role: "vendor", arrive: 120, back: null, arrived: false, from: "director", supply: "power" }]);
    expect(s.world.marks["p-04"]).toBeUndefined();
    // 送った物: 差し込める数・全体に差し込める種類（停電中なので見込みが入る）
    const sent = (i: number) => JSON.parse(calls[i].messages[0].content as string) as Record<string, { text: string }>;
    expect(sent(0)["想定"].text).toContain("差し込める数: 2");
    expect(sent(0)["弱点"].text).toMatch(/全体に差し込める種類: .*outage_eta/);
    expect(sent(0)["弱点"].text).toContain("aftershock");
    // T130: 業者の連絡先も手も無い p-01 には業者の巡回を見せない。連絡先のある p-02 には見せる
    const kindsOf = (text: string, id: string) => text.split(`- ${aliasOf(id)}:`)[1]?.split("差し込める種類: ")[1]?.split("\n")[0] ?? "";
    expect(kindsOf(sent(0)["弱点"].text, "p-01")).not.toContain("vendor_round");
    expect(kindsOf(sent(0)["弱点"].text, "p-02")).toContain("vendor_round");
    // 2 回目: 積んだ予定と向かっている人が出て、見込みはもう差し込める種類に無い
    expect(sent(1)["弱点"].text).toContain(`${aliasOf("p-02")}:`);
    expect(sent(1)["弱点"].text).toContain("向かっている人: 業者（2 時間ごろ）");
    expect(weaknessText([], s.world, 3, [])).toContain("全体に差し込める種類: なし");
  });
});

// ---------- 仮想の街の新しい種類 ----------

describe("仮想の街（world_step の新しい種類）", () => {
  function ctxOf(ids: string[]): ApplyContext {
    const { key } = pseudonymize(ids.map(input), { on: "2026-11-05" });
    const facts = new Map<string, PersonFacts>(
      ids.map((id) => {
        const p = input(id);
        return [
          id,
          {
            town: p.ledger.basic.address?.town ?? null,
            depends: SEED_PEOPLE.find((x) => x.person.id === id)!.clocks.flatMap((k) => (k.depends_on ? [k.depends_on] : [])),
            categories: p.clocks.map((k) => k.category),
            nurse: p.contacts.some((c) => c.kind === "visiting_nurse"),
            helper: id === "p-09",
          },
        ];
      }),
    );
    return { key, facts, ended: new Set(), hour: 6, via: "room" };
  }
  const ALL = SEED_PEOPLE.map((p) => p.person.id);
  const step1 = (events: WorldStep["events"]): WorldStep => ({ narration: "", events, farewells: [] });
  const e = (kind: string, over: Partial<WorldStep["events"][number]> = {}) => ({ kind, town: "", target: "", name: "", value: "", ...over });

  it("地理の名前だけで当たり、知らない名前・当てはまらない人・範囲の外は捨てる", () => {
    const ctx = ctxOf(ALL);
    const key = ctx.key;
    const alias = (id: string) => key.people.find((p) => p.personId === id)!.alias;
    const out = worldIncidents(
      step1([
        e("welfare_shelter", { name: "知らない避難所" }),
        e("welfare_shelter", { name: "高台の小学校" }), // 福祉避難所でない
        e("welfare_shelter"),
        e("vendor", { target: alias("p-05"), value: "3" }), // 酸素・呼吸器でない
      ]),
      ctx,
    );
    expect(out.map((x) => [x.change, x.text])).toEqual([
      [{ kind: "shelter", id: "sh-welfare-home", label: "福祉避難所（特養）", state: "open" }, "福祉避難所（特養） 開設"],
    ]);
    const more = worldIncidents(
      step1([
        e("vendor", { target: alias("p-01"), value: "20" }), // 範囲の外
        e("vendor", { target: alias("p-01"), value: "3" }),
        e("給水所", { town: "甲地区" }),
        e("pharmacy", { value: "closed" }),
      ]),
      ctx,
    );
    expect(more.map((x) => [x.change.kind, x.person ?? null, x.text])).toEqual([
      ["schedule", "p-01", "酸素業者 巡回予定 3 時間後"],
      ["note", null, "かわなぎ町 給水所 開設"],
      ["town_facility", null, "薬局の配達 休止"],
    ]);
    expect(more[0].change).toEqual({ kind: "schedule", at: 540, by: "world", then: { kind: "arrival", role: "vendor" } });
    const last = worldIncidents(step1([e("helper", { value: "closed" }), e("info")]), ctx);
    expect(last.map((x) => [x.change, x.person ?? null])).toEqual([
      [{ kind: "mark", mark: "helperAway" }, "p-09"],
      [{ kind: "note", topic: "info_confusion" }, null],
    ]);
    // 再開の介護事業所は受けない
    expect(worldIncidents(step1([e("helper", { value: "open" })]), ctx)).toEqual([]);
  });

  it("指示と返事の形: 種類の一覧に新しい 6 つ、欄は増やさない。部屋の版は 6（種類を足したので上げる）", () => {
    for (const k of ["welfare_shelter", "water_station", "pharmacy", "helper", "vendor", "info"]) expect(WORLD_SYSTEM).toContain(`  - ${k}: `);
    expect(WORLD_STEP_JSON_SCHEMA.properties.events.items.required).toEqual(["kind", "town", "target", "name", "value"]);
    expect(WORLD_STEP_JSON_SCHEMA.properties.events.items.properties.kind.description).toContain("vendor");
    expect(WORLD_AGENT_VERSION).toBe(6);
  });
});

// ---------- 画面と本人役への言葉 ----------

describe("画面（状況の印・被害状況の行）と本人役への言葉", () => {
  const names = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.person.name]));

  it("状況の欄: note・mark・check・schedule は出来事の表の印。前からの種類は今までの印", () => {
    expect(incidentLabel({ change: { kind: "note", topic: "water_station" }, inject: "water_station" })).toBe(EVENT_LABELS.water_station);
    expect(incidentLabel({ change: { kind: "mark", mark: "carSleep" }, inject: "car_sleep" })).toBe("車中泊");
    expect(incidentLabel({ change: { kind: "mark", mark: "helperAway" } })).toBe("介護休止");
    expect(incidentLabel({ change: { kind: "note", topic: "info_confusion" } })).toBe("情報混乱");
    expect(incidentLabel({ change: { kind: "check", depends: ["storage"], status: "unconfirmed" }, inject: "no_fridge" })).toBe("冷蔵不可");
    expect(incidentLabel({ change: { kind: "road", id: "rd-1", label: "x", open: false }, inject: "road_blocked" })).toBeNull();
    const tick: Tick = {
      step: 3,
      hour: 6,
      incidents: [
        { change: { kind: "mark", mark: "carSleep" }, text: "車中泊", person: "p-06", inject: "car_sleep", basis: "mhlw-ecs-2018", actor: "director", at: 6, ai: true },
        { change: { kind: "facility", id: "fc-p-03", label: "透析施設", open: false, depends: "dialysis_center" }, text: "透析施設 浸水で休止", person: "p-03", inject: "dialysis_flooded", actor: "director", at: 6, ai: false },
      ],
      turns: [],
      world: W,
      finished: false,
    };
    const html = renderToStaticMarkup(createElement(Situation, { ticks: [tick], names, startedAt: START }));
    expect(html).toContain(">車中泊</span>");
    expect(html).toContain('data-basis="mhlw-ecs-2018"');
    // 前からの差し込みの印は変わらない（施設）
    expect(html).toContain(">施設</span>");
    for (const w of ["診断", "判定", "重症", "緊急度", "札"]) expect(html).not.toContain(w);
  });

  it("被害状況: 予定・到着・物資の行（あるときだけ）と、新しい印", () => {
    const empty = renderToStaticMarkup(createElement(DamagePanel, { kind: "earthquake", world: W, now: 6, names }));
    for (const k of ["scheduled", "arrivals", "supplies"]) expect(empty).not.toContain(`data-world="${k}"`);
    let w = apply(W, "outage_eta", null, 6, 6);
    w = apply(w, "vendor_round", "p-01", 6, 3);
    w = apply(w, "car_sleep", "p-06", 6);
    w = { ...w, supplies: { "p-02": { oxygen: 300 } } };
    const html = renderToStaticMarkup(createElement(DamagePanel, { kind: "earthquake", world: w, now: 6, names }));
    expect(html).toContain('data-world="scheduled"');
    expect(html).toMatch(/停電 復旧<\/span><span class="text-muted">6 時間後/);
    expect(html).toContain(`業者</span><span class="text-muted">3 時間後</span><span class="text-xs text-muted">${names["p-01"]}`);
    expect(html).toContain(`${names["p-02"]}</span><span class="text-muted">酸素 5 時間`);
    expect(html).toContain("車中泊");
  });

  it("本人役への言葉: 印・見込み・向かっている人・届いた物・頼み事。氏名・町名・電話は入らない", () => {
    let w = apply(W, "outage_eta", null, 6, 6);
    w = apply(w, "vendor_round", "p-01", 6, 3);
    w = apply(w, "family_stranded", "p-01", 6);
    w = settleWorld({ ...w, asks: { "p-01": [{ kind: "medicine", at: 400, done: null }, { kind: "water", at: 300, done: 500 }] } }, 540);
    const words = extraWorldWords(w, "p-01");
    expect(words).toEqual([
      "同居でない家族が帰宅困難で、こちらに来られない（6 時間から）",
      "見込み: 停電 復旧（12 時間ごろ）",
      "酸素業者が来た（9 時間）",
      "酸素が届いた（9 時間）",
      "頼んでいる事: 薬（まだ）",
      "頼んだ事: 水（済んだ）",
    ]);
    // ほかの人の物は出ない（全体の見込みは出る）
    expect(extraWorldWords(w, "p-05")).toEqual(["見込み: 停電 復旧（12 時間ごろ）"]);
    // 本人役の入力の文の「今の様子」の末尾に入る
    const persona = buildPersona(input("p-01"), { on: "2026-11-05" });
    const text = tickText({ step: 4, hour: 9, person: "p-01", world: w, incidents: [], state: null, lastAction: null, fixed: [] }, persona);
    expect(text).toContain("- 酸素が届いた（9 時間）");
    expect(text).not.toContain(SEED_PEOPLE.find((p) => p.person.id === "p-01")!.person.name);
  });

  it("新しい種類の固定の文は 2〜30 字で、仮名・名前・町名を書かない", () => {
    const towns = [...new Set(SEED_PEOPLE.map((p) => p.ledger.basic.address!.town!))];
    for (const k of NEW_KINDS) {
      const t = INJECT_TEXTS[k];
      for (const town of towns) expect(t).not.toContain(town);
      expect(t).not.toMatch(/さん/);
    }
  });
});

// 型の確かめ（DirectorInput の budget は省略可のまま。T90 が埋める）
const _budget: Pick<DirectorInput, "budget"> = {};
void _budget;
