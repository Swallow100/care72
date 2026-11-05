// T125 想定ごとの表（lib/drill/fit.ts）のテスト。網羅（全部の想定・全部の災害の種類・出来事の種類・世界の種類）と、
// 想定の表（scenarios.ts）の固定の出来事が自分の想定に合うこと。Claude を呼ばない。

import { describe, expect, it } from "vitest";
import { DISASTER_KINDS, DRILL_SCENARIOS, HAZARD_KINDS } from "../db/types.ts";
import { DISASTER_SCENE } from "../disaster/state.ts";
import { INJECT_KINDS, INJECT_TEXTS } from "./event-catalog.ts";
import {
  changeMisfit,
  FIT_PROFILES,
  fitKindOf,
  fitLedgerHazards,
  forbiddenFor,
  LEDGER_HAZARD,
  profileOf,
  SCENARIO_FIT,
  waterActive,
  wordMisfit,
  zoneActive,
} from "./fit.ts";
import { SCALE_CHOICES } from "./scale.ts";
import { EMPTY_WORLD, scenarioOf, type DrillKind, type WorldState } from "./scenarios.ts";
import { WORLD_KINDS } from "./world-apply.ts";

const KINDS = Object.keys(FIT_PROFILES) as DrillKind[];

describe("網羅", () => {
  it("全部の想定に災害の種類の行がある（仮想は規模から）", () => {
    for (const s of DRILL_SCENARIOS) {
      expect(SCENARIO_FIT[s]).toBeDefined();
      if (SCENARIO_FIT[s] === "scale") continue;
      // 想定の表の種類と同じ
      expect(SCENARIO_FIT[s]).toBe(scenarioOf(s).kind);
      expect(FIT_PROFILES[SCENARIO_FIT[s] as DrillKind]).toBeDefined();
    }
  });

  it("想定の表の全部の種類（固定の筋と規模の選べる種類）に表の行がある", () => {
    const used = new Set<DrillKind>([...DRILL_SCENARIOS.map((s) => scenarioOf(s).kind), ...SCALE_CHOICES.map((s) => s.kind)]);
    for (const k of used) expect(FIT_PROFILES[k]?.kind).toBe(k);
  });

  it("事業所の災害の種類（平時・その他のほか）は、地図の場面で表のどれかの行に写る", () => {
    for (const k of DISASTER_KINDS) {
      const scene = DISASTER_SCENE[k];
      if (scene === null) continue;
      expect(FIT_PROFILES[scene]).toBeDefined();
    }
  });

  it("出来事の種類・世界の種類・台帳のハザードは、表の全部の行で使えるか使えないかが決まる（どの行にも穴が無い）", () => {
    for (const k of KINDS) {
      const p = FIT_PROFILES[k];
      for (const b of p.injects.banned) expect(INJECT_KINDS).toContain(b);
      for (const b of p.worldKinds.banned) expect(WORLD_KINDS).toContain(b);
      for (const w of Object.keys(p.worldKinds.only)) expect(WORLD_KINDS).toContain(w);
      for (const h of p.hazards) expect(p.active[h]).toBeTypeOf("function");
      expect(p.layers.length).toBeGreaterThan(0);
    }
    for (const h of HAZARD_KINDS) expect(h in LEDGER_HAZARD).toBe(true);
  });

  it("どの出来事の種類も、少なくとも 1 つの想定で使える（表で全部を捨てていない）", () => {
    for (const kind of INJECT_KINDS) expect(KINDS.some((k) => !FIT_PROFILES[k].injects.banned.includes(kind))).toBe(true);
    for (const kind of WORLD_KINDS) expect(KINDS.some((k) => !FIT_PROFILES[k].worldKinds.banned.includes(kind))).toBe(true);
  });
});

describe("想定の表の固定の出来事は自分の想定に合う", () => {
  for (const s of DRILL_SCENARIOS) {
    it(s, () => {
      const sc = scenarioOf(s);
      const kind = fitKindOf({ scenario: s, options: s === "virtual" ? { scale: { kind: "heavy_rain", level: 4 } } : null });
      const profile = profileOf(kind);
      let w: WorldState = { ...EMPTY_WORLD };
      for (const t of sc.ticks) {
        for (const e of t.events) {
          expect(changeMisfit(profile, e.change, w), `${t.hour} 時間 ${e.text}`).toBeNull();
          expect(wordMisfit(profile, e.text, w), `${t.hour} 時間 ${e.text}`).toBeNull();
          if (e.inject) expect(profile!.injects.banned).not.toContain(e.inject);
          w = foldSimple(w, e.change);
        }
        for (const r of t.turns) if (r.saying) expect(wordMisfit(profile, r.saying, w), `${t.hour} 時間 ${r.saying}`).toBeNull();
      }
    });
  }
});

/** 条件を見る所だけ当てる（テストの写し） */
function foldSimple(w: WorldState, c: WorldState extends never ? never : Parameters<typeof changeMisfit>[1]): WorldState {
  if (c.kind === "alert") return { ...w, alertLevel: c.level };
  if (c.kind === "quake") return { ...w, quake: c.intensity };
  if (c.kind === "tsunami") return { ...w, tsunami: c.state };
  if (c.kind === "flood") return { ...w, flood: true };
  return w;
}

