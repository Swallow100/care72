// T182: 11/7 夜の見直しの訓練の不具合。形は見直しの再現の台から起こし直した（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { timeOf } from "./engine.ts";
import { clockOfMinute, clockWhen, dayLine, startHourOf } from "./night.ts";
import { simTimeText } from "./time-text.ts";

describe("1. 発災の時刻の分", () => {
  const startedAt = "2026-11-04T01:50:00.000Z"; // 日本の 10:50

  it("帳面の時計が画面の時刻とそろう（分で切り捨てない）", () => {
    const s = timeOf({ startedAt });
    expect(simTimeText(startedAt, 410)).toContain("17:40");
    expect(clockWhen(410, s.startHour!, 410)).toBe("17 時 40 分ごろ");
    expect(clockOfMinute(410, s.startHour!)).toEqual({ day: 1, hour: 17, min: 40 });
  });

  it("時ちょうどの発災は前と同じ", () => {
    expect(startHourOf("2026-11-05T01:00:00.000Z")).toBe(10);
    expect(dayLine(36, 10)).toContain("発災は 10 時ごろ。今は 2 日目の 22 時ごろ");
  });

  it("今の時刻の 1 行も分で数える（10:50 から 1 時間 10 分は 12 時）", () => {
    const h = startHourOf(startedAt)!;
    expect(dayLine(70 / 60, h)).toContain("発災は 10 時 50 分ごろ。今は 12 時ごろ");
    expect(dayLine(13.5, h)).toContain("今は 2 日目の 0 時ごろ");
  });

  it("浮動小数で分がずれない（日をまたぐ分も）", () => {
    for (let m = 0; m < 60; m++) {
      const at = `2026-11-04T14:${String(m).padStart(2, "0")}:00.000Z`; // 日本の 23:mm
      const h = startHourOf(at)!;
      expect(clockOfMinute(0, h)).toEqual({ day: 1, hour: 23, min: m });
      expect(clockOfMinute(60, h)).toEqual({ day: 2, hour: 0, min: m });
    }
  });
});
