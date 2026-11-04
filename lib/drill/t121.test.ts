// T121（docs/tasks/T121.md）のテスト。偽の hooks・偽の client だけ（本物の Claude を呼ばない）。
// 評価の 1 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { advance, initialState, type DirectorEvent, type DirectorInput, type DrillIncident, type DrillState, type StepHooks } from "./engine.ts";
import { applyEvent, EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { DWELL_MINUTES, screenIncident, screenIncidents, stateLines, tableAheadOf } from "./state-rules.ts";

const START = "2026-11-05T01:00:00.000Z";
const TEN = ["p-01", "p-02", "p-03", "p-04", "p-05", "p-06", "p-07", "p-08", "p-09", "p-10"];

const inc = (change: DrillIncident["change"], at: number, extra: Partial<DrillIncident> = {}): DrillIncident => ({
  change,
  text: "x",
  actor: "director",
  at,
  ai: true,
  ...extra,
});

async function begin(scenario: "heavy_rain" | "earthquake" | "virtual", hooks: StepHooks = {}): Promise<DrillState> {
  const r = await advance(initialState(scenario, TEN, START, { clock: true }), 0, hooks);
  return r!.state;
}

/** 偽の監督（区切りごとに渡した関数の差し込みを返す） */
function director(pick: (input: DirectorInput) => DirectorEvent[]) {
  const log: DirectorInput[] = [];
  return {
    log,
    hook: async (input: DirectorInput) => {
      log.push(input);
      return { events: pick(input), words: [] };
    },
  };
}

const ev = (inject: DirectorEvent["inject"], extra: Partial<DirectorEvent> = {}): DirectorEvent => ({
  inject,
  text: "監督の文",
  reason: "理由",
  ai: true,
  ...extra,
});

// ---------- 0. 監督の差し込みの数で切る（行で切らない） ----------

describe("監督の差し込みを数で切る（行で切らない）", () => {
  it("区切りの budget が 1 でも、2 行の種類（携帯不可と回復見込）は 2 行とも当たる", async () => {
    let s = await begin("earthquake");
    // 地震の表は電話が通話不可から始まる。14 時間の表の「一部回復」の後、6 時間たってから携帯不可
    for (const to of [180, 360, 540, 720, 900, 1080, 1260]) s = (await advance(s, to, {}, { policy: "clock" }))!.state;
    expect(s.world.phone).toBe("busy");
    const d = director((input) => (input.hour * 60 === 1500 ? [ev("mobile_down", { after: 3 })] : []));
    const r = (await advance(s, 1500, { director: d.hook }, { policy: "clock", next: true }))!;
    const rows = r.tick.incidents.filter((e) => e.inject === "mobile_down");
    expect(rows.map((e) => e.change.kind)).toEqual(["phone", "schedule"]);
    expect(r.state.world.scheduled?.some((x) => x.change.kind === "phone" && x.change.state === "busy")).toBe(true);
  });
});

// ---------- 1. 変わった時刻と決まりの表 ----------

describe("変わった時刻（stamps）", () => {
  it("道・電話・停電・施設の変わった時刻を applyEvent が書き、変わらなければ書かない", () => {
    let w: WorldState = { ...EMPTY_WORLD };
    w = applyEvent(w, inc({ kind: "road", id: "rd-1", label: "川沿いの市道", open: false }, 3), 3);
    w = applyEvent(w, inc({ kind: "phone", state: "busy" }, 3), 3);
    expect(w.stamps).toEqual({ "road:rd-1": 3, phone: 3 });
    const same = applyEvent(w, inc({ kind: "phone", state: "busy" }, 5), 5);
    expect(same.stamps).toEqual({ "road:rd-1": 3, phone: 3 });
    w = applyEvent(w, inc({ kind: "outage", area: { scope: "office" } }, 4), 4);
    w = applyEvent(w, inc({ kind: "outage_restored" }, 30), 30);
    expect(w.stamps?.outage).toBe(30);
  });
});

describe("変わり方の決まり（state-rules）", () => {
  const closed: WorldState = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: false }, 3, { person: "p-01" }), 3);

  it("一度きり: 停電の復旧は 1 回だけ（復旧済・停電なしの復旧は捨てる）", () => {
    const out = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "outage", area: { scope: "office" } }, 0), 0);
    const restored = applyEvent(out, inc({ kind: "outage_restored" }, 36), 36);
    expect(screenIncident(out, inc({ kind: "outage_restored" }, 36), { minute: 2160, origin: "ai" })).toEqual({ keep: true });
    expect(screenIncident(restored, inc({ kind: "outage_restored" }, 48), { minute: 2880, origin: "table" })).toEqual({ keep: false, rule: "once:restore" });
    expect(screenIncident({ ...EMPTY_WORLD }, inc({ kind: "outage_restored" }, 5), { minute: 300, origin: "ai" })).toEqual({ keep: false, rule: "once:restore" });
  });

  it("表が先: 表がこのあと復旧させる停電を、監督が先に復旧させない（見込みの予定も）", () => {
    const out = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "outage", area: { scope: "office" } }, 0), 0);
    const ahead = tableAheadOf([{ event: { change: { kind: "outage_restored" } }, minute: 2880 }], 1440);
    expect(screenIncident(out, inc({ kind: "outage_restored" }, 36), { minute: 2160, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
    const eta = inc({ kind: "schedule", at: 2160, by: "director", then: { kind: "event", change: { kind: "outage_restored" }, text: "停電 復旧" } }, 24);
    expect(screenIncident(out, eta, { minute: 1440, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
    // 表の出来事そのものは通る
    expect(screenIncident(out, inc({ kind: "outage_restored" }, 48, { actor: "world", ai: false }), { minute: 2880, origin: "table", ahead })).toEqual({ keep: true });
  });

  it("変わるのに要る時間: 通行止から 6 時間たつまでの通行再開は、決まりの時刻へ予定に回す", () => {
    const reopen = inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: true }, 5, { person: "p-01", inject: "road_reopen" });
    const v = screenIncident(closed, reopen, { minute: 300, origin: "ai" });
    expect(v).toEqual({ keep: "defer", rule: "dwell:road", at: 180 + DWELL_MINUTES.roadReopen });
    const s = screenIncidents(closed, [reopen], { origin: "ai", minute: 300 });
    expect(s.kept).toHaveLength(1);
    const c = s.kept[0].change;
    expect(c.kind).toBe("schedule");
    if (c.kind === "schedule") {
      expect(c.at).toBe(300 + 240); // 4 時間後（9 時間）
      expect(c.then).toEqual({ kind: "event", change: reopen.change, text: reopen.text });
    }
    expect(s.kept[0].text).toBe("家の前の道 通行再開見込 4 時間後");
    expect(s.kept[0].inject).toBe("road_reopen");
    expect(s.world.roads[0].open).toBe(false);
    // 6 時間たったあとは通る
    expect(screenIncident(closed, reopen, { minute: 540, origin: "ai" })).toEqual({ keep: true });
  });

  it("通れるようになった道は 12 時間たつまで通行止に戻らない（捨てる）。同じ状態にする出来事も捨てる", () => {
    const opened = applyEvent(closed, inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: true }, 27, { person: "p-01" }), 27);
    const again = inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: false }, 30, { person: "p-01" });
    expect(screenIncident(opened, again, { minute: 1800, origin: "ai" })).toEqual({ keep: false, rule: "dwell:road" });
    expect(screenIncident(opened, again, { minute: 27 * 60 + DWELL_MINUTES.roadClose, origin: "ai" })).toEqual({ keep: true });
    expect(screenIncident(closed, inc({ kind: "road", id: "rd-p-01", label: "家の前の道", open: false }, 5, { person: "p-01" }), { minute: 300, origin: "ai" })).toEqual({
      keep: false,
      rule: "same",
    });
  });

  it("電話: 前に変わってから 6 時間たたない入れ替わりは捨てる。表がすぐ変える電話も先に変えない", () => {
    const busy = applyEvent({ ...EMPTY_WORLD, phone: "down" }, inc({ kind: "phone", state: "busy" }, 14, { actor: "world", ai: false }), 14);
    expect(screenIncident(busy, inc({ kind: "phone", state: "down" }, 18), { minute: 1080, origin: "ai" })).toEqual({ keep: false, rule: "dwell:phone" });
    expect(screenIncident(busy, inc({ kind: "phone", state: "down" }, 21), { minute: 1260, origin: "ai" })).toEqual({ keep: true });
    const ahead = tableAheadOf([{ event: { change: { kind: "phone", state: "ok" } }, minute: 1440 }], 1260);
    expect(screenIncident(busy, inc({ kind: "phone", state: "down" }, 21), { minute: 1260, origin: "ai", ahead })).toEqual({ keep: false, rule: "table_first" });
  });

  it("予定の電話の回復（携帯不可の一部回復）は、今の電話の方が良ければ起きない", () => {
    const ok = { ...EMPTY_WORLD, phone: "ok" as const };
    expect(screenIncident(ok, inc({ kind: "phone", state: "busy" }, 25), { minute: 1500, origin: "scheduled" })).toEqual({ keep: false, rule: "same" });
    expect(screenIncident({ ...EMPTY_WORLD, phone: "down" }, inc({ kind: "phone", state: "busy" }, 25), { minute: 1500, origin: "scheduled" })).toEqual({ keep: true });
  });

  it("到着は一度きり: 同じ人に同じ役が向かっている・24 時間のうちに着いた・届いたなら、同じ役の予定を受けない", () => {
    const vendor = (at: number) => inc({ kind: "schedule", at, by: "director", then: { kind: "arrival", role: "vendor" } }, at / 60 - 4, { person: "p-02" });
    const coming: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "vendor", arrive: 660, back: null, arrived: false, from: "director" }] };
    expect(screenIncident(coming, vendor(900), { minute: 660, origin: "ai" })).toEqual({ keep: false, rule: "once:arrival" });
    const came: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "vendor", arrive: 660, back: null, arrived: true, from: "director" }] };
    expect(screenIncident(came, vendor(2200), { minute: 1980, origin: "ai" })).toEqual({ keep: false, rule: "once:arrival" });
    expect(screenIncident(came, vendor(2400 + 660), { minute: 660 + 1440, origin: "ai" })).toEqual({ keep: true });
    // ほかの人・ほかの役は通る
    expect(screenIncident(coming, { ...vendor(900), person: "p-01" }, { minute: 660, origin: "ai" })).toEqual({ keep: true });
  });

  it("印・家の電話の不通・note の話題は一度きり", () => {
    const w: WorldState = { ...EMPTY_WORLD, marks: { "p-04": { lineDown: 7, familyAway: 12 } }, notes: { water_station: 36 } };
    expect(screenIncident(w, inc({ kind: "line_down" }, 15, { person: "p-04" }), { minute: 900, origin: "ai" }).keep).toBe(false);
    expect(screenIncident(w, inc({ kind: "mark", mark: "familyAway" }, 34, { person: "p-04" }), { minute: 2040, origin: "ai" }).keep).toBe(false);
    expect(screenIncident(w, inc({ kind: "note", topic: "water_station" }, 42), { minute: 2520, origin: "ai" }).keep).toBe(false);
    expect(screenIncident(w, inc({ kind: "line_down" }, 15, { person: "p-09" }), { minute: 900, origin: "ai" }).keep).toBe(true);
  });

  it("今の状態の行に、変わった時刻と、まだ変わらない時刻を書く（監督・世界に渡す）", () => {
    const lines = stateLines(closed, 300, (p) => (p === "p-01" ? "A さん" : null));
    expect(lines).toContain("家の前の道（A さん）: 通行止（3 時間から）。9 時間まで変わらない");
    expect(lines.some((l) => l.startsWith("電話: 通常"))).toBe(true);
  });
});

