// T167（docs/tasks/T167.md）の訓練のテスト。偽の答えだけ（本物の Claude を呼ばない）。
// 評価の 8 回目で見えた形を、架空の入力で作り直して確かめる（記録の台詞は写さない）。

import { describe, expect, it } from "vitest";
import { TALK_FIXED_SPEECH, speechRuleOf, type TalkLine, type TalkReply } from "./dialogue.ts";
import { closesCall, QUICK_KINDS, QUICK_REPLIES, quickKindOf, quickReply } from "./talk-quick.ts";
import { talkRound } from "./talk-turn.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { EVENT_CATALOG } from "./event-catalog.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { PersonState } from "./engine.ts";
import { dropFactSlips, factLines, factsOf, helpedFlip, noteIssued, planOf, placeSaid, screenTurn, sentenceFix, sentenceSlip, slipContextOf, spareCuts, type SlipContext } from "./person-facts.ts";
import { quietOf, quietPersonEvent } from "./quiet-event.ts";
import { worldIncidents } from "./world-apply.ts";
import { buildPersona, clockWords, personaTurns, visitText, VISIT_SYSTEM, type PersonaAnswer } from "./persona.ts";
import { actionWords } from "./action-catalog.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const state = (over: Partial<PersonState>): PersonState => ({ color: "green", source: "family", whereNow: "home", at: 1, saying: null, doing: null, ...over });
const ctxBase: SlipContext = { place: null, together: [], kin: null, powerBack: false, noSpare: false, down: false };

const cm =(text: string, ask?: TalkLine["ask"]): TalkLine => ({ who: "cm", text, ai: false, minute: 10, ...(ask ? { ask } : {}) });
const them = (text: string, ai = true): TalkLine => ({ who: "them", text, ai, minute: 11 });

describe("移ったあとのいる所（門）", () => {
  it("避難所・その他にいる人の「家で〜」は動詞の一覧に無くても落とす。済んだ話・帰りたい話は残す", () => {
    const shelter: SlipContext = { ...ctxBase, place: "shelter" };
    for (const s of ["家で話を聞いて答えています。", "家で応対できる", "主人は家で眠っています。", "母は家でテレビを見ている"]) expect(sentenceSlip(s, shelter)).toBe("place_text");
    for (const s of ["家で転びました。", "家に帰りたがっています。", "家に置いてきました。", "家では使っていました。", "うちの人は避難所にいます。"]) expect(sentenceSlip(s, shelter)).toBeNull();
    expect(placeSaid("家で応対できる")).toBe("home");
  });

  it("家にいる人の「病院へ移りました」は落とす。これから移る言い方と行けない言い方は残す", () => {
    const home: SlipContext = { ...ctxBase, place: "home" };
    for (const s of ["本人は病院へ移りました。", "今は病院にいます。", "入院しました。"]) expect(sentenceSlip(s, home)).toBe("place_text");
    for (const s of ["病院へ移ろうと思います。", "病院に行けません。", "病院は休みです。"]) expect(sentenceSlip(s, home)).toBeNull();
    expect(sentenceSlip("本人は病院へ移りました。", { ...ctxBase, place: "other" })).toBeNull();
  });

  it("家の外から家へは、来た人や届いた物では戻らない（戻った言葉のときだけ）。ふだん動ける人が家から出るのは今までどおり手があれば", () => {
    const f = { help: { at: 100, what: "機器の業者" }, mover: null, plan: null };
    expect(helpedFlip(f, "other")).toBe(false);
    expect(helpedFlip(f, "shelter")).toBe(false);
    expect(helpedFlip(f, "home")).toBe(true);
    const facts = factsOf({ person: "p-04", world: { ...EMPTY_WORLD, arrivals: [{ person: "p-04", role: "vendor", arrive: 100, back: 100, arrived: true, from: "director" }] }, state: state({ color: "red", whereNow: null, atHome: false, at: 1 }), actions: [], now: 120, plan: null, inOutage: false });
    const turn = { person: "p-04", color: "green" as const, source: "family" as const, whereNow: "home" as const, injured: null, atHome: null, canMove: null, hasMedicine: null, saying: "業者が来ました。", doing: null, ai: true, at: 2 };
    expect(screenTurn(turn, facts)?.whereNow).toBe("other");
    expect(screenTurn({ ...turn, saying: "家に戻りました。" }, facts)?.whereNow).toBe("home");
  });

  it("本人役の連絡がいる所を言わないとき（赤で家にいるかに答えない）も帳面のいる所で言葉を見る", () => {
    const persona = buildPersona(seedInput("p-07"), { on: "2026-11-05" });
    const answer: PersonaAnswer = { condition: "", location: "unknown", action: "家で応対できる", contactsCaremanager: true, from: persona.reporters.find((r) => r.canPress)!.role, pressesRed: true, redAnswers: { injured: null, atHome: null, canMove: null, hasMedicine: null }, speech: "連絡を待っています。" };
    const turns = personaTurns({ step: 3, hour: 60, person: "p-07", world: EMPTY_WORLD, incidents: [], state: state({ whereNow: "shelter", at: 40 }), fixed: [], actions: [], toMinute: 3600, since: 3000 } as never, persona, answer);
    expect(turns).toHaveLength(1);
    expect(turns[0].doing ?? "").not.toContain("家で");
  });

  it("もう避難所にいる人に移送の車が来ても移った事にせず、帳面に乗らないと書く", () => {
    const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-07", role: "transport", arrive: 200, back: 200, arrived: true, from: "a1" }] };
    const plan = planOf(seedInput("p-07"));
    const f = factsOf({ person: "p-07", world, state: state({ whereNow: "shelter", at: 3 }), actions: [], now: 210, plan: { ...plan, destination: "shelter" }, inOutage: false });
    expect(f.place).toMatchObject({ where: "shelter", by: "turn" });
    expect(factLines(f).join("\n")).toContain("もう避難所にいるので乗らない");
  });
});

