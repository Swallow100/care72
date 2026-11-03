import { describe, expect, it } from "vitest";
import { CLASS_LOG_LABELS } from "./classify/labels.ts";
import * as labels from "./labels.ts";
import { COLOR_LABELS, HEAD_LABELS, TIMELINE_KIND_LABELS } from "./labels.ts";
import { COLUMN_LABELS, DETAIL_LABELS } from "./list/labels.ts";
import { OFFICE_LABELS } from "./office/labels.ts";

// 画面の言葉で本人の状態を言い切らない（docs/DECISIONS.md「運営の返事を受けて」、CLAUDE.md「守ること」）。
const ASSERTING_WORDS = ["危険", "診断", "判定", "重症", "病気がわかる"];

describe("画面の言葉", () => {
  it("赤は連絡の順の言葉「至急」、灰は「不明」（11/3）。緑 無事・黄 要確認はそのまま", () => {
    expect(COLOR_LABELS).toEqual({ red: "至急", yellow: "要確認", gray: "不明", green: "無事" });
  });

  it("発災時の言葉（11/3 の校正、docs/DECISIONS.md）。採らなかった案の言葉はそのまま", () => {
    expect(DETAIL_LABELS).toMatchObject({ clocks: "残り時間", signals: "安否", override: "順番変更", expired: "失効" });
    expect(TIMELINE_KIND_LABELS).toMatchObject({ signal: "安否", override: "順番変更" });
    expect([COLUMN_LABELS.plan, HEAD_LABELS.plan, OFFICE_LABELS.plan]).toEqual(["避難計画", "避難計画", "避難計画"]);
    expect([COLUMN_LABELS.tier, COLUMN_LABELS.supporter, DETAIL_LABELS.startsOn, CLASS_LOG_LABELS.edit]).toEqual([
      "連絡順",
      "支援者",
      "で開始",
      "分類修正",
    ]);
  });

  it("連絡の順番の言葉（11/3 16:0x 確定。アドバイザーの勧めで「優先」をやめる）: 列・本人のページの上・職員の並びは「連絡順」、上書きは「順番変更」", () => {
    expect([COLUMN_LABELS.tier, HEAD_LABELS.priority, DETAIL_LABELS.override, TIMELINE_KIND_LABELS.override]).toEqual([
      "連絡順",
      "連絡順",
      "順番変更",
      "順番変更",
    ]);
    const words = Object.values(labels).flatMap((v) =>
      Array.isArray(v) ? v.flat().map(String) : Object.values(v as Record<string, string>),
    );
    for (const w of words) expect(w).not.toContain("優先");
  });

  it("どの言葉にも、本人の状態を言い切る言葉が入っていない", () => {
    const words = Object.values(labels).flatMap((v) =>
      Array.isArray(v) ? v.flat().map(String) : Object.values(v as Record<string, string>),
    );
    expect(words.length).toBeGreaterThan(20);
    for (const w of words) for (const bad of ASSERTING_WORDS) expect(w).not.toContain(bad);
  });
});
