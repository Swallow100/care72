// T173 使う側の模擬の 3 回目で残った迷いを減らす（docs/tasks/T173.md）。画面は renderToStaticMarkup と部品の元の文で確かめる。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIRM_LABELS } from "./ui/labels.ts";
import { RESET_LABELS } from "./seed/labels.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const short = (s: string) => [...s].length >= 2 && [...s].length <= 4;

describe("1. 最初に戻す", () => {
  const page = read("../app/office/page.tsx");
  it("画面の頭に置く（担当の長い表より前。読みの順で 115 個中 114 番目だった）", () => {
    expect(page.indexOf("<ResetAction />")).toBeGreaterThan(-1);
    for (const later of ["<ModeSection state=", "<AssignSection people=", "<SurveyPanel overview="]) {
      expect(page.indexOf("<ResetAction />")).toBeLessThan(page.indexOf(later));
    }
    // 右の列の面に戻さない
    expect(page).not.toContain("<ResetSection");
  });
  it("窓の決める方に「戻す」を使わない（2 つの窓で同じ語だった）。何をするかの語で、取り違えない", () => {
    expect(CONFIRM_LABELS.resetOk).toBe("初期化");
    expect(CONFIRM_LABELS.normalOk).toBe("平時復帰");
    expect(CONFIRM_LABELS.resetOk).not.toBe(CONFIRM_LABELS.normalOk);
    expect(short(CONFIRM_LABELS.stayCurrent)).toBe(true);
    expect(page).toContain("cancel: CONFIRM_LABELS.stayCurrent");
  });
  it("押す物の名前は最初に戻すのまま（目標と手引きの言葉）", () => {
    expect(RESET_LABELS.reset).toBe("最初に戻す");
    expect(page).toContain("{RESET_LABELS.reset}");
  });
});