describe("訪問は本人のいる所へ", () => {
  it("帳面のいる所で「着いた」の文を変える。家にいる人は家。指示と手の言い方に「家に」を決め打ちしない", () => {
    const persona = buildPersona(seedInput("p-07"), { on: "2026-11-05" });
    const v = { person: "p-07", hour: 60, world: EMPTY_WORLD, incidents: [] };
    expect(visitText({ ...v, state: state({ whereNow: "shelter", at: 40 }) }, persona)).toContain("ケアマネが本人のいる避難所に着いた");
    expect(visitText({ ...v, state: state({ whereNow: "home", at: 40 }) }, persona)).toContain("ケアマネが家に着いた");
    expect(visitText({ ...v, state: null }, persona)).toContain("ケアマネが家に着いた");
    expect(VISIT_SYSTEM).not.toContain("家を訪ねて");
    expect(actionWords({ kind: "visit" })).not.toContain("家に");
  });

  it("業者の巡回は家の外にいると連絡のあった人に出さない", () => {
    const s = seedInput("p-02");
    const e = EVENT_CATALOG.vendor_round;
    expect(e.eligible(s, "p-02", EMPTY_WORLD, state({ whereNow: "home" }))).toBe(true);
    expect(e.eligible(s, "p-02", EMPTY_WORLD, state({ whereNow: "shelter" }))).toBe(false);
    expect(e.eligible(s, "p-02", EMPTY_WORLD, state({ color: "red", whereNow: null, atHome: false }))).toBe(false);
  });
});

describe("停電の戻りと家の電気", () => {
  const supplied: WorldState = { ...EMPTY_WORLD, outage: { since: 1, area: { scope: "office" }, restoredAt: null }, supplies: { "p-02": { power: 1260 } } };
  const f = (world: WorldState, now: number) => factsOf({ person: "p-02", world, state: state({ at: 1 }), actions: [], now, plan: planOf(seedInput("p-02")), inOutage: true });

  it("届いた電源で動いている家: 帳面は停電が続くと書き、「電気が戻りました」を直す", () => {
    const facts = f(supplied, 1300);
    const lines = factLines(facts).join("\n");
    expect(lines).toContain("届いた電源で動いている");
    expect(lines).toContain("電気が戻ったとは言わない");
    const ctx = slipContextOf(facts);
    expect(ctx.suppliedOnly).toBe(true);
    const fixed = sentenceFix("人が来て電気が戻りました。", ctx);
    expect(fixed.rules).toContain("power_said");
    expect(fixed.text).toContain("届いた電源で動いています");
    expect(fixed.text).not.toContain("電気が戻");
    expect(sentenceFix("今は電気で動いています。", ctx).text).toContain("届いた電源で動");
    const hits: string[] = [];
    expect(dropFactSlips("電気が戻りました。", ctx, (r) => hits.push(r))).toContain("届いた電源");
    expect(hits).toContain("power_said");
    expect(clockWords(buildPersona(seedInput("p-02"), { on: "2026-11-05" }), supplied, "p-02", 1300).join("")).toContain("届いた電源で動き");
  });

  it("停電が戻った家: 「まだ停電」を落とし、「電気が戻りました」は残す", () => {
    const back: WorldState = { ...EMPTY_WORLD, outage: { since: 1, area: { scope: "office" }, restoredAt: 48 } };
    const ctx = slipContextOf(f(back, 3000));
    expect(ctx.outageRestored).toBe(true);
    expect(sentenceSlip("まだ停電が続いています。", ctx)).toBe("power_said");
    expect(sentenceSlip("停電の間は困りました。", ctx)).toBeNull();
    expect(sentenceFix("電気が戻りました。", ctx).rules).not.toContain("power_said");
  });
});

