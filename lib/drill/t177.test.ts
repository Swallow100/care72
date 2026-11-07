// T177: 評価の 10 回目で人ごとの筋に残った形（切れた時刻の言葉・手なしの移動・呼び出しの数）。文は手で組み、Claude は呼ばない

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { foldTick, initialState, type PersonaInput, type PersonState } from "./engine.ts";
import { clockOfMinute, clockStartOf, clockWhen, NIGHT_START_HOUR } from "./night.ts";
import { canLeaveHome, carryMoved, factLines, factsOf, GO_MINUTES, helpedFlip, placeReplyOf, planOf, screenTurn, sentenceFix, sentenceSlip, slipContextOf, startsMove, talkContextOf, whenWordsOf } from "./person-facts.ts";
import { buildPersona, callText, clockWords, personaTurns, tickText, visitText, type PersonaAnswer } from "./persona.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { seatRounds } from "./clock.ts";
import { isPlaceAsk } from "./talk-quick.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const state = (over: Partial<PersonState>): PersonState => ({ color: "red", source: "family", whereNow: null, at: 1, saying: null, doing: null, atHome: null, injured: null, canMove: null, hasMedicine: null, ...over });
const outage = (restoredAt: number | null = null): WorldState => ({ ...EMPTY_WORLD, outage: { area: { scope: "office" }, since: 0, restoredAt } });

describe("切れた時刻の言葉", () => {
  const id = "p-02";
  const plan = planOf(seedInput(id));
  const device = plan.devices[0];
  const spare = plan.spares.find((s) => s.category === device.category)!;
  const cut = Math.round((device.hours! + spare.hours!) * 60);
  const factsAt = (now: number, startHour: number | null = 10) =>
    factsOf({ person: id, world: outage(), state: null, actions: [], now, plan, inOutage: true, together: ["夫"], kin: null, startHour });

  it("時計の言い方: 何時ごろ。今と違う日は何日目。夜間発災は深夜 2 時から", () => {
    expect(clockWhen(360, 10, 400)).toBe("16 時ごろ");
    expect(clockWhen(365, 10, 400)).toBe("16 時ごろ");
    expect(clockWhen(410, 10, 420)).toBe("16 時 50 分ごろ");
    expect(clockWhen(360, 10, 1500)).toBe("1 日目の 16 時ごろ");
    expect(clockWhen(1500, 10, 1500)).toBe("11 時ごろ");
    expect(clockStartOf({ night: true, startHour: 10 })).toBe(NIGHT_START_HOUR);
    expect(clockStartOf({ startHour: 10 })).toBe(10);
    expect(clockStartOf({})).toBeNull();
    expect(clockOfMinute(60 * 24, 0)).toEqual({ day: 2, hour: 0, min: 0 });
  });

  it("帳面は時計の時刻と今からどれだけ前かで渡す。発災の時刻が無ければ前の経過の数のまま", () => {
    const now = cut + 120;
    const lines = factLines(factsAt(now)).join("\n");
    expect(lines).toContain(`${clockWhen(cut, 10, now)}（2 時間前）に切れた`);
    expect(lines).not.toContain("言う時は切れた時刻も添える");
    const old = factLines(factsAt(now, null)).join("\n");
    expect(old).toContain("言う時は切れた時刻も添える");
    expect(old).not.toContain("時ごろ（");
    expect(whenWordsOf({ startHour: 10, now: 100 })(100)).toContain("（今）");
    expect(whenWordsOf({ startHour: 10, now: 100 })(160)).toContain("（あと 1 時間）");
  });

  it("刻み・通話・訪問の文の全部に時計で渡す（今の様子の括弧と前の連絡も）", () => {
    const persona = buildPersona(seedInput(id), { on: "2026-11-05" });
    const now = cut + 180;
    const world: WorldState = { ...outage(), marks: { [id]: { waterOut: 2 } } };
    const prev = state({ at: 3, saying: "連絡です" });
    const input: PersonaInput = { step: 3, hour: now / 60, person: id, world, incidents: [], state: prev, lastAction: null, actions: [], fixed: [], startHour: 10, toMinute: now, since: 0, reasons: ["clock"] };
    const texts = [
      tickText(input, persona),
      callText({ person: id, hour: now / 60, world, incidents: [], state: prev, callee: "本人", startHour: 10 }, persona),
      visitText({ person: id, hour: now / 60, world, incidents: [], state: prev, startHour: 10 }, persona),
    ];
    for (const t of texts) {
      expect(t).toContain(`${clockWhen(cut, 10, now)}（3 時間前）に切れた`);
      expect(t).toContain("断水（12 時ごろから）");
      expect(t).toContain("前の連絡: 13 時ごろ（");
      expect(t).toContain("今は");
    }
    // 夜間発災は深夜 2 時から
    expect(tickText({ ...input, startHour: undefined, night: true }, persona)).toContain(`${clockWhen(cut, NIGHT_START_HOUR, now)}（3 時間前）に切れた`);
    // 持ちこたえる時間の段（切れた分）も同じ
    expect(clockWords(persona, world, id, now, whenWordsOf({ startHour: 10, now })).join("\n")).toContain("時ごろ（");
  });

  describe("門", () => {
    const f = factsAt(cut + 120);
    const hour = clockOfMinute(cut, 10).hour;
    const fix = (s: string) => sentenceFix(s, slipContextOf(f));

    it("経過の数をそのまま時刻として言う・計算が違う文は帳面の時刻に直す", () => {
      const elapsed = fix(`予備の電池は ${Math.round(cut / 60)} 時に切れました。`);
      expect(elapsed.rules).toContain("clock_said");
      expect(elapsed.text).toContain(`${hour} 時に切れ`);
      const wrong = fix(`予備も${(hour + 3) % 24}時ごろ切れて止まっています。`);
      expect(wrong.rules).toContain("clock_said");
      expect(wrong.text).toContain(`${hour} 時ごろ切れ`);
    });

    it("時計に直して正しい文は通す（午前午後の無い 12 時間の言い方、1 時間の幅、漢数字）", () => {
      expect(fix(`予備も${hour}時ごろに切れたままです。`).rules).toEqual([]);
      expect(fix(`予備も午後${hour % 12}時ごろに切れました。`).rules).toEqual([]);
      expect(fix(`予備も${(hour + 1) % 24}時ごろに切れました。`).rules).toEqual([]);
    });

    it("N 時間前も比べる。合っていれば通し、外れは今からの数に直す", () => {
      expect(fix("予備は 2 時間前に切れました。").rules).toEqual([]);
      const bad = fix("予備は 9 時間前に切れました。");
      expect(bad.rules).toContain("clock_said");
      expect(bad.text).toContain("2 時間前");
    });

    it("切れた話でない文・ほかの時計の時刻・時刻の分からない訓練は見ない", () => {
      expect(fix("業者は 7 時ごろ来る予定です。").rules).toEqual([]);
      expect(fix("業者は 7 時に来ますが、予備が切れました。").rules).toEqual([]);
      expect(fix("電池はあと 3 時間ほどです。").rules.includes("clock_said")).toBe(false);
      expect(sentenceFix("予備は 7 時に切れました。", slipContextOf(factsAt(cut + 120, null))).rules).toEqual([]);
    });
  });
});

