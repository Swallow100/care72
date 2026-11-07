// T177: 評価の 10 回目で人ごとの筋に残った形（切れた時刻の言葉・手なしの移動・呼び出しの数）。文は手で組み、Claude は呼ばない

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { PersonaInput, PersonState } from "./engine.ts";
import { clockOfMinute, clockStartOf, clockWhen, NIGHT_START_HOUR } from "./night.ts";
import { factLines, factsOf, planOf, sentenceFix, slipContextOf, whenWordsOf } from "./person-facts.ts";
import { buildPersona, callText, clockWords, tickText, visitText } from "./persona.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";

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
      expect(fix("電池はあと 3 時間ほどです。").rules.includes("clock_said")).toBe(false);
      expect(sentenceFix("予備は 7 時に切れました。", slipContextOf(factsAt(cut + 120, null))).rules).toEqual([]);
    });
  });
});