describe("機器の予備が切れた時刻に本人役を呼ぶ", () => {
  it("計画の予備の切れる時刻を、内蔵の電池の切れる時刻から出す。予備の時間が分からない物と時計の無い人は無し", () => {
    const plan = planOf(seedInput("p-02"));
    const device = plan.devices[0];
    const spare = plan.spares.find((s) => s.category === device.category)!;
    expect(spareCuts(plan, "p-02", [{ person: "p-02", label: device.label, outMinute: 240 }])).toEqual([240 + Math.round(spare.hours! * 60)]);
    expect(spareCuts(plan, "p-02", [])).toEqual([]);
    expect(spareCuts({ ...plan, spares: plan.spares.map((s) => ({ ...s, hours: null })) }, "p-02", [{ person: "p-02", label: device.label, outMinute: 240 }])).toEqual([]);
  });
});

describe("仮想の訓練の人ごとの出来事（コードが足す）", () => {
  const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p.person.id)] as const));
  const members = [...sources.keys()];
  const input = (world: WorldState, hour = 12) => ({ world, hour, members, sources, people: {}, seed: "t167", profile: null, supplyOk: () => false });

  it("町の浸水・断水の印はその人の筋に数えず、人を指す出来事のある人は外す。結末の人も外す", () => {
    const world: WorldState = {
      ...EMPTY_WORLD,
      marks: { "p-01": { flooded: 2, waterOut: 3 }, "p-02": { goingHome: 4 } },
      issued: [{ kind: "nurse_away", person: "p-03", text: "x", at: 60 }],
      ended: { "p-04": { at: 5, reason: null } },
    } as never;
    const q = quietOf(world, members);
    expect(q).toContain("p-01");
    for (const p of ["p-02", "p-03", "p-04"]) expect(q).not.toContain(p);
  });

  it("1 刻みに 1 人。その人に当てはまる表の人ごとの種類で、AI の印なし。同じ種なら同じ。もう出した出来事に数える", () => {
    const a = quietPersonEvent(input(EMPTY_WORLD));
    expect(a.length).toBeGreaterThan(0);
    expect(new Set(a.map((e) => e.person)).size).toBe(1);
    const e = a[0];
    expect(e.ai).toBe(false);
    expect(e.filled).toBe(true);
    expect(EVENT_CATALOG[e.inject!].scope).toBe("person");
    expect(EVENT_CATALOG[e.inject!].eligible(sources.get(e.person!)!, e.person!, EMPTY_WORLD, null)).toBe(true);
    expect(quietPersonEvent(input(EMPTY_WORLD))).toEqual(a);
    const noted = noteIssued(EMPTY_WORLD, a);
    expect(noted.issued?.[0]).toMatchObject({ kind: e.inject, person: e.person });
    expect(quietOf(noted, members)).not.toContain(e.person);
  });

  it("刻みを重ねると多くの人に、同じ種類は 2 回までで違う筋が立つ", () => {
    let world: WorldState = EMPTY_WORLD;
    const kinds: string[] = [];
    for (let h = 6; h <= 66; h += 3) {
      const add = quietPersonEvent(input(world, h));
      if (add.length === 0) continue;
      kinds.push(add[0].inject!);
      world = noteIssued(world, add);
    }
    expect(new Set((world.issued ?? []).map((x) => x.person)).size).toBeGreaterThanOrEqual(5);
    for (const k of new Set(kinds)) expect(kinds.filter((x) => x === k).length).toBeLessThanOrEqual(2);
  });

  it("世界がこの刻みに人を指す出来事を出していれば足さない", () => {
    const key = buildPersona(seedInput("p-02"), { on: "2026-11-05" }).key;
    const ctx = { key, facts: new Map([["p-02", { town: null, depends: [], categories: ["ventilator" as const], nurse: false }]]), ended: new Set<string>(), hour: 12, via: "oneshot" as const, quiet: () => [{ actor: "director" as const, at: 12, change: { kind: "nurse_away" as const }, text: "足した", person: "p-02", ai: false, filled: true as const }] };
    const step = (events: never[]) => ({ narration: "雨が続く", events, farewells: [] });
    expect(worldIncidents(step([]), ctx).some((e) => e.text === "足した")).toBe(true);
    const vendor = { kind: "vendor", town: "", target: "A さん", name: "", value: "4" };
    const out = worldIncidents(step([vendor as never]), ctx);
    expect(out.some((e) => e.person === "p-02" && e.ai)).toBe(true);
    expect(out.some((e) => e.text === "足した")).toBe(false);
  });
});