// ---------- 1. 区切りの中で（advance） ----------

describe("区切りの中の決まり（advance）", () => {
  it("大雨: 監督が 36 時間に停電を復旧させても通らず、表の 48 時間の復旧が 1 回だけ起きる", async () => {
    let s = await begin("heavy_rain");
    const d = director((input) => (input.hour * 60 === 2160 ? [ev("outage_eta", { after: 2 })] : []));
    const restores: number[] = [];
    for (let to = 180; to <= 72 * 60; to += 180) {
      const r = (await advance(s, to, { director: d.hook }, { policy: "clock" }))!;
      for (const e of r.tick.incidents) if (e.change.kind === "outage_restored" || (e.change.kind === "schedule" && e.change.then.kind === "event" && e.change.then.change.kind === "outage_restored")) restores.push(to);
      s = r.state;
      if (r.tick.finished) break;
    }
    expect(restores).toEqual([2880]);
    expect(s.world.outage?.restoredAt).toBe(48);
  });

  it("監督の通行再開が早すぎれば予定に回り、決まりの時刻に表の出来事と同じ道で起きる", async () => {
    let s = await begin("heavy_rain");
    // 表: 3 時間に川沿いの市道（rd-1、p-05）が通行止
    const d = director((input) => (input.hour * 60 === 360 ? [ev("road_blocked", { person: "p-01", text: "家の前の道が倒木で通れない" })] : input.hour * 60 === 540 ? [ev("road_reopen", { person: "p-01", text: "家の前の道が通れるようになった" })] : []));
    for (const to of [180, 360, 540]) s = (await advance(s, to, { director: d.hook }, { policy: "clock" }))!.state;
    // 6 時間に通行止 → 9 時間の再開は 3 時間早いので 12 時間の予定に
    expect(s.world.roads.find((r) => r.id === "rd-p-01")?.open).toBe(false);
    expect(s.world.scheduled?.find((x) => x.person === "p-01")?.at).toBe(720);
    s = (await advance(s, 720, { director: d.hook }, { policy: "clock" }))!.state;
    expect(s.world.roads.find((r) => r.id === "rd-p-01")?.open).toBe(true);
    expect(s.world.stamps?.["road:rd-p-01"]).toBe(12);
  });
});

