// T80（2 回目の点検）: 375 の担当一覧で「本人が「けが」「動けない」」の最後の 1 字が次の行に落ちていた（日本語はどの字の間でも折れる）。
// 理由の 1 行を句の塊に分け、折れるのは塊の間だけにする（言葉は表のまま。並べ直さない・削らない）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReasonText } from "../../components/list/ReasonText.tsx";
import { reasonChunks } from "./reason-chunks.ts";

describe("理由の句の塊（reasonChunks）", () => {
  it("「」の続きは 」「 の間で分ける（「本人が「けが」」「「動けない」」）", () => {
    expect(reasonChunks("本人が「けが」「動けない」")).toEqual(["本人が「けが」", "「動けない」"]);
    expect(reasonChunks("家族が「無事じゃない」")).toEqual(["家族が「無事じゃない」"]);
  });

  it("「、」のあとで分け、空白の所でも分ける。数と単位（3 時間・4.2 時間）は離さない", () => {
    expect(reasonChunks("透析先 未確認、連絡なし 4.2 時間")).toEqual(["透析先", " ", "未確認、", "連絡なし", " ", "4.2 時間"]);
    expect(reasonChunks("人工呼吸器 内蔵電池 3 時間を超過")).toEqual(["人工呼吸器", " ", "内蔵電池", " ", "3 時間を超過"]);
    expect(reasonChunks("本人が「けが」、録音の分類（AI）: 動けない")).toEqual(["本人が「けが」、", "録音の分類（AI）:", " ", "動けない"]);
  });

  it("つなぎ直すと元の 1 行と同じ（空白は塊の外に残す）", () => {
    for (const s of [
      "本人が「けが」「動けない」",
      "透析先 未確認、連絡なし 4.2 時間、支援者なし",
      "受入のあとも 酸素 内蔵電池 2 時間を超過、支援者なし",
      "電池が切れたあとに無事の報告、酸素 内蔵電池 2 時間を超過",
      "到着 みどり小学校",
      "",
    ]) {
      expect(reasonChunks(s).join("")).toBe(s);
    }
  });
});

describe("理由の描き方（ReasonText）", () => {
  it("塊ごとに折れない箱（inline-block）。文字は元のまま", () => {
    const html = renderToStaticMarkup(createElement(ReasonText, { text: "本人が「けが」「動けない」" }));
    expect(html).toBe('<span class="inline-block">本人が「けが」</span><span class="inline-block">「動けない」</span>');
    const spaced = renderToStaticMarkup(createElement(ReasonText, { text: "透析先 未確認、連絡なし 4.2 時間" }));
    expect(spaced.replace(/<[^>]+>/g, "")).toBe("透析先 未確認、連絡なし 4.2 時間");
  });
});
