// 同じ出来事の赤を重ねて読む（T10 の問い、T13 の案）。lib/triage/from-ledger.ts の foldSignals と、
// それを通す lib/disaster/triage.ts の triageInDisaster（担当一覧・本人のページ・様式 9 が通る所）。

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toTriageSignal, triageInDisaster, type SignalForTriage } from "../disaster/triage.ts";
import { foldSignals, toTriagePerson } from "./from-ledger.ts";
import type { Situation, TriageSignal } from "./index.ts";

const T0 = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const S: Situation = { now: at(2), disasterAt: at(0), outageAt: null };

const yamada = toTriagePerson(SEED_PEOPLE.find((p) => p.person.id === "p-01")!);
const sato = toTriagePerson(SEED_PEOPLE.find((p) => p.person.id === "p-04")!);

const red = (h: number, x: Partial<TriageSignal> = {}): TriageSignal => ({ color: "red", source: "self", at: at(h), ...x });
const green = (h: number, x: Partial<TriageSignal> = {}): TriageSignal => ({ color: "green", source: "self", at: at(h), ...x });

describe("foldSignals", () => {
  it("けがの赤のあとの答えなしの赤は、けが・動けないを引き継ぐ", () => {
    const out = foldSignals(yamada, [red(0.5, { injured: true, canMove: false }), red(0.6, { injured: null, canMove: null })]);
    expect(out[1]).toMatchObject({ injured: true, canMove: false, at: at(0.6) });
    // 信号の数と順は変えない。先の赤はそのまま
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ injured: true, canMove: false, at: at(0.5) });
  });

  it("あとの赤に答えがあれば、その答えを使う（けが なし で上書き）", () => {
    const out = foldSignals(yamada, [red(0.5, { injured: true }), red(0.6, { injured: false })]);
    expect(out[1].injured).toBe(false);
  });

  it("録音の分類は前の赤の分類と合わせる（重ねない）", () => {
    const out = foldSignals(yamada, [red(0.5, { classes: ["immobile"] }), red(0.6, { classes: ["unknown", "immobile"] })]);
    expect(out[1].classes).toEqual(["immobile", "unknown"]);
  });

  it("緑が来たら出来事は終わり（あとの赤に引き継がない）", () => {
    const out = foldSignals(yamada, [red(0.5, { injured: true }), green(0.6), red(0.7)]);
    expect(out[2].injured ?? null).toBeNull();
  });

  it("本人の報告を当てにしない人の本人の緑は、出来事を終わらせない。家族の緑は終わらせる", () => {
    expect(sato.selfReportUnreliable).toBe(true);
    const kept = foldSignals(sato, [red(0.5, { injured: true }), green(0.6), red(0.7)]);
    expect(kept[2].injured).toBe(true);
    const ended = foldSignals(sato, [red(0.5, { injured: true }), green(0.6, { source: "family" }), red(0.7)]);
    expect(ended[2].injured ?? null).toBeNull();
  });

  it("引き継ぐのは同じ出どころの赤からだけ（本人のけがを家族の赤に移さない）", () => {
    const out = foldSignals(yamada, [red(0.5, { injured: true }), red(0.6, { source: "family" }), red(0.7)]);
    expect(out[1].injured ?? null).toBeNull();
    expect(out[2].injured).toBe(true);
  });

  it("未知の信号（家族の「分からない」）は新しい情報なしとして外す。前の赤の引き継ぎも切らない", () => {
    const unknown = (h: number): TriageSignal => ({ color: "unknown", source: "family", at: at(h) });
    expect(foldSignals(yamada, [red(0.5), unknown(0.6)]).map((s) => s.color)).toEqual(["red"]);
    expect(foldSignals(yamada, [green(0.5), unknown(0.6)]).map((s) => s.color)).toEqual(["green"]);
    expect(foldSignals(yamada, [unknown(0.6)])).toEqual([]);
    const out = foldSignals(yamada, [red(0.5, { injured: true }), unknown(0.6), red(0.7)]);
    expect(out).toHaveLength(2);
    expect(out[1].injured).toBe(true);
  });

  it("時刻の順に読む（入れた順が逆でも）", () => {
    const out = foldSignals(yamada, [red(0.6), red(0.5, { canMove: false })]);
    expect(out[0].canMove).toBe(false);
    expect(out[1].canMove).toBe(false);
  });
});