// ---------- 1. 話し手の続柄と持ちこたえる時間（本人役） ----------

import { SEED_PEOPLE } from "../../seed/people.ts";
import { callText, clockWords, buildPersona, personaTurns, PERSONA_SYSTEM, type PersonaAnswer } from "./persona.ts";
import { callsFor, speakerSlip, speakersOf } from "./speaker.ts";
import { contactRoles, type PseudonymInput } from "../pseudonym/index.ts";
import type { PersonaInput } from "./engine.ts";

const sourceOf = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const speakersFor = (id: string) => {
  const s = sourceOf(id);
  return speakersOf(s.contacts, contactRoles(s.contacts), s.ledger.basic.sex);
};

describe("話し手の続柄（台帳の連絡先から）", () => {
  it("家族の話し手は押せる人・近く住む人を先に 1 人。本人の呼び方は続柄と本人の性別から", () => {
    expect(speakersFor("p-02").family).toMatchObject({ role: "夫", calls: ["妻", "家内", "うちの人"] });
    // 妻（同居）・長男（市内）・長女（県外）→ 妻
    expect(speakersFor("p-03").family).toMatchObject({ role: "妻", calls: ["主人", "夫", "うちの人"] });
    // 娘（同居）・息子・孫 → 娘
    expect(speakersFor("p-06").family).toMatchObject({ role: "娘", calls: ["母"] });
    expect(speakersFor("p-05").family?.calls).toEqual(["叔母"]);
    expect(speakersFor("p-07").family?.calls).toEqual(["兄"]);
    expect(speakersFor("p-01").supporter).toMatchObject({ role: "支援者 1", calls: ["おばあちゃん"] });
    expect(callsFor("孫 2", "family", "male")).toEqual(["祖父", "おじいちゃん"]);
    expect(callsFor("いとこ", "family", "female")).toEqual(["本人"]);
  });

  it("本人役の説明に話す人の 1 行、指示の決まり 5 は話す人を替えない形", () => {
    const persona = buildPersona(sourceOf("p-03"));
    expect(persona.profile.text).toContain("話す人: 家族から連絡するのは 妻（本人を「主人」「夫」「うちの人」と呼ぶ）。ほかの人に替えない");
    expect(PERSONA_SYSTEM).toContain("「話す人」に書いた人で、途中で替えない");
    expect(PERSONA_SYSTEM).not.toContain("「母」「父」「うちの人」「おばあちゃん」などと言う");
  });

  it("話し手に合わない文: 夫・妻が本人を母・父と呼ぶ文、話し手でない続柄で名乗る文", () => {
    const wife = speakersFor("p-03").family;
    const others = contactRoles(sourceOf("p-03").contacts);
    expect(speakerSlip("でも母はまだ2階にいます。", wife, others)).toBe(true);
    expect(speakerSlip("父が水を探しています。", wife, others)).toBe(true);
    expect(speakerSlip("長男です。", wife, others)).toBe(true);
    expect(speakerSlip("主人は2階にいます。", wife, others)).toBe(false);
    expect(speakerSlip("お母さんと呼ばれています。", wife, others)).toBe(false);
    expect(speakerSlip("祖母の家に行きます。", wife, others)).toBe(false);
    // 子の話し手が本人を母と呼ぶのはよい
    expect(speakerSlip("母は避難所にいます。", speakersFor("p-06").family, contactRoles(sourceOf("p-06").contacts))).toBe(false);
  });

  it("表の家族の行の言葉で、話し手に合わない文だけ落とす（全部落ちれば表の言葉）", () => {
    const persona = buildPersona(sourceOf("p-02"));
    const input: PersonaInput = {
      step: 1,
      hour: 1,
      person: "p-02",
      world: { ...EMPTY_WORLD },
      incidents: [],
      state: null,
      lastAction: null,
      fixed: [{ person: "p-02", color: "green", source: "family", whereNow: "home", saying: "停電した" }],
    };
    const answer = (speech: string): PersonaAnswer => ({
      condition: "",
      location: "home",
      action: "",
      contactsCaremanager: true,
      from: "夫",
      pressesRed: false,
      redAnswers: null,
      speech,
    });
    expect(personaTurns(input, persona, answer("停電しました。母の機械が電池になりました。"))[0].saying).toBe("停電しました。");
    expect(personaTurns(input, persona, answer("娘です。母は寝ています。"))[0]).toMatchObject({ saying: "停電した", ai: false });
    expect(personaTurns(input, persona, answer("停電しました。家内の機械が電池になりました。"))[0].saying).toBe("停電しました。家内の機械が電池になりました。");
  });

  it("電話に出た人の行に本人の呼び方", () => {
    const persona = buildPersona(sourceOf("p-06"));
    const text = callText({ person: "p-06", hour: 3, world: { ...EMPTY_WORLD }, incidents: [], state: null, callee: "息子" }, persona);
    expect(text).toContain("電話に出た人: 息子（本人を「母」と呼ぶ）");
  });
});