describe("通話の短い返事（呼び出しを減らす）", () => {
  it("相づち・待って・聞こえますか・何でしたっけ・曜日・後で電話はコードで返す", () => {
    for (const [said, kind] of [
      ["はい", "ack"],
      ["分かりました。", "ack"],
      ["うう……ちょっと待ってください", "wait"],
      ["もしもし、聞こえますか、電波が悪いみたいで", "hear"],
      ["あー、はい、はい、それで、何でしたっけ", "again"],
      ["えっと、今日は何曜日でしたっけ", "offtopic"],
      ["あとでまた電話します", "later"],
    ] as const) {
      expect(quickKindOf({ said }, [])).toBe(kind);
    }
    expect(quickKindOf({ ask: "will_call_back", said: "また後で電話します" }, [])).toBe("later");
    expect(quickKindOf({ ask: "stay", said: "今いる所で待っていてください。また連絡します" }, [])).toBe("stay");
  });

  it("中身のある文と初めて聞く問いは本人役が答える（コードにしない）", () => {
    for (const said of ["酸素の機械の音がしていますか", "さっきは家にいると言っていましたが、避難所にいるんですか", "そちらは寒くないですか、毛布はありますか", "近くに誰かいますか", "停電は続いていますか", "今どこにいますか", "はい、薬が足りないのですね"]) {
      expect(quickKindOf({ said }, [])).toBeNull();
    }
    expect(quickKindOf({ ask: "where", said: "今どこにいますか" }, [])).toBeNull();
    expect(quickKindOf({ ask: "advise_119", said: "具合が悪いなら 119 に電話してください" }, [])).toBeNull();
  });

  it("同じ通話でもう答えた問いはコードで返す（ボタンと文のどちらでも）。答えられなかった問いは本人役に", () => {
    const lines = [cm("けがはありませんか", "injured"), them("けがはありません。")];
    expect(quickKindOf({ said: "けがはありませんか" }, lines)).toBe("repeat");
    expect(quickKindOf({ ask: "injured", said: "けがはありませんか" }, lines)).toBe("repeat");
    expect(quickKindOf({ ask: "where", said: "今どこにいますか" }, lines)).toBeNull();
    const failed = [cm("けがはありませんか", "injured"), them(TALK_FIXED_SPEECH, false)];
    expect(quickKindOf({ ask: "injured", said: "けがはありませんか" }, failed)).toBeNull();
  });

  it("返事は同じ通話で重ねず、決まりの語を書かない", () => {
    const first = quickReply("ack", [], 0);
    const second = quickReply("ack", [them(first, false)], 0);
    expect(second).not.toBe(first);
    expect(quickReply("wait", [], 1)).not.toBe(quickReply("wait", [], 2));
    for (const k of QUICK_KINDS) {
      for (const x of QUICK_REPLIES[k]) {
        expect(speechRuleOf(x)).toBeNull();
        expect(x).not.toMatch(/曜日|[月火水木金土日]曜|無事|けが|さん/);
      }
    }
  });

  it("コードの返事はそのまま行に残り、AI の印も頼み事も呼び出しの数えも付かない", () => {
    const reply: TalkReply = { said: "はい", speech: "はい、どうぞ。", asks: [], ai: false, called: false, coded: true };
    const r = talkRound({ world: EMPTY_WORLD, person: "p-01", at: 100, text: "はい", reply, fit: null });
    expect(r.them).toMatchObject({ who: "them", text: "はい、どうぞ。", ai: false });
    expect(r.them.asks).toBeUndefined();
    expect(r.world.counts?.call ?? 0).toBe(0);
    // 印の無い言葉は今までどおり固定の言葉（鍵なし・失敗）
    const failed: TalkReply = { said: "はい", speech: "何か", asks: [], ai: false, called: true };
    expect(talkRound({ world: EMPTY_WORLD, person: "p-01", at: 100, text: "はい", reply: failed, fit: null }).them.text).toBe(TALK_FIXED_SPEECH);
  });

  it("また後で電話します・待機の指示は通話を切る合図", () => {
    expect(closesCall({ ask: "will_call_back" })).toBe(true);
    expect(closesCall({ ask: "stay" })).toBe(true);
    expect(closesCall({ text: "あとでまた電話します" })).toBe(true);
    expect(closesCall({ ask: "where" })).toBe(false);
    expect(closesCall({ text: "はい" })).toBe(false);
  });
});
