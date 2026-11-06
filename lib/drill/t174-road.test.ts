// T174: 道の開通と本人役の理由の食い違い。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { PersonaInput, PersonState } from "./engine.ts";
import { blockedWhy, dropRoadSlips, factLines, factsOf, planOf, roadSlip, sentenceSlip, slipContextOf, type SlipContext } from "./person-facts.ts";
import { buildPersona, personaTurns, type PersonaAnswer } from "./persona.ts";
import { applyEvent, EMPTY_WORLD, type WorldState } from "./scenarios.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const id = "p-07";
const plan = planOf(seedInput(id));
const state = (over: Partial<PersonState> = {}): PersonState => ({ color: "green", source: "agent", whereNow: "home", at: 1, saying: null, doing: null, ...over });
const facts = (world: WorldState, s: PersonState | null = state()) => factsOf({ person: id, world, state: s, actions: [], now: 300, plan, inOutage: false });
const base: SlipContext = { place: "home", together: [], kin: null, powerBack: false, noSpare: false, down: false };
const landslide = { kind: "landslide", town: "甲", persons: [id] } as const;
const town = (open: boolean) => ({ kind: "town_road", road: "town-甲地区", label: "甲の道", open, persons: [id] }) as const;
const bridge = (open: boolean) => ({ kind: "town_road", road: "bridge", label: "乙橋", open, persons: [id] }) as const;
const apply = (world: WorldState, change: unknown, hour = 1): WorldState => applyEvent(world, { at: hour, change } as never, hour);

describe("世界の道", () => {
  it("地区の道が開くと、同じ人の土砂の道も開く。名前のある道の開通では開かない。ほかの人の土砂の道はそのまま", () => {
    const other = { kind: "landslide", town: "乙", persons: ["p-04"] } as const;
    let w = apply(apply(apply(EMPTY_WORLD, landslide), other), town(false));
    expect(blockedWhy(w, id, plan).roads).toEqual(["土砂の道", "甲の道"]);
    w = apply(w, bridge(true));
    expect(w.roads.find((r) => r.id === `rd-ls-甲-${id}`)?.open).toBe(false);
    w = apply(w, town(true));
    expect(w.roads.find((r) => r.id === `rd-ls-甲-${id}`)?.open).toBe(true);
    expect(blockedWhy(w, id, plan).roads).toEqual([]);
    expect(w.roads.find((r) => r.id === "rd-ls-乙-p-04")?.open).toBe(false);
  });
});

describe("帳面の文", () => {
  it("通れない訳は事実の方だけ。土砂の人に水の訳を渡さない", () => {
    const f = facts(apply(EMPTY_WORLD, landslide), state({ saying: "避難所へ向かいます" }));
    const text = factLines(f).join("\n");
    expect(text).toContain("土砂の道が通行止");
    expect(text).toContain("水のせいと言わない");
    expect(text).not.toContain("道が通れないか家の辺りが水につかっている");
    expect(f.dryRoad).toBe(true);
  });

  it("水の印のある人は水を訳に書き、水のせいと言わないを書かない", () => {
    const w: WorldState = { ...EMPTY_WORLD, marks: { [id]: { flooded: 1 } } };
    const text = factLines(facts(w)).join("\n");
    expect(text).toContain("家の辺りが水につかっている");
    expect(text).not.toContain("水のせいと言わない");
    expect(facts(w).dryRoad).toBe(false);
  });

  it("土砂の道が開いたあとは「通れる」と書く", () => {
    const f = facts(apply(apply(EMPTY_WORLD, landslide), town(true)));
    expect(f.blocked).toBe(false);
    expect(factLines(f).join("\n")).toContain("家の辺りの道: 通れる");
  });
});

describe("言葉の門", () => {
  it("閉じているのに通れたと言わない。開いたのに通れないと言わない。問い・済んだ話は残す", () => {
    const shut = { ...base, roadClosed: true };
    const open = { ...base, roadClosed: false };
    for (const s of ["道が通ったので向かいます。", "家の前の道が通れるようになりました。", "道路は開通しました。"]) expect([s, sentenceSlip(s, shut)]).toEqual([s, "road_said"]);
    for (const s of ["道が通れません。", "家の前の道がふさがっています。", "橋が通行止です。"]) expect([s, sentenceSlip(s, open)]).toEqual([s, "road_said"]);
    for (const s of ["道は通れますか。", "道は通れなかったです。", "道が通れるか分かりません。"]) expect([s, sentenceSlip(s, open)]).toEqual([s, null]);
    for (const s of ["道が通れません。"]) expect(sentenceSlip(s, shut)).toBeNull();
    for (const s of ["道が通れるようになりました。"]) expect(sentenceSlip(s, open)).toBeNull();
    // 道の事実を持たない文脈は見ない
    expect(sentenceSlip("道が通れません。", base)).toBeNull();
  });

  it("土砂の人は水を訳に挙げない。水が出ない話・もしもの話は残す", () => {
    const dry = { ...base, dryRoad: true };
    for (const s of ["家の辺りが水で車を出せません。", "水が引いたら連れて行きます。", "道が冠水しています。"]) expect([s, roadSlip(s, dry)]).toEqual([s, true]);
    for (const s of ["水が出ません。", "飲み水が足りません。", "水が来たら逃げます。"]) expect([s, roadSlip(s, dry)]).toEqual([s, false]);
    expect(roadSlip("家の辺りが水で車を出せません。", base)).toBe(false);
  });

  it("帳面から文脈を作る。道の事実は全部の人に効く", () => {
    expect(slipContextOf(facts(EMPTY_WORLD)).roadClosed).toBe(false);
    expect(slipContextOf(facts(apply(EMPTY_WORLD, landslide))).roadClosed).toBe(true);
    expect(slipContextOf(facts(apply(EMPTY_WORLD, landslide))).dryRoad).toBe(true);
  });

  it("本人役の連絡の言葉にも効く（色と 4 問は変えない）", () => {
    const persona = buildPersona(seedInput(id), { on: "2026-11-05" });
    const answer: PersonaAnswer = { condition: "", location: "home", action: "", contactsCaremanager: true, from: persona.reporters.find((r) => r.canPress)!.role, pressesRed: false, redAnswers: null, speech: "家にいます。道が通れません。" };
    const input = { step: 3, hour: 5, person: id, world: EMPTY_WORLD, incidents: [], state: state(), fixed: [], actions: [], toMinute: 300 } as unknown as PersonaInput;
    const [t] = personaTurns(input, persona, answer);
    expect(t.color).toBe("green");
    expect(t.saying).toBe("家にいます。");
  });

  it("遅れて当たった道の出来事のあと、同じ区切りの言葉の合わない文だけ落とす", () => {
    const open = apply(EMPTY_WORLD, { kind: "road", id: "rd-a", label: "家の前の道", open: true }, 1);
    const hits: string[] = [];
    expect(dropRoadSlips("家の前の道が通れなくなっています。まだ誰も来ていません。", open, id, (r) => hits.push(r))).toBe("まだ誰も来ていません。");
    expect(hits).toEqual(["road_said"]);
    expect(dropRoadSlips("道が通れません。", open, id)).toBeNull();
    expect(dropRoadSlips("まだ誰も来ていません。", open, id)).toBe("まだ誰も来ていません。");
    expect(dropRoadSlips(null, open, id)).toBeNull();
  });
});
