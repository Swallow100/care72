// T125 AI の出力の 1 つの門（lib/drill/gate.ts と state-rules.ts の screenIncidents の想定の門）のテスト。Claude を呼ばない。

import { describe, expect, it } from "vitest";
import { FIT_PROFILES } from "./fit.ts";
import { gateTurns, gateWords, nameIds, tallyGate } from "./gate.ts";
import { advance, initialState, step, type DrillIncident, type DrillState } from "./engine.ts";
import { EMPTY_WORLD } from "./scenarios.ts";
import { screenIncidents } from "./state-rules.ts";
import type { DrillTurn } from "./persona-types.ts";

const ai = (change: DrillIncident["change"], text: string, person?: string): DrillIncident => ({
  actor: "director",
  at: 3,
  change,
  text,
  ai: true,
  ...(person ? { person } : {}),
});

describe("出来事の門（想定の表と世界の状態）", () => {
  it("地震で河川の浸水・警戒レベル・大雨の言葉の出来事は捨て、決まりの名前を残す", () => {
    const quake = FIT_PROFILES.earthquake;
    const s = screenIncidents(
      { ...EMPTY_WORLD, quake: "6強" },
      [
        ai({ kind: "flood" }, "川が氾濫"),
        ai({ kind: "alert", level: 4 }, "警戒レベル 4"),
        ai({ kind: "road", id: "rd-x", label: "家の前の道", open: false }, "家の前の道 冠水で通行止め", "p-01"),
        ai({ kind: "road", id: "rd-y", label: "家の前の道", open: false }, "家の前の道 倒壊で通行止め", "p-02"),
      ],
      { origin: "ai", minute: 180, fit: quake },
    );
    expect(s.kept.map((e) => e.text)).toEqual(["家の前の道 倒壊で通行止め"]);
    expect(s.ruled.map((r) => r.rule)).toEqual(["fit:river_flood", "fit:alert", "fit:rain_word"]);
    expect(s.world.flood).toBe(false);
  });

  it("大雨で余震は捨てる。想定の表の出来事（origin table）は門の外", () => {
    const rain = FIT_PROFILES.heavy_rain;
    const quakeEvent = ai({ kind: "quake", intensity: "4" }, "余震 震度 4");
    expect(screenIncidents(EMPTY_WORLD, [quakeEvent], { origin: "ai", minute: 60, fit: rain }).kept).toHaveLength(0);
    expect(screenIncidents(EMPTY_WORLD, [{ ...quakeEvent, ai: false }], { origin: "table", minute: 60, fit: rain }).kept).toHaveLength(1);
    // 想定を渡さない呼び方は前と同じ
    expect(screenIncidents(EMPTY_WORLD, [quakeEvent], { origin: "ai", minute: 60 }).kept).toHaveLength(1);
  });

  it("AI の文の手の id は画面の名前に、置き換えられない英字の id が残る出来事は捨てる", () => {
    const s = screenIncidents(
      EMPTY_WORLD,
      [ai({ kind: "note", topic: "info_confusion" }, "advise_119 を急ぐ声が広がる"), ai({ kind: "note", topic: "water_station" }, "world_step の給水所")],
      { origin: "ai", minute: 60, fit: null },
    );
    expect(s.kept.map((e) => e.text)).toEqual(["119勧奨 を急ぐ声が広がる"]);
    expect(s.ruled.map((r) => r.rule)).toEqual(["internal_id"]);
  });
});

describe("文の門", () => {
  it("手の id は名前に、残れば落とす", () => {
    expect(nameIds("一覧にadvise_119が無いためfreeの電話とした")).toBe("一覧に119勧奨が無いため自由対応の電話とした");
    expect(nameIds("call_person と visiting_nurse")).toBe("本人電話 と 訪問看護");
    expect(nameIds("road_blocked を選んだ")).toBeNull();
    expect(nameIds("家の前の道")).toBe("家の前の道");
  });

  it("地震の本人役の言葉から河川の文だけ落とし、色と答えは変えない", () => {
    const g = gateWords("揺れがこわいです。川が氾濫しそうです。水をください", FIT_PROFILES.earthquake, { ...EMPTY_WORLD, quake: "6強" });
    expect(g.text).toBe("揺れがこわいです。水をください");
    expect(g.dropped).toEqual(["fit:rain_word"]);
    const turn: DrillTurn = { person: "p-01", color: "red", source: "agent", whereNow: "home", injured: true, atHome: true, canMove: false, hasMedicine: null, saying: "また揺れました", doing: null, ai: true, at: 3 };
    const t = gateTurns([turn, { ...turn, ai: false }], FIT_PROFILES.heavy_rain, EMPTY_WORLD);
    expect(t.turns[0]).toMatchObject({ color: "red", injured: true, canMove: false, saying: null });
    // 表の固定の行は門の外（表の試験で合うことを確かめてある）
    expect(t.turns[1].saying).toBe("また揺れました");
    expect(t.dropped).toEqual(["fit:quake_word"]);
  });

  it("落とした数は世界の gated に足す", () => {
    const w = tallyGate(tallyGate(EMPTY_WORLD, "director", ["fit:alert"]), "director", ["fit:alert", "same"]);
    expect(w.gated).toEqual({ "director:fit:alert": 2, "director:same": 1 });
  });
});

describe("エンジンの道（監督の答えの表に無い種類・合わない出来事を捨て、記録に残す）", () => {
  const start = (scenario: DrillState["scenario"], clock: boolean) =>
    initialState(scenario, ["p-01", "p-02", "p-03"], "2026-11-05T01:00:00.000Z", clock ? { clock: true } : {});

  it("連続の時計の地震: 監督の河川の浸水と大雨の言葉を捨て、本人役の河川の言葉を落とす", async () => {
    let s = start("earthquake", true);
    s = (await advance(s, 0, {}))!.state;
    const r = (await advance(s, 180, {
      director: async () => [
        { kind: "road", id: "rd-p-01", label: "家の前の道", open: false, text: "家の前の道 冠水で通行止め", person: "p-01", ai: true } as never,
      ],
      persona: async (input) => [
        { person: input.person, color: "green", source: "agent", whereNow: "home", injured: null, atHome: true, canMove: null, hasMedicine: null, saying: "大雨で川が増水しています。家にいます", doing: null, ai: true, at: input.hour },
      ],
    }))!;
    // 監督の答えは directorIncidents が形を見る（ここでは偽の形が合わないので出来事にならない）。本人役の河川の文は落ちる
    for (const t of r.tick.turns) expect(t.saying).toBe("家にいます");
    expect(Object.entries(r.state.world.gated ?? {}).some(([k, n]) => k === "persona:fit:rain_word" && n > 0)).toBe(true);
  });

  it("刻みの道（10 分版）も本人役の言葉が門を通る", async () => {
    let s = start("short", false);
    const out = await step(s, {
      persona: async (input) => [
        { person: input.person, color: "green", source: "agent", whereNow: "home", injured: null, atHome: true, canMove: null, hasMedicine: null, saying: "地震で揺れました。家にいます", doing: null, ai: true, at: input.hour },
      ],
    });
    s = out.state;
    for (const t of out.tick.turns.filter((x) => x.ai)) expect(t.saying).toBe("家にいます");
    expect(s.world.gated?.["persona:fit:quake_word"]).toBeGreaterThan(0);
  });
});
