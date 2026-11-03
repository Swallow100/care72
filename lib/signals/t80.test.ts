// T80（2 回目の点検）: 送り終わりのボタンが本人は「もう 一度」、家族は「最初から」と違っていた。同じ言葉「最初から」に（定型は 1 か所）。

import { describe, expect, it } from "vitest";
import { easy, plainText } from "../forms/easy-words.ts";
import { FAMILY_PHRASES, PHONE_PHRASES } from "./phrases.ts";

describe("送り終わりのボタンの言葉（T80）", () => {
  it("本人と家族で同じ「最初から」（ふりがな さいしょ）", () => {
    expect(FAMILY_PHRASES.restart).toBe(PHONE_PHRASES.again);
    expect(plainText(easy(PHONE_PHRASES.again))).toBe("最初から");
    expect(PHONE_PHRASES.again).toBe("{最初|さいしょ}から");
  });
});