describe("持ちこたえる時間の今（本人役に渡す計算した値）", () => {
  const persona = buildPersona(sourceOf("p-02"));
  const out: WorldState = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "outage", area: { scope: "office" } }, 1), 1);

  it("停電から減る時計: 残り、切れた時刻", () => {
    expect(clockWords(persona, out, "p-02", 120)).toEqual([expect.stringMatching(/^.+: 残り 2 時間$/)]);
    expect(clockWords(persona, out, "p-02", 600)[0]).toMatch(/の分は切れた（4 時間ごろ）$/);
  });

  it("停電の復旧・電源が届いた時刻からは減らない", () => {
    const restored = applyEvent(out, inc({ kind: "outage_restored" }, 2), 2);
    expect(clockWords(persona, restored, "p-02", 600)[0]).toMatch(/残り 2 時間。2 時間から電気で動き減っていない$/);
    const powered: WorldState = { ...out, supplies: { "p-02": { power: 150 } } };
    expect(clockWords(persona, powered, "p-02", 600)[0]).toMatch(/残り 1.5 時間。2 時間 30 分から電気で動き減っていない$/);
  });

  it("本人役の刻みの文に時計の段と、道・電話のいつから", async () => {
    const { tickText } = await import("./persona.ts");
    let w = applyEvent(out, inc({ kind: "road", id: "rd-p-02", label: "家の前の道", open: false }, 3, { person: "p-02" }), 3);
    w = applyEvent(w, inc({ kind: "phone", state: "busy" }, 3), 3);
    const text = tickText({ step: 2, hour: 4, person: "p-02", world: w, incidents: [], state: null, lastAction: null, fixed: [], toMinute: 240 }, persona);
    expect(text).toContain("持ちこたえる時間の今（計算した値。言葉はこれと食い違わない）:");
    expect(text).toContain("- 家の前の道 通行止（家の近くの道）（3 時間から）");
    expect(text).toContain("- 電話 不安定（3 時間から）");
  });
});

