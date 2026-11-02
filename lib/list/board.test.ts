// 受け入れのテスト（lib/triage/heavy-rain.test.ts）の大雨の筋が、担当一覧の画面の並び（lib/caseload.ts の行と並び替え）と
// 一致するか。画面は色と順位を計算し直さず、ルールの表の結果をそのまま並べる（docs/tasks/T13.md「守ること」）。
// あわせて T13 の終わりの形（停電 3 時間すぎ: 山田が最上位、小林が赤で上、田中が黄「透析先 未確認」、伊藤に「支援者なし」）と、
// 優先の番号が並べ替えで変わらないこと、上書きが並びに効くこと。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { sortCaseload, SORT_KEYS, toCaseloadRows, type CaseloadDisaster } from "../caseload.ts";
import type { StoredOverride } from "../disaster/override.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { EXPECTED, HOURS, SIGNALS, situation } from "../triage/heavy-rain.fixture.ts";
import { rank, type Color, type TriageSignal } from "../triage/index.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const NAME = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.person.name.split(" ")[0]]));
const CHAR: Record<Color, string> = { red: "赤", yellow: "黄", gray: "灰", green: "緑" };

function disasterAt(h: number, extra: Partial<CaseloadDisaster> = {}): CaseloadDisaster {
  return {
    situation: { ...situation(h), outageTowns: null },
    signals: new Map(Object.entries(SIGNALS)),
    ...extra,
  };
}

function screen(h: number, extra: Partial<CaseloadDisaster> = {}) {
  return sortCaseload(toCaseloadRows(people, clocks, contacts, "2026-11-05", disasterAt(h, extra)), "tier");
}

describe("大雨の筋の 10 人が、担当一覧の既定の並び（優先）と一致する", () => {
  for (const h of HOURS) {
    it(`停電から ${h} 時間: 画面の並び・色・理由がルールの表と同じ、優先の番号は 1 から順`, () => {
      const rows = screen(h);
      expect(rows.map((r) => `${NAME[r.id]} ${CHAR[r.triage!.color]} ${r.triage!.reason}`)).toEqual(EXPECTED[h]);
      const table = rank(
        SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: SIGNALS[p.person.id] ?? [] })),
        situation(h),
      );
      expect(rows.map((r) => r.id)).toEqual(table.map((t) => t.personId));
      expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  }

  it("T13 の終わりの形（停電 3 時間すぎ）: 山田が最上位、小林が赤で 2 番、田中が黄「透析先 未確認」、伊藤に「支援者なし」", () => {
    const rows = screen(3.1);
    expect(rows[0]).toMatchObject({ id: "p-01", rank: 1, triage: { color: "red" } });
    expect(rows[1]).toMatchObject({ id: "p-02", rank: 2, triage: { color: "red", reason: "人工呼吸器 内蔵電池 3 時間を超過" } });
    expect(rows.find((r) => r.id === "p-03")!.triage).toMatchObject({ color: "yellow", reason: "無事・透析先 未確認" });
    expect(rows.find((r) => r.id === "p-05")!.triage!.reason).toContain("支援者なし");
    // 残り・最終連絡の列
    expect(rows[0].remain).toMatchObject({ label: "酸素 内蔵電池", over: true, tone: "urgent" });
    expect(rows[0].lastContact).toMatchObject({ source: "本人", color: "red", tone: "urgent" });
    expect(rows.find((r) => r.id === "p-02")!.lastContact).toBeNull();
  });

  it("ほかの列で並べ替えても優先の番号は同じ。状態の並びは色の悪い順", () => {
    const base = new Map(screen(6).map((r) => [r.id, r.rank]));
    const rows = toCaseloadRows(people, clocks, contacts, "2026-11-05", disasterAt(6));
    for (const k of SORT_KEYS) {
      for (const r of sortCaseload(rows, k)) expect(r.rank, `${k} ${r.id}`).toBe(base.get(r.id));
    }
    const colors = sortCaseload(rows, "state").map((r) => r.triage!.color);
    expect(colors).toEqual([...colors].sort((a, b) => ["red", "yellow", "gray", "green"].indexOf(a) - ["red", "yellow", "gray", "green"].indexOf(b)));
    // 最終連絡は連絡の無い人が先、残りは短い順
    const contact = sortCaseload(rows, "contact");
    expect(contact.slice(0, 4).every((r) => r.lastContact === null)).toBe(true);
    const remain = sortCaseload(rows, "remain").map((r) => r.remain?.hours ?? Infinity);
    expect(remain).toEqual([...remain].sort((a, b) => a - b));
  });

  it("ケアマネの上書きが並びに効く（渡辺を至急に上げると赤の組へ）", () => {
    const up: StoredOverride = {
      to: "red",
      baseAtOverride: "gray",
      reason: "近所で土砂",
      by: "acct-yamamoto",
      at: situation(6).now,
      byName: "山本",
    };
    const rows = screen(6, { overrides: new Map([["p-09", up]]) });
    const p9 = rows.find((r) => r.id === "p-09")!;
    expect(p9.triage).toMatchObject({ color: "red", baseColor: "gray", override: { reason: "近所で土砂", expired: false } });
    expect(rows.slice(0, 3).map((r) => r.id)).toContain("p-09");
    expect(p9.rank).toBeLessThanOrEqual(3);
  });

  it("同じ出来事の赤を重ねて読む: 山田のけがの赤のあとに答えなしの赤（音声）が来ても組 0「本人が「けが」」", () => {
    const signals: Record<string, TriageSignal[]> = {
      ...SIGNALS,
      "p-01": [
        { color: "red", source: "self", at: situation(0.5).now, injured: true, canMove: null },
        { color: "red", source: "self", at: situation(0.6).now, injured: null, canMove: null, classes: ["unknown"] },
      ],
    };
    const rows = screen(3, { signals: new Map(Object.entries(signals)) });
    expect(rows[0]).toMatchObject({ id: "p-01", triage: { rule: "red_injury", group: 0, reason: "本人が「けが」" } });
  });
});