describe("分類が Claude か人か（classified_by、T12）", () => {
  const row = (classes: string[] | null, by: "claude" | "care_manager" | null, h: number, x: Partial<SignalForTriage> = {}) =>
    toTriageSignal({
      person_id: "p-01",
      color: "red",
      source: "self",
      injured: null,
      can_move: null,
      classes: classes ? JSON.stringify(classes) : null,
      classified_by: by,
      occurred_at: at(h),
      ...x,
    });
  const reason = (signals: TriageSignal[]) => triageInDisaster({ person: yamada, signals, town: null }, S).reason;

  it("Claude の分類は「録音の分類（AI）」、ケアマネが直した分類は「分類（ケアマネ）」（AI の印なし）", () => {
    expect(row(["immobile"], "care_manager", 0.5)).toMatchObject({ staffClasses: ["immobile"] });
    expect(row(["immobile"], "care_manager", 0.5).classes).toBeUndefined();
    expect(reason([row(["immobile"], "claude", 0.5)])).toBe("録音の分類（AI）: 動けない");
    expect(reason([row(["immobile"], "care_manager", 0.5)])).toBe("分類（ケアマネ）: 動けない");
    expect(reason([row(["immobile"], "care_manager", 0.5)])).not.toContain("AI");
  });

  it("ボタンの答えは分類より先。答えにある言葉は分類から重ねない", () => {
    expect(reason([row(["immobile", "injury"], "care_manager", 0.5, { can_move: 0 })])).toBe("本人が「動けない」、分類（ケアマネ）: けが");
  });

  it("重ねて読むとき、ケアマネが外した分類を前の赤から戻さない（人の直しが最新として勝つ）", () => {
    // 前の赤は Claude が「動けない」、次の赤をケアマネが「不明」に直した → あとの答えなしの赤でも「動けない」は戻らない
    const signals = [row(["immobile"], "claude", 0.5), row(["unknown"], "care_manager", 0.6), row(null, null, 0.7)];
    const r = triageInDisaster({ person: yamada, signals, town: null }, S);
    expect(r).toMatchObject({ rule: "red", reason: "本人が「無事じゃない」" });
    // ケアマネが「けが」に直した: 前の Claude の「動けない」は捨て、人の「けが」だけ
    expect(reason([row(["immobile"], "claude", 0.5), row(["injury"], "care_manager", 0.6)])).toBe("分類（ケアマネ）: けが");
    // 直したあとの新しい録音の Claude の分類は足す
    expect(reason([row(["injury"], "care_manager", 0.5), row(["immobile"], "claude", 0.6)])).toBe(
      "分類（ケアマネ）: けが、録音の分類（AI）: 動けない",
    );
  });
});

describe("triageInDisaster は重ねて読んだ信号を表に渡す", () => {
  it("けが・動けないの赤 → 答えなしの赤（音声）: 理由は「本人が「けが」「動けない」」のまま、組 0", () => {
    const r = triageInDisaster(
      { person: yamada, signals: [red(0.5, { injured: true, canMove: false }), red(0.6, { injured: null, canMove: null })], town: null },
      S,
    );
    expect(r).toMatchObject({ color: "red", rule: "red_injury", group: 0, reason: "本人が「けが」「動けない」" });
  });

  it("答えなしの赤のあとに録音の分類（AI）で動けない: 印つきの理由のまま", () => {
    const r = triageInDisaster(
      { person: yamada, signals: [red(0.5, { classes: ["immobile"] }), red(0.6)], town: null },
      S,
    );
    expect(r).toMatchObject({ rule: "red_injury", reason: "録音の分類（AI）: 動けない" });
  });

  it("本人の赤のあとに家族が「分からない」（未知）: 赤のまま下がらない。そのあと緑が来たら赤が解ける", () => {
    const unknown: TriageSignal = { color: "unknown", source: "family", at: at(0.6) };
    const stays = triageInDisaster({ person: yamada, signals: [red(0.5, { canMove: false }), unknown], town: null }, S);
    expect(stays).toMatchObject({ color: "red", rule: "red_injury", reason: "本人が「動けない」" });
    const plain = triageInDisaster({ person: yamada, signals: [red(0.5), unknown], town: null }, S);
    expect(plain).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });
    const solved = triageInDisaster(
      { person: yamada, signals: [red(0.5), unknown, green(0.7, { source: "family" })], town: null },
      S,
    );
    expect(solved).toMatchObject({ color: "green", reason: "家族が「無事」" });
  });

  it("緑のあとの「分からない」で緑から下がらない（認知症の人の本人の緑は参考のまま）", () => {
    const unknown: TriageSignal = { color: "unknown", source: "family", at: at(0.6) };
    expect(triageInDisaster({ person: yamada, signals: [green(0.5), unknown], town: null }, S).color).toBe("green");
    const r = triageInDisaster({ person: sato, signals: [green(0.5), unknown], town: null }, S);
    expect(r.qualifiers).toContain("self_green_set_aside");
  });

  it("赤のあとの緑は緑（重ねて読むのは赤の中だけ）", () => {
    const r = triageInDisaster({ person: yamada, signals: [red(0.5, { injured: true }), green(0.6)], town: null }, S);
    expect(r.color).not.toBe("red");
  });
});