// ---------- 2. 起きやすさ（時間帯と訓練の傾向） ----------

import { drillLeanings, drillSeed, oddsOf, oddsText } from "./time-odds.ts";
import { kindAllowed } from "./director.ts";
import { tickText as worldTickText } from "./world-oneshot.ts";
import { pseudonymize } from "../pseudonym/index.ts";

describe("起きやすい物と起きにくい物（time-odds と訓練の種）", () => {
  it("帯の外の種類は起きにくい側（薬局の休止は 24 時間より前、回線の不通は 3〜12 時間の外）", () => {
    const early = oddsOf(2, null);
    expect(early.unlikely).toContain("pharmacy_closed");
    expect(early.likely).toContain("outage_spread");
    expect(oddsOf(30, null).likely).toContain("pharmacy_closed");
    expect(oddsOf(30, null).unlikely).toContain("line_down");
    expect(oddsOf(5, null).likely).toContain("line_down");
  });

  it("訓練の種で傾向が変わる（同じ種なら同じ）。帯の外の種類は傾向でも起きやすくならない", () => {
    const seeds = Array.from({ length: 12 }, (_, i) => drillSeed({ scenario: "heavy_rain", startedAt: `2026-11-05T0${i % 10}:${10 + i}:00.000Z` }));
    const sets = new Set(seeds.map((s) => drillLeanings(s).more.join(",")));
    expect(sets.size).toBeGreaterThan(6);
    expect(drillLeanings(seeds[0])).toEqual(drillLeanings(seeds[0]));
    for (const s of seeds) {
      const o = oddsOf(2, s);
      expect(o.likely).not.toContain("pharmacy_closed");
      expect(o.likely.filter((k) => o.unlikely.includes(k))).toEqual([]);
    }
  });

  it("文は種類の英字（監督）か印の言葉（世界）", () => {
    expect(oddsText(2, "x")).toContain("- 起きにくい（使うなら筋が通るときだけ、1 回まで）:");
    expect(oddsText(2, "x", (k) => `〔${k}〕`)).toContain("〔pharmacy_closed〕");
  });

  it("連続の時計の監督の入力に種、10 分版（刻みの道）には付けない", async () => {
    const d = director(() => []);
    const s = await begin("heavy_rain", { director: d.hook });
    expect(d.log[0].seed).toBe(drillSeed(s));
    const { step } = await import("./engine.ts");
    const d2 = director(() => []);
    await step(initialState("short", TEN, START), { director: d2.hook });
    expect(d2.log[0].seed).toBeUndefined();
  });

  it("今使われない種類は差し込める種類から外す（家の電話がもう不通・業者がもう向かっている）", () => {
    const w: WorldState = {
      ...EMPTY_WORLD,
      marks: { "p-02": { lineDown: 3 } },
      arrivals: [{ person: "p-02", role: "vendor", arrive: 600, back: null, arrived: false, from: "director" }],
    };
    expect(kindAllowed("line_down", "p-02", w, 5, 300)).toBe(false);
    expect(kindAllowed("line_down", "p-03", w, 5, 300)).toBe(true);
    expect(kindAllowed("vendor_round", "p-02", w, 5, 300)).toBe(false);
  });

  it("世界の刻みの文に起きやすさと今の状態（仮名と町の別名のまま）", () => {
    const s0 = initialState("virtual", TEN, START, { clock: true });
    const w = applyEvent({ ...EMPTY_WORLD }, inc({ kind: "road", id: "rd-x-p-01", label: "川沿いの道", open: false }, 3, { person: "p-01" }), 3);
    const sources = SEED_PEOPLE.map((p) => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }));
    const { key } = pseudonymize(sources);
    const text = worldTickText(
      {
        scenario: "virtual",
        step: 3,
        hour: 5,
        world: w,
        incidents: [],
        participants: TEN,
        people: {},
        actions: [],
        since: 240,
        seed: drillSeed(s0),
        hints: { reached: [], clocks: [] },
        session: null,
        minute: 300,
      },
      { key },
      4,
      72,
    );
    expect(text).toContain("起きやすさ（目安。この時間帯と、この訓練の傾向。訓練ごとに変わる）:");
    expect(text).toMatch(/- 川沿いの道（[A-Z] さん）: 通行止（3 時間から）。9 時間まで変わらない/);
  });
});