describe("仮想の災害の種類", () => {
  it("規模があれば規模、無ければ世界の出来事、それも無ければ未決", () => {
    expect(fitKindOf({ scenario: "virtual", options: { scale: { kind: "earthquake", level: "6強" } } })).toBe("earthquake");
    expect(fitKindOf({ scenario: "virtual" }, { quake: "5強" })).toBe("earthquake");
    expect(fitKindOf({ scenario: "virtual" }, { alertLevel: 4 })).toBe("heavy_rain");
    expect(fitKindOf({ scenario: "virtual" }, { ...EMPTY_WORLD })).toBeNull();
    // 未決は全部合う
    expect(changeMisfit(null, { kind: "quake", intensity: "5強" }, EMPTY_WORLD)).toBeNull();
    expect(wordMisfit(null, "余震が続く", EMPTY_WORLD)).toBeNull();
  });
});

describe("合わない物", () => {
  const rain = FIT_PROFILES.heavy_rain;
  const quake = FIT_PROFILES.earthquake;
  it("大雨で地震・津波・余震の出来事と言葉", () => {
    expect(changeMisfit(rain, { kind: "quake", intensity: "4" }, EMPTY_WORLD)).toBe("fit:quake");
    expect(changeMisfit(rain, { kind: "tsunami", state: "evacuate" }, EMPTY_WORLD)).toBe("fit:tsunami");
    expect(wordMisfit(rain, "また揺れました", EMPTY_WORLD)).toBe("fit:quake_word");
    expect(rain.injects.banned).toContain("aftershock");
  });
  it("地震で河川の浸水・警戒レベル・大雨の出来事と言葉。浸水は津波警報のあとだけ合う", () => {
    expect(changeMisfit(quake, { kind: "flood" }, EMPTY_WORLD)).toBe("fit:river_flood");
    expect(changeMisfit(quake, { kind: "alert", level: 4 }, EMPTY_WORLD)).toBe("fit:alert");
    expect(changeMisfit(quake, { kind: "weather", state: "rain" }, EMPTY_WORLD)).toBe("fit:rain");
    expect(changeMisfit(quake, { kind: "weather", state: "clear" }, EMPTY_WORLD)).toBeNull();
    const flood = { kind: "town_flood" as const, town: "x", depthM: 1, persons: [] };
    expect(changeMisfit(quake, flood, EMPTY_WORLD)).toBe("fit:tsunami_flood");
    expect(changeMisfit(quake, flood, { ...EMPTY_WORLD, tsunami: "evacuate" })).toBeNull();
    expect(wordMisfit(quake, "川が氾濫しそうです", EMPTY_WORLD)).toBe("fit:rain_word");
    expect(wordMisfit(quake, "家の前まで水が来ています", EMPTY_WORLD)).toBe("fit:flood_word");
    expect(wordMisfit(quake, "家の前まで水が来ています", { ...EMPTY_WORLD, tsunami: "evacuate" })).toBeNull();
    expect(quake.injects.banned).toContain("dialysis_flooded");
    // 予定の出来事も中身で見る
    expect(
      changeMisfit(quake, { kind: "schedule", at: 60, by: "director", then: { kind: "event", change: { kind: "flood" }, text: "x" } }, EMPTY_WORLD),
    ).toBe("fit:river_flood");
  });
  it("固定の差し込みの文は表の想定に合う（透析施設の浸水の文は大雨だけ）", () => {
    expect(wordMisfit(rain, INJECT_TEXTS.dialysis_flooded, EMPTY_WORLD)).toBeNull();
    expect(wordMisfit(quake, INJECT_TEXTS.dialysis_flooded, EMPTY_WORLD)).toBe("fit:flood_word");
  });
});

describe("区域のハザード", () => {
  it("地震の津波の浸水は、津波警報の間に津波の区域の人だけ", () => {
    const quake = FIT_PROFILES.earthquake;
    const warn = { ...EMPTY_WORLD, quake: "6強", tsunami: "evacuate" as const };
    expect(waterActive(quake, ["tsunami"], warn)).toBe(true);
    expect(waterActive(quake, ["flood"], warn)).toBe(false);
    expect(waterActive(quake, [], warn)).toBe(false);
    expect(waterActive(quake, ["tsunami"], { ...warn, tsunami: "lifted" })).toBe(false);
  });
  it("大雨の河川の浸水は、氾濫か警戒レベル 4 以上の間に洪水の区域の人だけ。土砂は警戒の間", () => {
    const rain = FIT_PROFILES.heavy_rain;
    expect(waterActive(rain, ["flood"], { ...EMPTY_WORLD, alertLevel: 4 })).toBe(true);
    expect(waterActive(rain, ["flood"], { ...EMPTY_WORLD, alertLevel: 3 })).toBe(false);
    expect(waterActive(rain, ["tsunami"], { ...EMPTY_WORLD, alertLevel: 5, flood: true })).toBe(false);
    expect(zoneActive(rain, "landslide", { ...EMPTY_WORLD, notes: { landslide_warn: 9 } })).toBe(true);
  });
  it("担当一覧のハザードの列は想定に効く区域だけ（その他は出す）", () => {
    const hz = [{ kind: "flood" as const, depthM: 3 }, { kind: "tsunami" as const }, { kind: "landslide" as const }, { kind: "other" as const, note: "崖" }];
    expect(fitLedgerHazards(FIT_PROFILES.earthquake, hz).map((h) => h.kind)).toEqual(["tsunami", "landslide", "other"]);
    expect(fitLedgerHazards(FIT_PROFILES.heavy_rain, hz).map((h) => h.kind)).toEqual(["flood", "landslide", "other"]);
    expect(fitLedgerHazards(null, hz)).toHaveLength(4);
  });
  it("評価の台の一覧は表から", () => {
    for (const k of KINDS) {
      const f = forbiddenFor(k);
      expect(f.changes).toBe(FIT_PROFILES[k].changes);
      expect(f.injects).toBe(FIT_PROFILES[k].injects.banned);
    }
  });
});