describe("手なしの移動", () => {
  const answer = (over: Partial<PersonaAnswer> = {}): PersonaAnswer => ({ condition: "", location: "home", action: "", contactsCaremanager: true, from: "妻", pressesRed: false, redAnswers: null, speech: "", ...over });
  const greenTurn = (whereNow: "home" | "shelter" | "other", saying: string | null = null) => ({ person: "x", color: "green" as const, source: "family" as const, whereNow, injured: null, atHome: null, canMove: null, hasMedicine: null, saying, doing: null, ai: true, at: 10 });
  const factsFor = (id: string, over: { state?: PersonState | null; world?: WorldState; now?: number } = {}) =>
    factsOf({ person: id, world: over.world ?? EMPTY_WORLD, state: over.state ?? null, actions: [], now: over.now ?? 600, plan: planOf(seedInput(id)), inOutage: false, together: [], kin: null });

  describe("移れる人の決め（種の 10 人）", () => {
    it("歩ける人・同居の車のある人は移れる。寝たきりは同居に車があっても移れない。避難先の無い人は移れない", () => {
      expect(canLeaveHome(factsFor("p-10"))).toBe(true); // 歩ける
      expect(canLeaveHome(factsFor("p-08"))).toBe(true); // 歩ける
      expect(canLeaveHome(factsFor("p-06"))).toBe(true); // 歩行困難で同居の車
      expect(planOf(seedInput("p-02"))).toMatchObject({ bedridden: true, carer: true });
      expect(canLeaveHome(factsFor("p-02"))).toBe(false); // 寝たきり
      expect(canLeaveHome(factsFor("p-05"))).toBe(false); // 寝たきり・避難先なし
      expect(canLeaveHome(factsFor("p-04"))).toBe(false); // 避難先なし
    });

    it("一部介助で手段の家族が帰宅困難なら移れない。寝たきりの人も運べる人が来れば移れる", () => {
      expect(canLeaveHome(factsFor("p-03"))).toBe(true);
      expect(canLeaveHome(factsFor("p-03", { world: { ...EMPTY_WORLD, marks: { "p-03": { familyAway: 3 } } } }))).toBe(false);
      const came: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-02", role: "nurse", arrive: 500, back: 500, arrived: true, from: "action" }] };
      expect(canLeaveHome(factsFor("p-02", { world: came }))).toBe(true);
    });

    it("道が通れない間は誰も移れない。薬や電源が届いただけでは家から出ない", () => {
      const road: WorldState = { ...EMPTY_WORLD, roads: [{ id: "rd-1", label: "橋", open: false, person: null }] };
      expect(canLeaveHome(factsFor("p-10", { world: road }))).toBe(false);
      expect(helpedFlip({ mover: null }, "home")).toBe(false);
      expect(helpedFlip({ mover: { at: 1, what: "移送の車" } }, "home")).toBe(true);
    });
  });

  describe("記録", () => {
    it("記録は門を通った連絡からだけ。移った人は連絡がいる所を言わなくても、表の固定の家でも戻らない", () => {
      const moved = carryMoved(null, { color: "green", whereNow: "shelter", at: 3 });
      expect(moved).toEqual({ to: "shelter", at: 180, by: "turn" });
      const prev = { moved: moved! };
      expect(carryMoved(prev, { color: "red", whereNow: null, atHome: null, at: 5 })).toEqual(moved);
      expect(carryMoved(prev, { color: "red", whereNow: null, atHome: false, at: 5 })).toEqual(moved);
      expect(carryMoved(prev, { color: "green", whereNow: "home", at: 5, ai: false })).toEqual(moved);
      // 戻った言葉で門を通った AI の連絡だけ家へ
      expect(carryMoved(prev, { color: "green", whereNow: "home", at: 5, ai: true })).toEqual({ to: "home", at: 300, by: "turn" });
    });

    it("向かっている途中はいる所が家のまま。着いたら連絡が言わなくても移った先", () => {
      const now = 600;
      const going = state({ at: now / 60, color: "green", whereNow: "home", moved: { to: "shelter", at: now + GO_MINUTES, by: "plan" } });
      const before = factsFor("p-10", { state: going, now: now + 30 });
      expect(before.place?.where).toBe("home");
      expect(before.moving).toBeDefined();
      expect(factLines(before).join("\n")).toContain("向かうと言った");
      const after = factsFor("p-10", { state: going, now: now + GO_MINUTES });
      expect(after.place).toMatchObject({ where: "shelter", by: "plan" });
      const later = factsFor("p-10", { state: { ...going, at: (now + 300) / 60, color: "red", whereNow: null, atHome: null, moved: going.moved! }, now: now + 600 });
      expect(later.place?.where).toBe("shelter");
    });

    it("前の連絡より前に着いた移送の車も、いる所を言わない連絡のあとで移った先のまま", () => {
      const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-08", role: "transport", arrive: 300, back: 300, arrived: true, from: "action" }] };
      const f = factsFor("p-08", { world, state: state({ at: 8, atHome: null }), now: 600 });
      expect(f.place).toMatchObject({ where: "shelter", by: "transport" });
    });

    it("もう移った人に移送の車が来ても移った事にしない", () => {
      const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-10", role: "transport", arrive: 500, back: 500, arrived: true, from: "action" }] };
      const f = factsFor("p-10", { world, state: state({ at: 7, moved: { to: "shelter", at: 300, by: "plan" } }), now: 600 });
      expect(f.rideAfter).toBe(500);
      expect(f.place?.where).toBe("shelter");
    });
  });

  it("移り始めの記録は刻みから作り直しても本人の様子に残る", () => {
    const base = initialState("heavy_rain", ["p-10"], "2026-11-05T01:00:00.000Z", { clock: true });
    const going = { ...greenTurn("home"), person: "p-10", at: 10, move: { to: "shelter" as const, at: 660, by: "plan" as const } };
    const one = foldTick(base, { step: 0, hour: 10, incidents: [], turns: [going] }, 99);
    expect(one.people["p-10"].moved).toEqual(going.move);
    // いる所を言わない次の連絡でも残る
    const two = foldTick(one, { step: 1, hour: 12, incidents: [], turns: [{ ...going, color: "red", whereNow: null, atHome: null, move: undefined, at: 12 }] }, 99);
    expect(two.people["p-10"].moved).toEqual(going.move);
    const f = factsOf({ person: "p-10", world: two.world, state: two.people["p-10"], actions: [], now: 720, plan: planOf(seedInput("p-10")), inOutage: false });
    expect(f.place).toMatchObject({ where: "shelter", by: "plan" });
  });

  describe("門", () => {
    it("本人役の答えだけでは家から出ない。移れる人は移り始めの記録が付き、移れない人は家のまま", () => {
      const f = factsFor("p-10");
      const drop: string[] = [];
      const t = screenTurn(greenTurn("shelter"), f, (r) => drop.push(r))!;
      expect(t.whereNow).toBe("home");
      expect(t.move).toEqual({ to: "shelter", at: 600 + GO_MINUTES, by: "plan" });
      expect(drop).toContain("place_flip");
      const t2 = screenTurn(greenTurn("other"), factsFor("p-02"))!;
      expect(t2.whereNow).toBe("home");
      expect(t2.move).toBeUndefined();
    });

    it("初めての連絡でも、記録なしに外にいるとは言えない", () => {
      expect(screenTurn(greenTurn("shelter"), factsFor("p-05"))!.whereNow).toBe("home");
    });

    it("記録に無い移動の言葉を落とす。移れる人の刻みの言葉は残す。頼み事は残す", () => {
      const cannot = slipContextOf(factsFor("p-02"), "home");
      for (const s of ["計画どおり病院へ移ります。", "母を病院へ車で移します。", "病院に行きます。"]) expect(sentenceSlip(s, cannot)).toBe("move_said");
      for (const s of ["病院へ移りたいです。", "病院へ移る段取りを頼みます。", "病院に行けません。", "病院へ移る手だてをお願いします。"]) expect(sentenceSlip(s, cannot)).toBeNull();
      const can = slipContextOf(factsFor("p-10"), "home");
      expect(sentenceSlip("これから避難所へ歩いて移ります。", can)).toBeNull();
      expect(sentenceSlip("避難先に移りました。", can)).toBe("place_text");
      expect(sentenceSlip("家から移って、今は落ち着いています。", can)).toBe("place_text");
    });

    it("通話では記録を始められないので、移れる人でも向かっている途中でなければ「移ります」を落とす", () => {
      expect(sentenceSlip("これから避難所へ移ります。", talkContextOf(factsFor("p-10")))).toBe("move_said");
      const going = factsFor("p-10", { state: state({ at: 10, color: "green", whereNow: "home", moved: { to: "shelter", at: 660, by: "plan" } }), now: 610 });
      expect(sentenceSlip("これから避難所へ移ります。", talkContextOf(going))).toBeNull();
    });

    it("来ていない移送の車の言葉を落とす。前の連絡のあとに着いた車は言ってよい", () => {
      const none = slipContextOf(factsFor("p-08"), "home");
      expect(sentenceSlip("移送の車が来ました。", none)).toBe("move_said");
      expect(sentenceSlip("移送の車はまだ来ません。", none)).toBeNull();
      const world: WorldState = { ...EMPTY_WORLD, arrivals: [{ person: "p-08", role: "transport", arrive: 500, back: 500, arrived: true, from: "action" }] };
      expect(sentenceSlip("移送の車が来ました。", slipContextOf(factsFor("p-08", { world }), "home"))).toBeNull();
    });

    it("避難所にいる人の「病院に移りました」を落とす", () => {
      const f = factsFor("p-10", { state: state({ at: 5, color: "green", whereNow: "shelter" }) });
      expect(sentenceSlip("病院に移りました。", slipContextOf(f))).toBe("place_text");
    });

    it("帳面に移れるか・移れないかの行がある", () => {
      expect(factLines(factsFor("p-10")).join("\n")).toContain("移動: 計画の手段で移れる");
      expect(factLines(factsFor("p-02")).join("\n")).toContain("移動: 今は移れない");
      expect(factLines(factsFor("p-04")).join("\n")).not.toContain("移動:");
    });
  });

  describe("刻みの答えと表の行", () => {
    const input = (id: string, over: Partial<PersonaInput> = {}): PersonaInput => ({ step: 3, hour: 10, person: id, world: EMPTY_WORLD, incidents: [], state: null, lastAction: null, actions: [], fixed: [], toMinute: 600, since: 0, reasons: ["round"], ...over });

    it("移れる人の「これから移ります」に記録が付き、次の刻みで移った先になる", () => {
      const persona = buildPersona(seedInput("p-10"), { on: "2026-11-05" });
      const [t] = personaTurns(input("p-10"), persona, answer({ speech: "これから避難所へ歩いて移ります。" }));
      expect(t.move).toEqual({ to: "shelter", at: 600 + GO_MINUTES, by: "plan" });
      expect(t.whereNow).toBe("home");
      expect(startsMove(factsFor("p-10"), ["これから避難所へ歩いて移ります。"])).toBe(true);
    });

    it("寝たきりの人の「病院へ移りました」は言葉も答えも通らない", () => {
      const persona = buildPersona(seedInput("p-02"), { on: "2026-11-05" });
      const [t] = personaTurns(input("p-02"), persona, answer({ from: "夫", location: "other", pressesRed: true, redAnswers: { injured: null, atHome: false, canMove: null, hasMedicine: null }, speech: "妻は病院へ移りました。電話を待ちます。" }));
      expect(t.atHome).toBe(true);
      expect(t.move).toBeUndefined();
      expect(t.saying ?? "").not.toContain("移りました");
    });

    it("移った人の表の行の家は移った先に直し、家にいる前提の文を使わない", () => {
      const persona = buildPersona(seedInput("p-08"), { on: "2026-11-05" });
      const moved = state({ at: 5, color: "green", whereNow: "shelter", moved: { to: "shelter", at: 300, by: "turn" } });
      const fixed = [{ person: "p-08", color: "green" as const, source: "agent" as const, whereNow: "home" as const, saying: "家は大丈夫" }];
      const text = tickText(input("p-08", { state: moved, fixed }), persona);
      expect(text).toContain("いる所 避難所");
      expect(text).not.toContain("家は大丈夫");
      const [t] = personaTurns(input("p-08", { state: moved, fixed: fixed as PersonaInput["fixed"] }), persona, answer({ from: "本人", speech: "" }));
      expect(t.whereNow).toBe("shelter");
      expect(t.saying).toBeNull();
    });
  });
});

describe("呼び出しの数", () => {
  const isRound = (p: string) => p.startsWith("r");
  const never = () => false;

  it("巡回だけの人は呼び出しの空きに相乗りし、空きが無ければ次へ残す", () => {
    expect(seatRounds(["r1", "r2"], isRound, never, 4)).toEqual([]);
    expect(seatRounds(["a", "r1", "r2", "r3", "r4"], isRound, never, 4)).toEqual(["a", "r1", "r2", "r3"]);
    expect(seatRounds(["a", "b", "c", "d", "r1"], isRound, never, 4)).toEqual(["a", "b", "c", "d"]);
    expect(seatRounds(["a", "b", "c", "d", "e", "r1"], isRound, never, 4)).toEqual(["a", "b", "c", "d", "e", "r1"]);
  });

  it("待ちすぎた巡回の人は自分で呼び出しを開く。ほかの理由の人は巡回で減らない", () => {
    expect(seatRounds(["r1", "r2"], isRound, (p) => p === "r2", 4)).toEqual(["r1", "r2"]);
    expect(seatRounds(["a", "b", "c", "d", "r1"], isRound, () => true, 4)).toEqual(["a", "b", "c", "d", "r1"]);
    expect(seatRounds(["a", "b"], isRound, never, 4)).toEqual(["a", "b"]);
  });

  it("いる所を聞く言葉は記録で答える。記録の無い人・ほかの問いは本人役", () => {
    for (const s of ["今どこにいますか", "えっと、今どこですか", "さっきは家にいると言っていましたが、避難所にいるんですか", "避難所にいますか"]) expect(isPlaceAsk({ said: s })).toBe(true);
    for (const s of ["近くに誰かいますか", "けがはありませんか", "酸素の機械の音がしていますか"]) expect(isPlaceAsk({ said: s })).toBe(false);
    expect(isPlaceAsk({ ask: "where", said: "" })).toBe(true);
    const f = (place: Parameters<typeof placeReplyOf>[0]["place"], over = {}) => placeReplyOf({ place, plan: null, ...over });
    expect(f({ where: "home", at: 1 })).toBe("家にいます。");
    expect(f({ where: "shelter", at: 1 })).toBe("避難所にいます。");
    expect(f({ where: "other", at: 1, by: "plan" })).toBe("避難先にいます。");
    expect(f({ where: "other", at: 1, by: "wandering" })).toBe("どこにいるか分かりません。");
    expect(f({ where: "other", at: 1, by: "turn", loose: true })).toBeNull();
    expect(f(null)).toBeNull();
    expect(f({ where: "home", at: 1 }, { moving: { to: "shelter", at: 9, by: "plan" } })).toBe("今、向かっている途中です。");
  });
});
